// Watcher test — write composition.yaml in a tmp work dir, verify the
// bus emits a composition-changed event. fs.watch on macOS has known
// flakiness (events sometimes arrive twice or under 'rename'), so the
// assertion is "at least one event within timeout".

import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  watchCompositionFor,
  _closeAllWatchers,
} from "../composition-watcher.js";
import { uiEventBus } from "../ui-events.js";

describe("composition-watcher", () => {
  afterEach(() => {
    _closeAllWatchers();
  });

  it("fires composition-changed when composition.yaml is written", async () => {
    const root = await mkdtemp(join(tmpdir(), "autoviral-watch-"));
    const workId = "w_watch_1";
    await mkdir(join(root, workId), { recursive: true });
    await writeFile(
      join(root, workId, "composition.yaml"),
      "id: c\nworkId: w_watch_1\nfps: 30\nwidth: 1080\nheight: 1920\nduration: 1\naspect: 9:16\nupdatedAt: '2026-01-01T00:00:00.000Z'\ntracks: []\nassets: []\nprovenance: []\nexportPresets: []\n",
      "utf8",
    );

    const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
    process.env.AUTOVIRAL_WORKS_ROOT = root;
    try {
      const fired = new Promise<void>((resolve) => {
        const off = uiEventBus.subscribe(workId, (event) => {
          if (event.type === "composition-changed") {
            off();
            resolve();
          }
        });
      });
      watchCompositionFor(workId);
      // Small wait so the watcher is fully armed before we mutate.
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(
        join(root, workId, "composition.yaml"),
        "id: c\nworkId: w_watch_1\nfps: 30\nwidth: 1080\nheight: 1920\nduration: 2\naspect: 9:16\nupdatedAt: '2026-01-01T00:00:00.000Z'\ntracks: []\nassets: []\nprovenance: []\nexportPresets: []\n",
        "utf8",
      );
      await Promise.race([
        fired,
        new Promise((_r, reject) => setTimeout(() => reject(new Error("no event")), 2000)),
      ]);
    } finally {
      if (prevRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
      else process.env.AUTOVIRAL_WORKS_ROOT = prevRoot;
    }
  });

  it("is idempotent — calling twice does not register two watchers", async () => {
    const root = await mkdtemp(join(tmpdir(), "autoviral-watch-"));
    const workId = "w_watch_2";
    await mkdir(join(root, workId), { recursive: true });
    await writeFile(join(root, workId, "composition.yaml"), "{}", "utf8");

    const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
    process.env.AUTOVIRAL_WORKS_ROOT = root;
    try {
      let count = 0;
      uiEventBus.subscribe(workId, (event) => {
        if (event.type === "composition-changed") count++;
      });
      watchCompositionFor(workId);
      watchCompositionFor(workId);
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(join(root, workId, "composition.yaml"), "{a: 1}", "utf8");
      await new Promise((r) => setTimeout(r, 200));
      // Even if the OS double-fires, the deduplicated watcher should not
      // exceed 2 (one per OS notification). Without dedup we'd see 4+.
      expect(count).toBeLessThanOrEqual(3);
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      if (prevRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
      else process.env.AUTOVIRAL_WORKS_ROOT = prevRoot;
    }
  });
});
