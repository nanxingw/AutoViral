import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// S16 (US 25) — fit-fill mode RENDERER CONSUMPTION proof. `fitMode` is NOT a
// dead schema field (the LUT-slider lesson): this test renders the SAME <Scene>
// the preview + the Remotion export run, and asserts that a video clip's
// `fitMode` actually drives the DOM/props the user sees:
//   - cover   → the <Video> gets objectFit:"cover"  (legacy crop, the default)
//   - contain → the <Video> gets objectFit:"contain" (letterbox, no crop)
//   - blur    → a blurred enlarged background <Video> (objectFit cover + a
//               blur() filter) sits BEHIND a contained foreground <Video>
// If a future refactor stops threading fitMode into the renderer, these go red.

// Mock Remotion render primitives so <Scene> renders under jsdom. We turn
// <Video> into a tagged <div data-test=video> that surfaces its style + src so
// the DOM assertions can read objectFit / filter / src per layer.
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

function compWithVideo(fitMode: VideoClip["fitMode"]): Composition {
  const clip: VideoClip = {
    id: "vc_fit01",
    kind: "video",
    src: "assets/clip.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode,
  };
  const comp = makeEmptyComposition({ workId: "w-fit" });
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
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-test='video']"),
  );
}

describe("VideoTrackRenderer fitMode is CONSUMED by the render pipeline (S16)", () => {
  it("fitMode 'cover' → single <Video> with objectFit:cover (legacy crop)", () => {
    frameRef.current = 30; // inside [0, 4)
    const { container } = render(<Scene comp={compWithVideo("cover")} />);
    const layers = videoLayers(container);
    expect(layers.length).toBe(1);
    expect(layers[0].style.objectFit).toBe("cover");
    // no blur background on cover
    expect(layers[0].style.filter || "").not.toContain("blur");
  });

  it("fitMode 'contain' → single <Video> with objectFit:contain (letterbox, no crop)", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo("contain")} />);
    const layers = videoLayers(container);
    expect(layers.length).toBe(1);
    // THE proof contain is consumed: objectFit flipped from the hardcoded cover.
    expect(layers[0].style.objectFit).toBe("contain");
  });

  it("fitMode 'blur' → blurred cover BACKGROUND layer behind a contained FOREGROUND", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo("blur")} />);
    const layers = videoLayers(container);
    // Two <Video> layers: a blurred fill behind a contained foreground.
    expect(layers.length).toBe(2);
    const blurred = layers.find((l) => (l.style.filter || "").includes("blur"));
    const foreground = layers.find(
      (l) => !(l.style.filter || "").includes("blur"),
    );
    expect(blurred).toBeDefined();
    expect(foreground).toBeDefined();
    // background fills the frame by cover (so the blur has no gaps) ...
    expect(blurred!.style.objectFit).toBe("cover");
    // ... and the SAME source is reused (it's the same clip, blurred under itself)
    expect(blurred!.getAttribute("data-src") ?? "").toContain("clip.mp4");
    // foreground is contained (the un-cropped real frame)
    expect(foreground!.style.objectFit).toBe("contain");
    expect(foreground!.getAttribute("data-src") ?? "").toContain("clip.mp4");
  });

  it("a clip with NO fitMode (old work) defaults to cover (back-compat)", () => {
    // makeEmptyComposition + a clip object missing fitMode entirely; the schema
    // default fills "cover", so the renderer must crop exactly as before S16.
    const comp = compWithVideo("cover");
    // strip the field to simulate a pre-S16 on-disk clip that bypassed parse.
    const vTrack = comp.tracks.find((t) => t.id === "trk_v1")!;
    delete (vTrack.clips[0] as Partial<VideoClip>).fitMode;
    frameRef.current = 30;
    const { container } = render(<Scene comp={comp} />);
    const layers = videoLayers(container);
    expect(layers.length).toBe(1);
    expect(layers[0].style.objectFit).toBe("cover");
  });
});
