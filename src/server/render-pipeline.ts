// src/server/render-pipeline.ts

import { renderCompositionToMp4 } from "./remotion-renderer.js";
import { applySpeedRampPrePass } from "./speed-ramp-ffmpeg.js";
import { pickEncoder } from "./render/gpu-encoder.js";
import {
  mixAudioTracks,
  normalizeLufs,
  burnSubtitles,
  compositionTextTrackToJson,
  type MixTrack,
} from "../audio-tools.js";
import { join } from "node:path";
import { rename, stat as fsStat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { Composition, ExportPreset } from "../shared/composition.js";

/**
 * Returns true iff `inputPath` has an audio stream AND that stream is not
 * effectively silent. Remotion auto-fills a silent audio track during
 * render, so a naive "has audio stream?" probe always returns true. Run
 * ffmpeg's volumedetect to read max_volume — `-inf` (or extremely low)
 * means silent, and the loudnorm pass-2 filter aborts on silent input
 * without writing the output file (which surfaces later as ENOENT).
 *
 * Returns false on probe failure: skipping loudnorm on a borderline file
 * is better than throwing the whole render away.
 */
async function hasMeaningfulAudio(inputPath: string): Promise<boolean> {
  // If the file isn't on disk we have nothing to probe. Return true so the
  // caller proceeds to normalizeLufs and surfaces the real problem there,
  // rather than silently swallowing a missing-file bug behind a "no audio"
  // skip. This also keeps unit tests that mock the renderer (returning a
  // fake path that never lands on disk) on the same path as before.
  try {
    await fsStat(inputPath);
  } catch {
    return true;
  }
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", [
      "-hide_banner",
      "-i", inputPath,
      "-af", "volumedetect",
      "-vn",
      "-f", "null",
      "-",
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", () => {
      if (!/Stream #\d+:\d+.*Audio/.test(stderr)) return resolve(false);
      const m = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?|-inf)\s*dB/);
      if (!m) return resolve(true); // probe inconclusive — try loudnorm anyway
      if (m[1] === "-inf") return resolve(false);
      const max = parseFloat(m[1]);
      if (!Number.isFinite(max)) return resolve(false);
      return resolve(max > -60); // > -60 dBFS counts as "real" signal
    });
    proc.on("error", () => resolve(false));
  });
}

/**
 * Composition.yaml stores `clip.src` as workspace-relative paths
 * (e.g. "assets/videos/test.mp4") so the file is portable. Remotion's
 * compositor on the other hand 404s on relative URLs and refuses
 * file:// URLs (`@remotion/renderer` only accepts http/https). Rewrite
 * relative paths to the local server's `/api/works/:id/assets/...`
 * route, which is already wired for browser preview. URLs with an
 * existing scheme (http://, https://, data:, blob:) pass through.
 */
function rewriteClipSrcsToAbsolute(comp: Composition): Composition {
  const SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
  const port = process.env.AUTOVIRAL_PORT ?? "3271";
  const baseUrl = `http://localhost:${port}/api/works/${comp.workId}`;
  const resolveOne = (src: string): string => {
    if (!src || SCHEME.test(src)) return src;
    // Server route already prefixes "assets/", so we only need the suffix.
    const trimmed = src.startsWith("assets/") ? src.slice("assets/".length) : src;
    const segments = trimmed.split("/").map(encodeURIComponent).join("/");
    return `${baseUrl}/assets/${segments}`;
  };
  return {
    ...comp,
    tracks: comp.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.kind === "text") return c;
        const src = (c as { src?: string }).src;
        if (typeof src !== "string") return c;
        return { ...c, src: resolveOne(src) } as typeof c;
      }),
    })),
  };
}

export type RenderStage = "render" | "duck" | "loudnorm" | "burn" | "encode";

export interface RenderJobOptions {
  comp: Composition;
  outDir: string;
  /** When true, burn TextTrack clips into the video (animations frozen).
   *  Default false — soft-sub via Remotion <Text> remains. */
  burnSubtitles?: boolean;
  /** Override the loudness target. Default -14 (YouTube/抖音/TikTok). */
  loudnessTargetLufs?: number;
  /** Override the title used in the output filename. Defaults to
   *  "autoviral-export" via buildSafeOutputFilename when undefined. */
  outputTitle?: string;
  /** Hook for the render queue / API client to surface progress. */
  onProgress?: (stage: RenderStage, pct: number) => void;
  /** Phase 7.A — abort the in-flight pipeline. Wired into spawn() processes. */
  signal?: AbortSignal;
  /** Phase 7.C — half-res / 24fps / half-bitrate proxy render. */
  proxy?: boolean;
}

