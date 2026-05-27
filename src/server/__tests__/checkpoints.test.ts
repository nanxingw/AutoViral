import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withTempDataDir } from "./_helpers.js";

describe("checkpoints", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("createCheckpoint snapshots existing carousel.yaml + dedupes by content sha", async () => {
    await withTempDataDir(async (dir) => {
      const { createCheckpoint, listCheckpoints } = await import("../checkpoints.js");
      const wDir = join(dir, "works", "w_test");
      await mkdir(wDir, { recursive: true });
      await writeFile(
        join(wDir, "carousel.yaml"),
        "id: c1\nworkId: w_test\nslides: []\n",
        "utf-8",
      );

      const first = await createCheckpoint("w_test");
      expect(first).toHaveLength(1);
      expect(first[0].deliverable).toBe("carousel.yaml");

      // Same content → no new snapshot.
      const second = await createCheckpoint("w_test");
      expect(second).toHaveLength(0);

      // After mutation → one new snapshot.
      await writeFile(
        join(wDir, "carousel.yaml"),
        "id: c1\nworkId: w_test\nslides: [{}]\n",
        "utf-8",
      );
      const third = await createCheckpoint("w_test");
      expect(third).toHaveLength(1);

      const list = await listCheckpoints("w_test");
      expect(list).toHaveLength(2);
      expect(list[0].file > list[1].file).toBe(true); // newest first
    });
  });

  it("returns empty list when work has no deliverables yet", async () => {
    await withTempDataDir(async (dir) => {
      const { createCheckpoint, listCheckpoints } = await import("../checkpoints.js");
      await mkdir(join(dir, "works", "w_empty"), { recursive: true });
      const out = await createCheckpoint("w_empty");
      expect(out).toEqual([]);
      const list = await listCheckpoints("w_empty");
      expect(list).toEqual([]);
    });
  });

  it("restoreCheckpoint overwrites the live deliverable", async () => {
    await withTempDataDir(async (dir) => {
      const { createCheckpoint, listCheckpoints, restoreCheckpoint } = await import(
        "../checkpoints.js"
      );
      const wDir = join(dir, "works", "w_test");
      await mkdir(wDir, { recursive: true });

      await writeFile(join(wDir, "carousel.yaml"), "v: 1\n", "utf-8");
      await createCheckpoint("w_test");

      await writeFile(join(wDir, "carousel.yaml"), "v: 2\n", "utf-8");
      const list = await listCheckpoints("w_test");
      // After 2 versions there should be 1 snapshot (only v:1 was checkpointed
      // before v:2 overwrote the live file).
      expect(list).toHaveLength(1);

      const out = await restoreCheckpoint("w_test", list[0].file);
      expect(out?.deliverable).toBe("carousel.yaml");
      const restored = await readFile(join(wDir, "carousel.yaml"), "utf-8");
      expect(restored).toBe("v: 1\n");
    });
  });

  it("restoreCheckpoint snapshots current state BEFORE overwriting it — restore is reversible (#68)", async () => {
    await withTempDataDir(async (dir) => {
      const { createCheckpoint, listCheckpoints, restoreCheckpoint } = await import(
        "../checkpoints.js"
      );
      const wDir = join(dir, "works", "w_test");
      await mkdir(wDir, { recursive: true });

      // v:1 — captured by an agent turn (createCheckpoint).
      await writeFile(join(wDir, "carousel.yaml"), "v: 1\n", "utf-8");
      await createCheckpoint("w_test");

      // v:2 — a manual edit. The autosave path writes the live yaml but does
      // NOT checkpoint, so v:2 lives ONLY in the live file (one snapshot total).
      await writeFile(join(wDir, "carousel.yaml"), "v: 2\n", "utf-8");
      const before = await listCheckpoints("w_test");
      expect(before).toHaveLength(1);

      // Restore v:1. Pre-fix this destroyed v:2 forever. Now it must first
      // snapshot the live v:2, then overwrite — so v:2 stays recoverable.
      const out = await restoreCheckpoint("w_test", before[0].file);
      expect(out?.deliverable).toBe("carousel.yaml");
      expect(out?.preRestoreSnapshot).not.toBeNull();
      expect(await readFile(join(wDir, "carousel.yaml"), "utf-8")).toBe("v: 1\n");

      // The pre-restore snapshot captured v:2 — restoring it brings v:2 back,
      // proving the restore was reversible (no data loss).
      const v2sha = out!.preRestoreSnapshot!.sha;
      const after = await listCheckpoints("w_test");
      const v2snap = after.find((c) => c.sha === v2sha);
      expect(v2snap).toBeDefined();
      await restoreCheckpoint("w_test", v2snap!.file);
      expect(await readFile(join(wDir, "carousel.yaml"), "utf-8")).toBe("v: 2\n");
    });
  });

  it("restoreCheckpoint does NOT spam a snapshot when current state is unchanged (#68 dedupe)", async () => {
    await withTempDataDir(async (dir) => {
      const { createCheckpoint, listCheckpoints, restoreCheckpoint } = await import(
        "../checkpoints.js"
      );
      const wDir = join(dir, "works", "w_test");
      await mkdir(wDir, { recursive: true });

      await writeFile(join(wDir, "carousel.yaml"), "v: 1\n", "utf-8");
      await createCheckpoint("w_test");
      const list = await listCheckpoints("w_test");
      expect(list).toHaveLength(1);

      // Live state already equals the latest snapshot → nothing pending to
      // preserve. The pre-restore snapshot dedupes to a no-op (preRestoreSnapshot
      // is null) so repeated restores don't grow the history unboundedly.
      const out = await restoreCheckpoint("w_test", list[0].file);
      expect(out?.preRestoreSnapshot).toBeNull();
      expect(await listCheckpoints("w_test")).toHaveLength(1);
    });
  });

  it("restoreCheckpoint rejects path traversal in filename", async () => {
    await withTempDataDir(async () => {
      const { restoreCheckpoint } = await import("../checkpoints.js");
      expect(await restoreCheckpoint("w_test", "../../../etc/passwd")).toBeNull();
      expect(await restoreCheckpoint("w_test", "subdir/file")).toBeNull();
      expect(await restoreCheckpoint("w_test", "..__abc__carousel.yaml")).toBeNull();
    });
  });
});
