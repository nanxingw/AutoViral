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

  it("crop {x:0.1,y:0.2,w:0.5,h:0.6} → clip-path inset() crops the frame", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } })} />,
    );
    const v = videoLayer(container);
    // inset(top right bottom left) as percentages:
    //   top    = y          = 20%
    //   right  = 1-(x+w)    = 1-0.6 = 40%
    //   bottom = 1-(y+h)    = 1-0.8 = 20%
    //   left   = x          = 10%
    expect(v.style.clipPath).toContain("inset(");
    expect(v.style.clipPath).toContain("20%"); // top & bottom
    expect(v.style.clipPath).toContain("40%"); // right
    expect(v.style.clipPath).toContain("10%"); // left
  });
});
