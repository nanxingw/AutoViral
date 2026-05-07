import type { VideoProvider, VideoGenerateOptions, VideoGenerateResult } from "./types.js";
import { createHash } from "node:crypto";

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

export const runwayProvider: VideoProvider = {
  id: "runway",
  displayName: "Runway Gen-3",
  async generateVideo(opts: VideoGenerateOptions): Promise<VideoGenerateResult> {
    const apiKey = process.env.RUNWAY_API_KEY;
    const isStub = !apiKey;
    // Simulate async latency (10ms in tests via fake timers).
    await new Promise((r) => setTimeout(r, 100));
    return {
      assetUri: `assets/stub-videos/runway-${hashPrompt(opts.prompt)}.mp4`,
      providerJobId: isStub ? undefined : `runway-${hashPrompt(opts.prompt)}`,
      costUsd: isStub ? 0 : 0.5,
      stub: isStub,
    };
  },
};
