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
