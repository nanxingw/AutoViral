import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// PRD-0016 S2 — premount 暖场 RENDER-TREE contract.
//
// docs/issues/032 root cause: each no-transition video clip is an independent
// <Sequence> with NO premountFor, so at a hard cut the outgoing Sequence
// unmounts and the incoming one mounts in the SAME commit (remotion
// Sequence.js:182). The new <video> gets its src only then; readyState <
// HAVE_FUTURE_DATA → blockMedia() + .load() (use-media-buffering.js:109), which
// the S1 red baseline reproduced as `waiting=40` + audio backward-replay.
//
// The fix (this slice): give the OUTER <Sequence> of every video chain a
// `premountFor` window (≈1s = Math.round(fps) frames). A premounted Sequence
// really `.load()`s its media early but EXPLICITLY skips the global buffering
// block (use-media-buffering.js:20-43), removing the cold-mount trigger both
// symptoms share.
//
// PREVIEW-ONLY BY REMOTION'S OWN CONSTRUCTION: Sequence.js:249-256 only routes
// to <PremountedPostmountedSequence> when `!env.isRendering`; under
// isRendering=true it ALWAYS renders <RegularSequence> regardless of
// premountFor. So we can pass premountFor unconditionally — the server render
// tree is provably unaffected (case ③ locks this in the render-branch form).
//
// This mock CAPTURES every remotion <Sequence>'s props (premountFor) while
// passing children through. In VideoTrackRenderer, the remotion <Sequence> is
// ONLY ever used as the OUTER chain wrapper — inner sequences are
// <TransitionSeries.Sequence> (a different, separately-mocked component) — so
// each captured entry is an outer wrapper.

const isRenderingRef = { current: false };
const fpsRef = { current: 30 };
const capturedSequences: Array<Record<string, unknown>> = [];

const valuesOf = (props: Record<string, unknown>) =>
  JSON.stringify({
    src: props.src,
    startFrom: props.startFrom,
    endAt: props.endAt,
    playbackRate: props.playbackRate,
  });

vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const CapturingSequence = (props: Record<string, unknown>) => {
    capturedSequences.push(props);
    return <>{props.children as React.ReactNode}</>;
  };
  const FakeVideo = (props: Record<string, unknown>) => (
    <div
      data-test="video"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-src={(props as any).src}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-start-from={(props as any).startFrom}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-end-at={(props as any).endAt}
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
      data-props={JSON.stringify(Object.keys(props).sort())}
      data-values={valuesOf(props)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={(props as any).style}
    />
  );
  return {
    ...actual,
    Sequence: CapturingSequence,
    // S16 review fix — freeze holds via a <Freeze> wrapper; the mocked
    // useCurrentFrame defeats real frame-pinning, so render it as a passthrough
    // (mirrors VideoTrackRenderer.reverseFreeze.test.tsx). The pixel-level hold
    // is proven by the consistency gate, not here.
    Freeze: Passthrough,
    Video: FakeVideo,
    OffthreadVideo: FakeOffthreadVideo,
    Audio: Passthrough,
    Img: (props: Record<string, unknown>) => (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <img data-test="overlay-img" src={(props as any).src} style={(props as any).style} />
    ),
    useCurrentFrame: () => 3,
    useVideoConfig: () => ({
      fps: fpsRef.current,
      width: 1080,
      height: 1920,
      durationInFrames: 180,
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

// TransitionSeries stub — a plain passthrough that leaves a queryable marker so
// the entrance/multi-clip paths still run VideoClipRenderer for both clips
// without needing the full Remotion runtime (mirrors render-branch.test.tsx).
vi.mock("@remotion/transitions", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const TransitionSeriesMock = Object.assign(
    ({ children }: { children?: React.ReactNode }) => (
      <div data-test="transition-series">{children}</div>
    ),
    {
      Sequence: ({ children }: { children?: React.ReactNode }) => (
        <div data-test="transition-series-sequence">{children}</div>
      ),
      Transition: () => null,
    },
  );
  return { ...actual, TransitionSeries: TransitionSeriesMock };
});

import { Scene } from "../../Scene";
import { makeEmptyComposition } from "../../../types";
import type { Composition, VideoClip, Track, Transition } from "../../../types";

function mkClip(extra: Partial<VideoClip>): VideoClip {
  return {
    id: extra.id ?? "vc_pm01",
    kind: "video",
    src: extra.src ?? "assets/clip.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
    ...extra,
  };
}

function compWith(clips: VideoClip[], transitions: Transition[] = []): Composition {
  const comp = makeEmptyComposition({ workId: "w-pm" });
  const videoTrack: Track = {
    id: "trk_v1",
    kind: "video",
    label: "Video",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions,
    clips,
  };
  comp.tracks.push(videoTrack);
  comp.duration = clips.length * 4;
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

beforeEach(() => {
  capturedSequences.length = 0;
  isRenderingRef.current = false;
  fpsRef.current = 30;
});

describe("VideoTrackRenderer premount warm-up (PRD-0016 S2)", () => {
  // ① 普通单 clip 路径的外层 <Sequence> 带 premountFor === Math.round(fps).
  it("① plain single-clip Sequence carries premountFor = Math.round(fps)", () => {
    render(<Scene comp={compWith([mkClip({ id: "vc_a", src: "assets/a.mp4" })])} />);
    // Exactly ONE outer remotion <Sequence> for a single-clip no-entrance chain.
    expect(capturedSequences.length).toBe(1);
    expect(capturedSequences[0].premountFor).toBe(30); // Math.round(fps=30)
  });

  // ① sweep — the value TRACKS fps and is genuinely rounded (not truncated).
  it("① premountFor = Math.round(fps) across integer + fractional fps", () => {
    const cases: Array<[number, number]> = [
      [30, 30],
      [24, 24],
      [25, 25],
      [60, 60],
      [23.976, 24], // fractional → rounded (24), not floored (23)
      [29.97, 30],
    ];
    for (const [fps, expected] of cases) {
      capturedSequences.length = 0;
      fpsRef.current = fps;
      render(<Scene comp={compWith([mkClip({ id: "vc_r", src: "assets/r.mp4" })])} />);
      expect(capturedSequences.length).toBe(1);
      expect(capturedSequences[0].premountFor).toBe(expected);
    }
    fpsRef.current = 30;
  });

  // ② TransitionSeries 包裹路径的外层 <Sequence> 同样带 premountFor —
  //    (a) 多 clip cut-point chain, (b) 单 clip + entrance.
  it("② multi-clip TransitionSeries chain outer Sequence carries premountFor", () => {
    const clipA = mkClip({ id: "vc_A", src: "assets/a.mp4", out: 3 });
    const clipB = mkClip({ id: "vc_B", src: "assets/b.mp4", out: 3, trackOffset: 3 });
    const transition: Transition = {
      id: "tr_AB",
      afterClipId: "vc_A",
      preset: "cross-dissolve",
      durationSec: 0.5,
      alignment: "center",
      easing: "linear",
    };
    const { container } = render(<Scene comp={compWith([clipA, clipB], [transition])} />);
    // routed through TransitionSeries (marker present) …
    expect(container.querySelector('[data-test="transition-series"]')).not.toBeNull();
    // … and its OUTER remotion <Sequence> (the only one) carries premountFor.
    expect(capturedSequences.length).toBe(1);
    expect(capturedSequences[0].premountFor).toBe(30);
  });

  it("② single-clip WITH entrance → outer Sequence carries premountFor", () => {
    const clip = mkClip({
      id: "vc_e",
      src: "assets/e.mp4",
      out: 3,
      transitionIn: { preset: "zoom-in", durationSec: 0.4 },
    });
    const { container } = render(<Scene comp={compWith([clip])} />);
    expect(container.querySelector('[data-test="transition-series"]')).not.toBeNull();
    expect(capturedSequences.length).toBe(1);
    expect(capturedSequences[0].premountFor).toBe(30);
  });

  // ③ isRendering 分支渲染树与现状一致（回归·render-branch 形态）——
  //    premountFor 是 Sequence 层的属性，从不落到 <video>/<OffthreadVideo> 元素上；
  //    isRendering=true 仍走 OffthreadVideo，媒体 props 一字不改。remotion 自身
  //    (Sequence.js:249) 保证 premountFor 在 isRendering 路径被忽略。
  it("③ premountFor never leaks onto the media element (preview branch)", () => {
    const { container } = render(<Scene comp={compWith([mkClip({ id: "vc_p", src: "assets/p.mp4" })])} />);
    const props = JSON.parse(videoLayers(container)[0].getAttribute("data-props")!) as string[];
    expect(props).not.toContain("premountFor");
  });

  it("③ isRendering=true render tree unchanged: OffthreadVideo only, no premountFor on media, base props intact", () => {
    isRenderingRef.current = true;
    const { container } = render(
      <Scene comp={compWith([mkClip({ id: "vc_x", src: "assets/x.mp4", in: 1, out: 4 })])} />,
    );
    // branch intact: server render still picks OffthreadVideo, never <Video>.
    expect(offthreadLayers(container).length).toBe(1);
    expect(videoLayers(container).length).toBe(0);
    const props = JSON.parse(offthreadLayers(container)[0].getAttribute("data-props")!) as string[];
    // premount lives on the Sequence wrapper, not the media element — proven
    // absent on the render branch (and the preview-only props stay absent too).
    expect(props).not.toContain("premountFor");
    expect(props).not.toContain("acceptableTimeShiftInSeconds");
    expect(props).not.toContain("pauseWhenBuffering");
    // media props byte-identical to pre-premount baseline (in:1@30fps → 30, out:4 → 120).
    const values = JSON.parse(
      offthreadLayers(container)[0].getAttribute("data-values")!,
    ) as { src: string; startFrom: number; endAt: number; playbackRate: number };
    expect(values).toEqual({
      src: "/api/works/w-pm/assets/x.mp4",
      startFrom: 30,
      endAt: 120,
      playbackRate: 1,
    });
    // premount is STILL applied to the outer Sequence even under isRendering —
    // remotion ignores it there (Sequence.js:249), so the render tree above is
    // unchanged despite the prop being present.
    expect(capturedSequences.length).toBe(1);
    expect(capturedSequences[0].premountFor).toBe(30);
  });

  // ④ freeze / blur / entrance 路径 props 不被暖场破坏，且各自外层 Sequence 仍带 premountFor.
  it("④ freeze path: 1-frame hold window intact + outer Sequence still premounted", () => {
    const { container } = render(
      <Scene comp={compWith([mkClip({ id: "vc_f", src: "assets/f.mp4", freezeAtSec: 1.0 })])} />,
    );
    // freeze wrapper present, 1-frame source window (startFrom=30, endAt=31 @ fps30).
    expect(container.querySelector('[data-test="clip-freeze"]')).not.toBeNull();
    const vid = videoLayers(container)[0];
    expect(vid.getAttribute("data-start-from")).toBe("30");
    expect(vid.getAttribute("data-end-at")).toBe("31");
    expect(capturedSequences.length).toBe(1);
    expect(capturedSequences[0].premountFor).toBe(30);
  });

  it("④ blur path: two stacked video layers intact + outer Sequence still premounted", () => {
    const { container } = render(
      <Scene comp={compWith([mkClip({ id: "vc_b", src: "assets/b.mp4", fitMode: "blur" })])} />,
    );
    expect(videoLayers(container).length).toBe(2); // blurred cover backdrop + contained foreground
    expect(capturedSequences.length).toBe(1);
    expect(capturedSequences[0].premountFor).toBe(30);
  });

  it("④ entrance path: entrance-blank + transition-series intact + outer Sequence still premounted", () => {
    const { container } = render(
      <Scene
        comp={compWith([
          mkClip({ id: "vc_en", src: "assets/en.mp4", out: 3, transitionIn: { preset: "glitch", durationSec: 0.4 } }),
        ])}
      />,
    );
    expect(container.querySelector('[data-test="transition-series"]')).not.toBeNull();
    expect(container.querySelector('[data-test="entrance-blank"]')).not.toBeNull();
    expect(capturedSequences.length).toBe(1);
    expect(capturedSequences[0].premountFor).toBe(30);
  });
});
