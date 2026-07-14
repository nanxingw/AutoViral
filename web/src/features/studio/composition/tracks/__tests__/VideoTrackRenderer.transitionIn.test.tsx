import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// PRD-0014 S3 — RENDER-TREE contract for `VideoClip.transitionIn` (entrance
// transition), through the REAL Scene/VideoTrackRenderer wiring. A single video
// clip with `transitionIn: {preset:"glitch", ...}` must render a glitch
// presentation node at its HEAD, inside a <TransitionSeries>, threaded from the
// clip (not hardcoded). The SAME component drives preview + export, so the
// entrance is WYSIWYG by construction (no ffmpeg dual) — asserted by rendering
// under isRendering=false AND isRendering=true and matching the node.

const isRenderingRef = { current: false };
// finding #4 — fps is mutable so the frame-conversion assertion can sweep
// several (durationSec, fps) pairs; the renderer reads it via useVideoConfig.
const fpsRef = { current: 30 };
// finding #4 — capture the REAL `timing` object every Transition receives so the
// test derives the frame span from production input (round(durationSec × fps))
// instead of trusting a number the mock invented.
type CapturedTiming = { getDurationInFrames: (o: { fps: number }) => number };
const capturedTimings: CapturedTiming[] = [];

vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const FakeVideo = (props: Record<string, unknown>) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div data-test="video" data-src={(props as any).src} />
  );
  const FakeOffthreadVideo = (props: Record<string, unknown>) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div data-test="offthread-video" data-src={(props as any).src} />
  );
  return {
    ...actual,
    Sequence: Passthrough,
    Video: FakeVideo,
    OffthreadVideo: FakeOffthreadVideo,
    Audio: Passthrough,
    Img: (props: Record<string, unknown>) => (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <img data-test="overlay-img" src={(props as any).src} />
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

// Render the passed presentation.component so the entrance marker actually lands
// in the DOM (mirrors VideoTrackRenderer.transitionPresentation.test.tsx).
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
      Transition: (props: {
        timing?: CapturedTiming;
        presentation?: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          component: React.ComponentType<any>;
          props: Record<string, unknown>;
        };
      }) => {
        // finding #4 — record the timing the renderer supplied and DERIVE the
        // frame span from it (round(durationSec*fps)) rather than hardcoding 12,
        // so a broken seconds→frames conversion would change this number.
        if (props.timing) capturedTimings.push(props.timing);
        const pres = props.presentation;
        if (!pres) return null;
        const Comp = pres.component;
        const frames = props.timing?.getDurationInFrames({ fps: fpsRef.current }) ?? 0;
        return (
          <div data-test="transition-slot">
            <Comp
              presentationProgress={0.5}
              presentationDirection="entering"
              passedProps={pres.props}
              presentationDurationInFrames={frames}
              bothEnteringAndExiting={false}
            >
              <div data-test="transition-scene-content" />
            </Comp>
          </div>
        );
      },
    },
  );
  return { ...actual, TransitionSeries: TransitionSeriesMock };
});

import { Scene } from "../../Scene";
import { makeEmptyComposition } from "../../../types";
import type { Composition, VideoClip, Track } from "../../../types";
import type { TransitionPreset } from "@shared/transitions";

function compWithEntrance(
  preset: TransitionPreset,
  durationSec = 0.4,
): Composition {
  const clip: VideoClip = {
    id: "vc_A",
    kind: "video",
    src: "assets/a.mp4",
    in: 0,
    out: 3,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
    transitionIn: { preset, durationSec },
  };
  const comp = makeEmptyComposition({ workId: "w-s3" });
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
  comp.duration = 3;
  return comp;
}

