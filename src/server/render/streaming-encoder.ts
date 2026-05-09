// R46 — streaming encode. Status: TODOs #3.a / #3.b / #3.d DONE
// (via the Remotion bridge in `remotion-bridge.ts`). #3.c (HTML
// serialization replacement) INTENTIONALLY SKIPPED — see rationale at
// the bottom of this file.
//
// ## Why this file exists
//
// hyperframes' biggest render-speed win comes from piping JPEG frames
// directly from Chrome screenshots into ffmpeg's image2pipe stdin —
// eliminating PNG-to-disk-to-read-to-encode round trips. With our
// FrameReorderBuffer primitive in place (R46), this file glues the
// producer side (Remotion's `renderFrames` via `remotion-bridge.ts`,
// or any future Puppeteer worker pool) to the ffmpeg consumer.
//
// The Remotion bridge feeds frames as JPEG (default `inputCodec`),
// matching `image2pipe -vcodec mjpeg`. Future producers that emit PNG
// (e.g. when JPEG quality is unacceptable for archival output) can
// pass `inputCodec: "png"` and ffmpeg will auto-decode the stream.

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
  /**
   * Wire format of the per-frame buffers produced by `producer`. ffmpeg
   * decodes with the matching `-vcodec`. Default "mjpeg" (zero-cost
   * decode, what Chrome screenshot + Remotion's `imageFormat: "jpeg"`
   * already emit). Switch to "png" if the producer can only emit PNG
   * (e.g. lossless archival path); ffmpeg will pay an extra zlib decode
   * per frame but the streaming arch is otherwise identical.
   */
  inputCodec?: "mjpeg" | "png";
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
    "-vcodec", opts.inputCodec ?? "mjpeg",
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

// ─── Roadmap status ────────────────────────────────────────────────────
//
// The pieces above are production-ready as a sequential streaming
// encoder. Stage 1 integration via the Remotion bridge is wired:
//
//   #3.a Headless Chromium wrapper        — DONE (delegated to
//        @remotion/renderer's `renderFrames`, which already manages a
//        Puppeteer pool with the correct chromium flags).
//   #3.b Parallel coordinator             — DONE (renderFrames'
//        `concurrency` option drives the worker pool; we map its
//        `onFrameBuffer` callback onto FrameReorderBuffer-coordinated
//        producer.produceFrame in `remotion-bridge.ts`).
//   #3.c Composition serialization        — INTENTIONALLY SKIPPED.
//        Rationale: re-implementing React tree → self-contained HTML is
//        ~2k LOC of compatibility surface (Sequence, Audio, Img,
//        offthread <Video>, useCurrentFrame, etc.). We get the same
//        streaming-encode perf win by keeping @remotion/bundler for
//        serialization and only replacing the *renderer* half. If a
//        future fork wants to drop the @remotion runtime entirely,
//        pick this up — but the perf delta vs the bridge approach is
//        small (Remotion's bundler is fast; the Chromium screenshot
//        loop is the bottleneck, not the HTML emit).
//   #3.d Feature flag + opt-in routing    — DONE (see render-pipeline.ts
//        `AUTOVIRAL_USE_STREAMING_RENDERER` env var + per-composition
//        `experimentalFlags.streamingRenderer`).
//
// The historical hyperframes-mirror notes are kept below for posterity
// in case anyone revisits #3.c.
//
// ### #3.a — Headless Chromium wrapper
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
// ### #3.b — Parallel coordinator
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
// ### #3.c — Composition serialization (SKIPPED, see status above)
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
// ### #3.d — Feature flag + opt-in routing (DONE)
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
