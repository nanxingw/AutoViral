// I19 / I20 — shared drag-and-drop foundation for the timeline.
//
// DnD selection: **native HTML5 DnD** (the same primitive Chat attachments use,
// see Chat/index.tsx `onDrop`/`dataTransfer.files`). The repo carries no DnD
// library; native DnD keeps bundle cost at zero and stays consistent with the
// one other drag surface in the app. Payloads ride a custom MIME type so a
// timeline drag never collides with file drops (which use `dataTransfer.files`).
//
// This module is the *pure* core — like #59's `computeSnap`, the keystone
// type-constraint + drop-resolution logic lives here with zero React / DOM
// coupling so it is unit-testable without simulating raw drag events (which
// jsdom can't faithfully reproduce). The React seam (Track/Clip) only wires
// these helpers to `dragstart`/`dragover`/`drop`.
import type { Composition } from "@shared/composition";
import { snapDraggedStartFull } from "@autoviral/timeline";
import type { AssetItem } from "@/queries/assets";
import type { Track } from "../../types";

/** Custom MIME so a timeline drag is distinguishable from a file drop. */
export const TIMELINE_DND_MIME = "application/x-autoviral-timeline";

/** A library asset being dragged toward a track (I19). */
export interface AssetDragPayload {
  source: "asset";
  /** work-relative asset path — the `src` the built clip points at. */
  assetPath: string;
  assetKind: AssetItem["kind"];
}

/** An existing timeline clip being dragged toward another track (I20). */
export interface ClipDragPayload {
  source: "clip";
  clipId: string;
  /** the clip's own kind — authoritative for the cross-track kind guard. */
  clipKind: Track["kind"];
}

export type TimelineDragPayload = AssetDragPayload | ClipDragPayload;

/**
 * The track kind a library asset lands on. Mirrors `buildClipFromAsset`'s
 * per-kind rule (#78): video→video / audio→audio / image→overlay. Returns
 * null for kinds with no timeline representation (text / other).
 */
export function assetTargetTrackKind(
  assetKind: AssetItem["kind"],
): Track["kind"] | null {
  switch (assetKind) {
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "image":
      return "overlay";
    default:
      return null;
  }
}

/**
 * Type constraint (I19/I20 keystone): can a dragged payload legally land on a
 * track of `trackKind`? Assets must map to the track kind from
 * `assetTargetTrackKind`; clips must match the target kind exactly (same as the
 * store's `moveClipToTrack` kind guard, #88). A non-placeable asset kind, or a
 * cross-kind clip move, is rejected → caller shows the not-allowed cue.
 */
export function canAcceptDrop(
  payload: TimelineDragPayload,
  trackKind: Track["kind"],
): boolean {
  if (payload.source === "asset") {
    return assetTargetTrackKind(payload.assetKind) === trackKind;
  }
  return payload.clipKind === trackKind;
}

// ── DataTransfer (de)serialization ──────────────────────────────────────────
// We tolerate any object with the get/setData surface so tests can pass a tiny
// fake without constructing a real DataTransfer (jsdom's is write-only mid-drag).

interface DataTransferLike {
  getData(type: string): string;
  setData(type: string, data: string): void;
}

export function writeDragPayload(
  dt: DataTransferLike,
  payload: TimelineDragPayload,
): void {
  dt.setData(TIMELINE_DND_MIME, JSON.stringify(payload));
}

