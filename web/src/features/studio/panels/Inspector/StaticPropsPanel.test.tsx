import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaticPropsPanel } from "./StaticPropsPanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { AudioClip, Composition, VideoClip } from "../../types";

// #56 — static property controls. The schema (transforms/filters/opacity/
// volume) and the preview renderer were already wired end-to-end; this
// panel was the last-mile UI. These tests pin the wiring so the
// "orphaned-capability" regression doesn't come back.

function compWithVideoClip(id: string, overrides: Partial<VideoClip> = {}): Composition {
  const c = makeEmptyComposition({ workId: "w-sp" });
  const clip: VideoClip = {
    id,
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...overrides,
  };
  (c.tracks[0].clips as VideoClip[]).push(clip);
  return c;
}

function compWithAudioClip(id: string, overrides: Partial<AudioClip> = {}): Composition {
  const c = makeEmptyComposition({ workId: "w-sp" });
  const clip: AudioClip = {
    id,
    kind: "audio",
    src: "/a.mp3",
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
    ...overrides,
  };
  const audioTrack = c.tracks.find((t) => t.kind === "audio")!;
  (audioTrack.clips as AudioClip[]).push(clip);
  return c;
}

function liveClip(id: string) {
  return useComposition.getState().comp!.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === id)!;
}

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null });
});

describe("<StaticPropsPanel />", () => {
  it("renders nothing when no clip is selected", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: null });
    const { container } = render(<StaticPropsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Transform + Adjust sections for a video clip", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1"),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    expect(screen.getByTestId("static-props-panel")).toBeInTheDocument();
    expect(screen.getByText(/transform/i)).toBeInTheDocument();
    expect(screen.getByText(/adjust/i)).toBeInTheDocument();
    // The slider and number-input both carry the property name; assert the
    // controls exist by role rather than by label so we don't fight the
    // duplicate accessible name.
    expect(screen.getByRole("slider", { name: /scale/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /scale/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /brightness/i })).toBeInTheDocument();
    // Opacity must NOT show on video clips — that's an Overlay-only static
    // field (composition.ts:237). Showing it would create two opacity
    // sources of truth (static vs the per-clip crossfade keyframe).
    expect(screen.queryByRole("slider", { name: /opacity/i })).toBeNull();
  });

  it("renders only Audio.volume for an audio clip", () => {
    useComposition.setState({
      comp: compWithAudioClip("a1", { volume: 0.7 }),
      selection: "a1",
    });
    render(<StaticPropsPanel />);
    expect(screen.getByText(/audio/i)).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /volume/i })).toBeInTheDocument();
    // No transform/adjust sections for audio.
    expect(screen.queryByText(/^transform$/i)).toBeNull();
    expect(screen.queryByText(/^adjust$/i)).toBeNull();
  });

  it("number-input change merges into the nested transforms object", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    const numberInput = screen.getByRole("spinbutton", { name: /scale/i });
    // Use fireEvent.change so React's controlled-input onChange fires
    // reliably with the synthesized event value.
    fireEvent.change(numberInput, { target: { value: "1.5" } });
    const live = liveClip("v1");
    // The other transform fields must remain untouched — this is the bug
    // the panel would create if it sent { transforms: { scale: 1.5 } }
    // without spreading the previous values.
    expect(live).toMatchObject({
      transforms: { scale: 1.5, x: 0, y: 0, rotation: 0 },
    });
  });

  it("filter slider change merges into the nested filters object", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    const slider = screen.getByRole("slider", { name: /brightness/i });
    fireEvent.change(slider, { target: { value: "0.4" } });
    const live = liveClip("v1");
    expect(live).toMatchObject({
      filters: { brightness: 0.4, contrast: 0, saturation: 0 },
    });
  });

  it("reset button restores the schema default and leaves siblings untouched", async () => {
    const user = userEvent.setup();
    useComposition.setState({
      comp: compWithVideoClip("v1", {
        transforms: { scale: 2, x: 100, y: 50, rotation: 45 },
      }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    await user.click(screen.getByRole("button", { name: /reset scale/i }));
    const live = liveClip("v1");
    expect(live.kind === "video" && live.transforms.scale).toBe(1);
    // Reset is per-property — sibling X must still be 100.
    expect(live.kind === "video" && live.transforms.x).toBe(100);
  });

  it("audio volume slider updates volume without polluting other fields", () => {
    useComposition.setState({
      comp: compWithAudioClip("a1", { fadeIn: 0.5 }),
      selection: "a1",
    });
    render(<StaticPropsPanel />);
    const slider = screen.getByRole("slider", { name: /volume/i });
    fireEvent.change(slider, { target: { value: "0.3" } });
    const live = liveClip("a1");
    expect(live.kind === "audio" && live.volume).toBe(0.3);
    // fadeIn must still be 0.5 — updateClip uses Object.assign, so a
    // top-level patch like { volume: 0.3 } cannot accidentally wipe it.
    expect(live.kind === "audio" && live.fadeIn).toBe(0.5);
  });
});
