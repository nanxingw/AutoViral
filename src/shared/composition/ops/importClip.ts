// ADR-009 (PRD-0014 S6) — `importClip`: register a finished/external video file
// back onto the timeline as a first-class edit verb. This is the write half of
// `autoviral clip import <path>` (and the素材库 "添加到时间线" convergence
// target). It is a PURE, IO-free composition mutation: the ffprobe I/O lives in
// the server (`src/server/probe-media.ts`), which hands its result in as
// `probe` — so the op stays consumable by BOTH the bridge read-modify-write
// path and (potentially) the studio store, exactly like every other op here.
//
// It does three inseparable things atomically:
//   1. registers an AssetEntry(kind: video) carrying the probed physical
//      metadata (duration/width/height/fps),
//   2. records a ProvenanceEdge(operation.type: "import", fromAssetId: null),
//   3. places a VideoClip (in=0, out=duration) on the target video lane.
//
// A probe with no usable duration must NEVER reach here as a placed clip: a
// zero/NaN-duration clip corrupts the timeline (out<=in, infinite ranges), so
// the op re-validates `durationSec` as its own invariant (belt-and-suspenders —
// the route already rejects a failed probe with a 4xx) and throws
// CompositionOpError{code:4} rather than placing a poison clip.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`,
// `comp.tracks`, `comp.assets`, `comp.provenance`, or any clips array with a
// fresh object (that breaks the immer draft proxy on the store side). We
// push/splice the EXISTING arrays so they keep their identity.

import type {
  AssetEntry,
  Composition,
  ProvenanceEdge,
  ProvenanceOperation,
  Track,
  VideoClip,
} from "../../composition.js";
import { CompositionOpError } from "./errors.js";
import { snapToFrame } from "../../frame.js";
import { compositionContentEnd } from "./setDuration.js";

/**
 * Physical probe result the server's ffprobe wrapper produces. Only
 * `durationSec` is required — it is the load-bearing field (a clip with no
 * duration destroys the timeline). Dimensions / fps are best-effort metadata.
 */
