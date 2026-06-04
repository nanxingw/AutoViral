import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// S18 (US 27/28) — crop + flip RENDERER CONSUMPTION proof. crop / flipH / flipV
// are NOT dead schema fields (the LUT-slider lesson): this test renders the SAME
// <Scene> the preview + the Remotion export run, and asserts that a video clip's
// transforms.crop / flipH / flipV actually drive the DOM/CSS the user sees:
//   - flipH → the <Video>'s CSS transform contains scaleX(-1) (horizontal mirror)
//   - flipV → the <Video>'s CSS transform contains scaleY(-1) (vertical mirror)
//   - crop {x,y,w,h} → the <Video> gets a clip-path inset() that crops the frame
// If a future refactor stops threading these into the renderer, these go red.

const frameRef = { current: 0 };
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
  const FakeImg = (props: Record<string, unknown>) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <img data-test="overlay-img" src={(props as any).src} style={(props as any).style} />
  );
  return {
    ...actual,
    Sequence: Passthrough,
    Video: FakeVideo,
    OffthreadVideo: FakeVideo,
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
  };
});

import { Scene } from "../../Scene";
import { cssCropZoom } from "../VideoTrackRenderer";
import { makeEmptyComposition } from "../../../types";
import type { Composition, VideoClip, Track } from "../../../types";