/** Round n/2 down to the nearest even integer (libx264 yuv420p requires even dims). */
function evenHalf(n: number): number {
  return Math.max(2, Math.floor(n / 2 / 2) * 2);
}

/**
 * Phase 7.C — produce a deep-clone of `comp` with half-resolution (rounded
 * to even ints), fps clamped to 24, and any export presets' videoBitrate
 * halved. Audio bitrate is intentionally preserved for review-quality audio.
 * Never mutates the input.
 */
function applyProxy(comp: Composition): Composition {
  // Composition.fps is a literal union (24|25|30|60); proxy always lands at 24
  // when the source is >= 24, otherwise we keep the original literal.
  const proxyFps: Composition["fps"] = comp.fps >= 24 ? 24 : comp.fps;
  const presets = (comp.exportPresets ?? []).map((p) => ({
    ...p,
    width: evenHalf(p.width),
    height: evenHalf(p.height),
    fps: Math.min(p.fps, 24),
    videoBitrate: Math.max(500, Math.round(p.videoBitrate / 2)),
  }));
  return {
    ...comp,
    width: evenHalf(comp.width),
    height: evenHalf(comp.height),
    fps: proxyFps,
    exportPresets: presets,
  };
}

/**
 * Adapts AudioClip ducking to mixAudioTracks' MixTrack contract.
 *
 * For each AudioClip with `ducking`, emits a MixTrack with the same
 * `type` discriminator and a ducking config whose `trigger` is hard-coded
 * to "voiceover" — when a voiceover clip exists, all bgm/sfx/original
 * clips that have ducking configs duck to it. AudioClip.ducking has
 * extra fields (attack, release) that MixTrack doesn't model; only
 * ratio is forwarded. Phase 6 will widen this when MixTrack grows.
 */
function compositionToMixTracks(comp: Composition): MixTrack[] {
  const tracks: MixTrack[] = [];
  const allAudioClips = comp.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips.filter((c) => c.kind === "audio") as any[]);

  const hasVoiceover = allAudioClips.some((c) => c.type === "voiceover");

  for (const clip of allAudioClips) {
    const mt: MixTrack = {
      source: clip.src,
      type: clip.type ?? "bgm",
      volume: clip.volume ?? 1,
      delay: clip.trackOffset,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
    };
    if (clip.ducking && hasVoiceover && clip.type !== "voiceover") {
      mt.ducking = {
        trigger: "voiceover",
        ratio: clip.ducking.ratio,
      };
    }
    tracks.push(mt);
  }
  return tracks;
}

// R46 — software-codec fallbacks. Kept for backwards compat with any
// caller that imports CODEC_MAP directly; the active path now goes
// through pickEncoder() which probes for hardware accel and translates
// the preset vocabulary so we don't crash NVENC with "medium".
const CODEC_MAP: Record<"h264" | "h265" | "vp9" | "av1", string> = {
  h264: "libx264",
  h265: "libx265",
  vp9: "libvpx-vp9",
  av1: "libaom-av1",
};

/**
 * Phase 6.E — re-encode `input` to `output` using `preset` for codec /
 * bitrate / audio settings. Loudnorm runs upstream (stage 4); this stage
 * only honours codec + bitrate flags, plus a faststart container hint
 * for web seek.
 *
 * R46: hardware encoder auto-detection. Was hard-coded to libx264 (CPU
 * software encoder); now probes ffmpeg -encoders once and prefers
 * h264_nvenc / h264_videotoolbox / h264_vaapi / h264_qsv. macOS Apple
 * Silicon now uses VideoToolbox = ~2-4× faster on the same h264 baseline.
 */
export async function runEncodeStage(
  input: string,
  output: string,
  preset: ExportPreset,
  signal?: AbortSignal,
): Promise<void> {
  const choice = await pickEncoder(preset.codec, "medium");
  const args = [
    "-y", "-loglevel", "error",
    "-i", input,
    "-c:v", choice.codec,
    ...choice.presetArgs,
    ...choice.extraArgs,
    "-b:v", `${preset.videoBitrate}k`,
    "-c:a", "aac",
    "-b:a", `${preset.audioBitrate}k`,
    "-movflags", "+faststart",
    output,
  ];
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("runEncodeStage: aborted before spawn"));
      return;
    }
    const child = spawn("ffmpeg", args);
    let stderr = "";
    child.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code: number | null) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error("runEncodeStage: aborted"));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`runEncodeStage: ffmpeg exit ${code}\n${stderr}`));
      }
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

