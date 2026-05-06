// src/server/render-pipeline.ts

import { renderCompositionToMp4 } from "./remotion-renderer.js";
import {
  mixAudioTracks,
  normalizeLufs,
  burnSubtitles,
  compositionTextTrackToJson,
  type MixTrack,
} from "../audio-tools.js";
import { join } from "node:path";
import { rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { Composition, ExportPreset } from "../shared/composition.js";

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
 */
export async function runEncodeStage(
  input: string,
  output: string,
  preset: ExportPreset,
  signal?: AbortSignal,
): Promise<void> {
  const vcodec = CODEC_MAP[preset.codec];
  const args = [
    "-y", "-loglevel", "error",
    "-i", input,
    "-c:v", vcodec,
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
  const comp = opts.proxy ? applyProxy(opts.comp) : opts.comp;
  const target = opts.loudnessTargetLufs ?? -14;
  const onP = opts.onProgress ?? (() => undefined);
  const checkAbort = () => {
    if (opts.signal?.aborted) {
      throw new Error("runRenderPipeline: aborted");
    }
  };

  // Stage 1: Remotion render
  // TODO(phase-7): renderCompositionToMp4 does not yet accept an AbortSignal;
  // we check between stages so cancellation takes effect at the next boundary.
  checkAbort();
  onP("render", 0);
  let workingPath = await renderCompositionToMp4(
    { ...comp, title: opts.outputTitle },
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

  // Stage 4: loudnorm two-pass
  onP("loudnorm", 0);
  const normalized = workingPath.replace(/\.mp4$/, "-normalized.mp4");
  await normalizeLufs(workingPath, normalized, { target, truePeak: -1.5, lra: 11 });
  workingPath = normalized;
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
