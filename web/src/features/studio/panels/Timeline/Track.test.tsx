import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Track } from "./Track";
import { useComposition } from "../../store";
import { makeEmptyComposition, type VideoClip } from "../../types";

const baseTransform = { scale: 1, x: 0, y: 0, rotation: 0 };
const baseFilters = { brightness: 0, contrast: 0, saturation: 0 };

beforeEach(() => {
  const c = makeEmptyComposition({ workId: "w" });
  const a: VideoClip = {
    id: "a",
    kind: "video",
    src: "/a.mp4",
    in: 0,
    out: 2,
    trackOffset: 0,
    transforms: baseTransform,
    filters: baseFilters,
  };
  const b: VideoClip = {
    id: "b",
    kind: "video",
    src: "/b.mp4",
    in: 0,
    out: 3,
    trackOffset: 2,
    transforms: baseTransform,
    filters: baseFilters,
  };
  const d: VideoClip = {
    id: "d",
    kind: "video",
    src: "/d.mp4",
    in: 0,
    out: 1,
    trackOffset: 5,
    transforms: baseTransform,
    filters: baseFilters,
  };
  c.tracks[0].clips.push(a, b, d);
  c.duration = 6;
  useComposition.setState({
    comp: c,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
  });
});

describe("Track (dnd-kit)", () => {
  it("renders all clips in order", () => {
    const comp = useComposition.getState().comp!;
    const { container } = render(
      <Track
        track={comp.tracks[0]}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="Video"
      />,
    );
    const clips = container.querySelectorAll(".timeline-clip");
    expect(clips.length).toBe(3);
  });
});
