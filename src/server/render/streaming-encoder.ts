// R46 — streaming encode skeleton. Status: PRIMITIVE COMPLETE,
// INTEGRATION PENDING. See "Roadmap" section at bottom.
//
// ## Why this file exists (even as a skeleton)
//
// hyperframes' biggest render-speed win comes from piping JPEG frames
// directly from Chrome screenshots into ffmpeg's image2pipe stdin —
// eliminating PNG-to-disk-to-read-to-encode round trips. With our
// FrameReorderBuffer primitive in place (R46), the remaining work is
// "just" wiring the producers and the ffmpeg consumer.
//
// We ship this file as a skeleton because the primitive + skeleton
// together form a coherent stake-in-the-ground: anyone can read
// frame-reorder-buffer.ts → streaming-encoder.ts and understand the
// full architecture, even though the actual @remotion/renderer
// replacement is gated behind a feature flag.
//
// The TODOs at the bottom are real engineering tasks, not vapor —
// each is sized to about a day's focused work and references the
// hyperframes source they should mirror.

import { spawn } from "node:child_process";
import { FrameReorderBuffer } from "./frame-reorder-buffer.js";
import { pickEncoder, type LibX264Preset } from "./gpu-encoder.js";

export interface StreamingEncodeOptions {
  /** Total frame count of the output video. */
  totalFrames: number;
  /** Output frames per second. Drives the ffmpeg `-r` input flag. */
  fps: number;
  /** Output file path (mp4). */
  outputPath: string;
  /** Output dimensions; ffmpeg infers from JPEG headers but we pass
   *  these for the `-s` flag as a sanity guard against malformed input. */
  width: number;
  height: number;
  /** ffmpeg preset (libx264 vocabulary, gets translated). */
  preset?: LibX264Preset;
  /** Output bitrate in kbps. */
  videoBitrateKbps: number;
  /** Optional audio track to mux in (mp3 / aac path). When undefined,
   *  output is video-only — caller is responsible for a separate audio
   *  pass downstream. */
  audioPath?: string;
  /** Audio bitrate kbps if audioPath is set. */
  audioBitrateKbps?: number;
  /** AbortSignal to kill the ffmpeg process mid-stream. */
  signal?: AbortSignal;
}

export interface StreamingEncodeProducer {
  /**
   * Produce one frame as a JPEG buffer for `frameIndex`. Producer is
   * free to render in parallel — ordering is enforced by the encoder
   * via FrameReorderBuffer.
   *
   * Throwing rejects the entire encode and aborts ffmpeg.
   */
  produceFrame(frameIndex: number): Promise<Buffer>;

  /** Hint to producer that no more frames will be requested. Used to
   *  release resources (close Chrome tabs, free worker pools, etc). */
  finalize?(): Promise<void>;
}

/**
 * Encode `producer`'s frames to `outputPath` via ffmpeg image2pipe.
 *
 * Returns a Promise that resolves with the output path on success.
 *
 * Architecture:
 *   1. Spawn ffmpeg with `-f image2pipe -vcodec mjpeg -i -` reader.
 *   2. Walk frames 0..totalFrames-1 in order, calling producer.produceFrame.
 *   3. Each frame's JPEG buffer goes to ffmpeg.stdin; ffmpeg encodes.
 *
 * For *parallel* production (the actual perf win) the producer should
 * fan out internally — e.g. a Puppeteer worker pool — and use the
 * FrameReorderBuffer to coordinate. See producer-puppeteer-pool.ts
 * (TODO) for the canonical implementation.
 */
