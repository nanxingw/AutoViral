// src/trends/sources/index.ts
// Keep youtubeSource exported so future re-wiring (real RSS / YouTube Data
// API v3) can opt back in without touching imports here.
export { youtubeSource } from "./youtube.js";
import { xiaohongshuSource } from "./xiaohongshu.js";
import { agentFallbackSource } from "./agentFallback.js";
import type { Source } from "./types.js";
import type { Platform } from "../schema.js";

export function getSource(platform: Platform): Source {
  switch (platform) {
    // Task 18 live smoke: youtube.com/feeds/videos.xml?chart=most-popular
    // returns HTTP 400 — that URL was never a public global-trending RSS;
    // YouTube only exposes per-channel feeds. Route YouTube through the
    // agent_websearch fallback so the source field still distinguishes data
    // provenance honestly. youtubeSource module is kept around for future
    // re-wiring once a real data path lands (YouTube Data API v3 or HTML
    // scrape with proper anti-bot handling).
    case "youtube":
      return agentFallbackSource("youtube");
    case "xiaohongshu":
      return xiaohongshuSource;
    case "tiktok":
      return agentFallbackSource("tiktok");
    case "douyin":
      return agentFallbackSource("douyin");
  }
}

export type { Source, RawTrendItem } from "./types.js";
