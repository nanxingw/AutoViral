import { renderMedia, selectComposition, makeCancelSignal } from "@remotion/renderer";
import { join } from "node:path";
import {
  resolveRemotionServeUrl,
  remotionBrowserExecutable,
} from "./remotion-paths.js";

export function buildSafeOutputFilename(
  title: string | undefined,
  now: Date = new Date(),
): string {
  const safe = (title ?? "")
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "autoviral-export";
  const stamp = now
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `${safe}-${stamp}.mp4`;
}

/**
 * R46 #2.5 — Remotion's renderMedia exposes a per-frame onProgress
 * callback we were ignoring. Without it, the surrounding pipeline saw
 * render as a binary 0-or-done stage even though weighted progress
 * budget allocates 75% of the bar to it. Result: bar would sit at 0%
 * for the whole render then snap to 75%. Wiring this through closes
 * the "stuck at 0%" gap surfaced in the 2026-05-09 e2e test.
 *
 * The callback shape is `({ renderedFrames, encodedFrames, ... })` —
 * we use renderedFrames since that's what advances during the slow
 * Chromium screenshot loop. encodedFrames lags by ~10 frames because
 * Remotion encodes in batches; for a smooth UI bar we want the leading
 * edge.
 */
export interface RenderToMp4Options {
  /** 0..1 fraction of frames rendered. Called every ~250ms by Remotion. */
  onProgress?: (fraction: number) => void;
  /**
   * #44 — abort the heaviest stage mid-flight, not just at the next stage
   * boundary. Remotion has its own cancellation protocol (makeCancelSignal),
   * so we bridge the standard Node AbortSignal onto it: an `abort` event calls
   * Remotion's `cancel()`, which kills the headless Chromium render loop and
   * makes renderMedia reject. Same "external signal → subsystem-native cancel"
   * shape that runEncodeStage already uses for ffmpeg child.kill(SIGTERM).
   */
  signal?: AbortSignal;
}

export async function renderCompositionToMp4(
  comp: { duration: number; fps: number; width: number; height: number; title?: string; [k: string]: unknown },
  outDir: string,
  opts: RenderToMp4Options = {},
): Promise<string> {
  // Bail before the expensive bundle if we're already cancelled — no point
  // spinning up webpack + Chromium for a job the user already abandoned.
  if (opts.signal?.aborted) {
    throw new Error("renderCompositionToMp4: aborted before render");
  }
  const bundleLocation = await resolveRemotionServeUrl();
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "main",
    inputProps: { comp },
    browserExecutable: remotionBrowserExecutable(),
  });
  const outFile = join(outDir, buildSafeOutputFilename(comp.title));
  // Override every dimension prop from the composition data — Remotion's
  // <Composition> root only declares defaults (1080x1920 30fps); without the
  // override here, 1:1 / 16:9 / 4:5 / 60fps exports came out with wrong
  // dimensions/fps. (Codex review 2026-04-27)
  const totalFrames = Math.max(1, Math.round(comp.duration * comp.fps));
  // #44 — bridge AbortSignal → Remotion cancelSignal. cancel() tears down the
  // Chromium render loop within ~1-2s instead of letting it run to completion.
  const cancelBridge = opts.signal ? makeCancelSignal() : null;
  const onAbort = () => cancelBridge?.cancel();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await renderMedia({
      composition: {
        ...composition,
        width: comp.width,
        height: comp.height,
        fps: comp.fps,
        durationInFrames: totalFrames,
      },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outFile,
      inputProps: { comp },
      browserExecutable: remotionBrowserExecutable(),
      cancelSignal: cancelBridge?.cancelSignal,
      // R46 #2.5 — surface per-frame progress so the pipeline progress
      // budget (worker.ts STAGE_BUDGET.render = 0.75) advances smoothly
      // through the long render stage instead of hanging at 0% for the
      // whole duration. Remotion calls this every ~250ms.
      onProgress: opts.onProgress
        ? ({ renderedFrames }) => {
            // Clamp + guard against div-by-zero (composition could be 1
            // frame in pathological cases).
            const fraction = Math.max(0, Math.min(1, renderedFrames / totalFrames));
            opts.onProgress!(fraction);
          }
        : undefined,
    });
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
  return outFile;
}
