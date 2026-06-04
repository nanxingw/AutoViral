import { describe, it, expect } from "vitest";
import {
  PLATFORM_PRESETS,
  resolvePlatformPreset,
} from "./platform-presets.js";

describe("PLATFORM_PRESETS — single source of truth", () => {
  it("exposes the canonical platform table", () => {
    const ids = PLATFORM_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "douyin-9-16",
        "xhs-9-16",
        "wechat-9-16",
        "bilibili-16-9",
        "tiktok-9-16",
        "reels-9-16",
        "shorts-9-16",
        "yt-long-16-9",
      ]),
    );
  });

  it("抖音 is 9:16 vertical at -14 LUFS / 8000k", () => {
    const douyin = PLATFORM_PRESETS.find((p) => p.id === "douyin-9-16")!;
    expect(douyin.width).toBe(1080);
    expect(douyin.height).toBe(1920);
    expect(douyin.loudnessTargetLufs).toBe(-14);
    expect(douyin.videoBitrate).toBe(8000);
  });

  it("视频号/微信 targets -16 LUFS (issue #80 — diverges from -14 default)", () => {
    const wechat = PLATFORM_PRESETS.find((p) => p.id === "wechat-9-16")!;
    expect(wechat.loudnessTargetLufs).toBe(-16);
  });

  it("小红书视频 targets -16 LUFS", () => {
    const xhs = PLATFORM_PRESETS.find((p) => p.id === "xhs-9-16")!;
    expect(xhs.loudnessTargetLufs).toBe(-16);
  });
});

describe("resolvePlatformPreset", () => {
  it("resolves by id", () => {
    expect(resolvePlatformPreset("douyin-9-16")?.platform).toBe("douyin");
  });

  it("resolves by label (the 抖音 case from the acceptance bar)", () => {
    expect(resolvePlatformPreset("抖音 9:16")?.id).toBe("douyin-9-16");
  });

  it("resolves by platform key, case-insensitively", () => {
    expect(resolvePlatformPreset("DOUYIN")?.id).toBe("douyin-9-16");
    expect(resolvePlatformPreset(" douyin ")?.id).toBe("douyin-9-16");
  });

  it("returns undefined for an unknown preset name (caller fails loud, not silent)", () => {
    expect(resolvePlatformPreset("not-a-real-preset")).toBeUndefined();
  });

  it("returns undefined for nullish / empty input", () => {
    expect(resolvePlatformPreset(undefined)).toBeUndefined();
    expect(resolvePlatformPreset(null)).toBeUndefined();
    expect(resolvePlatformPreset("")).toBeUndefined();
    expect(resolvePlatformPreset("   ")).toBeUndefined();
  });
});
