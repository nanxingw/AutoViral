// Phase 8.5 — RIFE-style frame interpolation adapter.
// Stub-only ship: when RIFE_MODEL_PATH is unset or points to a non-existent
// file, we copy input → output and flag the result as `stub: true`. A real
// implementation would invoke `rife-ncnn-vulkan` (or similar) instead.

import { copyFile, access } from "node:fs/promises";
import type {
  PostProcessor,
  PostProcessOptions,
  PostProcessResult,
} from "./types.js";

async function pathExists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

export const interpolateProcessor: PostProcessor = {
  id: "frame-interpolate",
  displayName: "Frame Interpolate (2x fps)",
  async process(
    input: string,
    output: string,
    _opts: PostProcessOptions = {},
  ): Promise<PostProcessResult> {
    const start = Date.now();
    const modelPath = process.env.RIFE_MODEL_PATH;
    const isStub = !modelPath || !(await pathExists(modelPath));
    // Stub: copy input → output. Real impl would call rife-ncnn-vulkan.
    await copyFile(input, output);
    return {
      outputPath: output,
      stub: isStub,
      durationMs: Date.now() - start,
    };
  },
};
