import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

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
  avgVolume: -999,
  peakVolume: -999,
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

  const avgVolume = meanMatch ? parseFloat(meanMatch[1]) : -999;
  const peakVolume = maxMatch ? parseFloat(maxMatch[1]) : -999;

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

// ── Multi-track mixing types ──────────────────────────────────────────────

export interface MixTrack {
  source: string;           // absolute file path
  type: "original" | "bgm" | "voiceover" | "sfx";
  volume: number;           // 0.0-1.0
  delay?: number;           // seconds
  fadeIn?: number;          // seconds
  fadeOut?: number;         // seconds
  ducking?: {
    trigger: string;        // type of track that triggers ducking, e.g. "voiceover"
    ratio: number;          // compression ratio 2-8
    threshold?: number;     // 0.01-0.1, default 0.02
  };
}

export interface MixOptions {
  videoPath: string;        // absolute path to base video
  tracks: MixTrack[];
  outputPath: string;       // absolute path for output
}

// ── Multi-track audio mixing ──────────────────────────────────────────────

/**
 * Mix multiple audio tracks with volume, delay, fade, and sidechain ducking,
 * then mux with the original video (copy video codec, encode audio as AAC).
 */
export async function mixAudioTracks(opts: MixOptions): Promise<void> {
  const { videoPath, tracks, outputPath } = opts;

  if (tracks.length === 0) {
    throw new Error("mixAudioTracks: at least one track is required");
  }

  // ── Step 1: Get video duration via ffprobe ──────────────────────────────
  const durationOut = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    videoPath,
  ]);
  const totalDur = parseFloat(durationOut.trim());
  if (!totalDur || totalDur <= 0) {
    throw new Error(`mixAudioTracks: could not determine video duration for ${videoPath}`);
  }

  // ── Step 2: Build FFmpeg inputs ─────────────────────────────────────────
  // Input 0 = video file, inputs 1..N = audio tracks
  const inputs: string[] = ["-i", videoPath];
  for (const track of tracks) {
    inputs.push("-i", track.source);
  }

  // ── Step 3: Build per-track filter chains ───────────────────────────────
  // Each track gets a label [tN] (or [tN_pre] if it will be ducked later)
  const filterParts: string[] = [];

  // Track which labels need ducking and which are their triggers
  interface DuckingJob {
    trackIdx: number;        // index of the track to be ducked
    preLabel: string;        // label before ducking, e.g. "t1_pre"
    finalLabel: string;      // label after ducking, e.g. "t1"
    triggerLabel: string;    // label of the trigger track (pre-duck)
    ratio: number;
    threshold: number;
  }
  const duckingJobs: DuckingJob[] = [];

  // First pass: figure out which tracks have ducking so we can name labels
  const hasDucking = tracks.map((t) => !!t.ducking);

  // Map from track type to the index (first match) — used for ducking trigger lookup
  const typeToIdx = new Map<string, number>();
  tracks.forEach((t, i) => {
    if (!typeToIdx.has(t.type)) {
      typeToIdx.set(t.type, i);
    }
  });

  // Build the per-track filter chain
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const inputRef = `[${i + 1}:a]`; // input 0 is video, tracks start at 1
    const filters: string[] = [];

    // Volume — always present
    filters.push(`volume=${track.volume}`);

    // Delay
    if (track.delay && track.delay > 0) {
      const delayMs = Math.round(track.delay * 1000);
      filters.push(`adelay=${delayMs}|${delayMs}`);
    }

    // Fade in
    if (track.fadeIn && track.fadeIn > 0) {
      filters.push(`afade=t=in:st=0:d=${track.fadeIn}`);
    }

    // Fade out
    if (track.fadeOut && track.fadeOut > 0) {
      const fadeStart = Math.max(0, totalDur - track.fadeOut);
      filters.push(`afade=t=out:st=${fadeStart}:d=${track.fadeOut}`);
    }

    // Determine label: if this track will be ducked, use _pre suffix
    const label = hasDucking[i] ? `t${i}_pre` : `t${i}`;
    filterParts.push(`${inputRef}${filters.join(",")}[${label}]`);

    // Register ducking job if needed
    if (track.ducking) {
      const triggerIdx = typeToIdx.get(track.ducking.trigger);
      if (triggerIdx === undefined) {
        throw new Error(
          `mixAudioTracks: ducking trigger type "${track.ducking.trigger}" not found among tracks`,
        );
      }
      // The trigger track's label is its pre-duck label (which is also its
      // final label if the trigger itself isn't ducked — but we reference the
      // pre-duck label regardless since sidechaincompress needs the original signal)
      const triggerPreLabel = hasDucking[triggerIdx] ? `t${triggerIdx}_pre` : `t${triggerIdx}`;
      duckingJobs.push({
        trackIdx: i,
        preLabel: `t${i}_pre`,
        finalLabel: `t${i}`,
        triggerLabel: triggerPreLabel,
        ratio: track.ducking.ratio,
        threshold: track.ducking.threshold ?? 0.02,
      });
    }
  }

  // ── Step 4: Apply sidechain ducking ─────────────────────────────────────
  for (const job of duckingJobs) {
    filterParts.push(
      `[${job.preLabel}][${job.triggerLabel}]sidechaincompress=threshold=${job.threshold}:ratio=${job.ratio}:attack=200:release=1000[${job.finalLabel}]`,
    );
  }

  // ── Step 5: Final amix ──────────────────────────────────────────────────
  // Collect final labels for each track
  const finalLabels = tracks.map((_, i) => {
    // If ducked, use the ducked label (t{i}); otherwise use the original label
    return hasDucking[i] ? `t${i}` : `t${i}`;
  });
  const amixInputs = finalLabels.map((l) => `[${l}]`).join("");
  filterParts.push(`${amixInputs}amix=inputs=${tracks.length}:duration=first[out]`);

  const filterComplex = filterParts.join(";\n");

  // ── Step 6: Run FFmpeg ──────────────────────────────────────────────────
  const ffmpegArgs = [
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[out]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-y",
    outputPath,
  ];

  await runCmd("ffmpeg", ffmpegArgs, 5 * 60 * 1000); // 5-minute timeout

  // ── Step 7: Verify output has audio ─────────────────────────────────────
  const verifyOut = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    outputPath,
  ]);

  if (!verifyOut.includes("audio")) {
    throw new Error("mixAudioTracks: output file has no audio stream — mixing may have failed");
  }

  // Also verify the file exists and has non-zero size
  const outStat = await stat(outputPath);
  if (outStat.size === 0) {
    throw new Error("mixAudioTracks: output file is empty — mixing failed");
  }
}
