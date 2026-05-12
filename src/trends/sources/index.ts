// src/trends/sources/index.ts
import { youtubeSource } from "./youtube.js";
import { xiaohongshuSource } from "./xiaohongshu.js";
import { agentFallbackSource } from "./agentFallback.js";
import type { Source } from "./types.js";
import type { Platform } from "../schema.js";

export function getSource(platform: Platform): Source {
  switch (platform) {
    case "youtube":
      return youtubeSource;
    case "xiaohongshu":
      return xiaohongshuSource;
    case "tiktok":
      return agentFallbackSource("tiktok");
    case "douyin":
      return agentFallbackSource("douyin");
  }
}

export type { Source, RawTrendItem } from "./types.js";
