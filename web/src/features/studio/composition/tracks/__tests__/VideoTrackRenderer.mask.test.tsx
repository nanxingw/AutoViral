import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// PRD-0014 S13 — mask RENDERER CONSUMPTION proof. `VideoClip.mask` (rect /
// ellipse + feather + inverted) is NOT dead schema data (the LUT-slider lesson):
// this asserts the field drives a real CSS `mask-image` (SVG shape + blur
// feather) the SAME component tree the preview AND the export (renderMedia) run,
// so preview == export by construction (single renderer, no ffmpeg dual).
//   - buildClipMask (pure) → the exact SVG string: rect path / ellipse arcs,
//     feGaussianBlur when feather>0, fill-rule="evenodd" (a punched hole) when
//     inverted. Unit-tested directly (mirrors cssCropZoom/cssFlipSuffix).
//   - render tree → a `[data-test='clip-mask']` wrapper wraps the clip body only
//     when a mask is present; absent otherwise (back-compat for pre-S13 works).
//   - renderMedia single frame (isRendering=true) must NOT throw (S16 prep).

const frameRef = { current: 0 };
const envRef = { isRendering: false };
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
      style={(props as any).style}
    />
  );
  return {
    ...actual,
    Sequence: Passthrough,
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
    getRemotionEnvironment: () => ({
      isStudio: false,
      isRendering: envRef.isRendering,
      isPlayer: !envRef.isRendering,
      isReadOnlyStudio: false,
      isClientSideRendering: false,
    }),
  };
});

import { Scene } from "../../Scene";
import { buildClipMask } from "../VideoTrackRenderer";
import { makeEmptyComposition } from "../../../types";
import type { Composition, VideoClip, Track } from "../../../types";

const DIMS = { width: 1080, height: 1920 };

function compWithVideo(extra: Partial<VideoClip>): Composition {
  const clip: VideoClip = {
    id: "vc_mask01",
    kind: "video",
    src: "assets/clip.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
    ...extra,
  };
  const comp = makeEmptyComposition({ workId: "w-mask" });
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

describe("buildClipMask (pure — S13)", () => {
  it("returns undefined for no mask (back-compat)", () => {
    expect(buildClipMask(undefined, DIMS)).toBeUndefined();
  });

  it("a rect mask → a rectangle path, no blur, no evenodd hole", () => {
    const out = buildClipMask({ type: "rect" }, DIMS)!;
    expect(out).toBeDefined();
    // default rect is the full frame → a rectangle path starting at the origin.
    expect(out.svg).toContain("M0 0");
    expect(out.svg).not.toContain("feGaussianBlur");
    expect(out.svg).not.toContain("evenodd");
    expect(out.maskImage).toContain("data:image/svg+xml");
  });

  it("an ellipse mask with feather>0 → arc commands + a gaussian blur", () => {
    const out = buildClipMask({ type: "ellipse", feather: 0.3 }, DIMS)!;
    // an SVG ellipse path is expressed with arc ("A") commands.
    expect(out.svg).toMatch(/A[\d.]/);
    expect(out.svg).toContain("feGaussianBlur");
  });

  it("no feather → no blur filter", () => {
    const out = buildClipMask({ type: "ellipse" }, DIMS)!;
    expect(out.svg).not.toContain("feGaussianBlur");
  });

  it("inverted → fill-rule=evenodd punching the shape out of a full-frame rect", () => {
    const out = buildClipMask(
      { type: "rect", inverted: true, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
      DIMS,
    )!;
    expect(out.svg).toContain('fill-rule="evenodd"');
    // the outer subpath is the whole frame (origin) and the inner subpath is the
    // 0.25..0.75 shape → both present so the shape becomes a transparent hole.
    expect(out.svg).toContain("M0 0");
    expect(out.svg).toContain("270"); // 0.25 * 1080
  });
});

describe("VideoTrackRenderer mask consumption (S13)", () => {
  it("no mask (old work) → NO clip-mask wrapper", () => {
    frameRef.current = 30;
    envRef.isRendering = false;
    const { container } = render(<Scene comp={compWithVideo({})} />);
    expect(container.querySelector("[data-test='clip-mask']")).toBeNull();
  });

  it("an ellipse mask → a clip-mask wrapper wraps the clip body", () => {
    frameRef.current = 30;
    envRef.isRendering = false;
    const { container } = render(
      <Scene comp={compWithVideo({ mask: { type: "ellipse", feather: 0.2 } })} />,
    );
    const wrapper = container.querySelector<HTMLElement>("[data-test='clip-mask']");
    expect(wrapper).not.toBeNull();
    // the masked video body still renders inside the wrapper.
    expect(wrapper!.querySelector("[data-test='video']")).not.toBeNull();
    // Review-fix (finding #2) — assert the OBSERVABLE rendered mask, not just the
    // wrapper's presence: the inline `mask-image` must carry the SVG data-URI, and
    // feather>0 must produce a real gaussian blur in the DOM mask (both survive
    // encodeURIComponent verbatim). This proves the field drives a real rendered
    // mask geometry, matching the buildClipMask unit assertions above.
    const maskImage =
      wrapper!.style.maskImage ||
      wrapper!.style.getPropertyValue("mask-image") ||
      wrapper!.style.getPropertyValue("-webkit-mask-image") ||
      wrapper!.getAttribute("style") ||
      "";
    expect(maskImage).toContain("data:image/svg+xml");
    expect(maskImage).toContain("feGaussianBlur");
  });

  it("an inverted mask → the rendered wrapper's mask-image carries the evenodd cutout (finding #2)", () => {
    frameRef.current = 30;
    envRef.isRendering = false;
    const { container } = render(
      <Scene
        comp={compWithVideo({
          mask: { type: "ellipse", inverted: true, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
        })}
      />,
    );
    const wrapper = container.querySelector<HTMLElement>("[data-test='clip-mask']");
    expect(wrapper).not.toBeNull();
    const maskImage =
      wrapper!.style.maskImage ||
      wrapper!.style.getPropertyValue("mask-image") ||
      wrapper!.style.getPropertyValue("-webkit-mask-image") ||
      wrapper!.getAttribute("style") ||
      "";
    // inverted → fill-rule="evenodd" (a punched hole) reaches the rendered DOM mask.
    expect(maskImage).toContain("evenodd");
  });

  it("renders under renderMedia (isRendering=true) WITHOUT throwing (S16 prep)", () => {
    frameRef.current = 30;
    envRef.isRendering = true;
    expect(() =>
      render(
        <Scene
          comp={compWithVideo({ mask: { type: "ellipse", feather: 0.4, inverted: true } })}
        />,
      ),
    ).not.toThrow();
  });
});
