import { describe, it, expect } from "vitest";
import { _internals } from "../ingest-youtube.js";

const { parseNumberedLines, renderBriefMarkdown, buildCaptionModel } = _internals;

describe("ingest-youtube · parseNumberedLines", () => {
  it("recovers ordered translation lines from a numbered list", () => {
    const out = parseNumberedLines("[0] 你好\n[1] 世界", 2);
    expect(out).toEqual(["你好", "世界"]);
  });

  it("tolerates leading whitespace and stray prose", () => {
    const out = parseNumberedLines(
      "Here is the translation:\n  [0]  你好\n[1] 世界\nThanks!",
      2,
    );
    expect(out).toEqual(["你好", "世界"]);
  });

  it("fills missing indices with empty strings, preserving count", () => {
    // Model dropped index 1; downstream zip must still produce N entries.
    const out = parseNumberedLines("[0] 你好\n[2] 世界", 3);
    expect(out).toEqual(["你好", "", "世界"]);
  });

  it("ignores indices outside the expected range", () => {
    const out = parseNumberedLines("[0] keep\n[5] drop", 2);
    expect(out).toEqual(["keep", ""]);
  });
});

describe("ingest-youtube · renderBriefMarkdown", () => {
  it("includes source URL, segment count, and translated body", () => {
    const md = renderBriefMarkdown({
      url: "https://www.youtube.com/watch?v=abc",
      durationSec: 65.4,
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      segments: [
        { start: 0.0, end: 2.5, text: "Hello world.", translation: "你好世界。" },
        { start: 2.5, end: 4.0, text: "Welcome.", translation: "欢迎。" },
      ],
    });

    expect(md).toMatch(/^# Ingest brief/);
    expect(md).toContain("https://www.youtube.com/watch?v=abc");
    expect(md).toContain("zh-CN");
    expect(md).toContain("**Segments:** 2");
    expect(md).toContain("你好世界。");
    expect(md).toContain("欢迎。");
    // mm:ss.s format (e.g. 00:00.0)
    expect(md).toMatch(/\*\*00:00\.0 → 00:02\.5\*\*/);
  });

  it("omits the translation paragraph when translation is empty (no OPENROUTER key)", () => {
    const md = renderBriefMarkdown({
      url: "https://x",
      durationSec: 1,
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      segments: [{ start: 0, end: 1, text: "Hi.", translation: "" }],
    });
    // Source line still in
    expect(md).toContain("Hi.");
    // No bare empty translation line — only one blank line after the > quote
    const segBlock = md.split("## Translated transcript")[1] ?? "";
    expect(segBlock).not.toMatch(/^>.+\n\n\n/m);
  });
});

describe("ingest-youtube · buildCaptionModel", () => {
  it("emits one segment + one group per translated input with editorial styling", () => {
    const model = buildCaptionModel(
      [
        { start: 0, end: 2.5, text: "Hi", translation: "你好" },
        { start: 2.5, end: 4.0, text: "Bye", translation: "再见" },
      ],
      "zh-CN",
    );

    expect(model.language).toBe("zh-CN");
    expect(model.segments).toHaveLength(2);
    expect(model.groups).toHaveLength(2);

    expect(model.segments[0]).toMatchObject({ start: 0, end: 2.5, text: "你好" });
    expect(model.segments[1]).toMatchObject({ start: 2.5, end: 4.0, text: "再见" });

    // groups carry the cool-steel highlight color from the brand palette.
    expect(model.groups[0].style).toMatchObject({
      fontSize: 56,
      textAlign: "center",
      bottomOffsetPx: 140,
    });
    expect(model.groups[0].animation).toMatchObject({
      entrance: { duration: 0.18, type: "slide-up" },
      highlight: { activeColor: "#a8c5d6" },
    });
  });

  it("falls back to the source text when translation is empty", () => {
    const model = buildCaptionModel(
      [{ start: 0, end: 1, text: "Hello", translation: "" }],
      "zh-CN",
    );
    expect(model.segments[0].text).toBe("Hello");
  });

  it("preserves zero-padded segment ids for stable lookup", () => {
    const model = buildCaptionModel(
      Array.from({ length: 12 }, (_, i) => ({
        start: i,
        end: i + 1,
        text: `s${i}`,
        translation: `t${i}`,
      })),
      "zh-CN",
    );
    expect(model.segments[0].segmentId).toBe("seg_0000");
    expect(model.segments[11].segmentId).toBe("seg_0011");
  });
});
