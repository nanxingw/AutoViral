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
  it("returns null peaks initially, then a duration-scaled array after decode", async () => {
    // Bucket count = clamp(MIN=128, MAX=8192, ceil(durationSec * 32)). The
    // dom-mocks AudioContext stub returns a 1-second AudioBuffer, so
    // 1 * 32 = 32 → clamped to MIN=128. Real long sources land between
    // floor and ceiling and exercise the temporal-density logic at runtime
    // (covered by the waveform-correctness E2E zoom evidence in the report).
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

// #30 — prefer the server's prebaked `<src>.peaks.json` (PeaksFileV2) and only
// fall back to the WebAudio decode for assets without it / bad responses.
describe("useWaveform — prebaked peaks.json (#30)", () => {
  // A spy decodeAudioData so we can assert the WebAudio path is (not) taken.
  function installDecodeSpy() {
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
    return decodeSpy;
  }

  // Fetch stub: `*.peaks.json` → peaksResponse; anything else → audio bytes
  // (the WebAudio fallback path).
  function stubFetch(peaksResponse: () => Partial<Response> | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith(".peaks.json")) {
          const r = peaksResponse();
          if (r) return r as unknown as Response;
        }
        return {
          ok: true,
          headers: { get: () => "audio/mpeg" },
          arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response;
      }),
    );
  }

  function jsonRes(body: unknown, contentType = "application/json"): Partial<Response> {
    return {
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) } as Headers,
      json: async () => body,
    };
  }

  it("happy path: a valid v2 file renders without touching WebAudio", async () => {
    const decodeSpy = installDecodeSpy();
    stubFetch(() =>
      jsonRes({ version: 2, channels: [[0.1, 0.5, 0.9]], durationSec: 12.5 }),
    );
    const { result } = renderHook(() => useWaveform("/bgm.mp3"));
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(Array.from(result.current.peaks!)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.5, 5),
      expect.closeTo(0.9, 5),
    ]);
    expect(result.current.sourceDuration).toBe(12.5);
    expect(decodeSpy).not.toHaveBeenCalled(); // no WebAudio decode
  });

  it("folds multiple channels by max (one display waveform)", async () => {
    installDecodeSpy();
    stubFetch(() =>
      jsonRes({
        version: 2,
        channels: [
          [0.2, 0.8, 0.1],
          [0.5, 0.3, 0.4],
        ],
        durationSec: 3,
      }),
    );
    const { result } = renderHook(() => useWaveform("/stereo.mp3"));
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(Array.from(result.current.peaks!)).toEqual([
      expect.closeTo(0.5, 5),
      expect.closeTo(0.8, 5),
      expect.closeTo(0.4, 5),
    ]);
  });

  it("falls back to WebAudio on 404", async () => {
    const decodeSpy = installDecodeSpy();
    stubFetch(() => ({ ok: false, status: 404 }));
    const { result } = renderHook(() => useWaveform("/legacy.mp3"));
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(decodeSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back when the peaks URL returns text/html (SPA fallback)", async () => {
    const decodeSpy = installDecodeSpy();
    stubFetch(() => jsonRes("<!doctype html>", "text/html"));
    const { result } = renderHook(() => useWaveform("/spa.mp3"));
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(decodeSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back on a version mismatch", async () => {
    const decodeSpy = installDecodeSpy();
    stubFetch(() => jsonRes({ version: 99, channels: [[0.1, 0.2]], durationSec: 2 }));
    const { result } = renderHook(() => useWaveform("/future.mp3"));
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(decodeSpy).toHaveBeenCalledTimes(1);
  });
});
