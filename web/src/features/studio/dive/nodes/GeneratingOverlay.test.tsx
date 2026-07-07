import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { GeneratingOverlay, pendingProgress } from "./GeneratingOverlay";
import { useLocaleStore } from "@/i18n/store";
import { MESSAGES } from "@/i18n/messages";

// Item 5 — the "still generating" node fill. We test the pure progress kernel
// (asymptote, monotonicity) directly, then the component's initial paint +
// the 2s message rotation under fake timers.

describe("pendingProgress — asymptotic curve", () => {
  it("starts at 10% and climbs but never reaches 100%", () => {
    expect(pendingProgress(0)).toBeCloseTo(10, 5);
    expect(pendingProgress(10000)).toBeLessThanOrEqual(98);
    expect(pendingProgress(10000)).toBeGreaterThan(pendingProgress(0));
  });

  it("is monotonically non-decreasing", () => {
    let prev = -1;
    for (let tick = 0; tick <= 200; tick += 5) {
      const p = pendingProgress(tick);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe("GeneratingOverlay — pending node fill", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders a progressbar starting near 10%, an elapsed readout, and the first message", () => {
    render(<GeneratingOverlay />);
    const bar = screen.getByTestId("dive-generating-bar");
    // width is `${progress}%`; at tick 0 progress ≈ 10.
    expect(parseFloat(bar.style.width)).toBeCloseTo(10, 1);
    expect(screen.getByTestId("dive-generating-elapsed").textContent).toBe("0s");
    expect(screen.getByTestId("dive-generating-msg").textContent).toBe(
      MESSAGES.en.studio.diveCanvas.generating0,
    );
    // ARIA — real progressbar semantics, never 100.
    const pb = screen.getByRole("progressbar");
    expect(Number(pb.getAttribute("aria-valuenow"))).toBeLessThan(100);
  });

  it("rotates to the second message after 2 seconds and advances progress", () => {
    render(<GeneratingOverlay />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("dive-generating-msg").textContent).toBe(
      MESSAGES.en.studio.diveCanvas.generating1,
    );
    expect(screen.getByTestId("dive-generating-elapsed").textContent).toBe("2s");
    expect(parseFloat(screen.getByTestId("dive-generating-bar").style.width)).toBeGreaterThan(10);
  });
});
