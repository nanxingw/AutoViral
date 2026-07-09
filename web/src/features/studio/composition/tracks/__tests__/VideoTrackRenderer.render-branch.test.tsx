import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// S2 (PRD-0012) — render-environment branch PROOF. docs/issues/026 root cause:
// VideoTrackRenderer unconditionally rendered <Video> (browser native <video>
// seek), which is what the SAME <Scene> tree renders under server-side
// renderMedia/renderFrames too (headless Chromium runs this exact component).
// Native <video> seeks are NOT frame-accurate — they snap to the nearest
// keyframe — which baked periodic backward jumps into every export.
//
// The fix: branch on `getRemotionEnvironment().isRendering` —
//   isRendering=true  (server render)  → <OffthreadVideo> (ffmpeg-backed,
//                                         frame-accurate)
//   isRendering=false (browser preview) → <Video> (unchanged — the 2026-05-08
//                                         decoder-budget fix must not regress)
// Preview-only props (`acceptableTimeShiftInSeconds`, `pauseWhenBuffering`)
// exist to smooth OUT native <video> seek jank; they must NOT be forwarded to
// <OffthreadVideo>, which has no such concept and doesn't need it (ffmpeg
// frame extraction is already exact).
//
// This is the FIRST test file in the repo to mock getRemotionEnvironment —
// unlike the sibling VideoTrackRenderer.*.test.tsx files, Video and
// OffthreadVideo must be two DISTINGUISHABLE fakes here (not the same
// FakeVideo) so the branch itself is provable.

const frameRef = { current: 0 };
const isRenderingRef = { current: false };

vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  // codex review (S2 finding, medium) — the branch-equivalence test used to
  // serialize ONLY prop KEYS (Object.keys), so a regression that computed a
  // WRONG startFrom/endAt/playbackRate value on one branch (but kept the same
  // key set) would still pass. `data-values` carries the actual scalar values
  // so the test below can assert real equality, not just key-presence.
  const valuesOf = (props: Record<string, unknown>) =>
    JSON.stringify({
      src: props.src,
      startFrom: props.startFrom,
      endAt: props.endAt,
      playbackRate: props.playbackRate,
    });
  const FakeVideo = (props: Record<string, unknown>) => (
    <div
      data-test="video"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-src={(props as any).src}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-props={JSON.stringify(Object.keys(props).sort())}
      data-values={valuesOf(props)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={(props as any).style}
    />
  );
  const FakeOffthreadVideo = (props: Record<string, unknown>) => (
    <div
      data-test="offthread-video"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-src={(props as any).src}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-props={JSON.stringify(Object.keys(props).sort())}
      data-values={valuesOf(props)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={(props as any).style}
    />
  );
  const FakeImg = (props: Record<string, unknown>) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <img data-test="overlay-img" src={(props as any).src} style={(props as any).style} />
  );
  return {
    ...actual,
    Sequence: Passthrough,
    Video: FakeVideo,
    OffthreadVideo: FakeOffthreadVideo,
    Audio: Passthrough,
    Img: FakeImg,
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
    getRemotionEnvironment: () => ({
      isStudio: false,
      isRendering: isRenderingRef.current,
      isPlayer: !isRenderingRef.current,
      isReadOnlyStudio: false,
      isClientSideRendering: false,
    }),
  };
});

// @remotion/transitions' <TransitionSeries> requires a real Player/Composition
// registration (its internal <Sequence> resolves useVideoConfig() through the
// ACTUAL remotion module — a package boundary vi.mock("remotion", ...) above
// does not reach, since @remotion/transitions is a separately-resolved CJS
// dependency). This suite only needs to prove the Video/OffthreadVideo BRANCH
// selection is unchanged for clips rendered inside a transition chain — not
// TransitionSeries' own crossfade timing/animation (untouched by S2, and
// already covered by groupChains.test.ts + the shared preset visual mapping).
// Stub it to a plain sequential passthrough so VideoClipRenderer still runs
// for both chained clips without needing the full Remotion runtime.
vi.mock("@remotion/transitions", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const TransitionSeriesMock = Object.assign(Passthrough, {
    Sequence: Passthrough,
    Transition: () => null,
  });
  return { ...actual, TransitionSeries: TransitionSeriesMock };
});

