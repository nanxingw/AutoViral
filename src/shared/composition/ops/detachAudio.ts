// ADR-009 (PRD-0014 S5) — `detachAudio`: pull a video clip's OWN embedded source
// audio out into a first-class AudioClip AND mute the source, as ONE atomic
// two-step mutation. Lifted into the shared composition-ops core so the studio
// "Detach" button (store `detachClipAudio`) and the bridge/CLI (`autoviral clip
// detach-audio <id>`) consume THIS one implementation — an agent detaching原声
// for ducking and a human clicking Detach converge byte-for-byte.
//
// The two steps (both required — the禁 "detach 后源声双份出声"):
//   (1) append a same-source AudioClip (src/in/out/trackOffset aligned,
//       type:"original", volume carried from the resolved source) onto an audio
//       lane — minting one via ops.addTrack if the composition has none; and
//   (2) set the video clip's `sourceAudio.enabled = false` so the source no
//       longer plays (preview <Video muted> + export video-only pre-pass).
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — push onto the EXISTING
// `clips` array and assign a fresh `sourceAudio` object (spread-guarding the
// sibling `volume`, the #81/#86 lesson). No fs / http and no
// CompositionSchema.parse. All validation happens BEFORE any mutation so a
// rejected call leaves `comp` byte-identical (atomic). Illegal params throw
// CompositionOpError{code:4}.
//
// Idempotency is a HARD ERROR, not a silent no-op: a video clip whose source is
// already detached (resolveSourceAudio(clip).enabled === false) rejects the
// second call, so we never mint a duplicate AudioClip. Re-ENABLING the source
// (the reverse direction) is the sourceAudio toggle's concern, not this op's.

import {
  resolveSourceAudio,
  type Composition,
  type Clip,
  type AudioClip,
  type VideoClip,
} from "../../composition.js";
import { addTrack } from "./track.js";
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

export interface DetachAudioResult {
  audioClipId: string;
  trackId: string;
}

/**
 * Detach the source audio of the video clip `clipId`. Returns the minted
 * AudioClip id and the audio lane it landed on.
 *
 * Throws `CompositionOpError{code:4}` when: no clip matches `clipId`, the clip
 * is not a video clip, or its source audio is already detached.
 */
export function detachAudio(
  comp: Composition,
  p: { clipId: string },
): DetachAudioResult {
  // ── Phase 1: locate + validate (no mutation yet — keep the call atomic) ──
  let video: VideoClip | undefined;
  for (const track of comp.tracks) {
    const c = (track.clips as Clip[]).find((c) => c.id === p.clipId);
    if (!c) continue;
    if (c.kind !== "video") {
      throw new CompositionOpError(
        `detachAudio: clip ${p.clipId} is a ${c.kind} clip, not a video clip`,
        4,
      );
    }
    video = c;
    break;
  }
  if (!video) {
    throw new CompositionOpError(`detachAudio: no video clip with id ${p.clipId}`, 4);
  }
  const source = resolveSourceAudio(video);
  if (!source.enabled) {
    throw new CompositionOpError(
      `detachAudio: clip ${p.clipId}'s source audio is already detached`,
      4,
    );
  }

  // ── Phase 2: mutate. All checks passed, so every write below lands. ──
  // Find (or mint) an audio lane. addTrack pushes onto comp.tracks in place.
  let audioTrack = comp.tracks.find((t) => t.kind === "audio");
  let trackId: string;
  if (audioTrack) {
    trackId = audioTrack.id;
  } else {
    ({ trackId } = addTrack(comp, { kind: "audio" }));
    audioTrack = comp.tracks.find((t) => t.id === trackId)!;
  }

  const audioClipId = crypto.randomUUID();
  const audioClip: AudioClip = {
    id: audioClipId,
    kind: "audio",
    src: video.src,
    in: video.in,
    out: video.out,
    trackOffset: video.trackOffset,
    // Carry the source's own gain so a subsequent ducking pass mixes at the
    // level the user was hearing (default 1 when the source had no volume set).
    volume: source.volume,
    fadeIn: 0,
    fadeOut: 0,
    // The detached track IS the clip's original diegetic audio.
    type: "original",
  };
  (audioTrack.clips as Clip[]).push(audioClip);

  // Mute the source — spread-guard the sibling `volume` so it survives (#81/#86).
  video.sourceAudio = { ...(video.sourceAudio ?? {}), enabled: false };

  recomputeDuration(comp);
  return { audioClipId, trackId };
}
