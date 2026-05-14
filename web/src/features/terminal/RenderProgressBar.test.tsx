import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { RenderProgressBar } from "./RenderProgressBar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function dispatchProgress(stage: string, pct?: number) {
  window.dispatchEvent(
    new CustomEvent("autoviral:ui-render-progress", { detail: { stage, pct } }),
  );
}

describe("RenderProgressBar", () => {
  it("renders nothing initially", () => {
    render(<RenderProgressBar />);
    expect(screen.queryByTestId("render-progress-bar")).toBeNull();
  });

  it("surfaces progress on autoviral:ui-render-progress event", () => {
    render(<RenderProgressBar />);
    act(() => dispatchProgress("render", 0.42));
    const bar = screen.getByTestId("render-progress-bar");
    expect(bar).toHaveAttribute("data-stage", "render");
    expect(bar.textContent).toContain("render");
    expect(bar.textContent).toContain("42%");
  });

  it("auto-hides 2s after stage=encode pct=1", () => {
    vi.useFakeTimers();
    render(<RenderProgressBar />);
    act(() => dispatchProgress("encode", 1));
    expect(screen.getByTestId("render-progress-bar")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByTestId("render-progress-bar")).toBeNull();
  });

  it("cancels the auto-hide timer when a new event arrives mid-fade", () => {
    vi.useFakeTimers();
    render(<RenderProgressBar />);
    act(() => dispatchProgress("encode", 1));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Re-entry — another render starts before the fade completed.
    act(() => dispatchProgress("render", 0.1));
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    // Still visible — the previous hide was cancelled, and the new
    // "render 10%" event is non-terminal so no new timer was scheduled.
    expect(screen.getByTestId("render-progress-bar")).toHaveAttribute(
      "data-stage",
      "render",
    );
  });
});
