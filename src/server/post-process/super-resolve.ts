// Phase 8.5 — Real-ESRGAN-style super-resolution adapter.
// Stub-only ship: when ESRGAN_MODEL_PATH is unset or points to a non-existent
// file, we copy input → output and flag the result as `stub: true`. A real
// implementation would invoke `realesrgan-ncnn-vulkan` (or similar) instead.

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

export const superResolveProcessor: PostProcessor = {
  id: "super-resolve",
  displayName: "Super-Resolve (2x)",
  async process(
    input: string,
    output: string,
    _opts: PostProcessOptions = {},
  ): Promise<PostProcessResult> {
    const start = Date.now();
    const modelPath = process.env.ESRGAN_MODEL_PATH;
    const isStub = !modelPath || !(await pathExists(modelPath));
    // Stub: copy input → output. Real impl would call realesrgan-ncnn-vulkan.
    await copyFile(input, output);
    return {
      outputPath: output,
      stub: isStub,
      durationMs: Date.now() - start,
    };
  },
};
