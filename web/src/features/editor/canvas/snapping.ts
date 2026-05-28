// #59 — smart-guide snapping for the carousel canvas. Pure geometry so it can
// be unit-tested without Konva. All coordinates are in canvas space
// (car.width × car.height), the same space Konva node.x()/y() report.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A guide line to draw, in canvas coords. axis "x" = vertical line at x=pos. */
export interface SnapGuide {
  axis: "x" | "y";
  pos: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

// 8 canvas px ≈ 4 screen px at the editor's 0.5 display scale — tight enough to
// feel precise, loose enough to catch. Canva uses a comparable band.
export const SNAP_THRESHOLD = 8;

/**
 * Find the closest snap for one axis. `start` is the dragged box origin on this
 * axis, `size` its extent; we test its left/center/right (or top/mid/bottom)
 * edges against every candidate `line`. Returns the delta to apply and the
 * line that won, or snap:false when nothing is within `threshold`.
 */
function bestSnap(start: number, size: number, lines: number[], threshold: number) {
  const edges = [start, start + size / 2, start + size];
  let best = { delta: 0, line: 0, snap: false, abs: Infinity };
  for (const edge of edges) {
    for (const line of lines) {
      const diff = line - edge;
      const abs = Math.abs(diff);
      if (abs <= threshold && abs < best.abs) {
        best = { delta: diff, line, snap: true, abs };
      }
    }
  }
  return best;
}

/**
 * Snap a dragged rect to the canvas centre/edges and to other layers'
 * edges/centres. Returns the (possibly adjusted) x/y plus the guide lines to
 * render. Snapping is independent per axis, so a layer can snap horizontally
 * while moving freely vertically.
 */
export function computeSnap(
  dragged: Rect,
  targets: Rect[],
  canvas: { width: number; height: number },
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  const xLines = [0, canvas.width / 2, canvas.width];
  const yLines = [0, canvas.height / 2, canvas.height];
  for (const t of targets) {
    xLines.push(t.x, t.x + t.w / 2, t.x + t.w);
    yLines.push(t.y, t.y + t.h / 2, t.y + t.h);
  }

  const bx = bestSnap(dragged.x, dragged.w, xLines, threshold);
  const by = bestSnap(dragged.y, dragged.h, yLines, threshold);

  const guides: SnapGuide[] = [];
  let x = dragged.x;
  let y = dragged.y;
  if (bx.snap) {
    x = dragged.x + bx.delta;
    guides.push({ axis: "x", pos: bx.line });
  }
  if (by.snap) {
    y = dragged.y + by.delta;
    guides.push({ axis: "y", pos: by.line });
  }
  return { x, y, guides };
}
