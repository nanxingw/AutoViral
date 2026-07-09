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
  const FakeVideo = (props: Record<string, unknown>) => (
    <div
      data-test="video"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-src={(props as any).src}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-props={JSON.stringify(Object.keys(props).sort())}
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

import { Scene } from "../../Scene";
import { makeEmptyComposition } from "../../../types";
import type { Composition, VideoClip, Track } from "../../../types";

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
    frameRef.current = 30;
    isRenderingRef.current = false;
    const { container: previewContainer } = render(<Scene comp={compWithVideo()} />);
    const previewProps = JSON.parse(
      videoLayers(previewContainer)[0].getAttribute("data-props")!,
    ) as string[];

    isRenderingRef.current = true;
    const { container: renderContainer } = render(<Scene comp={compWithVideo()} />);
    const renderProps = JSON.parse(
      offthreadLayers(renderContainer)[0].getAttribute("data-props")!,
    ) as string[];

    for (const shared of ["src", "startFrom", "endAt", "playbackRate", "style"]) {
      expect(previewProps).toContain(shared);
      expect(renderProps).toContain(shared);
    }
    expect(
      previewProps
        .filter((p) => p !== "acceptableTimeShiftInSeconds" && p !== "pauseWhenBuffering")
        .sort(),
    ).toEqual(renderProps.sort());
  });
});
