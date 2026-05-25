// #39 — track-header context menu viewport clamping.
//
// The menu is portaled to <body> with position:fixed at the cursor / ⋯-button
// coordinate, with NO collision handling. Since the Timeline is anchored to the
// bottom of the screen, right-clicking a low track opened the menu below the
// fold — all 6 items unreachable. This clamps the requested {top,left} so the
// menu always sits fully inside the viewport.

export interface MenuPosition {
  top: number;
  left: number;
}

/**
 * Clamp a fixed-position menu's top-left so the whole menu (menuW × menuH)
 * stays within [margin, viewport - size - margin] on both axes.
 *
 * Idempotent: clamping an already-in-bounds position returns equal numbers, so
 * a measure→re-clamp layout effect converges in one extra render instead of
 * looping. If the menu is larger than the viewport, the lower bound (margin)
 * wins so at least its top-left corner stays visible.
 */
export function clampMenuToViewport(
  pos: MenuPosition,
  menuW: number,
  menuH: number,
  viewportW: number,
  viewportH: number,
  margin = 8,
): MenuPosition {
  const maxLeft = Math.max(margin, viewportW - menuW - margin);
  const maxTop = Math.max(margin, viewportH - menuH - margin);
  return {
    left: Math.min(Math.max(margin, pos.left), maxLeft),
    top: Math.min(Math.max(margin, pos.top), maxTop),
  };
}
