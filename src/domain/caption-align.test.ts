// PRD-0014 S9 — caption script-alignment core.
//
// The pure function `alignScriptLines` takes ASR word-level timing + the
// GROUND-TRUTH script text and produces caption LINES whose *text is the
// script truth* (never the ASR's mis-heard words) while the *timing comes
// from the ASR anchors* (coarse LCS-level alignment, NOT per-word forced
// alignment to the ASR's wrong word boundaries). CJK lines are split at the
// `maxCjkChars` cap without breaking word (space-delimited / phrase) groups.
//
// No ASR here — the ASR word sequence IS the fixture (mirrors the fixture-
// driven stream-parse precedent in the captions tests: we never shell out to
// stable-ts in a unit test).

import { describe, it, expect } from "vitest";
import {
  alignScriptLines,
  buildCaptionModelFromLines,
  alignScriptToCaptionModel,
  type AsrWord,
} from "./caption-align.js";
import { CaptionModelSchema } from "../shared/composition.js";

const CJK = /[㐀-鿿぀-ヿ]/g;
const cjkCount = (s: string) => (s.match(CJK) ?? []).length;

describe("alignScriptLines — script truth text + ASR timing (coarse LCS align)", () => {
  it("replaces ASR mis-heard words with the ground-truth script; line timing comes from ASR anchors", () => {
    // ASR heard 你想要的答案就在这里 but botched 答案→那村 and hallucinated 调.
    const asr: AsrWord[] = [
      { text: "你", start: 0.0, end: 0.3 },
      { text: "想", start: 0.3, end: 0.6 },
      { text: "要", start: 0.6, end: 0.9 },
      { text: "的", start: 0.9, end: 1.1 },
      { text: "那", start: 1.1, end: 1.4 }, // wrong (truth: 答)
      { text: "村", start: 1.4, end: 1.7 }, // wrong (truth: 案)
      { text: "调", start: 1.7, end: 1.9 }, // hallucination
      { text: "就", start: 1.95, end: 2.2 },
      { text: "在", start: 2.2, end: 2.4 },
      { text: "这", start: 2.4, end: 2.7 },
      { text: "里", start: 2.7, end: 3.0 },
    ];
    const script = "你想要的答案，就在这里。";

    const lines = alignScriptLines(asr, script, { maxCjkChars: 14 });

    // Two phrase lines split at the punctuation boundaries.
    expect(lines.map((l) => l.text)).toEqual(["你想要的答案，", "就在这里。"]);

    // Text is the ground truth — the ASR's wrong words must never leak.
    const joined = lines.map((l) => l.text).join("");
    expect(joined).not.toContain("那");
    expect(joined).not.toContain("村");
    expect(joined).not.toContain("调");

    // Line timing rides the ASR anchors (line 1 opens at 你's start, line 2
    // opens at 就's start and closes at 里's end).
    expect(lines[0].start).toBeCloseTo(0.0, 2);
    expect(lines[1].start).toBeCloseTo(1.95, 2);
    expect(lines[1].end).toBeCloseTo(3.0, 2);

    // Monotonic, non-overlapping.
    expect(lines[0].end).toBeLessThanOrEqual(lines[1].start + 1e-6);
  });

  it("splits a long CJK run at the maxCjkChars cap without breaking word groups", () => {
    // Ground truth is four 4-char words; the spaces mark word boundaries (the
    // '给定分词假设'). Timing: each char 0.2s, all anchored 1:1.
    const script = "一二三四 五六七八 九十百千 万亿兆京"; // 16 CJK chars, 4 words
    const chars = script.replace(/\s+/g, "").split("");
    const asr: AsrWord[] = chars.map((ch, i) => ({
      text: ch,
      start: i * 0.2,
      end: i * 0.2 + 0.2,
    }));

    const lines = alignScriptLines(asr, script, { maxCjkChars: 14 });

    // Break happens at a word boundary (after 千), so no word is split; every
    // line ≤ 14 CJK chars.
    expect(lines.map((l) => l.text)).toEqual([
      "一二三四五六七八九十百千",
      "万亿兆京",
    ]);
    for (const l of lines) expect(cjkCount(l.text)).toBeLessThanOrEqual(14);

    // Concatenation reproduces the truth (spaces stripped).
    expect(lines.map((l) => l.text).join("")).toBe(chars.join(""));

    expect(lines[0].start).toBeCloseTo(0.0, 2);
    expect(lines[1].end).toBeCloseTo(3.2, 2);
  });

  it("returns [] for empty script or empty ASR (no crash)", () => {
    expect(alignScriptLines([], "你好", { maxCjkChars: 14 })).toEqual([]);
    expect(
      alignScriptLines([{ text: "你", start: 0, end: 1 }], "  ", { maxCjkChars: 14 }),
    ).toEqual([]);
  });
});

describe("buildCaptionModelFromLines / alignScriptToCaptionModel — valid CaptionModel", () => {
  it("maps each line to a segment + a group referencing it; validates against the schema", () => {
    const lines = [
      { start: 0, end: 1, text: "你好" },
      { start: 1, end: 2.5, text: "世界" },
    ];
    const model = buildCaptionModelFromLines(lines, {
      modelId: "cm_test",
      language: "zh",
      audioTrackId: "trk_a1",
    });

    expect(model.segments).toHaveLength(2);
    expect(model.groups).toHaveLength(2);
    expect(model.segments[0]!.text).toBe("你好");
    expect(model.groups[0]!.segmentIds).toEqual([model.segments[0]!.segmentId]);
    expect(model.groups[1]!.start).toBeCloseTo(1, 6);
    expect(model.language).toBe("zh");
    expect(model.audioTrackId).toBe("trk_a1");

    // Must be a valid CaptionModel per the shared zod schema.
    expect(() => CaptionModelSchema.parse(model)).not.toThrow();
  });

  it("alignScriptToCaptionModel wires align → model in one call", () => {
    const asr: AsrWord[] = [
      { text: "你", start: 0.0, end: 0.5 },
      { text: "好", start: 0.5, end: 1.0 },
    ];
    const model = alignScriptToCaptionModel(asr, "你好。", {
      maxCjkChars: 14,
      modelId: "cm_x",
      language: "zh",
    });
    expect(model.groups).toHaveLength(1);
    expect(model.segments[0]!.text).toBe("你好。");
    expect(() => CaptionModelSchema.parse(model)).not.toThrow();
  });
});
