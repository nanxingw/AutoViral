// Phase 4.E — useWaveform rewrite tests.
//
// Pneuma fidelity: hook contract follows
// .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/hooks/useWaveform.ts
// (97 lines): fetch → AudioContext.decodeAudioData → bucket peaks via
// per-bar max-abs scan → normalize. Local adaptations vs. pneuma upstream
// (per USER DECISION 3A — pneuma wins on divergence except where called
// out):
//
//   - Bucket count is fixed to 128 (D9), not a `bars` option. Pneuma
//     parameterizes; we hard-code per the master plan one-liner.
//   - Promise dedupe via module-scoped `Map<src, Promise<Peaks>>` (D9).
//     Pneuma uses a useRef-scoped cache keyed by `${url}:${bars}`; we
//     hoist it to module scope so concurrent hook callers for the same
//     src share the in-flight decode.
//   - Returned shape: `{ peaks: number[] | null; loading: boolean }`.
//     Pneuma returns `{ waveform: { peaks; duration } | null; loading }`;
//     we drop `duration` (not consumed by WaveformBars in this codebase
//     since we already know clip duration from AudioClip.in/out).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWaveform, _resetWaveformCacheForTests } from "./useWaveform";

const baseAudioContext = (globalThis as Record<string, unknown>).AudioContext;

beforeEach(() => {
  _resetWaveformCacheForTests();
  // dom-mocks/setup.ts already installs AudioContext mock returning a
  // 1s @ 48kHz Float32Array stub via getChannelData(). Stub fetch to
  // return an empty ArrayBuffer (the mock decodeAudioData ignores it).
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
  // Restore the canonical mock from dom-mocks.ts for any test that
  // overrode AudioContext.
  (globalThis as Record<string, unknown>).AudioContext = baseAudioContext;
});

describe("useWaveform", () => {
  it("returns null peaks initially, then a 128-element array after decode", async () => {
    const { result } = renderHook(() => useWaveform("/a.mp3"));
    expect(result.current.peaks).toBeNull();
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(result.current.peaks!.length).toBe(128);
  });

  it("returns null when src is empty", () => {
    const { result } = renderHook(() => useWaveform(""));
    expect(result.current.peaks).toBeNull();
  });

  it("dedupes concurrent calls for the same src (single decode)", async () => {
    const decodeSpy = vi.fn(async () => ({
      getChannelData: () => new Float32Array(48000),
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 48000,
    }));
    class SpyAudioContext {
      static __mocked = true;
      decodeAudioData = decodeSpy;
      close = vi.fn();
    }
    (globalThis as Record<string, unknown>).AudioContext = SpyAudioContext;

    const { result: r1 } = renderHook(() => useWaveform("/x.mp3"));
    const { result: r2 } = renderHook(() => useWaveform("/x.mp3"));
    await waitFor(() => expect(r1.current.peaks).not.toBeNull());
    await waitFor(() => expect(r2.current.peaks).not.toBeNull());
    expect(decodeSpy).toHaveBeenCalledTimes(1);
  });

  it("each peak is in [0, 1]", async () => {
    const { result } = renderHook(() => useWaveform("/peaks.mp3"));
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    for (const p of result.current.peaks!) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("loading flips true while decoding then false once peaks land", async () => {
    let resolveDecode: ((v: unknown) => void) | null = null;
    const pending = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    class SlowAudioContext {
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
    (globalThis as Record<string, unknown>).AudioContext = SlowAudioContext;

    const { result } = renderHook(() => useWaveform("/slow.mp3"));
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.peaks).toBeNull();
    resolveDecode!(undefined);
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it("exposes sourceDuration matching the decoded AudioBuffer.duration", async () => {
    const { result } = renderHook(() => useWaveform("/dur.mp3"));
    expect(result.current.sourceDuration).toBeNull();
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    // dom-mocks installs an AudioContext mock whose decodeAudioData returns
    // a 1-second AudioBuffer (48000 samples at 48kHz). Hook must surface
    // that through the new sourceDuration field.
    expect(result.current.sourceDuration).toBe(1);
  });

  it("does not setState after unmount (alive guard)", async () => {
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

    const { result, unmount } = renderHook(() => useWaveform("/hang.mp3"));
    expect(result.current.peaks).toBeNull();
    unmount();
    resolveDecode!(undefined);
    // Give microtasks a chance to flush; if alive guard works, no state
    // update happens on the unmounted hook (would emit a React warning
    // and we'd see crash if the guard were missing).
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.peaks).toBeNull();
  });
});
