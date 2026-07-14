import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// PRD-0014 S14 (review fix #1) — OverlayClip.blendMode CONSUMPTION proof. The
// field is schema/UI/CLI-writable but the OverlayTrackRenderer never read it, so
// a "screen" overlay (漏光) silently rendered as `normal`. This asserts the
// blendMode reaches the <Img> as a CSS `mix-blend-mode` (the SAME tree preview +
// export run) — and that an absent/normal blend adds NO mix-blend-mode.

const frameRef = { current: 0 };
vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const FakeImg = (props: Record<string, unknown>) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <img data-test="overlay-img" src={(props as any).src} style={(props as any).style} />
  );
  const FakeVideo = (props: Record<string, unknown>) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div data-test="offthread-video" style={(props as any).style} />
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
import type { Composition, OverlayClip, Track } from "../../../types";

function compWithOverlay(over: Partial<OverlayClip>): Composition {
  const comp = makeEmptyComposition({ workId: "w-ovblend" });
  const clip: OverlayClip = {
    id: "oc_b1",
    kind: "overlay",
    src: "assets/leak.png",
    trackOffset: 0,
    duration: 5,
    position: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
    opacity: 1,
    ...over,
  };
  const track: Track = {
    id: "trk_ovb",
    kind: "overlay",
    label: "Overlay",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [],
    clips: [clip],
  };
  comp.tracks.push(track);
  comp.duration = 5;
  return comp;
}

describe("OverlayTrackRenderer blendMode consumption (review fix #1)", () => {
  it("blendMode=screen → the overlay <Img> carries mix-blend-mode: screen", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithOverlay({ blendMode: "screen" })} />);
    const img = container.querySelector<HTMLElement>("[data-test='overlay-img']");
    expect(img).not.toBeNull();
    expect(img!.style.mixBlendMode).toBe("screen");
  });

  it("blendMode=add → plus-lighter", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithOverlay({ blendMode: "add" })} />);
    const img = container.querySelector<HTMLElement>("[data-test='overlay-img']");
    expect(img!.style.mixBlendMode).toBe("plus-lighter");
  });

  it("no blendMode (old overlay) → NO mix-blend-mode (back-compat)", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithOverlay({})} />);
    const img = container.querySelector<HTMLElement>("[data-test='overlay-img']");
    expect(img!.style.mixBlendMode).toBe("");
  });
});
