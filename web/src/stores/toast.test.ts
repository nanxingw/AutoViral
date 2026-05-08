import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore, describeError } from "./toast";
import { ApiError } from "@/lib/api";

describe("toast store", () => {
  beforeEach(() => useToastStore.getState().clear());

  it("push appends entries with auto-generated id", () => {
    const id1 = useToastStore.getState().push({
      variant: "error",
      message: "first",
      ttlMs: 5000,
    });
    const id2 = useToastStore.getState().push({
      variant: "error",
      message: "second",
      ttlMs: 5000,
    });
    expect(id1).not.toBe(id2);
    expect(useToastStore.getState().entries).toHaveLength(2);
  });

  it("dedupes identical messages within 2s", () => {
    useToastStore
      .getState()
      .push({ variant: "error", message: "same", ttlMs: 5000 });
    useToastStore
      .getState()
      .push({ variant: "error", message: "same", ttlMs: 5000 });
    expect(useToastStore.getState().entries).toHaveLength(1);
  });

  it("dismiss removes the entry", () => {
    const id = useToastStore
      .getState()
      .push({ variant: "info", message: "x", ttlMs: 5000 });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().entries).toHaveLength(0);
  });
});

describe("describeError", () => {
  it("uses errorCode-based i18n when available", () => {
    const err = new ApiError("English msg", 404, {
      error: "Work not found",
      errorCode: "work_not_found",
    });
    const t = (key: string) =>
      key === "serverErrors.work_not_found" ? "作品不存在" : key;
    expect(describeError(err, t)).toEqual({
      message: "作品不存在",
      detail: "404",
    });
  });

  it("falls back to err.message when errorCode unmapped", () => {
    const err = new ApiError("English msg", 500, {
      error: "Mystery",
      errorCode: "novel_code",
    });
    const t = (key: string) => key; // walk-style: missing key returns verbatim
    expect(describeError(err, t).message).toBe("English msg");
  });

  it("handles plain Error", () => {
    const err = new Error("boom");
    expect(describeError(err)).toEqual({ message: "boom", detail: "Error" });
  });

  it("stringifies unknown thrown values", () => {
    expect(describeError("string-rejection")).toEqual({
      message: "string-rejection",
    });
  });
});
