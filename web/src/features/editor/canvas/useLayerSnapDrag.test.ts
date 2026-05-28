import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLayerSnapDrag } from "./useLayerSnapDrag";
import { useEditor } from "../store";
import { makeEmptyCarousel, type Carousel, type Layer } from "../types";

// #59 — the drag hook wires computeSnap into Konva's onDragMove/onDragEnd and
// the store's snapGuides. We drive it with a fake Konva node + event.

function fakeNode(x: number, y: number, w: number, h: number) {
  let _x = x;
  let _y = y;
  return {
    x: (v?: number) => (v === undefined ? _x : ((_x = v), undefined)),
    y: (v?: number) => (v === undefined ? _y : ((_y = v), undefined)),
    width: () => w,
    height: () => h,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evt(node: unknown, mods: Record<string, boolean> = {}): any {
  return { target: node, evt: mods };
}

const LAYER = {
  id: "L1",
  kind: "text",
  text: "hi",
  box: { x: 0, y: 0, w: 200, h: 80, rotation: 0 },
  style: { font: "serif", size: 64, weight: 600, italic: false, color: "palette:fg", align: "center", tracking: 0 },
} as unknown as Layer;

function seedCarousel() {
  const car: Carousel = makeEmptyCarousel("w1"); // 1080×1350 → centre x=540
  car.slides[0].layers.push(LAYER);
  useEditor.getState().loadCarousel(car);
}

beforeEach(() => {
  seedCarousel();
});

describe("useLayerSnapDrag (#59)", () => {
  it("snaps the dragged node to the canvas horizontal centre + publishes a guide", () => {
    const { result } = renderHook(() => useLayerSnapDrag(LAYER));
    // x so centre (x+100) is 3px shy of 540.
    const node = fakeNode(540 - 100 - 3, 100, 200, 80);
    result.current.onDragMove(evt(node));
    expect(node.x()).toBe(440); // 540 - w/2
    expect(useEditor.getState().snapGuides).toContainEqual({ axis: "x", pos: 540 });
  });

  it("escape valve: holding Alt disables snapping and clears guides", () => {
    useEditor.getState().setSnapGuides([{ axis: "x", pos: 540 }]);
    const { result } = renderHook(() => useLayerSnapDrag(LAYER));
    const node = fakeNode(540 - 100 - 3, 100, 200, 80);
    result.current.onDragMove(evt(node, { altKey: true }));
    expect(node.x()).toBe(540 - 100 - 3); // untouched
    expect(useEditor.getState().snapGuides).toEqual([]);
  });

  it("onDragEnd commits the final box and clears the guides", () => {
    useEditor.getState().setSnapGuides([{ axis: "x", pos: 540 }]);
    const { result } = renderHook(() => useLayerSnapDrag(LAYER));
    const node = fakeNode(312, 456, 200, 80);
    result.current.onDragEnd(evt(node));
    const slide = useEditor.getState().car!.slides[0];
    const moved = slide.layers.find((l) => l.id === "L1")!;
    expect(moved.box.x).toBe(312);
    expect(moved.box.y).toBe(456);
    expect(moved.box.w).toBe(200); // preserved
    expect(useEditor.getState().snapGuides).toEqual([]);
  });
});
