import { spawn } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AudioAnalysis {
  hasAudio: boolean;
  hasMeaningfulAudio: boolean;  // mean_volume > -40dB
  avgVolume: number;            // dB
  peakVolume: number;           // dB
  silenceRatio: number;         // 0.0-1.0
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Run an external command, collecting stdout+stderr.
 * Rejects on spawn error or timeout.
 */
function runCmd(cmd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    const chunks: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => chunks.push(d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}

// ── Main analysis ──────────────────────────────────────────────────────────

const NO_AUDIO: AudioAnalysis = {
  hasAudio: false,
  hasMeaningfulAudio: false,
  avgVolume: -Infinity,
  peakVolume: -Infinity,
  silenceRatio: 1.0,
};

/**
 * Analyse audio properties of a media file using ffprobe + ffmpeg.
 *
 * Three-step detection:
 *  1. Stream detection — does the file contain an audio stream?
 *  2. Volume detection — mean & peak volume via volumedetect filter
 *  3. Silence detection — ratio of silence (< -40 dB, min 0.3 s) to total duration
 */
export async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
  // ── Step 1: Stream detection ────────────────────────────────────────────
  const probeStreams = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    filePath,
  ]);

  if (!probeStreams.includes("audio")) {
    return { ...NO_AUDIO };
  }

  // ── Step 2: Volume detection ────────────────────────────────────────────
  const volOutput = await runCmd("ffmpeg", [
    "-i", filePath,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);

  const meanMatch = volOutput.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const maxMatch = volOutput.match(/max_volume:\s*([-\d.]+)\s*dB/);

  const avgVolume = meanMatch ? parseFloat(meanMatch[1]) : -Infinity;
  const peakVolume = maxMatch ? parseFloat(maxMatch[1]) : -Infinity;

  // ── Step 3: Silence detection ───────────────────────────────────────────
  const durationOutput = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ]);

  const totalDuration = parseFloat(durationOutput.trim()) || 0;

  let silenceRatio = 1.0;
  if (totalDuration > 0) {
    const silenceOutput = await runCmd("ffmpeg", [
      "-i", filePath,
      "-af", "silencedetect=noise=-40dB:d=0.3",
      "-f", "null",
      "-",
    ]);

    // Sum all silence_duration values
    const silenceRegex = /silence_duration:\s*([\d.]+)/g;
    let totalSilence = 0;
    let match: RegExpExecArray | null;
    while ((match = silenceRegex.exec(silenceOutput)) !== null) {
      totalSilence += parseFloat(match[1]);
    }

    silenceRatio = Math.min(totalSilence / totalDuration, 1.0);
  }

  return {
    hasAudio: true,
    hasMeaningfulAudio: avgVolume > -40,
    avgVolume,
    peakVolume,
    silenceRatio,
  };
}
