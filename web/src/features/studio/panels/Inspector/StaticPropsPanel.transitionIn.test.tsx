import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaticPropsPanel } from "./StaticPropsPanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { Composition, VideoClip } from "../../types";

// PRD-0014 S3 — Inspector entrance-transition selector (入场转场 preset + duration).
// Both controls run the shared `setClipTransitionIn` store action
// (→ ops.setTransitionIn), so the human Inspector and `autoviral clip set
// --transition-in glitch:0.4` converge on ONE composition.

function compWithVideoClip(id: string, overrides: Partial<VideoClip> = {}): Composition {
  const c = makeEmptyComposition({ workId: "w-ti" });
  const clip: VideoClip = {
    id,
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...overrides,
  };
  (c.tracks.find((t) => t.kind === "video")!.clips as VideoClip[]).push(clip);
  return c;
}

function liveVideo(id: string) {
  return useComposition
    .getState()
    .comp!.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === id) as VideoClip;
}

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null });
});

describe("<StaticPropsPanel /> — entrance transition (S3)", () => {
  it("shows an entrance transition preset selector for a video clip", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    expect(screen.getByLabelText("Transition")).toBeInTheDocument();
  });

  it("picking a preset writes transitionIn through the shared op (default duration)", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    fireEvent.change(screen.getByLabelText("Transition"), {
      target: { value: "glitch" },
    });
    const clip = liveVideo("v1");
    expect(clip.transitionIn?.preset).toBe("glitch");
    // glitch registry default = 0.4
    expect(clip.transitionIn?.durationSec).toBe(0.4);
  });

  it("selecting None clears an existing transitionIn", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { transitionIn: { preset: "glitch", durationSec: 0.4 } }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    fireEvent.change(screen.getByLabelText("Transition"), {
      target: { value: "__none__" },
    });
    expect(liveVideo("v1").transitionIn).toBeUndefined();
  });

  it("editing the duration updates transitionIn.durationSec via the op", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { transitionIn: { preset: "glitch", durationSec: 0.4 } }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    fireEvent.change(screen.getByLabelText("Duration (s)"), {
      target: { value: "0.8" },
    });
    expect(liveVideo("v1").transitionIn?.durationSec).toBe(0.8);
  });

  it("an over-long duration is silently rejected by the op (clip unchanged)", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { transitionIn: { preset: "glitch", durationSec: 0.4 } }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    // clip is 5s → 9s entrance exceeds effective duration → op throws → store no-op.
    fireEvent.change(screen.getByLabelText("Duration (s)"), {
      target: { value: "9" },
    });
    expect(liveVideo("v1").transitionIn?.durationSec).toBe(0.4);
  });
});
