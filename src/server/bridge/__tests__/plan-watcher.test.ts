// Watcher test — write plan/script.md in a tmp work dir, verify the bus emits a
// plan-changed event. fs.watch on macOS has known flakiness (events sometimes
// arrive twice or under 'rename'), so the assertion is "at least one event
// within timeout". Mirrors composition-watcher.test.ts.

import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  watchPlanFor,
  _closeAllPlanWatchers,
} from "../plan-watcher.js";
import { uiEventBus } from "../ui-events.js";

describe("plan-watcher", () => {
  afterEach(() => {
    _closeAllPlanWatchers();
  });

  it("fires plan-changed when plan/script.md is written externally", async () => {
    const root = await mkdtemp(join(tmpdir(), "autoviral-planwatch-"));
    const workId = "w_planwatch_1";
    await mkdir(join(root, workId, "plan"), { recursive: true });
    await writeFile(join(root, workId, "plan", "script.md"), "# v1\n", "utf8");

    const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
    process.env.AUTOVIRAL_WORKS_ROOT = root;
    try {
      const fired = new Promise<void>((resolve) => {
        const off = uiEventBus.subscribe(workId, (event) => {
          if (event.type === "plan-changed") {
            off();
            resolve();
          }
        });
      });
      watchPlanFor(workId);
      // Small wait so the watcher is fully armed before we mutate.
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(join(root, workId, "plan", "script.md"), "# v2\n", "utf8");
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
    const root = await mkdtemp(join(tmpdir(), "autoviral-planwatch-"));
    const workId = "w_planwatch_2";
    await mkdir(join(root, workId, "plan"), { recursive: true });
    await writeFile(join(root, workId, "plan", "script.md"), "a", "utf8");

    const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
    process.env.AUTOVIRAL_WORKS_ROOT = root;
    try {
      let count = 0;
      uiEventBus.subscribe(workId, (event) => {
        if (event.type === "plan-changed") count++;
      });
      watchPlanFor(workId);
      watchPlanFor(workId);
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(join(root, workId, "plan", "script.md"), "b", "utf8");
      await new Promise((r) => setTimeout(r, 200));
      expect(count).toBeLessThanOrEqual(3);
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      if (prevRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
      else process.env.AUTOVIRAL_WORKS_ROOT = prevRoot;
    }
  });

  it("does not throw when the plan/ dir does not exist yet", () => {
    const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
    process.env.AUTOVIRAL_WORKS_ROOT = join(tmpdir(), "autoviral-planwatch-missing-xyz");
    try {
      // No plan/ dir on disk — watcher must skip silently (it gets re-armed on
      // the next WS connect once the dir exists).
      expect(() => watchPlanFor("w_no_plan_dir")).not.toThrow();
    } finally {
      if (prevRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
      else process.env.AUTOVIRAL_WORKS_ROOT = prevRoot;
    }
  });

  // Review 2026-06-09 (MEDIUM): the watcher used AUTOVIRAL_WORKS_ROOT-only while
  // the REST routes resolve via AUTOVIRAL_DATA_DIR (→ <DATA_DIR>/works). On a
  // custom DATA_DIR with no WORKS_ROOT they diverged — the watcher watched the
  // wrong dir and never fired. The shared getWorksRoot() now honors DATA_DIR.
  it("resolves the works root from AUTOVIRAL_DATA_DIR when AUTOVIRAL_WORKS_ROOT is unset (route parity)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "autoviral-planwatch-datadir-"));
    const workId = "w_planwatch_datadir";
    // The routes resolve plan/ under <DATA_DIR>/works/<id>/plan — watch THAT.
    await mkdir(join(dataDir, "works", workId, "plan"), { recursive: true });
    await writeFile(join(dataDir, "works", workId, "plan", "script.md"), "# v1\n", "utf8");

    const prevRoot = process.env.AUTOVIRAL_WORKS_ROOT;
    const prevData = process.env.AUTOVIRAL_DATA_DIR;
    delete process.env.AUTOVIRAL_WORKS_ROOT; // force the DATA_DIR branch
    process.env.AUTOVIRAL_DATA_DIR = dataDir;
    try {
      const fired = new Promise<void>((resolve) => {
        const off = uiEventBus.subscribe(workId, (event) => {
          if (event.type === "plan-changed") {
            off();
            resolve();
          }
        });
      });
      watchPlanFor(workId);
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(join(dataDir, "works", workId, "plan", "script.md"), "# v2\n", "utf8");
      await Promise.race([
        fired,
        new Promise((_r, reject) => setTimeout(() => reject(new Error("no event — watcher watched the wrong root")), 2000)),
      ]);
    } finally {
      if (prevRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
      else process.env.AUTOVIRAL_WORKS_ROOT = prevRoot;
      if (prevData === undefined) delete process.env.AUTOVIRAL_DATA_DIR;
      else process.env.AUTOVIRAL_DATA_DIR = prevData;
    }
  });
});