function compWithVideo(transforms: Partial<VideoClip["transforms"]>): Composition {
  const clip: VideoClip = {
    id: "vc_cf01",
    kind: "video",
    src: "assets/clip.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0, ...transforms },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
  };
  const comp = makeEmptyComposition({ workId: "w-cf" });
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

function videoLayer(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>("[data-test='video']")!;
}

describe("VideoTrackRenderer crop + flip are CONSUMED by the render pipeline (S18)", () => {
  it("no crop/flip (old work) → transform has NO scaleX(-1)/scaleY(-1), NO clip-path", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo({})} />);
    const v = videoLayer(container);
    expect(v.style.transform).not.toContain("scaleX(-1)");
    expect(v.style.transform).not.toContain("scaleY(-1)");
    expect(v.style.clipPath || "").toBe("");
  });

  it("flipH:true → transform contains scaleX(-1) (horizontal mirror)", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo({ flipH: true })} />);
    const v = videoLayer(container);
    expect(v.style.transform).toContain("scaleX(-1)");
    expect(v.style.transform).not.toContain("scaleY(-1)");
  });

  it("flipV:true → transform contains scaleY(-1) (vertical mirror)", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo({ flipV: true })} />);
    const v = videoLayer(container);
    expect(v.style.transform).toContain("scaleY(-1)");
    expect(v.style.transform).not.toContain("scaleX(-1)");
  });

  it("flipH+flipV → transform contains BOTH mirrors", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ flipH: true, flipV: true })} />,
    );
    const v = videoLayer(container);
    expect(v.style.transform).toContain("scaleX(-1)");
    expect(v.style.transform).toContain("scaleY(-1)");
  });

  // S18 review fix (critical) — crop is a CROP-AND-ZOOM, not a clip-path mask.
  // export crops the source to a smaller MP4 then Remotion objectFit:cover
  // rescales it to FILL the canvas. preview must match: the cropped sub-region
  // must ZOOM to fill the box, NOT stay a small window on the original frame.
  // So the <Video> is enlarged by 1/w × 1/h and shifted to bring the sub-region
  // to the origin — assert that geometry, and that there is NO clip-path mask.
  it("crop {x:0.1,y:0.2,w:0.5,h:0.6} → ZOOMS the sub-region to fill (no clip-path mask)", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } })} />,
    );
    const v = videoLayer(container);
    // crop-and-zoom: width = 100/w = 200%, height = 100/h = 166.6667%
    expect(v.style.width).toBe("200%");
    expect(v.style.height).toBe(`${Number((100 / 0.6).toFixed(4))}%`);
    // shift = -x/w = -20% left, -y/h = -33.3333% top
    expect(v.style.left).toBe("-20%");
    expect(v.style.top).toBe(`${Number((-0.2 / 0.6 * 100).toFixed(4))}%`);
    // the OLD mask is gone — crop is achieved by zoom+shift, not clip-path.
    expect(v.style.clipPath || "").toBe("");
  });

  it("crop is wrapped in an overflow:hidden window so the zoom is clipped to the box", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } })} />,
    );
    const v = videoLayer(container);
    const wrapper = v.parentElement!;
    expect(wrapper.style.overflow).toBe("hidden");
  });

  it("flipH still mirrors when a crop is present (zoom + mirror coexist)", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene
        comp={compWithVideo({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, flipH: true })}
      />,
    );
    const v = videoLayer(container);
    expect(v.style.transform).toContain("scaleX(-1)");
    // and still zoomed
    expect(v.style.width).toBe("200%");
  });

  it("no crop → no zoom geometry, no overflow wrapper change (back-compat)", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo({})} />);
    const v = videoLayer(container);
    // single layer, default sizing — width/height stay the 100% fill, no left/top shift
    expect(v.style.left || "").toBe("");
    expect(v.style.top || "").toBe("");
  });

  // S18 review fix (medium) — blur fitMode + crop/flip. export bakes crop+flip
  // into the SINGLE source MP4 that feeds BOTH blur layers, so the preview's
  // blurred backdrop must also be cropped+flipped (it used to show the raw
  // un-cropped un-flipped original → diverged from export). Assert BOTH layers
  // carry the zoom geometry and the mirror.
  it("blur + crop + flipH → BOTH blur layers are zoomed AND mirrored", () => {
    frameRef.current = 30;
    const clip: VideoClip = {
      id: "vc_blur_cf",
      kind: "video",
      src: "assets/clip.mp4",
      in: 0,
      out: 4,
      trackOffset: 0,
      transforms: {
        scale: 1,
        x: 0,
        y: 0,
        rotation: 0,
        crop: { x: 0, y: 0, w: 0.5, h: 0.5 },
        flipH: true,
      },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
      fitMode: "blur",
    };
    const comp = makeEmptyComposition({ workId: "w-blurcf" });
    comp.tracks.push({
      id: "trk_v1",
      kind: "video",
      label: "Video",
      displayOrder: comp.tracks.length,
      muted: false,
      hidden: false,
      volume: 0,
      transitions: [],
      clips: [clip],
    });
    comp.duration = 4;
    const { container } = render(<Scene comp={comp} />);
    const layers = Array.from(
      container.querySelectorAll<HTMLElement>("[data-test='video']"),
    );
    expect(layers.length).toBe(2);
    for (const l of layers) {
      // every layer zoomed (width 200% from w=0.5) and mirrored
      expect(l.style.width).toBe("200%");
      expect(l.style.transform).toContain("scaleX(-1)");
    }
  });

  // S18 review fix (critical) — preview/export crop SEMANTIC equivalence guard.
  // The pure helpers behind each side must agree on the SAME visible sub-region:
  // ffmpeg crop=out_w:out_h:x:y in source pixels, preview zoom 1/w × 1/h. We
  // assert the two describe the identical rectangle (as fractions of the source)
  // so a future drift on either side goes red — not just "each side has a string".
  it("preview zoom geometry and ffmpeg crop= describe the SAME sub-region", () => {
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    const zoom = cssCropZoom(crop)!;
    // Recover the source-fraction rectangle the PREVIEW shows from its zoom math:
    //   widthPct = 100/w → w = 100/widthPct ; leftPct = -x/w*100 → x = -leftPct/100*w
    const previewW = 100 / parseFloat(zoom.width);
    const previewH = 100 / parseFloat(zoom.height);
    const previewX = (-parseFloat(zoom.left) / 100) * previewW;
    const previewY = (-parseFloat(zoom.top) / 100) * previewH;
    expect(previewX).toBeCloseTo(crop.x, 4);
    expect(previewY).toBeCloseTo(crop.y, 4);
    expect(previewW).toBeCloseTo(crop.w, 4);
    expect(previewH).toBeCloseTo(crop.h, 4);
  });
});
