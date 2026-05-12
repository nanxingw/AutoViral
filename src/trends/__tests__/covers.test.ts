import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadCover, sanitizeCoverId, coversDir, gcOldCovers } from "../covers.js";

describe("sanitizeCoverId", () => {
  it("strips dangerous chars and limits length", () => {
    expect(sanitizeCoverId("../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeCoverId("yt_abc-123_def")).toBe("yt_abc-123_def");
    expect(sanitizeCoverId("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("downloadCover", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
    })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("writes the binary to disk under <coversDir>/<sanitizedId>.jpg", async () => {
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    try {
      const path = await downloadCover("https://i.ytimg.com/vi/abc/hqdefault.jpg", dir, "yt_abc");
      expect(path).toBe(join(dir, "yt_abc.jpg"));
      const buf = await readFile(path!);
      expect(buf.length).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null on non-OK fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    try {
      const path = await downloadCover("https://blocked/x.jpg", dir, "yt_x");
      expect(path).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("gcOldCovers", () => {
  it("keeps only the N newest files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    try {
      const fs = await import("node:fs/promises");
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(join(dir, `c${i}.jpg`), "x");
        await new Promise((r) => setTimeout(r, 5));
      }
      await gcOldCovers(dir, 2);
      const remaining = await readdir(dir);
      expect(remaining.length).toBe(2);
      expect(remaining.sort()).toEqual(["c3.jpg", "c4.jpg"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