export async function runRenderPipeline(opts: RenderJobOptions): Promise<string> {
  // Phase 7.C — apply proxy transform (deep-clone, never mutates caller's comp).
  const compProxy = opts.proxy ? applyProxy(opts.comp) : opts.comp;
  const target = opts.loudnessTargetLufs ?? -14;
  const onP = opts.onProgress ?? (() => undefined);
  const checkAbort = () => {
    if (opts.signal?.aborted) {
      throw new Error("runRenderPipeline: aborted");
    }
  };

  // Stage 0 (Phase 8.3.E) — speed-ramp pre-pass for static-speed VideoClips.
  // For each video clip with a static, non-1 speed (D6) we run an ffmpeg
  // setpts/atempo invocation that resamples the source MP4 *before* Remotion
  // ever sees it, rewriting clip.src to the cached output. Variable-speed
  // clips emit a console warning and fall back to 1× export (deferred to
  // Phase 8.3.5). Pre-Remotion lives upstream of every other stage so that
  // ducking / loudnorm / encode all see the resampled audio + video.
  checkAbort();
  const comp = await applySpeedRampPrePass(
    compProxy,
    opts.outDir,
    opts.signal,
  );
  checkAbort();

  // Stage 1: Remotion render
  // TODO(phase-7): renderCompositionToMp4 does not yet accept an AbortSignal;
  // we check between stages so cancellation takes effect at the next boundary.
  checkAbort();
  onP("render", 0);
  const compForRender = rewriteClipSrcsToAbsolute(
    { ...comp, title: opts.outputTitle } as Composition,
  );
  let workingPath = await renderCompositionToMp4(
    compForRender,
    opts.outDir,
  );
  onP("render", 1);
  checkAbort();

  // Stage 2: ducking (optional, only if any audio clip has ducking)
  const audioClips = comp.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips as any[]);
  const needsDucking = audioClips.some((c) => c.ducking);
  if (needsDucking) {
    onP("duck", 0);
    const ducked = workingPath.replace(/\.mp4$/, "-ducked.mp4");
    await mixAudioTracks({
      videoPath: workingPath,
      tracks: compositionToMixTracks(comp),
      outputPath: ducked,
    });
    workingPath = ducked;
    onP("duck", 1);
    checkAbort();
  }

  // Stage 3: subtitle burn (optional). Explicit opt-in must not silently no-op:
  // a missing text track when burnSubtitles=true is a programming error, not
  // graceful degradation. Callers can pre-check via compositionTextTrackToJson.
  if (opts.burnSubtitles) {
    const hasTextTrack = compositionTextTrackToJson(comp).length > 0;
    if (!hasTextTrack) {
      throw new Error(
        "runRenderPipeline: burnSubtitles=true but the composition has no text-track clips to burn",
      );
    }
    onP("burn", 0);
    const burned = workingPath.replace(/\.mp4$/, "-burned.mp4");
    await burnSubtitles({
      inputVideo: workingPath,
      comp,
      outputVideo: burned,
    });
    workingPath = burned;
    onP("burn", 1);
    checkAbort();
  }

  // Stage 4: loudnorm two-pass.
  // ffmpeg's loudnorm filter aborts when the input has no audio stream
  // (e.g. user uploaded a silent screen-recording with no BGM). Probe
  // the working file first; skip the stage if there is no audio.
  onP("loudnorm", 0);
  const hasAudio = await hasMeaningfulAudio(workingPath);
  if (hasAudio) {
    const normalized = workingPath.replace(/\.mp4$/, "-normalized.mp4");
    await normalizeLufs(workingPath, normalized, { target, truePeak: -1.5, lra: 11 });
    workingPath = normalized;
  }
  onP("loudnorm", 1);
  checkAbort();

  // Stage 5: final encode. If a platform preset is present, re-encode using
  // its codec + bitrate. Otherwise (legacy compositions w/o presets), keep
  // the prior behaviour: rename + done.
  onP("encode", 0);
  const finalPath = join(opts.outDir, `final-${Date.now()}.mp4`);
  const preset = comp.exportPresets?.[0];
  if (preset) {
    await runEncodeStage(workingPath, finalPath, preset, opts.signal);
  } else {
    await rename(workingPath, finalPath);
  }
  onP("encode", 1);

  return finalPath;
}
