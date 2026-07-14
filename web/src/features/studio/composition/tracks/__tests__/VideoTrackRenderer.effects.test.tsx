import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// PRD-0014 S14 — blendMode + ordered effects stack + adjustment layer RENDERER
// CONSUMPTION proof. These fields are NOT dead schema data (the LUT-slider
// lesson): each drives real CSS the SAME component tree the preview AND the
// export (renderMedia) run — preview == export by construction, no ffmpeg dual.
//   - effectsToCssFilter (pure) → an ORDERED CSS filter string built from the
//     enabled grade/blur entries (disabled entries skipped).
//   - blendMode → a `mix-blend-mode` on a clip-blend wrapper.
//   - adjustment track → a `[data-test='adjustment-layer']` with a
//     `backdrop-filter`, present ONLY inside the clip's time window.

const frameRef = { current: 0 };
const envRef = { isRendering: false };
vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  // Fake <Sequence> that HONOURS the from/durationInFrames window so the
  // adjustment-layer time-window assertion is real (renders children only when
  // the current frame lies inside [from, from+durationInFrames)).
  const FakeSequence = ({
    children,
    from = 0,
    durationInFrames,
  }: {
    children?: React.ReactNode;
    from?: number;
    durationInFrames?: number;
  }) => {
    const f = frameRef.current;
    const end = durationInFrames == null ? Infinity : from + durationInFrames;
    if (f < from || f >= end) return null;
    return <>{children}</>;
  };
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
    Sequence: FakeSequence,
    Video: FakeVideo,
    OffthreadVideo: FakeVideo,
    Audio: Passthrough,
    Img: FakeVideo,
    useCurrentFrame: () => frameRef.current,
    useVideoConfig: () => ({
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 300,
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
import { effectsToCssFilter, blendModeToCss } from "../../filters/cssFilters";
import { makeEmptyComposition, newTrackId } from "../../../types";
import type { Composition, VideoClip, Track, Effect } from "../../../types";

function compWithVideo(extra: Partial<VideoClip>): Composition {
  const clip: VideoClip = {
    id: "vc_fx01",
    kind: "video",
    src: "assets/clip.mp4",
    in: 0,
    out: 8,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    fitMode: "cover",
    ...extra,
  };
  const comp = makeEmptyComposition({ workId: "w-fx" });
  comp.tracks.push({
    id: "trk_vfx",
    kind: "video",
    label: "Video",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [],
    clips: [clip],
  });
  comp.duration = 8;
  return comp;
}

describe("effectsToCssFilter (pure — S14)", () => {
  const grade = (params: Record<string, number>): Effect => ({
    id: "g",
    type: "grade",
    params,
    enabled: true,
  });

  it("empty stack → empty string", () => {
    expect(effectsToCssFilter([])).toBe("");
  });

  it("a grade → brightness/contrast/saturate", () => {
    const css = effectsToCssFilter([grade({ brightness: 0.2, contrast: 0.1, saturation: -0.3 })]);
    expect(css).toContain("brightness(1.2)");
    expect(css).toContain("contrast(1.1)");
    expect(css).toContain("saturate(0.7)");
  });

  it("a blur → blur(px) from params.radius", () => {
    expect(effectsToCssFilter([{ id: "b", type: "blur", params: { radius: 12 }, enabled: true }])).toBe(
      "blur(12px)",
    );
  });

  it("applies entries IN ORDER (grade then blur vs blur then grade)", () => {
    const g = grade({ brightness: 0.5 });
    const b: Effect = { id: "b", type: "blur", params: { radius: 4 }, enabled: true };
    expect(effectsToCssFilter([g, b]).indexOf("brightness")).toBeLessThan(
      effectsToCssFilter([g, b]).indexOf("blur"),
    );
    expect(effectsToCssFilter([b, g]).indexOf("blur")).toBeLessThan(
      effectsToCssFilter([b, g]).indexOf("brightness"),
    );
  });

  it("SKIPS a disabled entry", () => {
    const css = effectsToCssFilter([
      { ...grade({ brightness: 0.5 }), enabled: false },
      { id: "b", type: "blur", params: { radius: 4 }, enabled: true },
    ]);
    expect(css).not.toContain("brightness");
    expect(css).toContain("blur(4px)");
  });
});

describe("blendModeToCss (pure — S14)", () => {
  it("normal / undefined → undefined (no wrapper)", () => {
    expect(blendModeToCss(undefined)).toBeUndefined();
    expect(blendModeToCss("normal")).toBeUndefined();
  });
  it("add → plus-lighter; screen/multiply/overlay pass through", () => {
    expect(blendModeToCss("add")).toBe("plus-lighter");
    expect(blendModeToCss("screen")).toBe("screen");
    expect(blendModeToCss("multiply")).toBe("multiply");
    expect(blendModeToCss("overlay")).toBe("overlay");
  });
});

describe("VideoTrackRenderer blendMode + effects consumption (S14)", () => {
  it("no blendMode (old work) → NO clip-blend wrapper", () => {
    frameRef.current = 30;
    envRef.isRendering = false;
    const { container } = render(<Scene comp={compWithVideo({})} />);
    expect(container.querySelector("[data-test='clip-blend']")).toBeNull();
  });

  it("blendMode=screen → a clip-blend wrapper with mix-blend-mode:screen", () => {
    frameRef.current = 30;
    envRef.isRendering = false;
    const { container } = render(<Scene comp={compWithVideo({ blendMode: "screen" })} />);
    const wrapper = container.querySelector<HTMLElement>("[data-test='clip-blend']");
    expect(wrapper).not.toBeNull();
    const style = wrapper!.getAttribute("style") || "";
    expect(style).toContain("screen");
    expect(wrapper!.querySelector("[data-test='video']")).not.toBeNull();
  });

  it("effects grade → the video element carries the grade filter", () => {
    frameRef.current = 30;
    envRef.isRendering = false;
    const { container } = render(
      <Scene
        comp={compWithVideo({
          effects: [{ id: "g", type: "grade", params: { brightness: 0.3 }, enabled: true }],
        })}
      />,
    );
    const vid = container.querySelector<HTMLElement>("[data-test='video']");
    expect(vid).not.toBeNull();
    expect((vid!.getAttribute("style") || "")).toContain("brightness(1.3)");
  });

  it("legacy filters (no effects) still grade — projected on the fly", () => {
    frameRef.current = 30;
    envRef.isRendering = false;
    const { container } = render(
      <Scene comp={compWithVideo({ filters: { brightness: 0.4, contrast: 0, saturation: 0 } })} />,
    );
    const vid = container.querySelector<HTMLElement>("[data-test='video']");
    expect((vid!.getAttribute("style") || "")).toContain("brightness(1.4)");
  });
});

// Adjustment track — an effect window over the z-lower tracks.
function compWithAdjustment(over: { at: number; duration: number; effects: Effect[] }): Composition {
  const comp = compWithVideo({});
  const adjTrackId = newTrackId();
  const adjTrack: Track = {
    id: adjTrackId,
    kind: "adjustment",
    label: "ADJ",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [],
    clips: [
      {
        id: "adj_clip01",
        kind: "adjustment",
        trackOffset: over.at,
        duration: over.duration,
        effects: over.effects,
      } as never,
    ],
  };
  comp.tracks.push(adjTrack); // appended AFTER the video track → higher z → affects it
  return comp;
}

describe("AdjustmentTrackRenderer consumption (S14)", () => {
  const grade: Effect = { id: "ag", type: "grade", params: { saturation: -1 }, enabled: true };

  it("renders a backdrop-filter layer INSIDE the clip's time window", () => {
    // window [1s, 3s) → frames [30, 90); frame 60 is inside.
    frameRef.current = 60;
    envRef.isRendering = false;
    const { container } = render(
      <Scene comp={compWithAdjustment({ at: 1, duration: 2, effects: [grade] })} />,
    );
    const layer = container.querySelector<HTMLElement>("[data-test='adjustment-layer']");
    expect(layer).not.toBeNull();
    const style = layer!.getAttribute("style") || "";
    expect(style.toLowerCase()).toContain("backdrop-filter");
    expect(style).toContain("saturate(0)");
  });

  it("does NOT render the layer OUTSIDE the clip's time window", () => {
    // frame 120 (4s) is past the [30,90) window.
    frameRef.current = 120;
    envRef.isRendering = false;
    const { container } = render(
      <Scene comp={compWithAdjustment({ at: 1, duration: 2, effects: [grade] })} />,
    );
    expect(container.querySelector("[data-test='adjustment-layer']")).toBeNull();
  });

  it("renders under renderMedia (isRendering=true) WITHOUT throwing (S16 prep)", () => {
    frameRef.current = 60;
    envRef.isRendering = true;
    expect(() =>
      render(<Scene comp={compWithAdjustment({ at: 1, duration: 2, effects: [grade] })} />),
    ).not.toThrow();
  });
});
