import { render, screen } from "@testing-library/react";
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
    fitMode: "cover",
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
    fitMode: "cover",
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
    fitMode: "cover",
    transforms: baseTransform,
    filters: baseFilters,
  };
  // Phase D (issue #31) — resolve tracks by kind, not index. Default lanes
  // are now V1/A1/A2/CC1, so `tracks[2]` is audio (A2), not text. Hardcoding
  // the index here was a Pitfall-#1 hazard the migration is meant to dodge.
  const videoLane = c.tracks.find((t) => t.kind === "video")!;
  videoLane.clips.push(a, b, d);

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
  const audioLane = c.tracks.find((t) => t.kind === "audio")!;
  audioLane.clips.push(audio);

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
  const textLane = c.tracks.find((t) => t.kind === "text")!;
  textLane.clips.push(text);

  c.duration = 6;
  useComposition.setState({
    comp: c,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
  });
});

describe("Track (dnd-kit)", () => {
  it("shows the localized per-kind hint for an empty track", () => {
    const track = { ...useComposition.getState().comp!.tracks.find((t) => t.kind === "audio")!, clips: [] };
    render(<Track track={track} pxPerSecond={50} totalWidth={800} color="purple" label="Audio" />);
    const hint = screen.getByTestId("empty-track-hint");
    expect(hint).toHaveTextContent("Drop audio · or choose VO from the library");
    expect(hint).toHaveStyle({ pointerEvents: "none" });
  });

  it("marks the row containing the selected clip with a 2px accent rail", () => {
    const track = useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
    useComposition.setState({ selection: track.clips[0].id });
    const { container } = render(<Track track={track} pxPerSecond={50} totalWidth={800} color="blue" label="Video" />);
    const row = container.querySelector('[data-selected-row="true"]') as HTMLElement;
    expect(row).toHaveStyle({ borderLeftWidth: "2px", borderLeftStyle: "solid" });
    expect(row.getAttribute("style")).toContain("border-left-color: var(--accent)");
  });

  it("marks every row containing any member of a cross-track selection", () => {
    const videoTrack = useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
    useComposition.getState().setTimelineSelection({
      ids: ["audio-1", "a"],
      primaryId: "audio-1",
      anchorId: "audio-1",
    });
    const { container } = render(
      <Track track={videoTrack} pxPerSecond={50} totalWidth={800} color="blue" label="Video" />,
    );
    expect(container.querySelector('[data-selected-row="true"]')).toBeInTheDocument();
  });

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
