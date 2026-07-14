import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// PRD-0014 S2 review fix (findings 3 + 5) — RENDER-TREE contract for the stylize/
// motion presets, through the REAL wiring.
//
// The delivered presentations.test.tsx unit-tests `presentationFor(preset)` in
// isolation and renders its component directly. That proves the factory maps
// glitch → a dedicated presentation, but it does NOT prove VideoTrackRenderer
// actually threads the clip's transition preset into
// `<TransitionSeries.Transition presentation={presentationFor(t.preset, dims)}/>`.
// If the renderer hardcoded a preset (or dropped the transition entirely), the
// unit test still passes. PRD-0014 S2 line 39 asks specifically for a two-clip
// composition + glitch rendered through the real Scene/VideoTrackRenderer tree
// with the presentation node observable.
//
// This suite renders a two-clip glitch composition through <Scene/> and mocks
// @remotion/transitions so its <Transition> ACTUALLY renders the passed
// `presentation.component` (the real one VideoTrackRenderer built). The glitch
// wrapper stamps `data-transition-preset="glitch"`, so the marker landing in the
// tree proves the whole chain: VideoTrackRenderer → presentationFor("glitch") →
// S2 presentation → DOM.
//
// finding 5 (WYSIWYG evidence): the SAME component drives preview and export
// (there is no ffmpeg dual for S2 presets), so we render the identical glitch
// comp under isRendering=false (preview) AND isRendering=true (export) and assert
// the glitch presentation node is present + structurally identical in both — the
// by-construction preview==export guarantee, machine-checked.

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
    useCurrentFrame: () => 15,
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

// Unlike VideoTrackRenderer.render-branch.test.tsx (which stubs Transition to
// null because it only cares about the Video/OffthreadVideo branch), THIS suite
// must observe the presentation. So the Transition mock renders the passed
// `presentation.component` with representative presentation props — exercising
// exactly the value VideoTrackRenderer constructed via presentationFor(t.preset).
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
import type { Composition, VideoClip, Track, Transition } from "../../../types";
import type { TransitionPreset } from "@shared/transitions";

function compWithTransition(preset: TransitionPreset): Composition {
  const clipA: VideoClip = {
    id: "vc_A",
    kind: "video",
    src: "assets/a.mp4",
    in: 0,
    out: 3,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
  };
  const clipB: VideoClip = {
    id: "vc_B",
    kind: "video",
    src: "assets/b.mp4",
    in: 0,
    out: 3,
    trackOffset: 3,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
  };
  const transition: Transition = {
    id: "tr_01",
    afterClipId: "vc_A",
    preset,
    durationSec: 0.4,
    alignment: "center",
    easing: "linear",
  };
  const comp = makeEmptyComposition({ workId: "w-s2" });
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

describe("VideoTrackRenderer → S2 presentation render tree (PRD-0014 S2)", () => {
  it("a glitch transition renders a glitch presentation node inside the TransitionSeries", () => {
    isRenderingRef.current = false;
    const { container } = render(<Scene comp={compWithTransition("glitch")} />);

    const series = container.querySelector('[data-test="transition-series"]');
    expect(series).not.toBeNull();

    // The whole chain ran: VideoTrackRenderer built presentationFor("glitch"),
    // the Transition rendered it, the S2 wrapper stamped its marker.
    const marker = container.querySelector('[data-transition-preset="glitch"]');
    expect(marker).not.toBeNull();
    // …and it lives INSIDE the transition chain, not as a stray sibling.
    expect(series!.contains(marker)).toBe(true);
    // Both source clips are still represented (chain didn't collapse to one).
    const srcs = Array.from(
      container.querySelectorAll<HTMLElement>("[data-test='video']"),
    ).map((el) => el.getAttribute("data-src"));
    expect(srcs).toContain("/api/works/w-s2/assets/a.mp4");
    expect(srcs).toContain("/api/works/w-s2/assets/b.mp4");
  });

  it("the preset is THREADED from the transition, not hardcoded (light-leak → light-leak marker)", () => {
    isRenderingRef.current = false;
    const { container } = render(<Scene comp={compWithTransition("light-leak")} />);
    // If VideoTrackRenderer hardcoded a preset, this would still say glitch.
    expect(container.querySelector('[data-transition-preset="light-leak"]')).not.toBeNull();
    expect(container.querySelector('[data-transition-preset="glitch"]')).toBeNull();
  });

  // finding 5 — WYSIWYG by construction, machine-checked: the identical glitch
  // comp yields the same presentation node under preview (isRendering=false) and
  // export (isRendering=true), because both paths render THIS component. No
  // ffmpeg dual can diverge them.
  it("preview and export render the SAME glitch presentation node (preview==export)", () => {
    isRenderingRef.current = false;
    const preview = render(<Scene comp={compWithTransition("glitch")} />);
    const previewMarker = preview.container.querySelector(
      '[data-transition-preset="glitch"]',
    ) as HTMLElement | null;

    isRenderingRef.current = true;
    const exp = render(<Scene comp={compWithTransition("glitch")} />);
    const exportMarker = exp.container.querySelector(
      '[data-transition-preset="glitch"]',
    ) as HTMLElement | null;

    expect(previewMarker).not.toBeNull();
    expect(exportMarker).not.toBeNull();
    // Same wrapper tag + same computed inline style string → visually identical
    // by construction (the S2 component is environment-agnostic).
    expect(exportMarker!.tagName).toBe(previewMarker!.tagName);
    expect(exportMarker!.getAttribute("style")).toBe(
      previewMarker!.getAttribute("style"),
    );
    // The scene content is composited through the transition in both paths.
    expect(
      preview.container.querySelector('[data-test="transition-scene-content"]'),
    ).not.toBeNull();
    expect(
      exp.container.querySelector('[data-test="transition-scene-content"]'),
    ).not.toBeNull();
  });
});
