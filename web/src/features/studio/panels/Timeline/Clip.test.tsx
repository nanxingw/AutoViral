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
    beats: [],
    dragState: null,
  });
});

describe("Clip", () => {
  it("renders with proportional width", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("200px");
    expect(el.style.left).toBe("50px");
  });

  it("clicking begins a drag and selects the clip", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(container.firstChild as HTMLElement, {
      clientX: 0,
      pointerId: 1,
    });
    expect(useComposition.getState().selection).toBe("v1");
    const ds = useComposition.getState().dragState;
    expect(ds?.clipId).toBe("v1");
    expect(ds?.originalStart).toBeCloseTo(1);
    expect(ds?.preview.get("v1")).toBeCloseTo(1);
  });

  it("dragState preview overrides clip.trackOffset for the rendered left edge", () => {
    useComposition.setState((s) => ({
      ...s,
      dragState: {
        clipId: "v1",
        originalStart: 1,
        candidateStart: 3,
        preview: new Map([["v1", 3]]),
        snapTime: null,
      },
    }));
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.left).toBe("150px");
  });
});
