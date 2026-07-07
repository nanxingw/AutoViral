// ── Dive-canvas interactive-control escape hatch (E2E R2: BE2-画布聚簇-F1) ──────
//
// An interactive control (button / input) rendered INSIDE a react-flow node has
// to escape TWO different swallowing mechanisms before a REAL mouse click works.
// Both prior fixes (ab2599a, 90c0300) only handled the first and the buttons
// stayed dead:
//
//   1. Hit-testing — a scene-cluster group node is handed to xyflow with
//      `selectable:false, draggable:false` and no node-level mouse handler, so
//      xyflow's NodeWrapper stamps `pointer-events:none` INLINE on the
//      `.react-flow__node` wrapper (see @xyflow/react NodeWrapper:
//      `pointerEvents: hasPointerEvents ? 'all' : 'none'`). Every descendant
//      inherits it, so the control is not the target of pointer events at all —
//      the click falls through to the react-flow__pane. Fix: the control sets
//      `pointer-events:auto` on itself (CSS lets a descendant override an
//      ancestor's `none`), re-opening itself as a hit target.
//
//   2. Pan/drag hijack — even once the control IS the hit target, react-flow's
//      pan/zoom is a d3-zoom bound to the pane. Its filter (@xyflow/system
//      `createFilter`) only lets a pointerdown through WITHOUT starting a canvas
//      pan when the event target is wrapped with the `nopan` class; xyflow adds
//      that class to node wrappers ONLY when the node is draggable
//      (`[noPanClassName]: isDraggable`). Our group node is `draggable:false`, so
//      its wrapper carries NO `nopan` — a pointerdown on the control therefore
//      starts a pan that eats the ensuing click. `nodrag` is the sibling opt-out
//      for node dragging. Fix: the control carries `nopan nodrag` itself.
//
// A control is only clickable by a real mouse when it carries BOTH halves.
// fireEvent.click bypasses hit-testing AND the pan filter, which is exactly why
// the handler unit tests were falsely green while the buttons were dead on the
// real canvas. The final "the click physically reaches the button" proof is
// browser-only and lives in E2E dimension BE2-画布聚簇-F1; the vitest contract
// tests lock the style + classes below.
//
// Any interactive control added inside a dive node MUST spread both.
export const HIT_TARGET_CLASS = "nopan nodrag";
export const HIT_TARGET_STYLE = { pointerEvents: "auto" } as const;
