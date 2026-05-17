import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useFocusStore,
  buildViewerContext,
  buildTerminalPrefix,
  EMPTY_FOCUS,
} from "./focus";

// Stub apiFetch so setSelection doesn't try to hit the network.
const apiFetchMock = vi.fn(async () => ({}));
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe("focus store (H0.1 — frontend)", () => {
  beforeEach(() => {
    useFocusStore.setState({ workId: null, focus: { ...EMPTY_FOCUS } });
    apiFetchMock.mockClear();
  });

  it("starts empty", () => {
    expect(useFocusStore.getState().focus).toEqual(EMPTY_FOCUS);
  });

  it("bindWork resets focus when workId changes", () => {
    useFocusStore.setState({ workId: "w_a", focus: { selectedClipId: "vc_x" } });
    useFocusStore.getState().bindWork("w_b");
    expect(useFocusStore.getState().workId).toBe("w_b");
    expect(useFocusStore.getState().focus.selectedClipId).toBeNull();
  });

  it("bindWork to same workId is a no-op (preserves selection)", () => {
    useFocusStore.getState().bindWork("w_same");
    useFocusStore.setState({ focus: { selectedClipId: "vc_keep" } });
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
    useFocusStore.getState().applyServerSnapshot({ selectedClipId: "vc_from_server" });
    expect(useFocusStore.getState().focus.selectedClipId).toBe("vc_from_server");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  describe("buildViewerContext", () => {
    it("returns null when nothing is selected", () => {
      expect(buildViewerContext()).toBeNull();
    });

    it("wraps selected-clip in a viewer-context envelope", () => {
      useFocusStore.setState({ focus: { selectedClipId: "vc_s07" } });
      const ctx = buildViewerContext();
      expect(ctx).toMatch(/<viewer-context>/);
      expect(ctx).toMatch(/<selected-clip id="vc_s07"\/>/);
      expect(ctx).toMatch(/<\/viewer-context>/);
    });

    it("escapes special characters in clip id", () => {
      useFocusStore.setState({ focus: { selectedClipId: 'a"b<c&d' } });
      const ctx = buildViewerContext();
      expect(ctx).toMatch(/a&quot;b&lt;c&amp;d/);
    });
  });

  describe("buildTerminalPrefix", () => {
    it("returns null when nothing is selected", () => {
      expect(buildTerminalPrefix()).toBeNull();
    });

    it("renders [ctx: clip=X] when a clip is selected", () => {
      useFocusStore.setState({ focus: { selectedClipId: "vc_s07" } });
      expect(buildTerminalPrefix()).toBe("[ctx: clip=vc_s07]");
    });
  });
});