import { Scene } from "../../Scene";
import { makeEmptyComposition } from "../../../types";
import type { Composition, VideoClip, Track, Transition } from "../../../types";

function compWithVideo(): Composition {
  const clip: VideoClip = {
    id: "vc_branch01",
    kind: "video",
    src: "assets/clip.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
  };
  const comp = makeEmptyComposition({ workId: "w-branch" });
  const videoTrack: Track = {
    id: "trk_v1",
    kind: "video",
    label: "Video",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [],
    clips: [clip],
  };
  comp.tracks.push(videoTrack);
  comp.duration = 4;
  return comp;
}

// codex review (S2 finding, medium) — the original equivalence fixture used
// in:0/out:4 (== the clip's full source span, i.e. "no trim") and no speed
// keyframes (playbackRate falls back to the D3 default of 1.0), so a bug
// that only manifests on a REAL trim/speed value could slip through. This
// fixture trims the head (in:1, non-zero/non-default) and pins a constant
// 2x speed via keyframes (D6 fast-path, mirrors VideoTrackRenderer.speed.test.tsx),
// so startFrom/endAt/playbackRate all diverge from their "empty" defaults.
function compWithNonDefaultTrimAndSpeedVideo(): Composition {
  const clip: VideoClip = {
    id: "vc_trimmed01",
    kind: "video",
    src: "assets/trimmed-clip.mp4",
    in: 1,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
    keyframes: [
      { property: "speed", time: 0, value: 2.0, easing: "linear" },
      { property: "speed", time: 3, value: 2.0, easing: "linear" },
    ],
  };
  const comp = makeEmptyComposition({ workId: "w-branch-trim" });
  const videoTrack: Track = {
    id: "trk_v1",
    kind: "video",
    label: "Video",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [],
    clips: [clip],
  };
  comp.tracks.push(videoTrack);
  comp.duration = 4;
  return comp;
}

// codex review (S2 finding, medium) — PRD-0011/0012 S2's preset test contract
// explicitly calls for "speed/trim/transition 等既有 props 两分支等价传递"; the
// original file only ever set `transitions: []` on the track and never
// exercised the multi-clip <TransitionSeries> path, so the branch (Video vs
// OffthreadVideo) was unproven for clips rendered inside a transition chain.
function compWithTransitionChain(): Composition {
  const clipA: VideoClip = {
    id: "vc_chainA",
    kind: "video",
    src: "assets/chain-a.mp4",
    in: 0,
    out: 3,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
  };
  const clipB: VideoClip = {
    id: "vc_chainB",
    kind: "video",
    src: "assets/chain-b.mp4",
    in: 0,
    out: 3,
    trackOffset: 3,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
  };
  const transition: Transition = {
    id: "tr_chain01",
    afterClipId: "vc_chainA",
    preset: "cross-dissolve",
    durationSec: 0.5,
    alignment: "center",
    easing: "linear",
  };
  const comp = makeEmptyComposition({ workId: "w-branch-transition" });
  const videoTrack: Track = {
    id: "trk_v1",
    kind: "video",
    label: "Video",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [transition],
    clips: [clipA, clipB],
  };
  comp.tracks.push(videoTrack);
  comp.duration = 6;
  return comp;
}

function videoLayers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-test='video']"));
}
function offthreadLayers(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-test='offthread-video']"),
  );
}

