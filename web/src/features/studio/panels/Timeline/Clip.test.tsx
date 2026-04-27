import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Clip } from "./Clip";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";

beforeEach(() => {
  const c = makeEmptyComposition({ workId: "w" });
  c.tracks[0].clips.push({
    id: "v1",
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 4,
    trackOffset: 1,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  });
  useComposition.setState({
    comp: c,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
  });
});

describe("Clip", () => {
  it("renders with proportional width", () => {
    const { container } = render(<Clip clipId="v1" pxPerSecond={50} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("200px");
    expect(el.style.left).toBe("50px");
  });

  it("clicking selects", () => {
    const { container } = render(<Clip clipId="v1" pxPerSecond={50} />);
    fireEvent.pointerDown(container.firstChild as HTMLElement, {
      clientX: 0,
      pointerId: 1,
    });
    expect(useComposition.getState().selection).toBe("v1");
  });
});
