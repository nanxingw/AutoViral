// R46 #3.a/b/d — Remotion → streaming-encoder bridge.
//
// We deliberately keep @remotion/bundler for React tree serialization
// (#3.c skipped, see streaming-encoder.ts roadmap) and only replace the
// *renderer* half of Remotion's pipeline. The shape of the win:
//
//   Remotion's renderMedia: render N frames serially → write N frames
//     to disk → spawn ffmpeg → ffmpeg reads from disk → encode.
//   Bridge:                  renderFrames in parallel (Chromium pool)
//     → onFrameBuffer pipes JPEG straight into ffmpeg stdin via
//     streamingEncode → encode in parallel with the next frame's render.
//
// renderFrames' `onFrameBuffer(buffer, frame)` gives us the rendered
// JPEG before it ever touches disk. We funnel each one into a
// per-frame deferred Promise; the streaming-encoder's sequential
// producer loop awaits these deferreds in order, while ffmpeg
// consumes from the other end of the pipe.
//
// FrameReorderBuffer + the deferred map together absorb the case where
// renderFrames' workers finish frame N+k before frame N — we just
// stash buffers in the map; the producer's await for frame N picks up
// whenever it lands.

import { bundle } from "@remotion/bundler";
import { renderFrames, selectComposition, makeCancelSignal } from "@remotion/renderer";
import { join } from "node:path";
import { streamingEncode, type StreamingEncodeProducer } from "./streaming-encoder.js";
import { buildSafeOutputFilename } from "../remotion-renderer.js";

// Mirror web/tsconfig.json paths so Remotion's webpack resolves
// `@shared/*` imports inside the bundled composition tree the same way
// Vite does. Kept in sync with `remotion-renderer.ts` — if you change
// the alias here, change it there too (and vice versa).
const SHARED_ALIAS_TARGET = join(process.cwd(), "src/shared");

export interface RenderViaStreamingBridgeOptions {
  /** 0..1 fraction of frames rendered. Called as renderFrames advances. */
  onProgress?: (fraction: number) => void;
  /**
   * #44 — same AbortSignal → Remotion cancelSignal bridge as the canonical
   * renderCompositionToMp4 path. Aborting kills the Chromium render-frame pool
   * mid-flight (renderFrames rejects), so streamingEncode tears down ffmpeg
   * instead of churning the full render before honoring the cancel.
   */
  signal?: AbortSignal;
}

/**
 * Internal: pull out the composition→bundle dance so tests can mock
 * @remotion/bundler / @remotion/renderer wholesale.
 */
type CompForRender = {
  duration: number;
  fps: number;
  width: number;
  height: number;
  title?: string;
  [k: string]: unknown;
};

/**
 * A minimal "deferred" — a Promise we can resolve/reject from the
 * outside. Used so that renderFrames' onFrameBuffer can hand a buffer
 * to a produceFrame() awaiter without us having to invent a queue.
 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function renderViaStreamingBridge(
  comp: CompForRender,
  outDir: string,
  opts: RenderViaStreamingBridgeOptions = {},
): Promise<string> {
  // #44 — bail before the expensive bundle if already cancelled.
  if (opts.signal?.aborted) {
    throw new Error("renderViaStreamingBridge: aborted before render");
  }
  // Bridge AbortSignal → Remotion cancelSignal (cleaned up after both the
  // render and encode promises settle, below).
  const cancelBridge = opts.signal ? makeCancelSignal() : null;
  const onAbort = () => cancelBridge?.cancel();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const bundleLocation = await bundle({
    entryPoint: join(
      process.cwd(),
      "web/src/features/studio/composition/RemotionRoot.tsx",
    ),
    webpackOverride: (c) => {
      c.resolve = c.resolve ?? {};
      c.resolve.alias = {
        ...(c.resolve.alias ?? {}),
        "@shared": SHARED_ALIAS_TARGET,
      };
      // src/shared/*.ts uses NodeNext-style explicit ".js" suffixes.
      c.resolve.extensionAlias = {
        ...(c.resolve.extensionAlias ?? {}),
        ".js": [".ts", ".tsx", ".js"],
      };
      return c;
    },
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "main",
    inputProps: { comp },
  });

  const totalFrames = Math.max(1, Math.round(comp.duration * comp.fps));
  const outFile = join(outDir, buildSafeOutputFilename(comp.title));

  // Map<frameIndex, Deferred<Buffer>>. renderFrames may produce frames
  // out of order (parallel Chromium workers); the producer awaits in
  // order. Pre-creating deferreds on demand lets either side arrive
  // first without races.
  const pending = new Map<number, Deferred<Buffer>>();
  const getDeferred = (i: number): Deferred<Buffer> => {
    let d = pending.get(i);
    if (!d) {
      d = defer<Buffer>();
      pending.set(i, d);
    }
    return d;
  };

  let renderError: Error | null = null;

  const producer: StreamingEncodeProducer = {
    async produceFrame(frameIndex) {
      if (renderError) throw renderError;
      const d = getDeferred(frameIndex);
      const buf = await d.promise;
      // Free the slot once the encoder consumed it — keeps the map
      // bounded by `concurrency` rather than `totalFrames`.
      pending.delete(frameIndex);
      return buf;
    },
  };

  // Kick off renderFrames. We do NOT await it here — streamingEncode
  // drives the read side concurrently, and we await the renderFrames
  // promise alongside the encode promise via Promise.all below so an
  // error from either rejects the bridge.
  const renderPromise = renderFrames({
    composition: {
      ...composition,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      durationInFrames: totalFrames,
    },
    serveUrl: bundleLocation,
    inputProps: { comp },
    cancelSignal: cancelBridge?.cancelSignal,
    imageFormat: "jpeg",
    // outputDir: null means "don't write frames to disk" — we pull
    // them from onFrameBuffer instead. This is the whole point of the
    // streaming path: zero disk round-trips for raw frames.
    outputDir: null,
    onStart: () => undefined,
    onFrameUpdate: (renderedFrames) => {
      if (!opts.onProgress) return;
      const fraction = Math.max(0, Math.min(1, renderedFrames / totalFrames));
      opts.onProgress(fraction);
    },
    onFrameBuffer: (buffer, frameIndex) => {
      const d = getDeferred(frameIndex);
      d.resolve(buffer);
    },
  }).catch((err: unknown) => {
    renderError = err instanceof Error ? err : new Error(String(err));
    // Reject any in-flight produceFrame awaits so streamingEncode
    // tears down ffmpeg instead of deadlocking.
    for (const [, d] of pending) d.reject(renderError);
    pending.clear();
    throw renderError;
  });

  const encodePromise = streamingEncode(producer, {
    totalFrames,
    fps: comp.fps,
    outputPath: outFile,
    width: comp.width,
    height: comp.height,
    videoBitrateKbps: 8000,
    inputCodec: "mjpeg",
  });

  // Both must settle. If renderFrames throws, encodePromise will also
  // reject (because produceFrame rejects); Promise.all surfaces the
  // first error. If encodePromise throws (ffmpeg crash, etc.) we still
  // need to await renderFrames or it'll keep churning Chromium —
  // allSettled handles that gracefully.
  const [encodeResult, renderResult] = await Promise.allSettled([
    encodePromise,
    renderPromise,
  ]);
  // Both promises have settled — safe to drop the abort listener.
  opts.signal?.removeEventListener("abort", onAbort);

  if (encodeResult.status === "rejected") throw encodeResult.reason;
  if (renderResult.status === "rejected") throw renderResult.reason;
  return encodeResult.value;
}
