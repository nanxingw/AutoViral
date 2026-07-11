import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en, zh } from "@/i18n/messages";
import {
  TIMELINE_HEADER_WIDTH,
  TIMELINE_ROW_GAP,
  TIMELINE_ROW_HEIGHTS,
  TIMELINE_RULER_HEIGHT,
} from "./timelineMetrics";
import {
  EMPTY_TRACK_MESSAGE_KEYS,
  TIMELINE_KIND_TOKENS,
} from "./timelinePresentation";

const tokensCss = readFileSync(
  resolve(__dirname, "../../../../styles/tokens.css"),
  "utf8",
);

function tokenValue(selector: string, token: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = tokensCss.match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  return block?.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();
}

describe("timeline presentation", () => {
  it("uses the phase-one row, gap, header, and ruler metrics", () => {
    expect(TIMELINE_ROW_HEIGHTS).toEqual({
      video: 56,
      audio: 44,
      caption: 36,
      overlay: 44,
    });
    expect(TIMELINE_ROW_GAP).toBe(4);
    expect(TIMELINE_HEADER_WIDTH).toBe(176);
    expect(TIMELINE_RULER_HEIGHT).toBe(28);
  });

  it("defines the four semantic timeline colors in dark and light themes", () => {
    expect(tokenValue(":root", "--timeline-video")).toBe("#a8c5d6");
    expect(tokenValue(":root", "--timeline-audio")).toBe("#a89bb8");
    expect(tokenValue(":root", "--timeline-caption")).toBe("#9caf9f");
    expect(tokenValue(":root", "--timeline-overlay")).toBe("#88adb8");
    expect(tokenValue('[data-theme="light"]', "--timeline-video")).toBe("#2a3a4a");
    expect(tokenValue('[data-theme="light"]', "--timeline-audio")).toBe("#655b70");
    expect(tokenValue('[data-theme="light"]', "--timeline-caption")).toBe("#506157");
    expect(tokenValue('[data-theme="light"]', "--timeline-overlay")).toBe("#3f6068");
  });

  it("derives soft and border variants with color-mix", () => {
    for (const kind of ["video", "audio", "caption", "overlay"]) {
      expect(tokenValue(":root", `--timeline-${kind}-soft`)).toBe(
        `color-mix(in srgb, var(--timeline-${kind}) 12%, transparent)`,
      );
      expect(tokenValue(":root", `--timeline-${kind}-border`)).toBe(
        `color-mix(in srgb, var(--timeline-${kind}) 38%, var(--glass-border))`,
      );
    }
  });

  it("maps each composition track kind to its semantic timeline tokens", () => {
    expect(TIMELINE_KIND_TOKENS.video.base).toBe("var(--timeline-video)");
    expect(TIMELINE_KIND_TOKENS.audio.soft).toBe("var(--timeline-audio-soft)");
    expect(TIMELINE_KIND_TOKENS.text.border).toBe("var(--timeline-caption-border)");
    expect(TIMELINE_KIND_TOKENS.overlay.base).toBe("var(--timeline-overlay)");
  });

  it("maps empty tracks to localized placeholder keys and copy", () => {
    expect(EMPTY_TRACK_MESSAGE_KEYS).toEqual({
      video: "studio.timeline.emptyTrack.video",
      audio: "studio.timeline.emptyTrack.audio",
      text: "studio.timeline.emptyTrack.text",
      overlay: "studio.timeline.emptyTrack.overlay",
    });
    expect(en.studio.timeline.emptyTrack).toEqual({
      video: "Drop video media",
      audio: "Drop audio · or choose VO from the library",
      text: "Drop captions · or generate captions",
      overlay: "Drop overlay media",
    });
    expect(zh.studio.timeline.emptyTrack).toEqual({
      video: "拖入视频素材",
      audio: "拖入音频 · 或从资源库选择 VO",
      text: "拖入字幕 · 或生成字幕",
      overlay: "拖入叠加素材",
    });
  });
});
