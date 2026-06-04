import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";

// Phase 8.3.F — AC integration tests for speed ramp / time remap.
//
// Ties the schema (8.3.A) → store keyframes (8.3.B) → renderer
// playbackRate (8.3.C) → KeyframePanel speed property (8.3.D) → ffmpeg
// pre-pass (8.3.E) together by rendering <Scene /> under a Remotion mock
// and asserting both:
//   AC1 — effectiveClipDuration returns (out-in)/speed for static speed.
//   AC2 — VideoClipRenderer routes the same speed value into the
//          OffthreadVideo's playbackRate prop, captured via a fake video
//          stand-in that exposes the prop as a data attribute.

// Mirror Phase 8.2's mock: replace Sequence/Audio with passthroughs and
// OffthreadVideo with a div that surfaces `playbackRate` (and the inline
// style) as data attributes so the DOM assertion can read them under
// happy-dom (which doesn't implement HTMLMediaElement.playbackRate).
const frameRef = { current: 0 };
vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const FakeVideo = (props: Record<string, unknown>) => (
    <div
      data-test="offthread-video"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-playback-rate={String((props as any).playbackRate ?? "1")}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={(props as any).style}
    />
  );
  return {
    ...actual,
    Sequence: Passthrough,
    // VideoTrackRenderer renders <Video> (browser-side path, 2026-05-08), not
    // <OffthreadVideo>; the playbackRate prop the AC asserts flows into Video.
    // Mock it so the real component doesn't throw "No video config found".
    Video: FakeVideo,
    OffthreadVideo: FakeVideo,
    Audio: Passthrough,
    Img: FakeVideo,
    useCurrentFrame: () => frameRef.current,
    useVideoConfig: () => ({
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 90,
      defaultProps: {},
      props: {},
      id: "main",
    }),
  };
});

import { Scene } from "../composition/Scene";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import type { Composition, VideoClip } from "../types";
import { effectiveClipDuration } from "@shared/speed-ramp";

function makeFixture(speed: number): Composition {
  const comp = makeEmptyComposition({ workId: "w-ac-speed" });
  const clip: VideoClip = {
    id: "v-speed",
    kind: "video",
    src: "/fixtures/sample.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
  (comp.tracks[0].clips as VideoClip[]).push(clip);
  comp.duration = 4 / speed;
  useComposition.setState({ comp, selection: "v-speed", currentFrame: 0 });
  // Author static speed via two equal-value keyframes — exactly what the
  // Inspector's "speed" property does (Phase 8.3.D).
  useComposition.getState().addKeyframe("v-speed", {
    property: "speed",
    time: 0,
    value: speed,
    easing: "linear",
  });
  useComposition.getState().addKeyframe("v-speed", {
    property: "speed",
    time: 4,
    value: speed,
    easing: "linear",
  });
  return useComposition.getState().comp!;
}

function readPlaybackRate(container: HTMLElement): number {
  const el = container.querySelector<HTMLElement>(
    "[data-test='offthread-video']",
  );
  if (!el) throw new Error("no offthread-video stand-in element rendered");
  const v = el.getAttribute("data-playback-rate") ?? "1";
  return Number(v);
}

describe("Phase 8.3 integration — AC speed ramp", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: null,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
    });
    frameRef.current = 0;
  });

  afterEach(() => {
    frameRef.current = 0;
  });

  it("AC1: static speed=2 → effectiveClipDuration halves source dur, renderer routes playbackRate=2", () => {
    const comp = makeFixture(2.0);
    const clip = comp.tracks[0].clips[0] as VideoClip;
    expect(effectiveClipDuration(clip)).toBeCloseTo(2.0, 3);

    frameRef.current = 30; // 1s timeline-time at 30fps
    const { container } = render(<Scene comp={comp} />);
    expect(readPlaybackRate(container)).toBeCloseTo(2.0, 3);
  });

  it("AC2: static speed=0.5 → effectiveClipDuration doubles, renderer routes playbackRate=0.5", () => {
    const comp = makeFixture(0.5);
    const clip = comp.tracks[0].clips[0] as VideoClip;
    expect(effectiveClipDuration(clip)).toBeCloseTo(8.0, 3);

    frameRef.current = 30;
    const { container } = render(<Scene comp={comp} />);
    expect(readPlaybackRate(container)).toBeCloseTo(0.5, 3);
  });
});
