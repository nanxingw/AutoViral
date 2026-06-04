import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TransitionPanel } from "./TransitionPanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { VideoClip } from "../../types";

// #54 Phase 2 — the picker UI. Phase 1 had store actions with zero UI callers;
// these tests exercise the last-mile wiring (add / update preset / duration /
// easing / remove) through the real store.

function videoClip(id: string, trackOffset: number, out = 3): VideoClip {
  return {
    id,
    kind: "video",
    src: "x.mp4",
    in: 0,
    out,
    trackOffset,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}
function videoTrack() {
  return useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
}

beforeEach(() => {
  cleanup();
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  const v1 = videoTrack();
  useComposition.getState().addClip(v1.id, videoClip("c1", 0, 3));
  useComposition.getState().addClip(v1.id, videoClip("c2", 3, 3));
  useComposition.getState().setSelection(null);
});

describe("TransitionPanel (#54 Phase 2 picker)", () => {
  it("renders nothing when no clip is selected", () => {
    const { container } = render(<TransitionPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for the LAST clip on the lane (no successor to fade into)", () => {
    useComposition.getState().setSelection("c2");
    const { container } = render(<TransitionPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the picker (but no duration/easing yet) for a clip with a successor", () => {
    useComposition.getState().setSelection("c1");
    render(<TransitionPanel />);
    expect(screen.getByTestId("transition-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("transition-duration-range")).toBeNull();
    expect(screen.queryByTestId("transition-easing-select")).toBeNull();
  });

  it("picking a preset adds a transition pinned to the selected clip", () => {
    useComposition.getState().setSelection("c1");
    render(<TransitionPanel />);
    fireEvent.change(screen.getByTestId("transition-preset-select"), {
      target: { value: "wipe-left" },
    });
    const trs = videoTrack().transitions!;
    expect(trs).toHaveLength(1);
    expect(trs[0].afterClipId).toBe("c1");
    expect(trs[0].preset).toBe("wipe-left");
    // duration + easing controls now appear
    expect(screen.getByTestId("transition-duration-range")).toBeInTheDocument();
    expect(screen.getByTestId("transition-easing-select")).toBeInTheDocument();
  });

  it("can pick a Phase-2 preset that did not exist in Phase 1 (e.g. clock-wipe)", () => {
    useComposition.getState().setSelection("c1");
    render(<TransitionPanel />);
    fireEvent.change(screen.getByTestId("transition-preset-select"), {
      target: { value: "clock-wipe" },
    });
    expect(videoTrack().transitions![0].preset).toBe("clock-wipe");
  });

  it("changing easing updates the transition (wires the formerly-dead field)", () => {
    useComposition.getState().setSelection("c1");
    render(<TransitionPanel />);
    fireEvent.change(screen.getByTestId("transition-preset-select"), {
      target: { value: "cross-dissolve" },
    });
    fireEvent.change(screen.getByTestId("transition-easing-select"), {
      target: { value: "spring" },
    });
    expect(videoTrack().transitions![0].easing).toBe("spring");
  });

  it("changing duration writes through the store (re-clamped)", () => {
    useComposition.getState().setSelection("c1");
    render(<TransitionPanel />);
    fireEvent.change(screen.getByTestId("transition-preset-select"), {
      target: { value: "cross-dissolve" },
    });
    fireEvent.change(screen.getByTestId("transition-duration-range"), {
      target: { value: "2" },
    });
    expect(videoTrack().transitions![0].durationSec).toBeCloseTo(2, 5);
  });

  it("selecting 无转场 (empty) removes the transition", () => {
    useComposition.getState().setSelection("c1");
    render(<TransitionPanel />);
    fireEvent.change(screen.getByTestId("transition-preset-select"), {
      target: { value: "cross-dissolve" },
    });
    expect(videoTrack().transitions!).toHaveLength(1);
    fireEvent.change(screen.getByTestId("transition-preset-select"), {
      target: { value: "" },
    });
    expect(videoTrack().transitions!).toHaveLength(0);
  });
});
