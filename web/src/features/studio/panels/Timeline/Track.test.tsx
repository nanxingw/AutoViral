import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Track } from "./Track";
import { useComposition } from "../../store";
import {
  makeEmptyComposition,
  type AudioClip,
  type TextClip,
  type VideoClip,
} from "../../types";

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

  const audio: AudioClip = {
    id: "audio-1",
    kind: "audio",
    src: "/bgm.mp3",
    in: 0,
    out: 4,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
  };
  c.tracks[1].clips.push(audio);

  const text: TextClip = {
    id: "text-1",
    kind: "text",
    text: "hi",
    trackOffset: 0,
    duration: 2,
    style: {
      font: "Inter",
      size: 64,
      weight: 700,
      italic: false,
      tracking: 0,
      color: "#ffffff",
    },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
  };
  c.tracks[2].clips.push(text);

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

  it("mounts a Filmstrip overlay for each video clip on a video track", () => {
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
    const strips = container.querySelectorAll('[aria-label="filmstrip"]');
    expect(strips.length).toBe(3);
  });

  it("does not mount Filmstrip for audio tracks", () => {
    const comp = useComposition.getState().comp!;
    const { container } = render(
      <Track
        track={comp.tracks[1]}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="BGM"
      />,
    );
    const strips = container.querySelectorAll('[aria-label="filmstrip"]');
    expect(strips.length).toBe(0);
  });

  it("does not mount Filmstrip for text tracks", () => {
    const comp = useComposition.getState().comp!;
    const { container } = render(
      <Track
        track={comp.tracks[2]}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="Subtitles"
      />,
    );
    const strips = container.querySelectorAll('[aria-label="filmstrip"]');
    expect(strips.length).toBe(0);
  });

  // Phase 4.E — waveform overlay mounting (mirrors filmstrip gating).
  it("mounts a WaveformBars overlay for each audio clip on an audio track", () => {
    const comp = useComposition.getState().comp!;
    const { container } = render(
      <Track
        track={comp.tracks[1]}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="BGM"
      />,
    );
    const overlays = container.querySelectorAll(
      '[aria-label="waveform-loading"], [aria-label="waveform"]',
    );
    expect(overlays.length).toBe(1);
  });

  it("does not mount WaveformBars for video tracks", () => {
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
    const overlays = container.querySelectorAll(
      '[aria-label="waveform-loading"], [aria-label="waveform"]',
    );
    expect(overlays.length).toBe(0);
  });

  it("does not mount WaveformBars for text tracks", () => {
    const comp = useComposition.getState().comp!;
    const { container } = render(
      <Track
        track={comp.tracks[2]}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="Subtitles"
      />,
    );
    const overlays = container.querySelectorAll(
      '[aria-label="waveform-loading"], [aria-label="waveform"]',
    );
    expect(overlays.length).toBe(0);
  });
});
