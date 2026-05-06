import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";

// Phase 8.2.E — mock Remotion's per-frame hooks before importing Scene so
// the renderer pulls the test-driven frame value. `useVideoConfig` returns
// the AC1 fixture's video config; `useCurrentFrame` is overwritten per
// `it()` block via the imported handle.
const frameRef = { current: 0 };
vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  // Replace `Sequence` with a transparent wrapper so we don't depend on
  // Remotion's internal <Composition> context. Replace `OffthreadVideo`
  // with a div carrying the inline style so the DOM assertion can find
  // the scale() transform without needing real <video>.
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const FakeVideo = (props: Record<string, unknown>) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div data-test="offthread-video" style={(props as any).style} />
  );
  return {
    ...actual,
    Sequence: Passthrough,
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
import { computeVideoTransformForFrame } from "../composition/tracks/VideoTrackRenderer";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import type { Composition, VideoClip } from "../types";
import { interpolateProperty } from "@shared/keyframes";

// Phase 8.2.E — AC1 integration: a VideoClip with keyframes
//   [{property:"scale",time:0,value:1},{property:"scale",time:2,value:2}]
// authored end-to-end via store actions renders at scale=1, 1.5, 2 at
// frames 0, 30, 60 (30 fps). Per master-plan §8.2 the AC video can be
// authored entirely from the Inspector panel and the rendered DOM reflects
// the animation. This test ties schema → store action → renderer helper →
// rendered DOM together.

function makeFixtureViaStore(): Composition {
  // Author the clip + keyframes through the public store API exactly as
  // the Inspector KeyframePanel would — proving the end-to-end path.
  const comp = makeEmptyComposition({ workId: "w-ac1" });
  const clip: VideoClip = {
    id: "v-ac1",
    kind: "video",
    src: "/fixtures/sample.mp4",
    in: 0,
    out: 3,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
  (comp.tracks[0].clips as VideoClip[]).push(clip);
  comp.duration = 3;
  useComposition.setState({ comp, selection: "v-ac1", currentFrame: 0 });
  // Add the two scale keyframes through the store (NOT by mutating the
  // fixture directly) — this is the AC1 authoring path.
  useComposition.getState().addKeyframe("v-ac1", {
    property: "scale",
    time: 0,
    value: 1,
    easing: "linear",
  });
  useComposition.getState().addKeyframe("v-ac1", {
    property: "scale",
    time: 2,
    value: 2,
    easing: "linear",
  });
  return useComposition.getState().comp!;
}

function parseScale(transform: string): number {
  const m = /scale\(([-\d.]+)\)/.exec(transform);
  if (!m) throw new Error(`No scale() in transform: ${transform}`);
  return parseFloat(m[1]);
}

describe("Phase 8.2 integration — AC1 keyframe-driven scale animation", () => {
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

  it("authoring two keyframes via store.addKeyframe yields scale=1.5 at the linear midpoint (AC1 pure-helper assertion)", () => {
    const comp = makeFixtureViaStore();
    const clip = comp.tracks[0].clips[0] as VideoClip;
    expect(clip.keyframes).toBeDefined();
    expect(clip.keyframes!.length).toBe(2);
    // Pure helper agrees with the integration math: t=1s = midpoint.
    const fromHelper = interpolateProperty(clip.keyframes, "scale", 1)!;
    expect(fromHelper).toBeCloseTo(1.5, 6);
    // Renderer-level helper (used inside <VideoClipRenderer>) at frame 30
    // @ 30fps → localSec=1 → scale=1.5.
    const out = computeVideoTransformForFrame(clip, 30, 30);
    expect(out.scale).toBeCloseTo(1.5, 6);
    // Endpoints: frame 0 → 1; frame 60 → 2.
    expect(computeVideoTransformForFrame(clip, 0, 30).scale).toBeCloseTo(1, 6);
    expect(computeVideoTransformForFrame(clip, 60, 30).scale).toBeCloseTo(2, 6);
  });

  it("rendered <Scene /> reflects the interpolated scale at frame 30 (DOM assertion)", () => {
    const comp = makeFixtureViaStore();
    frameRef.current = 30;
    const { container } = render(<Scene comp={comp} />);
    // OffthreadVideo may render as a <video> or a placeholder under JSDOM;
    // we walk every element with an inline transform and find the one
    // produced by VideoClipRenderer (it carries `scale(...)`).
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>("[style]"),
    ).filter((el) => /scale\(/.test(el.style.transform));
    expect(candidates.length).toBeGreaterThan(0);
    const scales = candidates.map((el) => parseScale(el.style.transform));
    expect(scales.some((s) => Math.abs(s - 1.5) < 1e-3)).toBe(true);
  });
});
