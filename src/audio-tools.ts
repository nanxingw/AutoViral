import { spawn } from "node:child_process";
import { stat, writeFile, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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
  // Final label is `t${i}` regardless of ducking — non-ducked tracks emit
  // directly with that label (see line ~236), and ducked tracks' sidechain
  // output is also labeled `t${i}` (see line ~265). The hasDucking branch
  // is preserved here in comments for documentation only.
  const finalLabels = tracks.map((_, i) => `t${i}`);
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

// ─── Phase 3.A — LUFS two-pass normalization ───────────────────────────────

export interface LoudnormOptions {
  /** Integrated-loudness target in LUFS. -14 for YouTube/TikTok/Bilibili,
   *  -16 for podcasts and 小红书/视频号. */
  target: number;
  /** True-peak ceiling in dBTP. -1.5 typical, -1.0 if downstream re-encoding
   *  is known to be lossy. */
  truePeak: number;
  /** Loudness range target. 11 is the EBU R128 default; smaller values mean
   *  more aggressive limiting. */
  lra: number;
}

export interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  output_i: string;
  output_tp: string;
  output_lra: string;
  output_thresh: string;
  normalization_type: string;
  target_offset: string;
}

/**
 * Pure helper: extract the loudnorm JSON block from ffmpeg's stderr.
 * Returns null when no loudnorm-shaped JSON block is found.
 *
 * The regex looks for a curly block containing the canonical "input_i"
 * key, which uniquely identifies a loudnorm measurement (no other ffmpeg
 * filter emits this key).
 */
