import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// S19 (US 29/30) — reverse + freeze RENDERER CONSUMPTION proof. reverse /
// freezeAtSec are NOT dead schema fields (the LUT-slider lesson): this renders
// the SAME <Scene> the preview runs and asserts the fields actually drive the
// DOM the user sees:
//   - freezeAtSec → the <Video> is FROZEN at that source frame: its
//     startFrom == round(freezeAtSec*fps) AND it spans exactly ONE frame
//     (endAt == startFrom + 1), so it holds a single still (preview consumes it).
//   - reverse → the preview does NOT fake backwards playback. Instead it shows
//     an EXPLICIT "export-only" placeholder badge over the clip so the user is
//     told the reverse only takes effect on export (never a fake WYSIWYG).
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
      data-start-from={(props as any).startFrom}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-end-at={(props as any).endAt}
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

function compWithVideo(extra: Partial<VideoClip>): Composition {
  const clip: VideoClip = {
    id: "vc_rf01",
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
  const comp = makeEmptyComposition({ workId: "w-rf" });
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

describe("VideoTrackRenderer freeze is CONSUMED by the preview (S19)", () => {
  it("no freeze (old work) → <Video> plays the normal in..out span", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo({})} />);
    const v = videoLayer(container);
    // in:0 out:4 @30fps → startFrom 0, endAt 120 (NOT a 1-frame hold)
    expect(v.getAttribute("data-start-from")).toBe("0");
    expect(v.getAttribute("data-end-at")).toBe("120");
  });

  it("freezeAtSec:1.5 → <Video> is held at ONE frame (startFrom=45, endAt=46)", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ freezeAtSec: 1.5 })} />,
    );
    const v = videoLayer(container);
    // 1.5s @30fps → frame 45; a held still spans exactly one frame.
    expect(v.getAttribute("data-start-from")).toBe("45");
    expect(v.getAttribute("data-end-at")).toBe("46");
  });
});

describe("VideoTrackRenderer reverse shows an EXPLICIT export-only placeholder (S19)", () => {
  it("no reverse → NO export-only badge over the clip", () => {
    frameRef.current = 30;
    const { container } = render(<Scene comp={compWithVideo({})} />);
    expect(
      container.querySelector("[data-test='reverse-export-only']"),
    ).toBeNull();
  });

  it("reverse:true → an export-only placeholder badge IS rendered (no fake WYSIWYG)", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ reverse: true })} />,
    );
    const badge = container.querySelector<HTMLElement>(
      "[data-test='reverse-export-only']",
    );
    expect(badge).not.toBeNull();
    // The badge text must MAKE CLEAR the preview is not real reverse — it must
    // say it only takes effect on export, so the user is never misled.
    expect(badge!.textContent ?? "").toMatch(/导出|export/i);
    // And the underlying <Video> is NOT flagged as a real reverse (preview can't
    // play <video> backwards) — it plays forward UNDER an honest placeholder.
    const v = videoLayer(container);
    expect(v.getAttribute("data-start-from")).toBe("0");
    expect(v.getAttribute("data-end-at")).toBe("120");
  });

  // S19 review fix — the badge MUST NOT lie. The export's timeWarpVideoFilterChain
  // gives freezeAtSec PRECEDENCE over reverse: when BOTH are set, the export
  // FREEZES a single frame (forward-frozen) and does NOT reverse. So a
  // "倒放 · 仅导出生效" (reverse-only-on-export) badge would promise a reverse the
  // export never performs — a dishonest preview. When freeze is also set, the
  // reverse-export-only badge must NOT render (freeze is already WYSIWYG; nothing
  // export-only to warn about, and definitely not a phantom reverse).
  it("freeze+reverse together → NO reverse-export-only badge (export freezes, doesn't reverse — badge must not lie)", () => {
    frameRef.current = 30;
    const { container } = render(
      <Scene comp={compWithVideo({ reverse: true, freezeAtSec: 1.5 })} />,
    );
    // the dishonest reverse badge is suppressed because export won't reverse.
    expect(
      container.querySelector("[data-test='reverse-export-only']"),
    ).toBeNull();
    // freeze is still WYSIWYG: the <Video> is held at the single freeze frame
    // (1.5s @30fps = frame 45, one-frame span), exactly as the export bakes.
    const v = videoLayer(container);
    expect(v.getAttribute("data-start-from")).toBe("45");
    expect(v.getAttribute("data-end-at")).toBe("46");
  });
});
