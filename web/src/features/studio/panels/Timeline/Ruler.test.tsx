import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Ruler } from "./Ruler";
import { useComposition } from "../../store";
import { makeCompositionWithClips, makeVideoClip } from "../../../../test/composition-fixtures";

// #77 — the ruler is now the primary click-to-seek surface. In jsdom
// getBoundingClientRect() returns all-zero, so the region's left edge is x=0
// and clientX maps straight to time: frame = round(clientX / pxPerSecond * fps).
beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 10 });
  useComposition.setState({
    comp: { ...makeCompositionWithClips([a]), fps: 30, duration: 10 },
    currentFrame: 0,
    isPlaying: false,
    dragState: null,
  });
});

describe("Ruler click-to-seek (#77)", () => {
  it("clicking the ruler moves the playhead to that time", () => {
    render(<Ruler duration={10} pxPerSecond={50} totalWidth={500} fps={30} />);
    const region = screen.getByTestId("ruler-seek-region");
    // clientX=100 → 2s @ 50px/s → 60 frames @ 30fps
    fireEvent.pointerDown(region, { clientX: 100, pointerId: 1 });
    expect(useComposition.getState().currentFrame).toBe(60);
    fireEvent.pointerUp(region, { clientX: 100, pointerId: 1 });
  });

  it("dragging after pointerdown scrubs continuously", () => {
    render(<Ruler duration={10} pxPerSecond={50} totalWidth={500} fps={30} />);
    const region = screen.getByTestId("ruler-seek-region");
    fireEvent.pointerDown(region, { clientX: 50, pointerId: 1 }); // 1s → 30
    expect(useComposition.getState().currentFrame).toBe(30);
    fireEvent.pointerMove(region, { clientX: 150, pointerId: 1 }); // 3s → 90
    expect(useComposition.getState().currentFrame).toBe(90);
    fireEvent.pointerUp(region, { clientX: 150, pointerId: 1 });
  });

  it("does not scrub on a bare move without a prior pointerdown", () => {
    render(<Ruler duration={10} pxPerSecond={50} totalWidth={500} fps={30} />);
    const region = screen.getByTestId("ruler-seek-region");
    fireEvent.pointerMove(region, { clientX: 200, pointerId: 1 });
    expect(useComposition.getState().currentFrame).toBe(0);
  });

  it("stops scrubbing after pointerup", () => {
    render(<Ruler duration={10} pxPerSecond={50} totalWidth={500} fps={30} />);
    const region = screen.getByTestId("ruler-seek-region");
    fireEvent.pointerDown(region, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(region, { clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(region, { clientX: 300, pointerId: 1 });
    expect(useComposition.getState().currentFrame).toBe(30); // unchanged after up
  });

  it("clamps a negative position (click left of x=0) to frame 0", () => {
    useComposition.setState({ currentFrame: 45 });
    render(<Ruler duration={10} pxPerSecond={50} totalWidth={500} fps={30} />);
    const region = screen.getByTestId("ruler-seek-region");
    fireEvent.pointerDown(region, { clientX: -80, pointerId: 1 });
    expect(useComposition.getState().currentFrame).toBe(0);
    fireEvent.pointerUp(region, { clientX: -80, pointerId: 1 });
  });

  it("captures the pointer so a scrub survives the cursor leaving the ruler", () => {
    render(<Ruler duration={10} pxPerSecond={50} totalWidth={500} fps={30} />);
    const region = screen.getByTestId("ruler-seek-region") as HTMLElement;
    let captured: number | null = null;
    region.setPointerCapture = (id: number) => {
      captured = id;
    };
    fireEvent.pointerDown(region, { clientX: 10, pointerId: 9 });
    expect(captured).toBe(9);
  });
});