export function parseLoudnormJson(stderr: string): LoudnormMeasurement | null {
  const m = stderr.match(/\{[^{}]*?"input_i"[^{}]*?\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as LoudnormMeasurement;
  } catch {
    return null;
  }
}

/**
 * Two-pass EBU R128 loudness normalization.
 *
 * Pass 1: ffmpeg measures input_i / input_tp / input_lra / input_thresh
 *         via the loudnorm filter with print_format=json to stderr.
 * Pass 2: ffmpeg applies the actual normalization with measured values
 *         pinned, ensuring the output hits the target without dynamic-range
 *         pumping. Two-pass is required for ±0.5 LU accuracy on speech.
 */
export async function normalizeLufs(
  inputPath: string,
  outputPath: string,
  opts: LoudnormOptions = { target: -14, truePeak: -1.5, lra: 11 },
): Promise<void> {
  const pass1Filter =
    `loudnorm=I=${opts.target}:LRA=${opts.lra}:tp=${opts.truePeak}:print_format=json`;
  const pass1Stderr = await runCmd(
    "ffmpeg",
    ["-i", inputPath, "-af", pass1Filter, "-f", "null", "-"],
    60_000,
  );
  const measured = parseLoudnormJson(pass1Stderr);
  if (!measured) {
    throw new Error(
      `normalizeLufs pass-1 failed: no loudnorm JSON in stderr. ` +
        `First 500 chars: ${pass1Stderr.slice(0, 500)}`,
    );
  }

  const pass2Filter = [
    `loudnorm=I=${opts.target}`,
    `LRA=${opts.lra}`,
    `tp=${opts.truePeak}`,
    `measured_I=${measured.input_i}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`,
    `measured_thresh=${measured.input_thresh}`,
    `linear=true`,
    `print_format=summary`,
  ].join(":");

  await runCmd(
    "ffmpeg",
    [
      "-i", inputPath,
      "-af", pass2Filter,
      "-c:a", "pcm_s16le",
      "-ar", "48000",
      "-y",
      outputPath,
    ],
    120_000,
  );

  const outStat = await stat(outputPath);
  if (outStat.size === 0) {
    throw new Error(
      `normalizeLufs pass-2 produced empty output (ffmpeg may have failed silently). Output: ${outputPath}`,
    );
  }
}

/**
 * Re-measure the integrated loudness of a file (for tests / verification).
 * Returns the integrated-loudness value as a number (e.g. -14.02).
 */
export async function measureLufs(filePath: string): Promise<number> {
  const stderr = await runCmd(
    "ffmpeg",
    ["-i", filePath, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
    60_000,
  );
  const m = parseLoudnormJson(stderr);
  if (!m) throw new Error(`measureLufs: no loudnorm block in stderr`);
  return parseFloat(m.input_i);
}

// ─── Phase 3.B — Subtitle burning adapter ─────────────────────────────────

const DEFAULT_FONT_PATH = join(homedir(), ".autoviral", "fonts", "NotoSansCJKsc-Regular.otf");

/**
 * Pure helper: walk a Composition's tracks and emit flat-list subtitle JSON
 * matching subtitle_burn.py's parse_json_subs() expected shape:
 *   [{ start: number, end: number, text: string }, ...]
 *
 * Returns the FIRST text track's clips, sorted by trackOffset. If the comp
 * has no text track, returns an empty array. Animations and styling are
 * dropped here — the burn renders static text per Phase 3 decision D2.
 */
export function compositionTextTrackToJson(
  comp: {
    tracks: Array<{
      kind: string;
      clips: Array<{ kind: string; text?: string; trackOffset: number; duration?: number }>;
    }>;
  },
): Array<{ start: number; end: number; text: string }> {
  const textTrack = comp.tracks.find((t) => t.kind === "text");
  if (!textTrack) return [];
  return textTrack.clips
    .filter((c) => c.kind === "text" && typeof c.text === "string")
    .slice()
    .sort((a, b) => a.trackOffset - b.trackOffset)
    .map((c) => ({
      start: c.trackOffset,
      end: c.trackOffset + (c.duration ?? 0),
      text: c.text!,
    }));
}

/**
 * Phase 3.B font guard. subtitle_burn.py's font_manager import is dead
 * code (audit §11.11), so the script silently relies on the canonical
 * font being pre-installed. Asserting here BEFORE invoking the script gives
 * a "missing font" failure with clear remediation instead of a cryptic
 * moviepy traceback.
 */
export async function assertFontInstalled(
  fontPath: string = DEFAULT_FONT_PATH,
): Promise<string> {
  try {
    const s = await stat(fontPath);
    if (!s.isFile()) {
      throw new Error(`Font path is not a file: ${fontPath}`);
    }
    return fontPath;
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Font not installed at ${fontPath} (${cause}). ` +
        `Run: python3 skills/autoviral/modules/assets/scripts/font_manager.py install ` +
        `(or set AUTOVIRAL_FONT_PATH to a TTF/OTF you have locally).`,
    );
  }
}

/**
 * Burn the composition's text track into a video by:
 *   1. Adapting comp's text-track clips to flat-list JSON
 *   2. Writing the JSON to a temp file
 *   3. Asserting the canonical font is installed
 *   4. Invoking subtitle_burn.py with the input video, JSON, output path
 *
 * Animations are lost (D2). Output codec is libx264+aac (subtitle_burn defaults).
 */
export async function burnSubtitles(opts: {
  inputVideo: string;
  comp: Parameters<typeof compositionTextTrackToJson>[0];
  outputVideo: string;
  fontPath?: string;
  style?: "modern" | "cinematic" | "bold" | "minimal" | "karaoke";
}): Promise<void> {
  const segments = compositionTextTrackToJson(opts.comp);
  if (segments.length === 0) {
    throw new Error("burnSubtitles: composition has no text-track clips to burn");
  }

  const fontPath = await assertFontInstalled(
    opts.fontPath ?? process.env.AUTOVIRAL_FONT_PATH ?? DEFAULT_FONT_PATH,
  );

  // Use os.tmpdir() so we don't depend on ~/.autoviral/ existing on a fresh
  // dev machine. mkdtemp creates a unique sub-dir whose parent (the system
  // temp dir) is guaranteed to exist.
  const tmpDir = await mkdtemp(join(tmpdir(), "autoviral-burnsubs-"));
  const segPath = join(tmpDir, "segments.json");
  await writeFile(segPath, JSON.stringify(segments), "utf-8");

  // Invoke subtitle_burn.py — flag names verified against the actual script:
  //   --video, --subs, --output, --style, --font
  await runCmd(
    "python3",
    [
      "skills/autoviral/modules/assembly/scripts/subtitle_burn.py",
      "--video", opts.inputVideo,
      "--subs", segPath,
      "--output", opts.outputVideo,
      "--style", opts.style ?? "modern",
      "--font", fontPath,
    ],
    300_000, // 5 minutes (subtitle burn is slow with moviepy)
  );

  // runCmd does not throw on non-zero exit, and moviepy can exit non-zero
  // with a partial-or-missing output. Defensive stat matches the pattern
  // used by mixAudioTracks / normalizeLufs.
  const outStat = await stat(opts.outputVideo);
  if (!outStat.isFile() || outStat.size === 0) {
    throw new Error(
      `burnSubtitles: subtitle_burn.py produced no output at ${opts.outputVideo}`,
    );
  }
}
