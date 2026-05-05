import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useFrameExtractor, __resetFrameCacheForTests } from "./useFrameExtractor";

beforeEach(() => {
  __resetFrameCacheForTests();
});

describe("useFrameExtractor", () => {
  it("returns an empty map initially, then resolves all timestamps", async () => {
    const { result } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [0, 0.5, 1] }),
    );
    expect(result.current.frames.size).toBe(0);
    await waitFor(() => {
      expect(result.current.frames.size).toBe(3);
    });
    expect(result.current.frames.get(0)).toMatch(/^data:image\/jpeg/);
    expect(result.current.frames.get(0.5)).toMatch(/^data:image\/jpeg/);
    expect(result.current.frames.get(1)).toMatch(/^data:image\/jpeg/);
  });

  it("clamps t=0 to Math.max(t, 0.05) to avoid black poster frames", async () => {
    const seekSpy = vi.fn();
    const store = new WeakMap<HTMLMediaElement, number>();
    // Override the prototype currentTime setter for this test only — the
    // outer mockHTMLMediaElement setter would otherwise swallow the spy.
    const prevDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "currentTime",
    );
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      set(this: HTMLMediaElement, v: number) {
        seekSpy(v);
        store.set(this, v);
        queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
      },
      get(this: HTMLMediaElement) {
        return store.get(this) ?? 0;
      },
    });
    try {
      renderHook(() => useFrameExtractor({ src: "/v.mp4", timestamps: [0] }));
      await waitFor(() => expect(seekSpy).toHaveBeenCalled());
      expect(seekSpy.mock.calls[0]?.[0]).toBeCloseTo(0.05);
    } finally {
      if (prevDescriptor) {
        Object.defineProperty(
          HTMLMediaElement.prototype,
          "currentTime",
          prevDescriptor,
        );
      }
    }
  });

  it("dedupes concurrent extraction for the same src+timestamp via cache", async () => {
    const { result: r1 } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [0.5] }),
    );
    const { result: r2 } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [0.5] }),
    );
    await waitFor(() => {
      expect(r1.current.frames.get(0.5)).toBeDefined();
      expect(r2.current.frames.get(0.5)).toBeDefined();
    });
    expect(r1.current.frames.get(0.5)).toBe(r2.current.frames.get(0.5));
  });

  it("does not throw when src is empty", () => {
    const { result } = renderHook(() =>
      useFrameExtractor({ src: "", timestamps: [] }),
    );
    expect(result.current.frames.size).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it("does not throw when timestamps array is empty", () => {
    const { result } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [] }),
    );
    expect(result.current.frames.size).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it("transitions loading flag from true to false once frames resolve", async () => {
    const { result } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [0.5, 1] }),
    );
    await waitFor(() => {
      expect(result.current.frames.size).toBe(2);
      expect(result.current.loading).toBe(false);
    });
  });
});
