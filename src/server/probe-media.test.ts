// PRD-0014 S6 (review finding 7) — REAL ffprobe integration for `probeMedia`.
// The route test (bridge/__tests__/routes.test.ts) mocks probeMedia entirely, so
// the actual spawn → JSON parse → duration/stream extraction → failure edges were
// never exercised. This file drives the real binary against a real generated
// mp4, a pure-audio fixture (review finding 5: an audio-only file must NOT probe
// as video), and a corrupt file. It is ffmpeg-gated: if the resolved ffmpeg /
// ffprobe binaries can't run in this environment the suite skips rather than
// fails.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { FFMPEG_BIN, FFPROBE_BIN } from "./ffmpeg-paths.js";
import { probeMedia } from "./probe-media.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "../../tests/fixtures");

function binRuns(bin: string): boolean {
  try {
    const r = spawnSync(bin, ["-version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

const FF_OK = binRuns(FFMPEG_BIN) && binRuns(FFPROBE_BIN);

describe.skipIf(!FF_OK)("probeMedia — real ffprobe integration (S6 finding 7)", () => {
  let dir: string;
  let videoPath: string;
  let corruptPath: string;
  const audioPath = join(FIXTURES, "quiet-tone.wav"); // pure-audio fixture (3s)

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "autoviral-probe-"));
    videoPath = join(dir, "gen.mp4");
    corruptPath = join(dir, "corrupt.mp4");
    // A real 2s 320x240 @ 24fps test-pattern mp4 the probe can read truthfully.
    const r = spawnSync(
      FFMPEG_BIN,
      [
        "-v", "error", "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=2:size=320x240:rate=24",
        "-pix_fmt", "yuv420p",
        videoPath,
      ],
      { stdio: "ignore" },
    );
    if (r.status !== 0) throw new Error("failed to synthesize test mp4");
    // A file with an mp4 name but garbage bytes — ffprobe must exit non-zero.
    await writeFile(corruptPath, "not a real media container at all", "utf8");
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reads a real video file's duration + dimensions + fps", async () => {
    const probe = await probeMedia(videoPath);
    expect(probe.durationSec).toBeGreaterThan(1.8);
    expect(probe.durationSec).toBeLessThan(2.4);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.fps).toBeCloseTo(24, 1);
  });

  it("REJECTS a pure-audio file — no video stream to place as a VideoClip (finding 5)", async () => {
    // The .wav has a real container duration (3s) but zero video streams; a
    // duration-only pass would wrongly register it as a video import.
    await expect(probeMedia(audioPath)).rejects.toThrow(/video stream/i);
  });

  it("REJECTS a corrupt / unreadable file (ffprobe non-zero exit)", async () => {
    await expect(probeMedia(corruptPath)).rejects.toThrow();
  });

  it("REJECTS when aborted before spawn", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(probeMedia(videoPath, ctrl.signal)).rejects.toThrow(/abort/i);
  });
});
