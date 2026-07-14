import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// PRD-0014 S5 — source-audio RENDERER CONSUMPTION proof. `sourceAudio` is NOT a
// dead schema field: this renders the SAME <Scene> the preview runs and asserts
// the field drives the <Video>/<OffthreadVideo> `muted` / `volume` props the user
// hears — consumed identically in preview (browser <Video>) AND export (headless
// <OffthreadVideo>), so muting the source on export is WYSIWYG by construction.
//   - absent (pre-S5 work) → NOT muted, volume 1 (legacy "video plays its sound").
//   - sourceAudio.enabled:false → muted (detachAudio pulled the track out; the
//     source must not double-play).
//   - sourceAudio.volume → forwarded to the <Video> volume.

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
      data-muted={String((props as any).muted)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-volume={String((props as any).volume)}
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
    getRemotionEnvironment: () => ({
      isStudio: false,
      isRendering: false,
      isPlayer: true,
      isReadOnlyStudio: false,
      isClientSideRendering: false,
    }),
  };
});

import { Scene } from "../../Scene";
import { makeEmptyComposition } from "../../../types";
import type { Composition, VideoClip, Track } from "../../../types";

function compWithVideo(extra: Partial<VideoClip>): Composition {
  const clip: VideoClip = {
    id: "vc_sa01",
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
  const comp = makeEmptyComposition({ workId: "w-sa" });
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

describe("VideoTrackRenderer consumes sourceAudio (S5)", () => {
  it("no sourceAudio (old work) → <Video> is NOT muted, volume 1", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo({})} />);
    const v = videoLayer(container);
    expect(v.getAttribute("data-muted")).toBe("false");
    expect(v.getAttribute("data-volume")).toBe("1");
  });

  it("sourceAudio.enabled:false → <Video> is muted (source will not double-play)", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ sourceAudio: { enabled: false } })} />,
    );
    expect(videoLayer(container).getAttribute("data-muted")).toBe("true");
  });

  it("sourceAudio {enabled:true, volume:0.5} → volume forwarded, not muted", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ sourceAudio: { enabled: true, volume: 0.5 } })} />,
    );
    const v = videoLayer(container);
    expect(v.getAttribute("data-muted")).toBe("false");
    expect(v.getAttribute("data-volume")).toBe("0.5");
  });
});
