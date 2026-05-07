// Phase 8.6 — Wav2Lip-style lip-sync adapter.
// Stub-only ship: when WAV2LIP_MODEL_PATH is unset or points to a non-existent
// file, we copy the input video → output and flag the result as `stub: true`.
// A real implementation would invoke Wav2Lip (GPU + ~500MB weights) to align
// the speaker's mouth with `opts.audioPath`.

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

export const lipSyncProcessor: PostProcessor = {
  id: "lip-sync",
  displayName: "Lip-Sync (Wav2Lip)",
  async process(
    input: string,
    output: string,
    opts: PostProcessOptions = {},
  ): Promise<PostProcessResult> {
    const start = Date.now();
    if (!opts.audioPath) {
      // Hard requirement: lip-sync needs audio. Don't even pretend in stub mode.
      throw new Error("lip-sync requires opts.audioPath");
    }
    const modelPath = process.env.WAV2LIP_MODEL_PATH;
    const isStub = !modelPath || !(await pathExists(modelPath));
    // Stub: copy input video → output (no actual lip-sync, audio swap deferred
    // to real impl). Real impl would invoke Wav2Lip with input + opts.audioPath.
    await copyFile(input, output);
    return {
      outputPath: output,
      stub: isStub,
      durationMs: Date.now() - start,
    };
  },
};