describe("VideoTrackRenderer render-environment branch (S2, PRD-0012 / issue 026)", () => {
  it("isRendering=false (preview) → renders <Video>, not <OffthreadVideo>", () => {
    isRenderingRef.current = false;
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo()} />);
    expect(videoLayers(container).length).toBe(1);
    expect(offthreadLayers(container).length).toBe(0);
  });

  it("isRendering=false (preview) → carries acceptableTimeShiftInSeconds + pauseWhenBuffering", () => {
    isRenderingRef.current = false;
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo()} />);
    const props = JSON.parse(videoLayers(container)[0].getAttribute("data-props")!);
    expect(props).toContain("acceptableTimeShiftInSeconds");
    expect(props).toContain("pauseWhenBuffering");
  });

  it("isRendering=true (server render) → renders <OffthreadVideo>, not <Video>", () => {
    isRenderingRef.current = true;
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo()} />);
    expect(offthreadLayers(container).length).toBe(1);
    expect(videoLayers(container).length).toBe(0);
  });

  it("isRendering=true (server render) → does NOT carry preview-only props", () => {
    isRenderingRef.current = true;
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo()} />);
    const props = JSON.parse(
      offthreadLayers(container)[0].getAttribute("data-props")!,
    );
    expect(props).not.toContain("acceptableTimeShiftInSeconds");
    expect(props).not.toContain("pauseWhenBuffering");
  });

  it("speed/trim props are equivalent across both branches (src/startFrom/endAt/playbackRate)", () => {
    // Non-default fixture: in:1 (trimmed head) + constant 2x speed keyframes.
    // frame=30 @ fps=30 → localSec=1, inside the [0,3] speed-kf span → 2.0.
    frameRef.current = 30;
    isRenderingRef.current = false;
    const { container: previewContainer } = render(
      <Scene comp={compWithNonDefaultTrimAndSpeedVideo()} />,
    );
    const previewProps = JSON.parse(
      videoLayers(previewContainer)[0].getAttribute("data-props")!,
    ) as string[];
    const previewValues = JSON.parse(
      videoLayers(previewContainer)[0].getAttribute("data-values")!,
    ) as { src: string; startFrom: number; endAt: number; playbackRate: number };

    isRenderingRef.current = true;
    const { container: renderContainer } = render(
      <Scene comp={compWithNonDefaultTrimAndSpeedVideo()} />,
    );
    const renderProps = JSON.parse(
      offthreadLayers(renderContainer)[0].getAttribute("data-props")!,
    ) as string[];
    const renderValues = JSON.parse(
      offthreadLayers(renderContainer)[0].getAttribute("data-values")!,
    ) as { src: string; startFrom: number; endAt: number; playbackRate: number };

    for (const shared of ["src", "startFrom", "endAt", "playbackRate", "style"]) {
      expect(previewProps).toContain(shared);
      expect(renderProps).toContain(shared);
    }
    expect(
      previewProps
        .filter((p) => p !== "acceptableTimeShiftInSeconds" && p !== "pauseWhenBuffering")
        .sort(),
    ).toEqual(renderProps.sort());

    // Anchor to INDEPENDENTLY-computed expected values (not just "branches
    // agree with each other") so a bug that broke BOTH branches identically
    // (e.g. dropped the `in`-offset entirely) would still be caught. src is
    // rewritten by Scene's resolveCompositionAssets (relative → /api/works/:id/assets/...).
    const expected = {
      src: "/api/works/w-branch-trim/assets/trimmed-clip.mp4",
      startFrom: 30,
      endAt: 120,
      playbackRate: 2,
    };
    expect(previewValues).toEqual(expected);
    expect(renderValues).toEqual(expected);
  });

  it("transition chain (two clips + a preset) branches the SAME way as a standalone clip", () => {
    // PRD-0011/0012 S2 preset test contract explicitly names "transition" as
    // a prop family that must branch equivalently; a multi-clip chain routes
    // through <TransitionSeries> instead of a plain <Sequence>, so this
    // proves the Video/OffthreadVideo choice isn't accidentally scoped to
    // the single-clip code path only.
    frameRef.current = 15;

    isRenderingRef.current = false;
    const { container: previewContainer } = render(
      <Scene comp={compWithTransitionChain()} />,
    );
    expect(videoLayers(previewContainer).length).toBeGreaterThan(0);
    expect(offthreadLayers(previewContainer).length).toBe(0);

    isRenderingRef.current = true;
    const { container: renderContainer } = render(
      <Scene comp={compWithTransitionChain()} />,
    );
    expect(offthreadLayers(renderContainer).length).toBeGreaterThan(0);
    expect(videoLayers(renderContainer).length).toBe(0);

    // Both source clips must be represented (chain didn't collapse to one).
    const renderSrcs = offthreadLayers(renderContainer).map((el) =>
      el.getAttribute("data-src"),
    );
    expect(renderSrcs).toContain("/api/works/w-branch-transition/assets/chain-a.mp4");
    expect(renderSrcs).toContain("/api/works/w-branch-transition/assets/chain-b.mp4");
  });
});
