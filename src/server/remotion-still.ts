// I21 — single-frame Remotion still capture for `autoviral snapshot`.
//
// The agent is otherwise "blind": it writes composition.yaml and assumes the
// render is right (the failure mode .claude/rules/e2e-testing.md / invariant #6
// keeps warning about). `renderStill` lets the agent capture the CURRENT frame
// as a PNG and Read it back — visual self-check before declaring done.
//
// WHY a sibling file (not folded into remotion-renderer.ts): the mp4 path is
// load-bearing and heavily tested; a still is a strictly additive capability.
// But it MUST share the exact same serveUrl + inputProps + browserExecutable as
// renderCompositionToMp4 so the snapshot matches the deliverable frame-for-frame
// (invariant: snapshot ≡ what the full render would produce). We deliberately
// reuse resolveRemotionServeUrl + remotionBrowserExecutable and pass the same
// `{ comp }` inputProps + dimension overrides as the mp4 path.

import { renderStill, selectComposition } from "@remotion/renderer";
import {
  resolveRemotionServeUrl,
  remotionBrowserExecutable,
} from "./remotion-paths.js";

// Remotion's default delayRender timeout (28s) is too short for the snapshot
// use case: a video-clip composition must load each <Html5Video>'s metadata in
// headless Chromium just to compute the still, which routinely exceeds 28s for
// real deliverables (E2E 2026-06-04). A longer budget changes nothing about the
// frame produced (snapshot ≡ the deliverable frame) — it only tolerates slow
// asset loads so the agent's visual self-check doesn't spuriously time out.
const SNAPSHOT_TIMEOUT_MS = 120_000;

export interface RenderStillOptions {
  /** Absolute path the PNG is written to. */
  outFile: string;
  /**
   * 0-based frame index to capture. Caller clamps to [0, totalFrames-1]; we
   * defensively clamp the low bound to 0 here so a negative `at` can never
   * reach Remotion.
   */
  frame: number;
}

/**
 * Render ONE frame of the composition to a PNG, reusing the same serveUrl /
 * inputProps / browserExecutable / dimension overrides as the canonical mp4
 * render path (remotion-renderer.ts) so the still is byte-faithful to the
 * deliverable. Returns the absolute path written (`opts.outFile`).
 */
export async function renderCompositionStill(
  comp: {
    duration: number;
    fps: number;
    width: number;
    height: number;
    title?: string;
    [k: string]: unknown;
  },
  opts: RenderStillOptions,
): Promise<string> {
  const bundleLocation = await resolveRemotionServeUrl();
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "main",
    inputProps: { comp },
    browserExecutable: remotionBrowserExecutable(),
    timeoutInMilliseconds: SNAPSHOT_TIMEOUT_MS,
  });
  const totalFrames = Math.max(1, Math.round(comp.duration * comp.fps));
  // Clamp into the valid [0, totalFrames-1] window — Remotion throws on a
  // frame past the end, and a snapshot at a stale playhead (e.g. user shortened
  // the comp) shouldn't error, it should land on the last real frame.
  const frame = Math.max(0, Math.min(totalFrames - 1, Math.round(opts.frame)));
  await renderStill({
    composition: {
      ...composition,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      durationInFrames: totalFrames,
    },
    serveUrl: bundleLocation,
    output: opts.outFile,
    frame,
    imageFormat: "png",
    inputProps: { comp },
    browserExecutable: remotionBrowserExecutable(),
    overwrite: true,
    timeoutInMilliseconds: SNAPSHOT_TIMEOUT_MS,
  });
  return opts.outFile;
}
