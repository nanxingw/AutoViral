// src/server/audio/peaks.ts
//
// Server-side audio waveform peaks generator. Mirrors BBC `audiowaveform`
// industry standard (Peaks.js v2 JSON), but implemented over the project's
// existing ffmpeg dependency so there's no extra binary to install.
//
// Output: sibling `<srcPath>.peaks.json` with shape
//   { version: 2, channels: number[][], bucketCount, durationSec,
//     sampleRate, bucketsPerSec }
//
// channels[c][i] ∈ [0, 1] is the normalised peak amplitude in bucket i of
// channel c. Per-channel (not Shotcut-style summed) so future UI can show
// L/R asymmetry or implement per-channel ducking without re-encoding the
// peaks file. See research notes 2026-05-25 (BBC audiowaveform + pitfall #3).
//
// Bucket count: duration-scaled (~32 buckets/sec) bounded to [128, 8192]
// — matches the frontend useWaveform.ts heuristic so a fetch'd file slots
// into the existing render path without rescaling.
//
// Idempotent: skip generation if peaks file exists AND is newer than src.
// Force re-generation with { force: true }.

import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";

export interface PeaksFileV2 {
  version: 2;
  channels: number[][];
  bucketCount: number;
  durationSec: number;
  sampleRate: number;
  bucketsPerSec: number;
}

const BUCKETS_PER_SEC = 32;
const MIN_BUCKETS = 128;
const MAX_BUCKETS = 8192;
// 8 kHz is fine: target bucket span ≥ 8000/32 = 250 samples → solid max-abs
// peak granularity, ~4× smaller pcm buffer than 22050 Hz for long beds.
const DECODE_SAMPLE_RATE = 8000;

interface ProbeResult {
  durationSec: number;
  sampleRate: number;
  channels: number;
}

function probeAudio(srcPath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=sample_rate,channels:format=duration",
      "-of", "json",
      srcPath,
    ]);
    const chunks: Buffer[] = [];
    let errBuf = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => { errBuf += d.toString("utf-8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (exit ${code}) for ${srcPath}: ${errBuf}`));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        const stream = parsed.streams?.[0] ?? {};
        const fmt = parsed.format ?? {};
        resolve({
          durationSec: parseFloat(fmt.duration ?? "0"),
          sampleRate: parseInt(stream.sample_rate ?? "0", 10),
          channels: parseInt(stream.channels ?? "1", 10),
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

function decodePcm(
  srcPath: string,
  channels: number,
  sampleRate: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-v", "error",
      "-i", srcPath,
      "-ac", String(channels),
      "-ar", String(sampleRate),
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-",
    ]);
    const chunks: Buffer[] = [];
    let errBuf = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => { errBuf += d.toString("utf-8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg pcm decode failed (exit ${code}) for ${srcPath}: ${errBuf}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function bucketChannel(samples: Int16Array, bucketCount: number): number[] {
  const samplesPerBucket = Math.max(1, Math.floor(samples.length / bucketCount));
  const peaks = new Array<number>(bucketCount).fill(0);
  for (let i = 0; i < bucketCount; i++) {
    let max = 0;
    const start = i * samplesPerBucket;
    const end = Math.min(samples.length, start + samplesPerBucket);
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

function normalise(arr: number[]): number[] {
  let max = 1; // floor avoids div-by-zero on dead-silent clips
  for (const v of arr) if (v > max) max = v;
  return arr.map((v) => Math.min(1, v / max));
}

export interface GeneratePeaksOptions {
  /** Re-generate even if peaks file is newer than source. */
  force?: boolean;
}

/**
 * Compute per-channel peaks for an audio file and write
 * `<srcPath>.peaks.json` (Peaks.js v2 JSON shape).
 *
 * Returns the peaks file path. Idempotent unless `force: true`.
 */
export async function generatePeaks(
  srcPath: string,
  opts: GeneratePeaksOptions = {},
): Promise<string> {
  const peaksPath = `${srcPath}.peaks.json`;

  if (!opts.force) {
    try {
      const [srcStat, peaksStat] = await Promise.all([
        stat(srcPath),
        stat(peaksPath),
      ]);
      if (peaksStat.mtimeMs >= srcStat.mtimeMs) return peaksPath;
    } catch {
      // peaks file missing → fall through and generate
    }
  }

  const probe = await probeAudio(srcPath);
  if (probe.durationSec <= 0 || probe.channels <= 0) {
    throw new Error(
      `peaks: invalid probe for ${srcPath}: ${JSON.stringify(probe)}`,
    );
  }

  const channelCount = Math.max(1, probe.channels);
  const pcm = await decodePcm(srcPath, channelCount, DECODE_SAMPLE_RATE);

  // s16le interleaved → per-channel Int16 deinterleave.
  const totalSamples = Math.floor(pcm.length / 2);
  const samplesPerChannel = Math.floor(totalSamples / channelCount);
  const interleaved = new Int16Array(pcm.buffer, pcm.byteOffset, totalSamples);

  const bucketCount = Math.min(
    MAX_BUCKETS,
    Math.max(MIN_BUCKETS, Math.ceil(probe.durationSec * BUCKETS_PER_SEC)),
  );

  const channels: number[][] = [];
  for (let c = 0; c < channelCount; c++) {
    const ch = new Int16Array(samplesPerChannel);
    for (let i = 0; i < samplesPerChannel; i++) {
      ch[i] = interleaved[i * channelCount + c];
    }
    channels.push(normalise(bucketChannel(ch, bucketCount)));
  }

  const out: PeaksFileV2 = {
    version: 2,
    channels,
    bucketCount,
    durationSec: probe.durationSec,
    sampleRate: probe.sampleRate,
    bucketsPerSec: BUCKETS_PER_SEC,
  };

  await writeFile(peaksPath, JSON.stringify(out), "utf-8");
  return peaksPath;
}

const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"]);

/** True if the path looks like an audio asset we should pre-compute peaks for. */
export function isAudioAsset(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return AUDIO_EXTS.has(filePath.slice(dot).toLowerCase());
}
