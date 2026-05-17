import { describe, it, expect, beforeEach, vi } from "vitest";
import { read, write, subscribe, reset, EMPTY_FOCUS } from "../index.js";

describe("focus store (H0.1)", () => {
  beforeEach(() => {
    reset();
  });

  it("returns EMPTY_FOCUS for unknown workId", () => {
    expect(read("w_unknown")).toEqual(EMPTY_FOCUS);
  });

  it("write returns the merged snapshot", () => {
    const merged = write("w_1", { selectedClipId: "vc_s07" });
    // After H0.2 the snapshot has 4 fields; only selectedClipId is set,
    // the rest come from EMPTY_FOCUS defaults.
    expect(merged.selectedClipId).toBe("vc_s07");
    expect(merged.playheadSec).toBe(0);
    expect(merged.selectedSegmentId).toBeNull();
    expect(merged.activePanel).toBeNull();
  });

  it("subsequent reads see the written value", () => {
    write("w_1", { selectedClipId: "vc_s07" });
    expect(read("w_1").selectedClipId).toBe("vc_s07");
  });

  it("write merges patches rather than replacing the whole snapshot", () => {
    write("w_1", { selectedClipId: "vc_s07" });
    // Empty patch should not clobber the selection.
    write("w_1", {});
    expect(read("w_1").selectedClipId).toBe("vc_s07");
  });

  it("write supports clearing selection by setting null", () => {
    write("w_1", { selectedClipId: "vc_s07" });
    write("w_1", { selectedClipId: null });
    expect(read("w_1").selectedClipId).toBeNull();
  });

  it("isolates state across workIds", () => {
    write("w_1", { selectedClipId: "vc_a" });
    write("w_2", { selectedClipId: "vc_b" });
    expect(read("w_1").selectedClipId).toBe("vc_a");
    expect(read("w_2").selectedClipId).toBe("vc_b");
  });

  it("subscribe fires on every write for the matching workId", () => {
    const cb = vi.fn();
    const unsub = subscribe("w_1", cb);
    write("w_1", { selectedClipId: "vc_a" });
    write("w_1", { selectedClipId: "vc_b" });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedClipId: "vc_b" }),
    );
    unsub();
  });

  it("subscribe does NOT fire for unrelated workIds", () => {
    const cb = vi.fn();
    subscribe("w_1", cb);
    write("w_2", { selectedClipId: "vc_other" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further callbacks", () => {
    const cb = vi.fn();
    const unsub = subscribe("w_1", cb);
    write("w_1", { selectedClipId: "vc_a" });
    unsub();
    write("w_1", { selectedClipId: "vc_b" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a throwing subscriber does not break siblings", () => {
    const good = vi.fn();
    subscribe("w_1", () => {
      throw new Error("subscriber boom");
    });
    subscribe("w_1", good);
    write("w_1", { selectedClipId: "vc_a" });
    expect(good).toHaveBeenCalledOnce();
  });

  it("reset(workId) clears only that work", () => {
    write("w_1", { selectedClipId: "vc_a" });
    write("w_2", { selectedClipId: "vc_b" });
    reset("w_1");
    expect(read("w_1")).toEqual(EMPTY_FOCUS);
    expect(read("w_2").selectedClipId).toBe("vc_b");
  });

  // ─── H0.2: full schema (playhead, segment, panel) ──────────────────────
  it("EMPTY_FOCUS has all four fields with sensible defaults", () => {
    expect(EMPTY_FOCUS).toEqual({
      selectedClipId: null,
      playheadSec: 0,
      selectedSegmentId: null,
      activePanel: null,
    });
  });

  it("write merges H0.2 fields independently", () => {
    write("w_full", { selectedClipId: "vc_a" });
    write("w_full", { playheadSec: 12.3 });
    write("w_full", { selectedSegmentId: "seg_0023" });
    write("w_full", { activePanel: "inspector" });
    expect(read("w_full")).toEqual({
      selectedClipId: "vc_a",
      playheadSec: 12.3,
      selectedSegmentId: "seg_0023",
      activePanel: "inspector",
    });
  });

  it("playheadSec accepts 0 and positive numbers", () => {
    write("w_pf", { playheadSec: 0 });
    expect(read("w_pf").playheadSec).toBe(0);
    write("w_pf", { playheadSec: 123.456 });
    expect(read("w_pf").playheadSec).toBe(123.456);
  });

  it("activePanel can be set to null to clear", () => {
    write("w_panel", { activePanel: "timeline" });
    expect(read("w_panel").activePanel).toBe("timeline");
    write("w_panel", { activePanel: null });
    expect(read("w_panel").activePanel).toBeNull();
  });

  it("multi-field write produces a single subscriber callback", () => {
    const cb = vi.fn();
    subscribe("w_multi", cb);
    write("w_multi", {
      selectedClipId: "vc_x",
      playheadSec: 5,
      selectedSegmentId: "seg_y",
      activePanel: "preview",
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({
      selectedClipId: "vc_x",
      playheadSec: 5,
      selectedSegmentId: "seg_y",
      activePanel: "preview",
    });
  });
});
