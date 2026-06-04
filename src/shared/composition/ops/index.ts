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
export { addTransition, removeTransition } from "./transition.js";
export { addTrack, removeTrack } from "./track.js";
export { addKeyframe, setKeyframe } from "./keyframe.js";
export { setAspectRatio, rescaleCompositionForResize } from "./setAspectRatio.js";
