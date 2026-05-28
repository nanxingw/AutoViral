import { describe, it, expect } from "vitest";
import { computeSnap, SNAP_THRESHOLD, type Rect } from "./snapping";

// #59 — smart-guide snapping geometry. Canvas is 1080×1920 (carousel default).
const CANVAS = { width: 1080, height: 1920 };

describe("computeSnap (#59)", () => {
  it("snaps a layer's centre to the canvas horizontal centre when within threshold", () => {
    // Dragged box 200 wide; centre should land on 540. Place it 3px off.
    const dragged: Rect = { x: 540 - 100 - 3, y: 100, w: 200, h: 80 };
    const res = computeSnap(dragged, [], CANVAS);
    // centre (x + w/2) snaps to 540 → x = 440.
    expect(res.x).toBe(440);
    expect(res.guides).toContainEqual({ axis: "x", pos: 540 });
  });

  it("does not snap when the nearest line is beyond threshold", () => {
    const dragged: Rect = { x: 540 - 100 - (SNAP_THRESHOLD + 5), y: 100, w: 200, h: 80 };
    const res = computeSnap(dragged, [], CANVAS);
    expect(res.x).toBe(dragged.x); // unchanged
    expect(res.guides).toHaveLength(0);
  });

  it("snaps to the canvas left edge (x=0)", () => {
    const dragged: Rect = { x: 4, y: 300, w: 100, h: 50 };
    const res = computeSnap(dragged, [], CANVAS);
    expect(res.x).toBe(0);
    expect(res.guides).toContainEqual({ axis: "x", pos: 0 });
  });

  it("snaps to another layer's left edge", () => {
    const target: Rect = { x: 300, y: 800, w: 200, h: 100 };
    const dragged: Rect = { x: 303, y: 1200, w: 120, h: 60 }; // left ~ target.left
    const res = computeSnap(dragged, [target], CANVAS);
    expect(res.x).toBe(300);
    expect(res.guides).toContainEqual({ axis: "x", pos: 300 });
  });

  it("snaps both axes independently (centre + vertical middle)", () => {
    const dragged: Rect = {
      x: 540 - 50 - 2, // centre near 540
      y: 960 - 40 + 2, // centre near 960 (canvas vertical middle)
      w: 100,
      h: 80,
    };
    const res = computeSnap(dragged, [], CANVAS);
    expect(res.x).toBe(490); // 540 - w/2 (w=100)
    expect(res.y).toBe(920); // 960 - h/2 (h=80)
    expect(res.guides).toContainEqual({ axis: "x", pos: 540 });
    expect(res.guides).toContainEqual({ axis: "y", pos: 960 });
  });

  it("picks the closest line when several are in range", () => {
    // Left edge at 2 (→ canvas 0, diff 2) vs nothing closer; snaps to 0.
    const dragged: Rect = { x: 2, y: 500, w: 100, h: 50 };
    const res = computeSnap(dragged, [{ x: 5, y: 0, w: 10, h: 10 }], CANVAS);
    // dragged.left=2 → canvas 0 (diff 2) beats target.left=5 (diff 3).
    expect(res.x).toBe(0);
  });
});
