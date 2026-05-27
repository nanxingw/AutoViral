import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useFocusStore,
  buildViewerContext,
  buildTerminalPrefix,
  EMPTY_FOCUS,
} from "./focus";

// Stub apiFetch so writes don't try to hit the network.
// Rest param so `apiFetchMock(...args)` type-checks AND mock.calls entries are
// typed as unknown[] (not the empty tuple []), which lets the throttle-count
// assertions index c[1] without TS2493.
const apiFetchMock = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe("focus store (H0.1 + H0.2)", () => {
  beforeEach(() => {
    // Bounce through a sentinel workId so bindWork fires (resets module-
    // scoped throttle state). Then back to null so each test starts from
    // a known empty store + clean throttle timestamps.
    useFocusStore.getState().bindWork("__reset__");
    useFocusStore.getState().bindWork(null);
    useFocusStore.setState({ workId: null, focus: { ...EMPTY_FOCUS } });
    apiFetchMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── H0.1 ─────────────────────────────────────────────────────────────────
  it("starts empty", () => {
    expect(useFocusStore.getState().focus).toEqual(EMPTY_FOCUS);
  });

  it("bindWork resets focus when workId changes", () => {
    useFocusStore.setState({
      workId: "w_a",
      focus: {
        selectedClipId: "vc_x",
        playheadSec: 5,
        selectedSegmentId: "seg_1",
        activePanel: "timeline",
      },
    });
    useFocusStore.getState().bindWork("w_b");
    expect(useFocusStore.getState().workId).toBe("w_b");
    expect(useFocusStore.getState().focus).toEqual(EMPTY_FOCUS);
  });

  it("bindWork to same workId is a no-op (preserves selection)", () => {
    useFocusStore.getState().bindWork("w_same");
    useFocusStore.setState({ focus: { ...EMPTY_FOCUS, selectedClipId: "vc_keep" } });
    useFocusStore.getState().bindWork("w_same");
    expect(useFocusStore.getState().focus.selectedClipId).toBe("vc_keep");
  });

  it("setSelection updates local state and POSTs to the bridge", () => {
    useFocusStore.getState().bindWork("w_test");
    useFocusStore.getState().setSelection("vc_s07");
    expect(useFocusStore.getState().focus.selectedClipId).toBe("vc_s07");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bridge/v1/focus",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ selectedClipId: "vc_s07" }),
      }),
    );
  });

  it("setSelection without a bound workId still updates local state", () => {
    useFocusStore.getState().setSelection("vc_no_work");
    expect(useFocusStore.getState().focus.selectedClipId).toBe("vc_no_work");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("applyServerSnapshot replaces focus without triggering apiFetch", () => {
    useFocusStore.getState().bindWork("w_apply");
    useFocusStore.getState().applyServerSnapshot({
      selectedClipId: "vc_from_server",
      playheadSec: 12.3,
      selectedSegmentId: "seg_x",
      activePanel: "preview",
    });
    expect(useFocusStore.getState().focus.selectedClipId).toBe("vc_from_server");
    expect(useFocusStore.getState().focus.playheadSec).toBe(12.3);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  // ─── H0.2 ─────────────────────────────────────────────────────────────────
  it("setSelectedSegment posts to bridge + updates local state", () => {
    useFocusStore.getState().bindWork("w_seg");
    useFocusStore.getState().setSelectedSegment("seg_0023");
    expect(useFocusStore.getState().focus.selectedSegmentId).toBe("seg_0023");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bridge/v1/focus",
      expect.objectContaining({
        body: JSON.stringify({ selectedSegmentId: "seg_0023" }),
      }),
    );
  });

  it("setActivePanel posts to bridge + updates local state", () => {
    useFocusStore.getState().bindWork("w_panel");
    useFocusStore.getState().setActivePanel("inspector");
    expect(useFocusStore.getState().focus.activePanel).toBe("inspector");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bridge/v1/focus",
      expect.objectContaining({
        body: JSON.stringify({ activePanel: "inspector" }),
      }),
    );
  });

  it("setPlayhead immediately updates local state (UI responsiveness)", () => {
    useFocusStore.getState().bindWork("w_head");
    useFocusStore.getState().setPlayhead(0);
    useFocusStore.getState().setPlayhead(0.1);
    useFocusStore.getState().setPlayhead(0.2);
    // Local snapshot reflects the latest value regardless of throttle.
    expect(useFocusStore.getState().focus.playheadSec).toBe(0.2);
  });

  it("setPlayhead throttles bridge writes (100 scrub events → ≤15 WS writes)", async () => {
    useFocusStore.getState().bindWork("w_scrub");

    // Simulate 100 rapid scrub frames spread over 1 second (~60fps + extras).
    for (let i = 0; i < 100; i++) {
      useFocusStore.getState().setPlayhead(i * 0.01);
      // Advance fake time by 10ms between calls — i.e. 100 calls over 1000ms.
      vi.advanceTimersByTime(10);
    }
    // Flush any trailing-edge timer.
    vi.runAllTimers();

    // 1000ms / 100ms throttle = at most ~10-11 writes. The PRD says ≤15 to
    // give a small safety margin for leading-edge behavior.
    const writeCount = apiFetchMock.mock.calls.filter((c) =>
      JSON.stringify(c[1]).includes("playheadSec"),
    ).length;
    expect(writeCount).toBeLessThanOrEqual(15);
    expect(writeCount).toBeGreaterThanOrEqual(5);
  });

  it("setPlayhead leading-edge fires the first call immediately", () => {
    useFocusStore.getState().bindWork("w_first");
    useFocusStore.getState().setPlayhead(0.5);
    // Without timer advance, the first call should already have flushed.
    const playheadWrites = apiFetchMock.mock.calls.filter((c) =>
      JSON.stringify(c[1]).includes("playheadSec"),
    );
    expect(playheadWrites.length).toBeGreaterThanOrEqual(1);
  });

  describe("buildViewerContext", () => {
    it("returns null when nothing is set", () => {
      expect(buildViewerContext()).toBeNull();
    });

    it("wraps selected-clip + playhead + selected-segment + active-panel", () => {
      useFocusStore.setState({
        focus: {
          selectedClipId: "vc_s07",
          playheadSec: 12.345,
          selectedSegmentId: "seg_0023",
          activePanel: "timeline",
        },
      });
      const ctx = buildViewerContext();
      expect(ctx).toMatch(/<viewer-context>/);
      expect(ctx).toMatch(/<selected-clip id="vc_s07"\/>/);
      expect(ctx).toMatch(/<playhead seconds="12.35"\/>/);
      expect(ctx).toMatch(/<selected-segment id="seg_0023"\/>/);
      expect(ctx).toMatch(/<active-panel name="timeline"\/>/);
      expect(ctx).toMatch(/<\/viewer-context>/);
    });

    it("omits zero/empty fields", () => {
      useFocusStore.setState({
        focus: { ...EMPTY_FOCUS, selectedClipId: "vc_only" },
      });
      const ctx = buildViewerContext();
      expect(ctx).toMatch(/<selected-clip id="vc_only"\/>/);
      expect(ctx).not.toMatch(/<playhead/);
      expect(ctx).not.toMatch(/<active-panel/);
    });

    it("escapes special characters in clip id", () => {
      useFocusStore.setState({
        focus: { ...EMPTY_FOCUS, selectedClipId: 'a"b<c&d' },
      });
      const ctx = buildViewerContext();
      expect(ctx).toMatch(/a&quot;b&lt;c&amp;d/);
    });
  });

  describe("buildTerminalPrefix", () => {
    it("returns null when nothing is set", () => {
      expect(buildTerminalPrefix()).toBeNull();
    });

    it("renders [ctx: clip=X seg=Y head=12.3s panel=Z]", () => {
      useFocusStore.setState({
        focus: {
          selectedClipId: "vc_s07",
          playheadSec: 12.345,
          selectedSegmentId: "seg_0023",
          activePanel: "preview",
        },
      });
      expect(buildTerminalPrefix()).toBe(
        "[ctx: clip=vc_s07 seg=seg_0023 head=12.3s panel=preview]",
      );
    });

    it("omits zero-valued playhead", () => {
      useFocusStore.setState({
        focus: { ...EMPTY_FOCUS, selectedClipId: "vc_X", playheadSec: 0 },
      });
      expect(buildTerminalPrefix()).toBe("[ctx: clip=vc_X]");
    });
  });
});
