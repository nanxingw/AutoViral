import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfillPeaks } from "./peaks-backfill.js";

// #29 — boot backfill scans works/<id>/assets/ for audio files and generates
// missing .peaks.json, gently (1 concurrent + breath). We inject a fake
// `generate` so the test needs no ffmpeg, and breathMs:0 so it doesn't wait.

let root: string;

async function touch(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "x");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "peaks-backfill-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("backfillPeaks (#29)", () => {
  it("generates peaks for every audio asset, skipping output/ and non-audio", async () => {
    const works = join(root, "works");
    await touch(join(works, "w1", "assets", "audio", "bgm.mp3"));
    await touch(join(works, "w1", "assets", "audio", "vo.wav"));
    await touch(join(works, "w1", "assets", "images", "cover.png")); // not audio
    await touch(join(works, "w1", "assets", "output", "final.mp3")); // output/ skipped
    await touch(join(works, "w2", "assets", "music.flac"));

    const seen: string[] = [];
    const generate = vi.fn(async (p: string) => {
      seen.push(p);
    });
    await backfillPeaks(works, { generate, breathMs: 0 });

    const names = seen.map((p) => p.split("/").pop()).sort();
    expect(names).toEqual(["bgm.mp3", "music.flac", "vo.wav"]);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("is a no-op (no throw) when the works root does not exist", async () => {
    const generate = vi.fn(async () => {});
    await expect(
      backfillPeaks(join(root, "nope"), { generate, breathMs: 0 }),
    ).resolves.toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });

  it("one failing file does not abort the rest", async () => {
    const works = join(root, "works");
    await touch(join(works, "w1", "assets", "audio", "a.mp3"));
    await touch(join(works, "w1", "assets", "audio", "b.mp3"));
    await touch(join(works, "w1", "assets", "audio", "c.mp3"));

    const generate = vi.fn(async (p: string) => {
      if (p.endsWith("b.mp3")) throw new Error("ffmpeg boom");
    });
    await expect(
      backfillPeaks(works, { generate, breathMs: 0 }),
    ).resolves.toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(3); // a, b (throws), c all attempted
  });

  it("respects the concurrency limit (default 1 → never overlaps)", async () => {
    const works = join(root, "works");
    for (const n of ["a", "b", "c", "d"]) {
      await touch(join(works, "w1", "assets", "audio", `${n}.mp3`));
    }
    let inFlight = 0;
    let maxInFlight = 0;
    const generate = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    await backfillPeaks(works, { generate, breathMs: 0 }); // default concurrency 1
    expect(generate).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(1);
  });
});
