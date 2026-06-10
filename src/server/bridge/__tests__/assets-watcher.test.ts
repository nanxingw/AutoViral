// Watcher test — write a file into a tmp work's assets/ tree, verify the bus
// emits asset-added. fs.watch on macOS has known flakiness (events sometimes
// arrive twice or under 'rename'), and this watcher debounces bursts, so the
// assertion is "at least one event within timeout". Mirrors
// plan-watcher.test.ts.

import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  watchAssetsFor,
  _closeAllAssetsWatchers,
} from "../assets-watcher.js";
import { uiEventBus } from "../ui-events.js";

async function setupWork(workId: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "autoviral-assetswatch-"));
  await mkdir(join(root, workId, "assets", "images"), { recursive: true });
  return root;
}

function withWorksRoot(root: string, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.AUTOVIRAL_WORKS_ROOT;
  process.env.AUTOVIRAL_WORKS_ROOT = root;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prev;
  });
}

describe("assets-watcher", () => {
  afterEach(() => {
    _closeAllAssetsWatchers();
  });

  it("fires asset-added when a file lands in assets/ (nested dir, any writer)", async () => {
    const workId = "w_assetswatch_1";
    const root = await setupWork(workId);
    await withWorksRoot(root, async () => {
      const fired = new Promise<void>((resolve) => {
        const off = uiEventBus.subscribe(workId, (event) => {
          if (event.type === "asset-added") {
            off();
            resolve();
          }
        });
      });
      watchAssetsFor(workId);
      await new Promise((r) => setTimeout(r, 50));
      // Simulates an out-of-band writer (agent via Bash/python/ffmpeg) the
      // generation endpoints never see.
      await writeFile(
        join(root, workId, "assets", "images", "direct.png"),
        "png-bytes",
        "utf8",
      );
      await Promise.race([
        fired,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("no asset-added event")), 3000),
        ),
      ]);
    });
  });

  it("debounces a write burst into one event per quiet window", async () => {
    const workId = "w_assetswatch_2";
    const root = await setupWork(workId);
    await withWorksRoot(root, async () => {
      let count = 0;
      const off = uiEventBus.subscribe(workId, (event) => {
        if (event.type === "asset-added") count += 1;
      });
      try {
        watchAssetsFor(workId);
        await new Promise((r) => setTimeout(r, 50));
        // Burst: 5 rapid writes (ffmpeg-style progressive output).
        for (let i = 0; i < 5; i += 1) {
          await writeFile(
            join(root, workId, "assets", "images", "burst.png"),
            `v${i}`,
            "utf8",
          );
        }
        // Wait past the debounce window for the coalesced publish.
        await new Promise((r) => setTimeout(r, 700));
        expect(count).toBe(1);
      } finally {
        off();
      }
    });
  });

  it("ignores temp/hidden files (.tmp, dotfiles)", async () => {
    const workId = "w_assetswatch_3";
    const root = await setupWork(workId);
    await withWorksRoot(root, async () => {
      let count = 0;
      const off = uiEventBus.subscribe(workId, (event) => {
        if (event.type === "asset-added") count += 1;
      });
      try {
        watchAssetsFor(workId);
        await new Promise((r) => setTimeout(r, 50));
        await writeFile(
          join(root, workId, "assets", "images", "partial.tmp"),
          "x",
          "utf8",
        );
        await writeFile(
          join(root, workId, "assets", "images", ".DS_Store"),
          "x",
          "utf8",
        );
        await new Promise((r) => setTimeout(r, 600));
        expect(count).toBe(0);
      } finally {
        off();
      }
    });
  });

  it("is idempotent and skips a missing assets/ dir without throwing", async () => {
    const workId = "w_assetswatch_4";
    const root = await setupWork(workId);
    await withWorksRoot(root, async () => {
      watchAssetsFor(workId);
      watchAssetsFor(workId); // second call must not register a second watcher
      let count = 0;
      const off = uiEventBus.subscribe(workId, (event) => {
        if (event.type === "asset-added") count += 1;
      });
      try {
        await new Promise((r) => setTimeout(r, 50));
        await writeFile(
          join(root, workId, "assets", "images", "once.png"),
          "x",
          "utf8",
        );
        await new Promise((r) => setTimeout(r, 600));
        expect(count).toBe(1);
      } finally {
        off();
      }
      // Bogus workId (no assets/ dir) — must be a silent no-op, never a
      // throw, and must NOT create the directory (typo'd ids stay off disk).
      expect(() => watchAssetsFor("w_does_not_exist")).not.toThrow();
    });
  });
});
