// ADR-009 — shared composition-ops core. Intent-level, in-place,
// I/O-free mutations consumed by BOTH the studio store (immer draft) and the
// bridge (read-modify-write a parsed Composition). The ops set grows one verb
// per issue slice (S6: splitClip → builds this skeleton; S7 trimClip; S8
// moveClipToTrack; …). Single source of truth for write-path invariants.
export { CompositionOpError } from "./errors.js";
export { splitClip } from "./splitClip.js";
export { trimClip } from "./trimClip.js";
export { patchClipProps } from "./patchClipProps.js";
export { moveClipToTrack } from "./moveClipToTrack.js";
export { addTransition, removeTransition, updateTransition } from "./transition.js";
export { addTrack, removeTrack } from "./track.js";
export {
  addScene,
  setSceneProps,
  reorderScenes,
  linkSceneAssets,
  removeScene,
} from "./scene.js";
export { addKeyframe, setKeyframe, removeKeyframe, moveKeyframe } from "./keyframe.js";
export type { KeyframeWrite, KeyframeRemove, KeyframeMove } from "./keyframe.js";
export { setAspectRatio, rescaleCompositionForResize } from "./setAspectRatio.js";
export { setCompositionDuration, compositionContentEnd } from "./setDuration.js";
export { setFps } from "./setFps.js";
export type { Fps } from "./setFps.js";
export { importClip } from "./importClip.js";
export type { ImportProbe, ImportClipParams } from "./importClip.js";
// PRD-0014 S7 — store-only editing verbs lifted into the shared core.
export { rippleDeleteClip } from "./rippleDelete.js";
export type { RippleDeleteResult } from "./rippleDelete.js";
export { collapseGapsOnTrack } from "./collapseGaps.js";
export type { CollapseGapsResult } from "./collapseGaps.js";
export { duplicateClip } from "./duplicateClip.js";
export type { DuplicateClipResult } from "./duplicateClip.js";
export { setTrackProps } from "./setTrackProps.js";
export type { TrackProps } from "./setTrackProps.js";
// PRD-0014 S8 — keyframe edit (remove/move) + transition update above; reframe sugar.
export { reframeClip } from "./reframeClip.js";
export type { ReframeParams } from "./reframeClip.js";
// PRD-0014 S5 — detach a video clip's source audio to a first-class AudioClip.
export { detachAudio } from "./detachAudio.js";
export type { DetachAudioResult } from "./detachAudio.js";
export { attachAudio } from "./attachAudio.js";
export type { AttachAudioResult } from "./attachAudio.js";
