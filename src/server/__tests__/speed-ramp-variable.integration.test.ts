// S4 (PRD-0014) — variable-speed export, real ffmpeg integration.
//
// The unit-level graph/plan tests live in src/server/speed-ramp-ffmpeg.test.ts;
// this file goes the extra mile and proves the segmented setpts/atempo → concat
// pass actually produces an on-disk mp4 of the right DURATION (the whole point
// of S4 — the v1 fallback silently exported variable-speed clips at 1×).
//
// Skips the whole file when the host has no ffmpeg/ffprobe (execFile probe, not
// existsSync — S1 review lesson: probe the binary, don't guess by path).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  planSpeedSegments,
  buildVariableSpeedFilterArgs,
  buildAudioSpeedFilterArgs,
} from "../speed-ramp-ffmpeg.js";

function spawnAndCollect(
  cmd: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
  });
}

async function ffmpegOk(args: string[]): Promise<void> {
  const r = await spawnAndCollect("ffmpeg", args);
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}):\n${r.stderr}`);
}

async function probeDurationSec(path: string): Promise<number> {
  const r = await spawnAndCollect("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]);
  return parseFloat(r.stdout.trim());
}

let HAVE_FFMPEG = false;

beforeAll(async () => {
  const a = await spawnAndCollect("ffmpeg", ["-version"]);
  const b = await spawnAndCollect("ffprobe", ["-version"]);
  HAVE_FFMPEG = a.code === 0 && b.code === 0;
}, 10_000);

describe("variable-speed export — real ffmpeg integration (S4)", () => {
  let workDir = "";

  beforeAll(async () => {
    if (!HAVE_FFMPEG) return;
    workDir = await mkdtemp(join(tmpdir(), "av-speedvar-it-"));
  }, 60_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("4s clip + speed 2→1 two-segment curve → output ≈ 3s (v1 fell back to 4s)", async () => {
    if (!HAVE_FFMPEG) return;
    const src = join(workDir, "src.mp4");
    const out = join(workDir, "out.mp4");
    // 4s red 320x240 @ 30fps WITH an audio stream (the graph maps [0:a]).
    await ffmpegOk([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x240:r=30:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4:sample_rate=44100",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      src,
    ]);
    const clip = {
      in: 0,
      out: 4,
      keyframes: [
        { property: "speed" as const, time: 0, value: 2, easing: "linear" as const },
        { property: "speed" as const, time: 2, value: 1, easing: "linear" as const },
      ],
    };
    const { segments, totalTimelineDuration } = planSpeedSegments(clip, 30);
    expect(totalTimelineDuration).toBeCloseTo(3, 5);
    const args = buildVariableSpeedFilterArgs(src, out, segments, 30);
    await ffmpegOk(args);
    const dur = await probeDurationSec(out);
    // 2s@2× (1s) + 2s@1× (2s) = 3s. Allow container/encoder padding.
    expect(dur).toBeGreaterThan(2.7);
    expect(dur).toBeLessThan(3.3);
  }, 60_000);

  it("AudioClip static speed 1.5 → audio duration shrinks to 2/3", async () => {
    if (!HAVE_FFMPEG) return;
    const src = join(workDir, "aud.m4a");
    const out = join(workDir, "aud-fast.m4a");
    await ffmpegOk([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=3:sample_rate=44100",
      "-c:a",
      "aac",
      src,
    ]);
    // in=0,out=3,speed=1.5 → (3-0)/1.5 = 2s.
    const args = buildAudioSpeedFilterArgs(src, out, 0, 3, 1.5, 30);
    await ffmpegOk(args);
    const dur = await probeDurationSec(out);
    expect(dur).toBeGreaterThan(1.8);
    expect(dur).toBeLessThan(2.2);
  }, 60_000);
});
