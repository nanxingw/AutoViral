// Phase 4.E — WaveformBars tests.
//
// Mirrors pneuma's pure-presentational component contract (peaks → bars)
// plus the loading placeholder for the in-flight decode state.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { WaveformBars } from "./WaveformBars";
import { _resetWaveformCacheForTests } from "../../hooks/useWaveform";
import type { AudioClip } from "../../types";

const baseAudioContext = (globalThis as Record<string, unknown>).AudioContext;

const audioClip: AudioClip = {
  id: "wf-1",
  kind: "audio",
  src: "/bgm.mp3",
  in: 0,
  out: 4,
  trackOffset: 0,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  type: "bgm",
};

beforeEach(() => {
  _resetWaveformCacheForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  (globalThis as Record<string, unknown>).AudioContext = baseAudioContext;
});

describe("WaveformBars", () => {
  it("renders a loading placeholder while peaks are decoding", async () => {
    let resolveDecode: ((v: unknown) => void) | null = null;
    const pending = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    class HangAudioContext {
      static __mocked = true;
      decodeAudioData = vi.fn(async () => {
        await pending;
        return {
          getChannelData: () => new Float32Array(48000),
          duration: 1,
          numberOfChannels: 1,
          sampleRate: 48000,
        };
      });
      close = vi.fn();
    }
    (globalThis as Record<string, unknown>).AudioContext = HangAudioContext;

    const { container } = render(
      <WaveformBars clip={audioClip} pxPerSecond={50} height={48} />,
    );
    expect(
      container.querySelector('[aria-label="waveform-loading"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="waveform"]')).toBeNull();
    await act(async () => {
      resolveDecode!(undefined);
      await Promise.resolve();
    });
  });

  it("renders an SVG of bars once peaks resolve", async () => {
    const { container } = render(
      <WaveformBars clip={audioClip} pxPerSecond={50} height={48} />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[aria-label="waveform"]'),
      ).not.toBeNull(),
    );
    const svg = container.querySelector('[aria-label="waveform"]') as SVGElement;
    expect(svg.tagName.toLowerCase()).toBe("svg");
    const rects = svg.querySelectorAll("rect");
    expect(rects.length).toBeGreaterThan(0);
  });

  it("sizes the SVG to clip duration × pxPerSecond", async () => {
    const { container } = render(
      <WaveformBars clip={audioClip} pxPerSecond={40} height={48} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[aria-label="waveform"]')).not.toBeNull(),
    );
    const svg = container.querySelector(
      '[aria-label="waveform"]',
    ) as SVGElement;
    // dur = 4, pxPerSecond = 40 → width 160.
    expect(svg.getAttribute("width")).toBe("160");
  });

  it("slices peaks by source-relative window for trimmed (in > 0) clips", async () => {
    // Regression test for the latent bug in the prior implementation,
    // which used `totalDur = clip.in + dur` as if it were the source's
    // duration. With dom-mocks AudioContext returning a 1s source and a
    // clip {in: 0.4, out: 0.8}, the correct slice is
    //   peaks[floor(0.4/1 * 128) .. ceil(0.8/1 * 128)] = peaks[51..103]
    // i.e. 52 bars. The buggy math returned peaks[51..128] = 77 bars,
    // since totalDur collapsed to clip.out.
    const trimmed: AudioClip = { ...audioClip, in: 0.4, out: 0.8 };
    const { container } = render(
      <WaveformBars clip={trimmed} pxPerSecond={50} height={48} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[aria-label="waveform"]')).not.toBeNull(),
    );
    const svg = container.querySelector('[aria-label="waveform"]') as SVGElement;
    const rects = svg.querySelectorAll("rect");
    expect(rects.length).toBe(52);
  });

  it("returns the loading placeholder for a zero-duration clip", () => {
    const zero: AudioClip = { ...audioClip, in: 2, out: 2 };
    const { container } = render(
      <WaveformBars clip={zero} pxPerSecond={50} height={48} />,
    );
    expect(
      container.querySelector('[aria-label="waveform-loading"]'),
    ).not.toBeNull();
  });
});
