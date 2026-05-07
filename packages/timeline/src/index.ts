// Public surface for `@autoviral/timeline`.
//
// Phase 1 of the extraction (this commit) only ships the *pure* timeline
// helpers — the things that have no zustand / DOM dependencies and are
// reusable across viewer modes (timeline, dive ribbon, overview). The
// React components currently still live in `web/src/features/studio/panels/Timeline/`
// because they couple tightly to the app's `useComposition` store; pulling
// them across is a follow-up that requires a prop-down refactor on the
// component seam.
export {
  MIN_CLIP_DUR,
  OFFSET_EPSILON,
  clipDuration,
  clipEnd,
} from "./clipMath";

export {
  collectSnapPoints,
  snapToNearest,
  snapDraggedStartToPoints,
} from "./snapPoints";
export type { SnapPoint } from "./snapPoints";

export {
  computeRipplePreview,
  snapDraggedStart,
  snapDraggedStartFull,
} from "./dragEngine";

export { snapToBeat } from "./snapToBeat";
