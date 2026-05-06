// src/server/clip-index.test.ts
//
// Phase 8.1.B — unit tests for the clip-index bridge module.
// Mocks `runPythonScript` so no Python is actually spawned.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

vi.mock("./python-bridge.js", () => ({ runPythonScript: vi.fn() }));

import { runPythonScript } from "./python-bridge.js";

const _runPython = runPythonScript as unknown as ReturnType<typeof vi.fn>;

let dataDir: string;

beforeEach(() => {
  _runPython.mockReset();
  vi.resetModules();
  if (dataDir) {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  dataDir = mkdtempSync(join(tmpdir(), "av-clip-"));
  process.env.AUTOVIRAL_DATA_DIR = dataDir;
});

async function setupAssets(workId: string, files: string[]): Promise<void> {
  const baseDir = join(dataDir, "works", workId);
  await mkdir(join(baseDir, "assets"), { recursive: true });
  for (const f of files) {
    const full = join(baseDir, f);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, "fake-bytes");
  }
}

describe("buildClipIndex", () => {
  it("invokes build_index.py with the expected args + 5-min timeout", async () => {
    const { buildClipIndex } = await import("./clip-index.js");
    await setupAssets("work-abc", [
      "assets/clips/intro.mp4",
      "assets/images/cover.png",
    ]);
    _runPython.mockResolvedValueOnce({
      ok: true,
      stub: false,
      assetCount: 2,
      model: "ViT-B-32",
      indexedAt: "2026-05-06T00:00:00Z",
      durationMs: 1234,
    });

    const result = await buildClipIndex("work-abc");

    expect(result.ok).toBe(true);
    expect(_runPython).toHaveBeenCalledTimes(1);
    const [scriptPath, args, opts] = _runPython.mock.calls[0];
    expect(scriptPath).toMatch(/build_index\.py$/);
    expect(args).toEqual(expect.arrayContaining(["--work-id", "work-abc"]));
    expect(args).toEqual(expect.arrayContaining(["--asset-list", expect.stringContaining(".json")]));
    expect(args).toEqual(expect.arrayContaining(["--out-dir"]));
    expect(opts).toMatchObject({ timeoutMs: 300_000 });
  });

  it("propagates stub response unchanged", async () => {
    const { buildClipIndex } = await import("./clip-index.js");
    await setupAssets("work-abc", ["assets/images/cover.png"]);
    _runPython.mockResolvedValueOnce({
      stub: true,
      reason: "open_clip_torch not installed",
    });

    const result = await buildClipIndex("work-abc");
    expect(result.stub).toBe(true);
    expect(result.reason).toMatch(/open_clip/);
  });

  it("rejects an unsafe workId before invoking python", async () => {
    const { buildClipIndex } = await import("./clip-index.js");
    await expect(buildClipIndex("../../etc")).rejects.toThrow(/[Ii]nvalid/);
    expect(_runPython).not.toHaveBeenCalled();
  });

  it("short-circuits to stub when no indexable assets exist (D10)", async () => {
    const { buildClipIndex } = await import("./clip-index.js");
    await setupAssets("work-empty", ["assets/notes/script.txt"]);
    const result = await buildClipIndex("work-empty");
    expect(result.stub).toBe(true);
    expect(result.reason).toBe("no_indexable_assets");
    expect(_runPython).not.toHaveBeenCalled();
  });

  it("filters non-image/non-video assets out of the temp asset list", async () => {
    const { buildClipIndex } = await import("./clip-index.js");
    await setupAssets("work-mix", [
      "assets/clips/intro.mp4",
      "assets/audio/track.mp3",
      "assets/images/cover.png",
      "assets/notes/script.txt",
    ]);
    let capturedList: Array<{ kind: string }> | null = null;
    _runPython.mockImplementationOnce(async (_script: string, args: string[]) => {
      const listIdx = args.indexOf("--asset-list");
      const tmpPath = args[listIdx + 1];
      const { readFile } = await import("node:fs/promises");
      capturedList = JSON.parse(await readFile(tmpPath, "utf-8"));
      return {
        ok: true, stub: false, assetCount: 2, model: "ViT-B-32",
        indexedAt: "2026-05-06T00:00:00Z", durationMs: 100,
      };
    });

    await buildClipIndex("work-mix");
    expect(capturedList).not.toBeNull();
    expect((capturedList as unknown as Array<{ kind: string }>).map(a => a.kind).sort()).toEqual(["image", "video"]);
  });
});

describe("searchClipIndex", () => {
  it("invokes search.py with the expected args + 30s timeout", async () => {
    const { searchClipIndex } = await import("./clip-index.js");
    _runPython.mockResolvedValueOnce({
      stub: false,
      results: [
        { uri: "assets/images/panda.png", kind: "image", score: 0.42 },
      ],
      searchMs: 87,
    });

    const result = await searchClipIndex("work-abc", "panda", 5);

    expect(result.stub).toBe(false);
    expect(_runPython).toHaveBeenCalledTimes(1);
    const [scriptPath, args, opts] = _runPython.mock.calls[0];
    expect(scriptPath).toMatch(/search\.py$/);
    expect(args).toEqual(expect.arrayContaining(["--work-id", "work-abc"]));
    expect(args).toEqual(expect.arrayContaining(["--query", "panda"]));
    expect(args).toEqual(expect.arrayContaining(["--top-k", "5"]));
    expect(args).toEqual(expect.arrayContaining(["--index-dir"]));
    expect(opts).toMatchObject({ timeoutMs: 30_000 });
  });

  it("rejects unsafe workId", async () => {
    const { searchClipIndex } = await import("./clip-index.js");
    await expect(searchClipIndex("../../bad", "x", 5)).rejects.toThrow(/[Ii]nvalid/);
    expect(_runPython).not.toHaveBeenCalled();
  });

  it("propagates stub response unchanged", async () => {
    const { searchClipIndex } = await import("./clip-index.js");
    _runPython.mockResolvedValueOnce({
      stub: true,
      reason: "no_index",
    });
    const result = await searchClipIndex("work-abc", "panda", 20);
    expect(result.stub).toBe(true);
    expect(result.reason).toBe("no_index");
  });
});

describe("clipIndexDir", () => {
  it("derives per-work paths under AUTOVIRAL_DATA_DIR", async () => {
    const { clipIndexDir } = await import("./clip-index.js");
    expect(clipIndexDir("work-A")).toMatch(/works\/work-A\/clip-index$/);
    expect(clipIndexDir("work-B")).toMatch(/works\/work-B\/clip-index$/);
    expect(clipIndexDir("work-A")).not.toEqual(clipIndexDir("work-B"));
  });
});