/** Parse a timeline drag payload, or null if absent / malformed / unknown. */
export function readDragPayload(dt: DataTransferLike): TimelineDragPayload | null {
  let raw: string;
  try {
    raw = dt.getData(TIMELINE_DND_MIME);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (p.source === "asset" && typeof p.assetPath === "string" && typeof p.assetKind === "string") {
    return {
      source: "asset",
      assetPath: p.assetPath,
      assetKind: p.assetKind as AssetItem["kind"],
    };
  }
  if (p.source === "clip" && typeof p.clipId === "string" && typeof p.clipKind === "string") {
    return {
      source: "clip",
      clipId: p.clipId,
      clipKind: p.clipKind as Track["kind"],
    };
  }
  return null;
}

/**
 * Pointer X (clientX) → raw drop time in seconds, clamped at 0. `laneLeft` is
 * the clip-lane's left edge in viewport coords (the lane starts after the
 * sticky label column, so the caller passes the lane element's own rect).
 */
export function dropTimeFromPointer(
  clientX: number,
  laneLeft: number,
  pxPerSecond: number,
): number {
  if (pxPerSecond <= 0) return 0;
  return Math.max(0, (clientX - laneLeft) / pxPerSecond);
}

/**
 * Snap a raw drop time against the composition's edges + playhead, reusing the
 * #59-era `snapDraggedStartFull` (same engine the existing in-track drag uses,
 * so the drop line agrees with the live clip-drag guideline). `excludeClipId`
 * keeps a clip from snapping to its own edges during a cross-track move.
 *
 * `clipDuration` is the dragged item's length (for end-edge snapping). For an
 * asset drop we pass the default placeholder duration; for a clip move we pass
 * the clip's real duration.
 */
export function resolveDropTime(
  comp: Composition | null,
  rawTime: number,
  clipDuration: number,
  playheadTime: number,
  excludeClipId: string | null,
  snapThreshold = 0.06,
): { start: number; snapTime: number | null } {
  return snapDraggedStartFull(
    comp,
    excludeClipId ?? "__dnd_new__",
    clipDuration,
    rawTime,
    playheadTime,
    snapThreshold,
  );
}

// ── Drop resolution: payload + target → a store-action intent ────────────────
// Like #59 split the *decision* away from the Konva event handler, the drop
// handler stays a thin DOM shim: it parses the payload, computes the time, and
// asks `resolveDrop` what to do. The intent is then executed against the store.

/** Place a freshly-built clip from a library asset onto `trackId` at `start`. */
export interface AddAssetIntent {
  type: "add-asset";
  assetPath: string;
  assetKind: AssetItem["kind"];
  trackId: string;
  start: number;
}
/** Move an existing clip onto `targetTrackId` (same-kind, time preserved). */
export interface MoveClipIntent {
  type: "move-clip";
  clipId: string;
  targetTrackId: string;
}
/** The drop is illegal (wrong kind / no-op) — caller shows the reject cue. */
export interface RejectIntent {
  type: "reject";
}
export type DropIntent = AddAssetIntent | MoveClipIntent | RejectIntent;

/**
 * Pure drop resolver (the I19/I20 keystone the tests drive directly). Given a
 * parsed payload, the target track, and a snapped drop start, decide which
 * store primitive should run — without touching the store or the DOM.
 *
 * - asset onto a matching-kind track → {@link AddAssetIntent} (caller runs
 *   buildClipFromAsset + addClip).
 * - clip onto a *different* same-kind track → {@link MoveClipIntent} (caller
 *   runs moveClipToTrack; the store re-guards kind, #88).
 * - clip dropped on the track it already lives on → reject (no-op move).
 * - anything cross-kind / non-placeable → reject.
 */
export function resolveDrop(
  payload: TimelineDragPayload,
  target: { id: string; kind: Track["kind"] },
  start: number,
  sourceTrackId: string | null,
): DropIntent {
  if (!canAcceptDrop(payload, target.kind)) return { type: "reject" };
  if (payload.source === "asset") {
    return {
      type: "add-asset",
      assetPath: payload.assetPath,
      assetKind: payload.assetKind,
      trackId: target.id,
      start,
    };
  }
  // clip move — a drop on the clip's own track is a no-op.
  if (sourceTrackId !== null && sourceTrackId === target.id) {
    return { type: "reject" };
  }
  return { type: "move-clip", clipId: payload.clipId, targetTrackId: target.id };
}
