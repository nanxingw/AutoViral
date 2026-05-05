// happy-dom does not ship a real <canvas> 2D context or a video decoder.
// These shims provide the surface our timeline tests exercise:
//   - canvas: getContext("2d") returns drawImage/clearRect/getImageData stubs;
//             toDataURL returns a stable fake `data:image/jpeg` URL.
//   - HTMLMediaElement: .duration is settable via mockHTMLMediaElement; setting
//             .currentTime fires `seeked` on the next microtask so the
//             useFrameExtractor seek loop resolves.
//   - AudioContext: minimal decodeAudioData stub for waveform-style tests
//             (kept here so 4.E reuses the same setup module).
import { vi } from "vitest";

export function installCanvasMocks(): void {
  if (!HTMLCanvasElement.prototype.toDataURL.toString().includes("data:image")) {
    HTMLCanvasElement.prototype.toDataURL = vi.fn(
      () => "data:image/jpeg;base64,FRAME",
    ) as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
  }
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: ((...args: unknown[]) => unknown) & { __mocked?: boolean };
  };
  if (!proto.getContext.__mocked) {
    const orig = proto.getContext;
    const wrapped = function (this: HTMLCanvasElement, ...args: unknown[]) {
      const ctx =
        (orig as unknown as (...a: unknown[]) => unknown).apply(this, args) ?? {
          fillRect: vi.fn(),
          clearRect: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
          putImageData: vi.fn(),
        };
      const mut = ctx as { drawImage?: unknown };
      mut.drawImage = vi.fn();
      return ctx;
    } as ((...args: unknown[]) => unknown) & { __mocked?: boolean };
    wrapped.__mocked = true;
    proto.getContext = wrapped;
  }
}

export function installAudioContextMock(): void {
  const existing = (globalThis as { AudioContext?: { __mocked?: boolean } })
    .AudioContext;
  if (existing && existing.__mocked) return;
  class MockAudioContext {
    static __mocked = true;
    decodeAudioData = vi.fn(async () => ({
      getChannelData: () => new Float32Array(48000),
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 48000,
    }));
    close = vi.fn();
  }
  (globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
  (globalThis as Record<string, unknown>).webkitAudioContext = MockAudioContext;
}

// Per-element currentTime store at module scope so re-invocations of
// mockHTMLMediaElement (e.g. with a different durationSec) don't orphan
// values previously written by existing elements.
const mediaCurrentTime = new WeakMap<HTMLMediaElement, number>();

export function mockHTMLMediaElement(durationSec = 10): void {
  const proto = HTMLMediaElement.prototype as unknown as {
    __mocked?: boolean;
  };
  if (proto.__mocked) {
    // Allow duration override on re-call, but skip re-installing setters that
    // would otherwise trash existing prototype state.
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => durationSec,
    });
    return;
  }
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => durationSec,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 180,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    set(this: HTMLMediaElement, v: number) {
      mediaCurrentTime.set(this, v);
      queueMicrotask(() => {
        this.dispatchEvent(new Event("canplay"));
        this.dispatchEvent(new Event("seeked"));
      });
    },
    get(this: HTMLMediaElement) {
      return mediaCurrentTime.get(this) ?? 0;
    },
  });
  proto.__mocked = true;
}
