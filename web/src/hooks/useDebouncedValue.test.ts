import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 300));
    expect(result.current).toBe("a");
  });

  it("debounces updates by the given delay", () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 300),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "b" });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("b");
  });

  it("cancels pending updates on rapid changes", () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 300),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "b" });
    act(() => { vi.advanceTimersByTime(150); });
    rerender({ v: "c" });
    act(() => { vi.advanceTimersByTime(150); });
    // The "b" timer was cleared at 150ms; the "c" timer started at 150ms
    // and only 150ms has elapsed for it — still pending.
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current).toBe("c");
  });
});
