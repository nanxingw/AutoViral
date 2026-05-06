import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { Playhead } from "./Playhead";
import { useComposition } from "../../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
  useComposition.setState({
    comp: { ...makeCompositionWithClips([a]), fps: 30 },
    currentFrame: 30, // 1s at 30fps
    isPlaying: false,
    dragState: null,
  });
});

describe("Playhead", () => {
  it("renders at the correct x = (frame/fps) * pxPerSecond", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    // 30 frames / 30 fps = 1s * 50px/s = 50px
    expect(el.style.left).toBe("50px");
  });

  it("dragging by 100px advances currentFrame proportionally", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 100, pointerId: 1 });
    // dx=100 → 2s @ 30fps → +60 frames; starting at 30 → 90
    expect(useComposition.getState().currentFrame).toBe(90);
    fireEvent.pointerUp(el, { clientX: 100, pointerId: 1 });
  });

  it("clamps currentFrame at 0 when dragging past the left edge", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: -1000, pointerId: 1 });
    expect(useComposition.getState().currentFrame).toBe(0);
    fireEvent.pointerUp(el, { clientX: -1000, pointerId: 1 });
  });

  it("ignores pointermove without a prior pointerdown", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerMove(el, { clientX: 200, pointerId: 1 });
    // currentFrame stays put (no drag was started)
    expect(useComposition.getState().currentFrame).toBe(30);
  });

  it("pointerup ends the drag — subsequent moves are ignored", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, pointerId: 1 });
    // dx=50 → 1s → +30 frames, 30 → 60
    expect(useComposition.getState().currentFrame).toBe(60);
    fireEvent.pointerUp(el, { clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 500, pointerId: 1 });
    // After pointerup, frame stays at 60 (drag ended)
    expect(useComposition.getState().currentFrame).toBe(60);
  });

  it("calls setPointerCapture so drags survive cursor leaving the element", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    let captured: number | null = null;
    el.setPointerCapture = (id: number) => {
      captured = id;
    };
    fireEvent.pointerDown(el, { clientX: 0, pointerId: 7 });
    expect(captured).toBe(7);
  });

  it("exposes accessibility role + aria attributes", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("role")).toBe("slider");
    expect(el.getAttribute("aria-label")).toBe("Playhead");
    expect(el.getAttribute("aria-valuenow")).toBe("30");
  });

  it("re-renders when currentFrame updates externally (e.g. playback)", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.left).toBe("50px");
    act(() => {
      useComposition.getState().setFrame(60); // 60/30 = 2s → 100px
    });
    expect(el.style.left).toBe("100px");
  });
});
