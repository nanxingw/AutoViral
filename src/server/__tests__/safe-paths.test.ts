import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveAssetPath, resolveAssetFile, resolveAssetSubpath, ASSET_ROOTS, getWorksRoot, UnsafePathError } from "../safe-paths.js";
import { withTempDataDir } from "./_helpers.js";

describe("safe-paths", () => {
  // Review 2026-06-09 — the shared works-root resolver. File watchers MUST use
  // this so they never diverge from the routes (which resolve via DATA_DIR).
  describe("getWorksRoot (single source of truth for watchers + routes)", () => {
    it("prefers an explicit AUTOVIRAL_WORKS_ROOT", () => {
      const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
      const prevData = process.env.AUTOVIRAL_DATA_DIR;
      process.env.AUTOVIRAL_WORKS_ROOT = "/explicit/works";
      process.env.AUTOVIRAL_DATA_DIR = "/some/data";
      try {
        expect(getWorksRoot()).toBe("/explicit/works");
      } finally {
        if (prevRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
        else process.env.AUTOVIRAL_WORKS_ROOT = prevRoot;
        if (prevData === undefined) delete process.env.AUTOVIRAL_DATA_DIR;
        else process.env.AUTOVIRAL_DATA_DIR = prevData;
      }
    });

    it("falls back to <AUTOVIRAL_DATA_DIR>/works when WORKS_ROOT is unset (route parity)", () => {
      const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
      const prevData = process.env.AUTOVIRAL_DATA_DIR;
      delete process.env.AUTOVIRAL_WORKS_ROOT;
      process.env.AUTOVIRAL_DATA_DIR = "/some/data";
      try {
        expect(getWorksRoot()).toBe(join("/some/data", "works"));
      } finally {
        if (prevRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
        else process.env.AUTOVIRAL_WORKS_ROOT = prevRoot;
        if (prevData === undefined) delete process.env.AUTOVIRAL_DATA_DIR;
        else process.env.AUTOVIRAL_DATA_DIR = prevData;
      }
    });
  });

  describe("plan root (S5 — script.md lives under plan/)", () => {
    it("includes 'plan' in ASSET_ROOTS", () => {
      expect(ASSET_ROOTS).toContain("plan");
    });

    it("resolves a safe basename under plan/", async () => {
      await withTempDataDir(async (dir) => {
        const r = resolveAssetFile("w_test", "plan", "script.md");
        expect(r.startsWith(dir)).toBe(true);
        expect(r.endsWith("/works/w_test/plan/script.md")).toBe(true);
      });
    });

    it("rejects ../ traversal out of plan/", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetPath("w_test", "plan", "../../etc/passwd")).toThrow(UnsafePathError);
        expect(() => resolveAssetPath("w_test", "plan", "../composition.yaml")).toThrow(UnsafePathError);
      });
    });

    it("rejects absolute paths under plan/", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetPath("w_test", "plan", "/etc/passwd")).toThrow(UnsafePathError);
      });
    });

    it("rejects a basename with path separators under plan/", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetFile("w_test", "plan", "sub/script.md")).toThrow(UnsafePathError);
        expect(() => resolveAssetFile("w_test", "plan", "..")).toThrow(UnsafePathError);
      });
    });
  });

  describe("resolveAssetPath", () => {
    it("resolves a normal nested path under assets/", async () => {
      await withTempDataDir(async (dir) => {
        const result = resolveAssetPath("w_test", "assets", "images/foo.png");
        expect(result.startsWith(dir)).toBe(true);
        expect(result.endsWith("/works/w_test/assets/images/foo.png")).toBe(true);
      });
    });

    it("rejects ../ traversal", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetPath("w_test", "assets", "../../etc/passwd")).toThrow(UnsafePathError);
        expect(() => resolveAssetPath("w_test", "assets", "images/../../etc/passwd")).toThrow(UnsafePathError);
      });
    });

    it("rejects absolute paths", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetPath("w_test", "assets", "/etc/passwd")).toThrow(UnsafePathError);
      });
    });

    it("rejects backslash traversal (Windows-style)", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetPath("w_test", "assets", "..\\..\\etc")).toThrow(UnsafePathError);
      });
    });

    it("rejects unsafe workId", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetPath("../escape", "assets", "x.png")).toThrow(UnsafePathError);
        expect(() => resolveAssetPath("w/two", "assets", "x.png")).toThrow(UnsafePathError);
      });
    });

    it("rejects non-asset roots (e.g., trying to read work.yaml or chat.json)", async () => {
      await withTempDataDir(async () => {
        // Even via legitimate-looking subpath, only assets/ and output/ are allowed
        expect(() => resolveAssetPath("w_test", "chat" as any, "json")).toThrow(UnsafePathError);
        expect(() => resolveAssetPath("w_test", "" as any, "work.yaml")).toThrow(UnsafePathError);
      });
    });
  });

  describe("resolveAssetFile (basename only)", () => {
    it("accepts simple basenames", async () => {
      await withTempDataDir(async () => {
        const r = resolveAssetFile("w_test", "output", "final.mp4");
        expect(r.endsWith("/works/w_test/output/final.mp4")).toBe(true);
      });
    });

    it("rejects basenames containing slashes", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetFile("w_test", "output", "sub/file.mp4")).toThrow(UnsafePathError);
        expect(() => resolveAssetFile("w_test", "output", "..")).toThrow(UnsafePathError);
      });
    });
  });

  describe("resolveAssetSubpath (subdir + basename)", () => {
    it("combines subdir and basename safely", async () => {
      await withTempDataDir(async () => {
        const r = resolveAssetSubpath("w_test", "assets", "images", "cover.png");
        expect(r.endsWith("/works/w_test/assets/images/cover.png")).toBe(true);
      });
    });

    it("rejects traversal in subdir", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetSubpath("w_test", "assets", "../escape", "x.png")).toThrow(UnsafePathError);
      });
    });

    it("rejects path separators in basename", async () => {
      await withTempDataDir(async () => {
        expect(() => resolveAssetSubpath("w_test", "assets", "images", "x/y.png")).toThrow(UnsafePathError);
      });
    });
  });
});