export async function streamingEncode(
  producer: StreamingEncodeProducer,
  opts: StreamingEncodeOptions,
): Promise<string> {
  const { totalFrames, fps, outputPath, width, height } = opts;
  const choice = await pickEncoder("h264", opts.preset ?? "medium");

  const args: string[] = [
    "-y",
    "-loglevel", "error",
    // Input 0: video frames via stdin, JPEG, at target fps. The -s
    // flag is a guard rail; if Chrome screenshot dimensions drift,
    // ffmpeg complains rather than silently letterboxing.
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "-r", String(fps),
    "-s", `${width}x${height}`,
    "-i", "-",
    // Optional input 1: audio.
    ...(opts.audioPath ? ["-i", opts.audioPath] : []),
    // Output codec config from gpu-encoder.
    "-c:v", choice.codec,
    ...choice.presetArgs,
    ...choice.extraArgs,
    "-b:v", `${opts.videoBitrateKbps}k`,
    "-pix_fmt", "yuv420p", // browser-compatible
    // Audio passthrough/encode if present.
    ...(opts.audioPath
      ? ["-c:a", "aac", "-b:a", `${opts.audioBitrateKbps ?? 192}k`]
      : []),
    "-movflags", "+faststart",
    outputPath,
  ];

  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  ff.stderr.on("data", (b: Buffer | string) => {
    stderr += b.toString();
  });

  const onAbort = () => {
    try { ff.kill("SIGTERM"); } catch { /* dead */ }
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  // The reorder buffer is the synchronization point even in this
  // skeleton — useful for a future test where producer is an in-process
  // mock with deliberately out-of-order completion timing.
  const buffer = new FrameReorderBuffer({ totalFrames });

  // Sequential producer loop (skeleton). Real parallel implementation
  // (TODO #3.b) replaces this with a worker pool that calls
  // buffer.waitForFrame(n) → produceFrame(n) → write → buffer.advanceTo.
  try {
    for (let i = 0; i < totalFrames; i++) {
      await buffer.waitForFrame(i);
      const jpeg = await producer.produceFrame(i);
      const ok = ff.stdin.write(jpeg);
      if (!ok) {
        // Backpressure — wait for drain so we don't OOM on a slow encoder.
        await new Promise<void>((r) => ff.stdin.once("drain", () => r()));
      }
      buffer.advanceTo(i + 1);
    }
    ff.stdin.end();
  } catch (err) {
    buffer.dispose("producer error");
    try { ff.kill("SIGTERM"); } catch { /* dead */ }
    throw err;
  } finally {
    await producer.finalize?.();
    opts.signal?.removeEventListener("abort", onAbort);
  }

  return new Promise<string>((resolve, reject) => {
    ff.on("close", (code) => {
      if (opts.signal?.aborted) {
        reject(new Error("streamingEncode: aborted"));
      } else if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`streamingEncode: ffmpeg exit ${code}\n${stderr}`));
      }
    });
    ff.on("error", reject);
  });
}

// ─── Roadmap (TODOs to fully replace Stage 1 Remotion render) ──────────
//
// The pieces above are production-ready as a sequential streaming
// encoder. Turning this into the parallel Chromium-screenshot pipeline
// that beats Remotion 3-5× requires three more files:
//
// ### TODO #3.a — Headless Chromium wrapper
//   File: src/server/render/headless-chrome.ts
//   Mirror: hyperframes packages/engine/src/services/browserManager.ts
//           (~300 LOC)
//   Job: Pool of N Puppeteer browser contexts pre-loaded with our
//        composition HTML. Each exposes captureFrame(frameIndex) that
//        uses HeadlessExperimental.beginFrame to deterministically
//        pause/seek/screenshot. Returns JPEG buffer.
//   Critical hyperframes flags to keep:
//     --disable-threaded-compositor (deterministic timing)
//     --force-color-profile=srgb
//     --disable-features=BackForwardCache,IntensiveWakeUpThrottling
//     --force-gpu-mem-available-mb=4096
//
// ### TODO #3.b — Parallel coordinator
//   File: src/server/render/parallel-coordinator.ts
//   Mirror: hyperframes packages/engine/src/services/parallelCoordinator.ts
//           lines 71-130 (~330 LOC)
//   Job: Decide worker count from system (cpu, mem, frame count),
//        partition frame ranges, manage producer pool. Wraps headless-
//        chrome.ts + frame-reorder-buffer.ts and exposes the
//        StreamingEncodeProducer interface above.
//   Default worker count formula:
//     min(cpu - 2, totalMem * 0.5 / 256MB, frames / 30) capped at 6
//
// ### TODO #3.c — Composition serialization
//   File: src/server/render/composition-to-html.ts
//   Mirror: piece together from hyperframes producer/renderOrchestrator
//           (the 4184-line file we didn't fully audit; the relevant
//            section is the "extract" stage circa lines 2108-2400)
//   Job: Take our Composition object (Scene.tsx React tree shape) and
//        emit a self-contained HTML bundle that captureFrame can load.
//        Today @remotion/bundler does this for us; we'd be replacing
//        it with a direct emitter.
//   Compatibility note: only need to support the subset of Remotion
//   primitives we actually use (AbsoluteFill, Sequence, Video, Audio,
//   Img). React state hooks → not supported, must be expressed via
//   data-time-line attributes a la hyperframes' GSAP timeline pattern.
//
// ### TODO #3.d — Feature flag + opt-in routing
//   File: src/server/render-pipeline.ts (existing)
//   Job: Read AUTOVIRAL_USE_STREAMING_RENDERER env var (or
//        composition.experimentalFlags.streamingRenderer). When set,
//        call streamingEncode() with the parallel coordinator producer
//        instead of renderCompositionToMp4(). Fall back to Remotion
//        path on any error so a flag-on user isn't blocked by spike
//        bugs.
//
// Estimated total: 2-3 weeks for one engineer who knows our codebase.
// The primitive (this file + frame-reorder-buffer.ts) is the ~10% of
// that work we did this session — it's the load-bearing wall everything
// else hangs from.
