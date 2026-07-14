// PRD-0014 S11 (review finding 5) — the "snapshot 集成（可跳过）" deliverable the
// slice promised: REALLY render a fixture composition's frame 30 through the
// single-frame `remotion-still` path and verify the produced file is a genuine
// PNG (magic bytes), not just a string path a mock invented.
//
// This is heavy (spins up a Remotion bundle + headless Chromium), so it is
// GATED behind AUTOVIRAL_SNAPSHOT_INTEGRATION=1 — same discipline as the other
// binary-gated integration suites (probe-media = ffmpeg-gated, transitions =
// ffmpeg-gated). It skips by default so the standard `test:server` run stays
// fast and green; a capable runner opts in to actually exercise the render.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCompositionStill } from "../remotion-still.js";

const RUN = process.env.AUTOVIRAL_SNAPSHOT_INTEGRATION === "1";

// PNG signature: 89 50 4E 47 0D 0A 1A 0A ("\x89PNG\r\n\x1a\n").
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe.skipIf(!RUN)(
  "render snapshot --frame — real single-frame PNG (S11 finding 5)",
  () => {
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "autoviral-snap-"));
    });

    afterAll(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("renders frame 30 of a fixture composition to a valid PNG", async () => {
      // 4s @ 30fps = 120 frames → frame 30 is well inside range.
      const comp = {
        id: "c",
        workId: "w-int",
        fps: 30,
        width: 1080,
        height: 1920,
        duration: 4,
        aspect: "9:16",
        updatedAt: "2026-07-14T00:00:00Z",
        tracks: [],
        assets: [],
        provenance: [],
        exportPresets: [],
        title: "snapshot-integration",
      };
      const outFile = join(dir, "snapshot-frame-30.png");
      const produced = await renderCompositionStill(comp as any, {
        outFile,
        frame: 30,
      });
      expect(produced).toBe(outFile);
      const head = (await readFile(outFile)).subarray(0, 8);
      expect(head.equals(PNG_MAGIC)).toBe(true);
    }, 180_000);
  },
);
