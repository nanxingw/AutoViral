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
      fps: 30,
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
        presentation?: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          component: React.ComponentType<any>;
          props: Record<string, unknown>;
        };
      }) => {
        const pres = props.presentation;
        if (!pres) return null;
        const Comp = pres.component;
        return (
          <div data-test="transition-slot">
            <Comp
              presentationProgress={0.5}
              presentationDirection="entering"
              passedProps={pres.props}
              presentationDurationInFrames={12}
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
