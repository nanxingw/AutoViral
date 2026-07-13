import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { makeEmptyComposition, type VideoClip } from "../../types";
import { useComposition } from "../../store";
import { MarqueeSelection } from "./MarqueeSelection";
import { useShortcuts } from "../../hooks/useShortcuts";

const transform = { scale: 1, x: 0, y: 0, rotation: 0 };
const filters = { brightness: 0, contrast: 0, saturation: 0 };

function clip(id: string, trackOffset: number): VideoClip {
  return {
    id,
    kind: "video",
    src: `/${id}.mp4`,
    in: 0,
    out: 1,
    trackOffset,
    fitMode: "cover",
    transforms: transform,
    filters,
  };
}

function seed() {
  const comp = makeEmptyComposition({ workId: "marquee" });
  const firstVideo = comp.tracks.find((track) => track.kind === "video")!;
  const secondVideo = {
    ...firstVideo,
    id: "video-2",
    displayOrder: comp.tracks.length,
    clips: [] as VideoClip[],
  };
  firstVideo.clips.push(clip("a", 0));
  secondVideo.clips.push(clip("b", 2));
  comp.tracks.push(secondVideo);
  comp.duration = 3;
  useComposition.setState({
    comp,
    selection: null,
    timelineSelection: { ids: [], primaryId: null, anchorId: null },
  });
}

function setRect(element: Element, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
}

function Harness() {
  const ref = createRef<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="surface" style={{ position: "relative" }}>
      <div data-track-id="video-1" data-testid="lane-a">
        <div data-clip-id="a" data-testid="clip-a" />
      </div>
      <div data-track-id="video-2" data-testid="lane-b">
        <div data-clip-id="b" data-testid="clip-b" />
      </div>
      <MarqueeSelection containerRef={ref} />
    </div>
  );
}

function ShortcutHarness() {
  useShortcuts(null);
  return <Harness />;
}

beforeEach(seed);

describe("MarqueeSelection", () => {
  it("selects intersecting clips across tracks", () => {
    render(<Harness />);
    setRect(screen.getByTestId("surface"), { left: 0, top: 0 });
    setRect(screen.getByTestId("clip-a"), { left: 10, top: 10, right: 40, bottom: 30 });
    setRect(screen.getByTestId("clip-b"), { left: 15, top: 45, right: 45, bottom: 65 });

    fireEvent.pointerDown(screen.getByTestId("lane-a"), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 70 });
    expect(
      screen.getByRole("status", { name: /marquee selection/i }),
    ).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 50, clientY: 70 });

    expect(useComposition.getState().timelineSelection.ids).toEqual(["a", "b"]);
    expect(useComposition.getState().selection).toBe("a");
  });

  it("unions with Shift and toggles with Command/Ctrl marquee", () => {
    render(<Harness />);
    setRect(screen.getByTestId("surface"), { left: 0, top: 0 });
    setRect(screen.getByTestId("clip-a"), { left: 10, top: 10, right: 40, bottom: 30 });
    setRect(screen.getByTestId("clip-b"), { left: 60, top: 10, right: 90, bottom: 30 });
    useComposition.getState().setSelection("a");

    fireEvent.pointerDown(screen.getByTestId("lane-b"), {
      button: 0,
      shiftKey: true,
      clientX: 50,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 40 });
    expect(useComposition.getState().timelineSelection.ids).toEqual(["a", "b"]);

    fireEvent.pointerDown(screen.getByTestId("lane-b"), {
      button: 0,
      metaKey: true,
      clientX: 50,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 40 });
    expect(useComposition.getState().timelineSelection.ids).toEqual(["a"]);
  });

  it("clears on Escape and on a blank click", () => {
    render(<Harness />);
    useComposition.getState().setSelection("a");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useComposition.getState().selection).toBeNull();

    useComposition.getState().setSelection("b");
    fireEvent.pointerDown(screen.getByTestId("lane-a"), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    expect(useComposition.getState().selection).toBeNull();
  });

  it("aborts an active marquee on pointer cancellation without changing selection", () => {
    render(<Harness />);
    setRect(screen.getByTestId("surface"), { left: 0, top: 0 });
    setRect(screen.getByTestId("clip-b"), {
      left: 60,
      top: 10,
      right: 90,
      bottom: 30,
    });
    useComposition.getState().setSelection("a");

    fireEvent.pointerDown(screen.getByTestId("lane-b"), {
      button: 0,
      clientX: 50,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 40 });
    expect(screen.getByRole("status", { name: /marquee selection/i })).toBeInTheDocument();
    fireEvent.pointerCancel(window, { clientX: 100, clientY: 40 });

    expect(
      screen.queryByRole("status", { name: /marquee selection/i }),
    ).not.toBeInTheDocument();
    expect(useComposition.getState().timelineSelection.ids).toEqual(["a"]);
    expect(useComposition.getState().selection).toBe("a");
  });

  it("deletes every selected clip as one group", () => {
    render(<Harness />);
    useComposition.getState().setTimelineSelection({
      ids: ["a", "b"],
      primaryId: "a",
      anchorId: "a",
    });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(
      useComposition.getState().comp!.tracks.flatMap((track) => track.clips),
    ).toHaveLength(0);
    expect(useComposition.getState().timelineSelection.ids).toEqual([]);
  });

  it("leaves a single-selection Shift+Backspace to the legacy ripple shortcut", () => {
    const comp = useComposition.getState().comp!;
    const videoTrack = comp.tracks.find((track) => track.kind === "video")!;
    (videoTrack.clips as VideoClip[]).push(clip("later", 3));
    comp.duration = 4;
    useComposition.getState().setSelection("a");
    render(<ShortcutHarness />);

    fireEvent.keyDown(window, { key: "Backspace", shiftKey: true });
    const remaining = useComposition
      .getState()
      .comp!.tracks.find((track) => track.id === videoTrack.id)!.clips;
    expect(remaining.map((item) => item.id)).toEqual(["later"]);
    expect(remaining[0].trackOffset).toBe(2);
  });
});