export interface ImportProbe {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface ImportClipParams {
  /** Physical probe (ffprobe) result for the source file. */
  probe: ImportProbe;
  /** Work-relative uri stored on BOTH the AssetEntry and the VideoClip.src. */
  src: string;
  /** Target video lane. Omit → the FIRST video track. */
  trackId?: string;
  /** Explicit trackOffset (seconds). Omit → append at end of the target lane. */
  atSec?: number;
  /**
   * Wipe every video track's clips first, then place this one clip at 0. Audio /
   * text / overlay lanes are LEFT UNTOUCHED (a full-timeline replace keeps the
   * existing music bed / captions). Overrides `atSec` (the single clip sits at 0).
   */
  replaceTimeline?: boolean;
  /** Human-facing asset name (optional). */
  name?: string;
  /** Provenance actor. Defaults to "agent" (the CLI import path). */
  actor?: ProvenanceOperation["actor"];
}

function newImportClipId(): string {
  return `vc_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function newImportAssetId(): string {
  return `imp_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** End-of-track offset for a video lane (max clip end; 0 for an empty lane). */
function endOfVideoTrack(track: Track): number {
  let end = 0;
  for (const clip of track.clips) {
    if (clip.kind !== "video") continue;
    const clipEnd = clip.trackOffset + (clip.out - clip.in);
    if (clipEnd > end) end = clipEnd;
  }
  return end;
}

/**
 * Import `src` onto the timeline. Returns the minted `{ clipId, assetId }` so
 * callers (CLI, bridge, tests) can immediately reference the new clip/asset.
 *
 * Throws CompositionOpError{code:4} when:
 *  - `probe.durationSec` is not a finite positive number (poison-clip guard),
 *  - `trackId` is given but no such track exists / it is not a video lane,
 *  - no `trackId` is given and the composition has no video track at all.
 */
export function importClip(
  comp: Composition,
  p: ImportClipParams,
): { clipId: string; assetId: string } {
  const { probe, src, trackId, atSec, replaceTimeline, name, actor } = p;

  // (1) Poison-clip guard — the single invariant this op exists to protect.
  const durationSec = probe?.durationSec;
  if (
    typeof durationSec !== "number" ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    throw new CompositionOpError(
      `importClip: probe returned no usable duration (${String(durationSec)}) for ${src} — refusing to place a zero/NaN-duration clip`,
      4,
    );
  }

  // (2) Resolve the destination video lane.
  let track: Track | undefined;
  if (trackId) {
    track = comp.tracks.find((t) => t.id === trackId);
    if (!track) {
      throw new CompositionOpError(`importClip: no track with id ${trackId}`, 4);
    }
    if (track.kind !== "video") {
      throw new CompositionOpError(
        `importClip: track ${trackId} is a ${track.kind} lane, not video`,
        4,
      );
    }
  } else {
    track = comp.tracks.find((t) => t.kind === "video");
    if (!track) {
      throw new CompositionOpError(
        "importClip: composition has no video track to import onto",
        4,
      );
    }
  }

  // (3) replaceTimeline — empty EVERY video lane's clips in place (keep array
  // identity via splice), leaving audio/text/overlay lanes untouched. Cut-point
  // transitions on those lanes MUST be emptied in lockstep: a transition's
  // `afterClipId` now points at a clip we just removed, and the write-path
  // refine (refineTrack) rejects a dangling afterClipId with a 400 — so a stored
  // work containing transitions would fail `clip import --replace-timeline`.
  if (replaceTimeline) {
    for (const t of comp.tracks) {
      if (t.kind === "video" && t.clips.length > 0) {
        t.clips.splice(0, t.clips.length);
        if (Array.isArray(t.transitions) && t.transitions.length > 0) {
          t.transitions.splice(0, t.transitions.length);
        }
      }
    }
  }

  // (4) Register the AssetEntry (physical metadata only — provenance carries the
  // "how it came to exist" fields). `metadata` omits undefined leaves so a probe
  // that couldn't read dims doesn't persist explicit undefineds.
  const assetId = newImportAssetId();
  const metadata: AssetEntry["metadata"] = { duration: durationSec };
  if (typeof probe.width === "number") metadata.width = probe.width;
  if (typeof probe.height === "number") metadata.height = probe.height;
  if (typeof probe.fps === "number") metadata.fps = probe.fps;
  const asset: AssetEntry = {
    id: assetId,
    uri: src,
    kind: "video",
    status: "ready",
    metadata,
    ...(name ? { name } : {}),
  };
  comp.assets.push(asset);

  // (5) Provenance edge — a root import (no source asset).
  const edge: ProvenanceEdge = {
    fromAssetId: null,
    toAssetId: assetId,
    operation: {
      type: "import",
      actor: actor ?? "agent",
      timestamp: new Date().toISOString(),
      params: { src, durationSec },
    },
  };
  comp.provenance.push(edge);

  // (6) Place the VideoClip. Offset: 0 when replacing, else explicit atSec, else
  // append at the end of the destination lane (avoids stacking on an existing clip).
  // S15 — a caller-supplied `--at` offset snaps to a whole frame so the imported
  // clip lands frame-aligned (append/replace are already derived from aligned ends).
  const trackOffset = replaceTimeline
    ? 0
    : atSec != null
      ? snapToFrame(atSec, comp.fps)
      : endOfVideoTrack(track);
  const clipId = newImportClipId();
  const clip: VideoClip = {
    id: clipId,
    kind: "video",
    src,
    in: 0,
    // S15 finding 2 — the probe duration is an external value written to `out`;
    // snap it so the imported clip END lands frame-aligned (a probe of 4.017s =
    // 120.51 frames @30fps must not persist off-grid, or every derived keyframe
    // endpoint / ripple offset inherits the sub-frame drift).
    out: snapToFrame(durationSec, comp.fps),
    trackOffset,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  } as VideoClip;
  track.clips.push(clip);

  // (7) Recompute comp.duration from content across ALL tracks — the SAME口径
  // trimClip / splitClip use. Without this a fresh work (duration:0) would place
  // the clip yet still render a single frame, and appending / replacing with a
  // longer take would stay clipped to the stale duration.
  comp.duration = compositionContentEnd(comp);

  return { clipId, assetId };
}
