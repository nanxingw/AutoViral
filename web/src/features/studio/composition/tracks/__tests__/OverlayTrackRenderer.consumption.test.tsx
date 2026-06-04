import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Wave 3a fix-up (finding #3) — prove the overlay clip the bridge writes via
// POST /clip is NOT a dead field: it must be CONSUMED by the render pipeline.
// The Remotion render entry (RemotionRoot.tsx → registerRoot) renders the SAME
// <Scene> the preview uses, and Scene dispatches an overlay track to
// OverlayTrackRenderer, which emits an <Img src={clip.src}> inside a <Sequence>.
// This test renders <Scene> with an overlay clip in the EXACT shape the bridge
// POST /clip overlay branch constructs (routes.ts: kind/src/trackOffset/duration/
// position full-frame/opacity 1) and asserts that <Img> reaches the DOM — i.e.
// the agent-created overlay clip enters the render path. If a future refactor
// drops the overlay dispatch (turning it into a dead field), this test goes red.

// Mock Remotion's render-time primitives so <Scene> renders under jsdom without
// the real <Composition> context (mirrors phase8-2-integration.test.tsx). We
// turn <Img> into a tagged <img> so the DOM assertion can find the overlay src.
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
import { makeEmptyComposition, CompositionSchema } from "../../../types";
import type { Composition, OverlayClip, Track } from "../../../types";

// Build a composition with a single overlay track holding ONE overlay clip in
// the precise shape the bridge POST /clip overlay branch writes. Keeping this
// shape in lockstep with routes.ts is the point: if the bridge default shape
// drifts from what the renderer can consume, the schema parse below catches it.
function overlayClipAsBridgeWritesIt(src: string): OverlayClip {
  return {
    id: "oc_test01",
    kind: "overlay",
    src,
    trackOffset: 1,
    duration: 4,
    position: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
    opacity: 1,
  };
}

function compWithOverlay(src: string): Composition {
  const comp = makeEmptyComposition({ workId: "w-overlay" });
  const overlayTrack: Track = {
    id: "trk_ov1",
    kind: "overlay",
    label: "Overlay",
    displayOrder: comp.tracks.length,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [],
    clips: [overlayClipAsBridgeWritesIt(src)],
  };
  comp.tracks.push(overlayTrack);
  comp.duration = 5;
  return comp;
}

describe("overlay clip is consumed by the render pipeline (finding #3)", () => {
  it("the bridge-shaped overlay clip is a valid OverlayClip (schema parse round-trips)", () => {
    const comp = compWithOverlay("assets/logo.png");
    // The same chokepoint writeCompositionFor uses on the bridge write path —
    // an overlay clip that the renderer can't parse would 400 the agent's add.
    expect(() => CompositionSchema.parse(comp)).not.toThrow();
  });

  it("<Scene> dispatches the overlay track to OverlayTrackRenderer, emitting an <Img src> (NOT a dead field)", () => {
    const src = "assets/logo.png";
    const comp = compWithOverlay(src);
    frameRef.current = Math.round(1.5 * 30); // inside the clip's [1, 5) window
    const { container } = render(<Scene comp={comp} />);
    // The overlay renderer emits an <Img> (mocked to <img data-test=overlay-img>)
    // whose src resolves to the clip's asset. Its mere presence proves the
    // overlay clip travelled Scene → OverlayTrackRenderer → <Img>: consumed,
    // not dropped.
    const imgs = Array.from(
      container.querySelectorAll<HTMLImageElement>("[data-test='overlay-img']"),
    );
    expect(imgs.length).toBe(1);
    // Scene rewrites relative asset srcs to the /api proxy; assert the basename
    // survived so we know it's the SAME asset the agent attached.
    expect(imgs[0].getAttribute("src") ?? "").toContain("logo.png");
    // Full-frame default placement (the bridge's overlay default) reaches the DOM.
    expect(imgs[0].style.width).toBe("100%");
    expect(imgs[0].style.height).toBe("100%");
  });
});
