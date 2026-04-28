import { describe, it, expect } from "vitest";
import { buildSafeOutputFilename } from "../remotion-renderer.js";

describe("buildSafeOutputFilename", () => {
  it("lowercases and slugifies the title", () => {
    const f = buildSafeOutputFilename("My Big Title!", new Date("2026-04-28T12:34:56Z"));
    expect(f).toBe("my-big-title-2026-04-28-12-34-56.mp4");
  });
  it("strips non-word characters incl. CJK", () => {
    const f = buildSafeOutputFilename("春日咖啡 — Carousel", new Date("2026-04-28T00:00:00Z"));
    // 春日咖啡 is dropped, em-dash dropped, "Carousel" kept
    expect(f.endsWith("carousel-2026-04-28-00-00-00.mp4")).toBe(true);
  });
  it("falls back to autoviral-export when title is empty", () => {
    const f = buildSafeOutputFilename("", new Date("2026-04-28T00:00:00Z"));
    expect(f).toBe("autoviral-export-2026-04-28-00-00-00.mp4");
  });
});
