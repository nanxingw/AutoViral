#!/usr/bin/env node
// jitter-scan.mjs — frame-level "backward jump" forensics CLI (S1, PRD-0012).
//
// Detects periodic "seek rewinds" burned into an exported video's frame
// sequence: a frame whose diff vs the immediately-preceding frame is large
// (the picture is visibly moving) yet whose diff vs one of the previous
// 2-12 frames is near-zero (playback rewound to an earlier frame, then
// continued). This formalizes the investigation in
// docs/issues/026-export-backward-frame-jitter.md — use it both to verify a
// fix (event count should drop to 0) and as a standing regression gate.
//
// Usage:
//   node scripts/jitter-scan.mjs <video.mp4> [fps]
//
// fps defaults to 24 if omitted (only affects the reported `sec` column —
// event/frame/k detection is fps-independent).
//
// Pipeline:
//   1. ffmpeg extracts a 32x18 grayscale rawvideo dump of <video.mp4> to a
//      tmp file:
//        ffmpeg -i <video.mp4> -vf "scale=32:18,format=gray" -f rawvideo <raw>
//   2. the raw bytes are sliced into one Uint8Array per frame (32*18 = 576
//      bytes/frame).
//   3. the pure detector (src/domain/backward-jump-scan.ts, compiled to
//      dist/domain/backward-jump-scan.js by `npm run build:backend`) scans
//      the frame sequence and this script prints an event table.
//
// REQUIRES `npm run build:backend` to have run first — this script imports
// the compiled dist/ output (not the TS source) so it stays a plain Node
// script with no ts-node/tsx dependency.
//
// Examples:
//   npm run build:backend
//   node scripts/jitter-scan.mjs ~/.autoviral/works/w_.../output/final-x.mp4
//   node scripts/jitter-scan.mjs ~/.autoviral/works/w_.../assets/seedance/clip.mp4 24

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCAN_WIDTH = 32;
const SCAN_HEIGHT = 18;
const FRAME_SIZE = SCAN_WIDTH * SCAN_HEIGHT;
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

function extractGrayRaw(inputFile, rawPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      FFMPEG_BIN,
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        inputFile,
        "-vf",
        `scale=${SCAN_WIDTH}:${SCAN_HEIGHT},format=gray`,
        "-f",
        "rawvideo",
        rawPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    ff.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg extract failed (exit ${code}): ${stderr}`));
    });
    ff.on("error", reject);
  });
}

/** Slice a flat rawvideo buffer into one Uint8Array view per frame. */
function bufferToFrames(buf) {
  const n = Math.floor(buf.length / FRAME_SIZE);
  const frames = [];
  for (let i = 0; i < n; i++) {
    frames.push(
      new Uint8Array(buf.buffer, buf.byteOffset + i * FRAME_SIZE, FRAME_SIZE),
    );
  }
  return frames;
}

async function main() {
  const [, , inputFile, fpsArg] = process.argv;
  if (!inputFile) {
    console.error("usage: node scripts/jitter-scan.mjs <video.mp4> [fps]");
    process.exitCode = 1;
    return;
  }
  const fps = fpsArg ? Number(fpsArg) : 24;

  const distEntry = join(__dirname, "..", "dist", "domain", "backward-jump-scan.js");
  if (!existsSync(distEntry)) {
    console.error(
      `jitter-scan: ${distEntry} not found — run \`npm run build:backend\` first.`,
    );
    process.exitCode = 1;
    return;
  }
  const { scanBackwardJumps } = await import(distEntry);

  const dir = await mkdtemp(join(tmpdir(), "jitter-scan-"));
  const rawPath = join(dir, "frames.raw");
  try {
    await extractGrayRaw(inputFile, rawPath);
    const buf = await readFile(rawPath);
    const frames = bufferToFrames(buf);
    const events = scanBackwardJumps(frames, fps);
    console.log(`frames=${frames.length} fps=${fps} 倒跳命中=${events.length}`);
    for (const ev of events) {
      console.log(`  @${ev.sec}s 帧${ev.t} 回跳≈${ev.k}帧`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
