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
    expect(merged).toEqual({ selectedClipId: "vc_s07" });
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
    expect(cb).toHaveBeenLastCalledWith({ selectedClipId: "vc_b" });
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
});
