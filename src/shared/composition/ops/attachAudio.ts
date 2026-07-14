// ADR-009 (PRD-0014 S5, review fix #1) — `attachAudio`: the REVERSE of
// `detachAudio`. Re-enabling a video clip's source audio (the Inspector "原声"
// switch back ON) must ATOMICALLY remove the AudioClip that `detachAudio` pulled
// out — otherwise the source AND the detached track both play, violating the禁
// "detach 后源声双份出声" (preview + export). Lifted into the shared ops core so
// the studio store (`reattachClipAudio`) and any future bridge/CLI reverse
// consume THIS one implementation.
//
// The two steps (both required, mutual-exclusion invariant):
//   (1) set the video clip's `sourceAudio.enabled = true` (spread-guarding the
//       sibling `volume`, the #81/#86 lesson); and
//   (2) delete EVERY AudioClip whose `detachedFrom === clipId` from its lane.
//
// Mutates `comp` IN PLACE (ADR-009 decision #1/#2). No fs / http, no
// CompositionSchema.parse. Unknown / non-video clip → CompositionOpError{code:4}.
// Re-enabling an already-enabled clip with no detached twin is a benign no-op
// (removedAudioClipIds is empty) — this is the reverse of an idempotent toggle,
// not a hard error, so the UI switch can call it unconditionally when turning ON.

import {
  type Composition,
  type Clip,
  type VideoClip,
} from "../../composition.js";
import { CompositionOpError } from "./errors.js";

function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, (c as { duration: number }).duration);
}

function clipEnd(c: Clip): number {
  return c.trackOffset + clipDuration(c);
}

function recomputeDuration(comp: Composition): void {
  comp.duration = Math.max(
    0,
    ...comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
  );
}

export interface AttachAudioResult {
  /** Ids of the detached AudioClip(s) that were removed (usually 0 or 1). */
  removedAudioClipIds: string[];
}

/**
 * Re-attach (re-enable) the source audio of the video clip `clipId`, atomically
 * removing any AudioClip previously detached from it.
 *
 * Throws `CompositionOpError{code:4}` when no clip matches `clipId` or the clip
 * is not a video clip.
 */
export function attachAudio(
  comp: Composition,
  p: { clipId: string },
): AttachAudioResult {
  // ── Phase 1: locate + validate (no mutation yet — keep the call atomic) ──
  let video: VideoClip | undefined;
  for (const track of comp.tracks) {
    const c = (track.clips as Clip[]).find((c) => c.id === p.clipId);
    if (!c) continue;
    if (c.kind !== "video") {
      throw new CompositionOpError(
        `attachAudio: clip ${p.clipId} is a ${c.kind} clip, not a video clip`,
        4,
      );
    }
    video = c;
    break;
  }
  if (!video) {
    throw new CompositionOpError(`attachAudio: no video clip with id ${p.clipId}`, 4);
  }

  // ── Phase 2: mutate. ──
  // (1) Re-enable the source (spread-guard the sibling `volume`).
  video.sourceAudio = { ...(video.sourceAudio ?? {}), enabled: true };

  // (2) Remove every AudioClip back-linked to this video from its lane.
  const removedAudioClipIds: string[] = [];
  for (const track of comp.tracks) {
    if (track.kind !== "audio") continue;
    const kept: Clip[] = [];
    for (const c of track.clips as Clip[]) {
      if (
        c.kind === "audio" &&
        (c as { detachedFrom?: string }).detachedFrom === p.clipId
      ) {
        removedAudioClipIds.push(c.id);
      } else {
        kept.push(c);
      }
    }
    (track.clips as Clip[]).length = 0;
    (track.clips as Clip[]).push(...kept);
  }

  recomputeDuration(comp);
  return { removedAudioClipIds };
}
