// S4 (PRD-0014) — variable-speed export, real ffmpeg integration.
//
// The unit-level graph/plan tests live in src/server/speed-ramp-ffmpeg.test.ts;
// this file goes the extra mile and proves the segmented setpts/atempo → concat
// pass actually produces an on-disk mp4 whose DURATION matches the PREVIEW
// (effectiveClipDuration) to within ±1 frame — the S4 acceptance the v1 fallback
// broke (it silently exported variable-speed clips at 1×).
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
  applySpeedRampPrePass,
} from "../speed-ramp-ffmpeg.js";
import { effectiveClipDuration } from "../../shared/speed-ramp.js";
import type { Composition, AudioClip } from "../../shared/composition.js";

const FPS = 30;
const kf = (time: number, value: number) => ({
  property: "speed" as const,
  time,
  value,
  easing: "linear" as const,
});

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

async function probeFormatDurationSec(path: string): Promise<number> {
  const r = await spawnAndCollect("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    path,
  ]);
  return parseFloat(r.stdout.trim());
}

// The WYSIWYG timeline duration is the VIDEO stream's PTS span, not the muxed
// container (which absorbs AAC encoder priming). setpts retimes frames without
// dropping them, so the stream duration is what a viewer sees on the timeline.
async function probeVideoStreamDurationSec(path: string): Promise<number> {
  const r = await spawnAndCollect("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=duration",
    "-of", "default=nw=1:nk=1",
    path,
  ]);
  const d = parseFloat(r.stdout.trim());
  return Number.isFinite(d) ? d : probeFormatDurationSec(path);
}

async function makeColorSrc(
  workDir: string,
  name: string,
  seconds: number,
  withAudio: boolean,
): Promise<string> {
  const src = join(workDir, name);
  const base = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=red:s=320x240:r=${FPS}:d=${seconds}`,
  ];
  const audioIn = withAudio
    ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}:sample_rate=44100`]
    : [];
  const enc = withAudio
    ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]
    : ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
  await ffmpegOk([...base, ...audioIn, ...enc, src]);
  return src;
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

  it("export video-stream duration == PREVIEW effectiveClipDuration within ±1 frame (finding 1/3)", async () => {
    if (!HAVE_FFMPEG) return;
    const src = await makeColorSrc(workDir, "src-ramp.mp4", 4, true);
    const out = join(workDir, "out-ramp.mp4");
    // The finding's canonical case: 1→2 ramp over a 4s clip. Preview ≈ 2.5s;
    // the v1 source-domain hold-left plan would have said 3s (>±1 frame).
    const clip = { in: 0, out: 4, keyframes: [kf(0, 1), kf(2, 2)] };
    const preview = effectiveClipDuration(clip); // ≈ 2.5
    const { segments, totalTimelineDuration } = planSpeedSegments(clip, FPS);

    // (a) plan matches preview to sub-frame accuracy.
    expect(Math.abs(totalTimelineDuration - preview)).toBeLessThanOrEqual(1 / FPS + 1e-9);

    // (b) ffmpeg output matches the plan/preview to ±1 frame.
    await ffmpegOk(buildVariableSpeedFilterArgs(src, out, segments, FPS));
    const dur = await probeVideoStreamDurationSec(out);
    expect(Math.abs(dur - preview)).toBeLessThanOrEqual(1 / FPS + 1e-6);
  }, 120_000);

  it("SILENT VideoClip (no audio stream) → video-only pass succeeds (finding 2)", async () => {
    if (!HAVE_FFMPEG) return;
    // A legitimately silent source: mapping [0:a] would make ffmpeg fail.
    const src = await makeColorSrc(workDir, "src-silent.mp4", 4, false);
    const out = join(workDir, "out-silent.mp4");
    const clip = { in: 0, out: 4, keyframes: [kf(0, 2), kf(2, 1)] };
    const preview = effectiveClipDuration(clip);
    const { segments } = planSpeedSegments(clip, FPS);
    // hasAudio=false → the graph must not reference [0:a]; this MUST NOT throw.
    await ffmpegOk(buildVariableSpeedFilterArgs(src, out, segments, FPS, false));
    const dur = await probeVideoStreamDurationSec(out);
    expect(Math.abs(dur - preview)).toBeLessThanOrEqual(1 / FPS + 1e-6);
  }, 120_000);

  it("extreme slow speed=0.1 → runnable atempo chain (every factor ≥0.5) (finding 5)", async () => {
    if (!HAVE_FFMPEG) return;
    // The old chain ended in atempo=0.4000, which a real ffmpeg REJECTS. A 1s
    // source at 0.1× must stretch to ~10s and, crucially, exit 0.
    const src = await makeColorSrc(workDir, "src-tenth.mp4", 1, true);
    const out = join(workDir, "out-tenth.m4a");
    const args = buildAudioSpeedFilterArgs(src, out, 0, 1, 0.1, FPS);
    const r = await spawnAndCollect("ffmpeg", args);
    expect(r.code).toBe(0); // old atempo=0.4 chain would fail here
    const dur = await probeFormatDurationSec(out);
    expect(dur).toBeGreaterThan(9);
    expect(dur).toBeLessThan(11);
  }, 120_000);

  it("AudioClip static speed 1.5 THROUGH applySpeedRampPrePass → rewritten + shrunk (finding 4)", async () => {
    if (!HAVE_FFMPEG) return;
    const src = join(workDir, "aud.m4a");
    await ffmpegOk([
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=44100",
      "-c:a", "aac", src,
    ]);

    // Drive the ACTUAL wired pre-pass on a full composition — not the arg
    // builder in isolation. This proves applySpeedRampPrePass rewrites the
    // AudioClip (src → cache, in/out reset, speed keyframe stripped), which the
    // old direct-builder test could not (it was born green — finding 4).
    const comp = {
      id: "c", workId: "w", fps: FPS, width: 1080, height: 1920,
      tracks: [
        {
          id: "aud", kind: "audio", label: "VO",
          muted: false, hidden: false, volume: 0, displayOrder: 0,
          clips: [
            {
              id: "a1", kind: "audio", src, in: 0, out: 3, trackOffset: 0,
              keyframes: [kf(0, 1.5)],
            },
          ],
        },
      ],
      assets: [], provenance: [], exportPresets: [],
    } as unknown as Composition;

    const result = await applySpeedRampPrePass(comp, workDir);
    const outClip = result.tracks[0].clips[0] as AudioClip;

    // Rewrite contract (the external behaviour the export path depends on):
    expect(outClip.src).not.toBe(src);
    expect(outClip.src).toContain("speedaud");
    expect(outClip.in).toBe(0);
    expect(outClip.out).toBeCloseTo(2, 5); // (3-0)/1.5
    expect(
      (outClip.keyframes ?? []).some((k) => k.property === "speed"),
    ).toBe(false); // speed kf stripped so Remotion won't double-apply

    // And the baked cache really is ~2/3 the length.
    const dur = await probeFormatDurationSec(outClip.src);
    expect(dur).toBeGreaterThan(1.8);
    expect(dur).toBeLessThan(2.25);
  }, 120_000);
});
