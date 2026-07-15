import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// S3 (PRD-0016) — AudioTrackRenderer buffering semantics PROOF. docs/issues/032
// root cause: at a hard cut the incoming clip's <video> cold-mounts and enters
// Remotion's global buffering block; while that block is up, the app's audio
// elements (BGM/VO .mp3, the residual after S2 premount) are pulled back by the
// 0.15s aggressive drift-correction — the user HEARS ~0.6s of already-played
// audio (the "replay" half of the stutter). AudioTrackRenderer never passed
// `pauseWhenBuffering`, so an audio element that isn't ready would silently
// drift instead of joining the block.
//
// The fix mirrors the preview <Video> (VideoTrackRenderer.render-branch.test):
//   isRendering=false (browser preview) → <Audio pauseWhenBuffering>
//   isRendering=true  (server render)   → plain <Audio> (no preview-only prop —
//                                         ffmpeg has no buffering concept)
// This is the FIRST AudioTrackRenderer test to render the component through a
// mocked remotion boundary (the sibling AudioTrackRenderer.*.test.tsx cover the
// pure computeAudioVolumeForFrame math only), so Audio must be a props-capturing
// fake and getRemotionEnvironment must be mockable to prove the branch.

const frameRef = { current: 0 };
const isRenderingRef = { current: false };

vi.mock("remotion", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const FakeAudio = (props: Record<string, unknown>) => (
    <div
      data-test="audio"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-src={(props as any).src}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data-props={JSON.stringify(Object.keys(props).sort())}
      data-values={JSON.stringify({
        src: props.src,
        startFrom: props.startFrom,
        endAt: props.endAt,
        volume: props.volume,
      })}
    />
  );
  return {
    ...actual,
    Sequence: Passthrough,
    Audio: FakeAudio,
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

import { AudioTrackRenderer } from "../AudioTrackRenderer";
import type { AudioClip, Track } from "../../../types";

function audioTrack(clip: Partial<AudioClip> = {}): Track {
  const audioClip: AudioClip = {
    id: "a_buf01",
    kind: "audio",
    src: "assets/bgm.mp3",
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 0.8,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
    ...clip,
  };
  return {
    id: "trk_a1",
    kind: "audio",
    label: "Audio",
    displayOrder: 0,
    muted: false,
    hidden: false,
    volume: 0,
    transitions: [],
    clips: [audioClip],
  };
}

function audioLayers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-test='audio']"));
}

describe("AudioTrackRenderer buffering semantics (S3, PRD-0016 / issue 032)", () => {
  it("isRendering=false (preview) → <Audio> carries pauseWhenBuffering", () => {
    isRenderingRef.current = false;
    frameRef.current = 30;
    const { container } = render(<AudioTrackRenderer track={audioTrack()} />);
    expect(audioLayers(container).length).toBe(1);
    const props = JSON.parse(audioLayers(container)[0].getAttribute("data-props")!);
    expect(props).toContain("pauseWhenBuffering");
  });

  it("isRendering=true (server render) → <Audio> does NOT carry the preview-only prop", () => {
    isRenderingRef.current = true;
    frameRef.current = 30;
    const { container } = render(<AudioTrackRenderer track={audioTrack()} />);
    const props = JSON.parse(audioLayers(container)[0].getAttribute("data-props")!);
    expect(props).not.toContain("pauseWhenBuffering");
  });

  it("does not regress the existing volume/fade behaviour (base volume + linear fadeIn)", () => {
    isRenderingRef.current = false;
    // Clip: base volume 0.8, fadeIn 2s, no fadeOut. At frame 30 (1s @ 30fps) we
    // are halfway through the fadeIn ramp, so the effective volume must be
    // 0.8 * (1/2) = 0.4 — proving the fade math still rides on top of `base`
    // regardless of the new preview-only prop.
    frameRef.current = 30;
    const { container } = render(
      <AudioTrackRenderer track={audioTrack({ volume: 0.8, fadeIn: 2, fadeOut: 0 })} />,
    );
    const values = JSON.parse(audioLayers(container)[0].getAttribute("data-values")!) as {
      src: string;
      startFrom: number;
      endAt: number;
      volume: number;
    };
    expect(values.volume).toBeCloseTo(0.4, 4);
    // trim/offset props are untouched by S3 (startFrom = in*fps, endAt = out*fps).
    expect(values.startFrom).toBe(0);
    expect(values.endAt).toBe(150);
  });
});