describe("VideoTrackRenderer → transitionIn entrance render tree (PRD-0014 S3)", () => {
  it("a single clip with a glitch entrance renders a glitch presentation node at its head", () => {
    isRenderingRef.current = false;
    const { container } = render(<Scene comp={compWithEntrance("glitch")} />);

    const series = container.querySelector('[data-test="transition-series"]');
    expect(series).not.toBeNull();

    const marker = container.querySelector('[data-transition-preset="glitch"]');
    expect(marker).not.toBeNull();
    expect(series!.contains(marker)).toBe(true);
    // The blank "before" scene of the entrance is present.
    expect(container.querySelector('[data-test="entrance-blank"]')).not.toBeNull();
    // The clip itself is still rendered.
    const srcs = Array.from(
      container.querySelectorAll<HTMLElement>("[data-test='video']"),
    ).map((el) => el.getAttribute("data-src"));
    expect(srcs).toContain("/api/works/w-s3/assets/a.mp4");
  });

  it("the entrance preset is THREADED from the clip, not hardcoded (zoom-in → zoom-in marker)", () => {
    isRenderingRef.current = false;
    const { container } = render(<Scene comp={compWithEntrance("zoom-in")} />);
    expect(container.querySelector('[data-transition-preset="zoom-in"]')).not.toBeNull();
    expect(container.querySelector('[data-transition-preset="glitch"]')).toBeNull();
  });

  it("a clip WITHOUT transitionIn renders no entrance (plain sequence, back-compat)", () => {
    isRenderingRef.current = false;
    const comp = makeEmptyComposition({ workId: "w-s3b" });
    const clip: VideoClip = {
      id: "vc_B",
      kind: "video",
      src: "assets/b.mp4",
      in: 0,
      out: 3,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
      fitMode: "cover",
    };
    (comp.tracks.find((t) => t.kind === "video")!.clips as VideoClip[]).push(clip);
    comp.duration = 3;
    const { container } = render(<Scene comp={comp} />);
    expect(container.querySelector('[data-test="entrance-blank"]')).toBeNull();
    expect(container.querySelector('[data-test="transition-series"]')).toBeNull();
  });

  it("derives the entrance frame span from durationSec × fps — multiple durations/FPS (finding #4)", () => {
    // Each pair yields a DISTINCT frame count, so a wrong seconds→frames
    // conversion (off-by-one, or seconds mistaken for frames) would break this.
    const cases: Array<[number, number, number]> = [
      [0.4, 30, 12],
      [0.5, 30, 15],
      [0.4, 25, 10],
      [1.0, 24, 24],
    ];
    for (const [durationSec, fps, expected] of cases) {
      isRenderingRef.current = false;
      fpsRef.current = fps;
      capturedTimings.length = 0;
      render(<Scene comp={compWithEntrance("glitch", durationSec)} />);
      // exactly one entrance transition on a single-clip chain
      expect(capturedTimings.length).toBe(1);
      expect(capturedTimings[0].getDurationInFrames({ fps })).toBe(expected);
    }
    fpsRef.current = 30;
  });

  it("a NON-first clip in a cut-point chain still renders its OWN entrance (finding #1 regression)", () => {
    isRenderingRef.current = false;
    fpsRef.current = 30;
    capturedTimings.length = 0;
    const comp = makeEmptyComposition({ workId: "w-s3-chain" });
    const mk = (id: string, offset: number, transitionIn?: VideoClip["transitionIn"]): VideoClip => ({
      id,
      kind: "video",
      src: `assets/${id}.mp4`,
      in: 0,
      out: 3,
      trackOffset: offset,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
      fitMode: "cover",
      ...(transitionIn ? { transitionIn } : {}),
    });
    const clipA = mk("vc_A", 0);
    // clip B is the SECOND (non-first) clip AND carries its own entrance.
    const clipB = mk("vc_B", 3, { preset: "zoom-in", durationSec: 0.4 });
    const videoTrack: Track = {
      id: "trk_v1",
      kind: "video",
      label: "Video",
      displayOrder: comp.tracks.length,
      muted: false,
      hidden: false,
      volume: 0,
      // a cut-point transition A→B (glitch) — B's entrance must coexist with it.
      transitions: [
        {
          id: "tr_AB",
          afterClipId: "vc_A",
          preset: "glitch",
          durationSec: 0.3,
          alignment: "center",
          easing: "linear",
        },
      ],
      clips: [clipA, clipB],
    };
    comp.tracks.push(videoTrack);
    comp.duration = 6;
    const { container } = render(<Scene comp={comp} />);
    // the cut-point transition (glitch) between A and B is present …
    expect(container.querySelector('[data-transition-preset="glitch"]')).not.toBeNull();
    // … AND clip B's OWN entrance (zoom-in) is ALSO rendered — orthogonal
    // coexistence (finding #1: this used to be silently dropped for non-first
    // clips). B's entrance has its blank "before" scene too.
    expect(container.querySelector('[data-transition-preset="zoom-in"]')).not.toBeNull();
    expect(container.querySelector('[data-test="entrance-blank"]')).not.toBeNull();
  });

  it("preview and export render the SAME entrance node (preview==export)", () => {
    isRenderingRef.current = false;
    const preview = render(<Scene comp={compWithEntrance("glitch")} />);
    const previewMarker = preview.container.querySelector(
      '[data-transition-preset="glitch"]',
    ) as HTMLElement | null;

    isRenderingRef.current = true;
    const exp = render(<Scene comp={compWithEntrance("glitch")} />);
    const exportMarker = exp.container.querySelector(
      '[data-transition-preset="glitch"]',
    ) as HTMLElement | null;

    expect(previewMarker).not.toBeNull();
    expect(exportMarker).not.toBeNull();
    expect(exportMarker!.tagName).toBe(previewMarker!.tagName);
    expect(exportMarker!.getAttribute("style")).toBe(
      previewMarker!.getAttribute("style"),
    );
  });
});
