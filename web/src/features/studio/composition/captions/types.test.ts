import { describe, it, expect } from "vitest";
import {
  findSegment,
  isGroupActive,
  activeSegmentInGroup,
  autoGroupSegments,
  HYPE_DEFAULT_ANIM,
  type CaptionModel,
  type CaptionSegment,
} from "./types";

const sample = (): CaptionModel => ({
  modelId: "m1",
  audioTrackId: "a1",
  language: "zh",
  segments: [
    { segmentId: "s0", start: 0.0, end: 0.5, text: "你好" },
    { segmentId: "s1", start: 0.5, end: 1.0, text: "今天" },
    { segmentId: "s2", start: 1.0, end: 1.6, text: "我们" },
  ],
  groups: [
    {
      groupId: "g0",
      start: 0,
      end: 1.6,
      segmentIds: ["s0", "s1", "s2"],
      style: { fontSize: 48, bottomOffsetPx: 120 },
    },
  ],
});

describe("findSegment", () => {
  it("finds existing segment by ID", () => {
    const m = sample();
    expect(findSegment(m, "s1")?.text).toBe("今天");
  });
  it("returns undefined for missing ID", () => {
    expect(findSegment(sample(), "nope")).toBeUndefined();
  });
});

describe("isGroupActive", () => {
  it("true within group window (inclusive)", () => {
    const m = sample();
    const g = m.groups[0]!;
    expect(isGroupActive(g, 0)).toBe(true);
    expect(isGroupActive(g, 0.8)).toBe(true);
    expect(isGroupActive(g, 1.6)).toBe(true);
  });
  it("false outside group window", () => {
    const g = sample().groups[0]!;
    expect(isGroupActive(g, -0.1)).toBe(false);
    expect(isGroupActive(g, 1.7)).toBe(false);
  });
});

describe("activeSegmentInGroup", () => {
  it("returns the segment overlapping current time", () => {
    const m = sample();
    const g = m.groups[0]!;
    expect(activeSegmentInGroup(m, g, 0.3)?.segmentId).toBe("s0");
    expect(activeSegmentInGroup(m, g, 0.7)?.segmentId).toBe("s1");
    expect(activeSegmentInGroup(m, g, 1.3)?.segmentId).toBe("s2");
  });
  it("returns undefined in caption gap (between segments)", () => {
    const m: CaptionModel = {
      ...sample(),
      segments: [
        { segmentId: "s0", start: 0.0, end: 0.4, text: "你" },
        { segmentId: "s1", start: 0.6, end: 1.0, text: "好" }, // 0.2s gap
      ],
      groups: [
        { groupId: "g0", start: 0, end: 1, segmentIds: ["s0", "s1"], style: { fontSize: 48 } },
      ],
    };
    expect(activeSegmentInGroup(m, m.groups[0]!, 0.5)).toBeUndefined();
  });
});

describe("autoGroupSegments", () => {
  it("buckets words by max-words limit", () => {
    const segs: CaptionSegment[] = Array.from({ length: 12 }, (_, i) => ({
      segmentId: `s${i}`,
      start: i * 0.3,
      end: (i + 1) * 0.3,
      text: `词${i}`,
    }));
    const groups = autoGroupSegments(segs, {
      maxWordsPerGroup: 4,
      style: { fontSize: 48 },
    });
    expect(groups.length).toBe(3); // 12 / 4
    expect(groups[0]!.segmentIds.length).toBe(4);
    expect(groups[0]!.start).toBe(0);
    expect(groups[0]!.end).toBeCloseTo(1.2, 6);
  });

  it("flushes on terminal punctuation (Chinese)", () => {
    const segs: CaptionSegment[] = [
      { segmentId: "a", start: 0, end: 0.3, text: "你好" },
      { segmentId: "b", start: 0.3, end: 0.6, text: "今天。" }, // sentence boundary
      { segmentId: "c", start: 0.6, end: 0.9, text: "我们" },
    ];
    const groups = autoGroupSegments(segs, {
      maxWordsPerGroup: 99, // disable the count limit
      style: { fontSize: 48 },
    });
    expect(groups.length).toBe(2);
    expect(groups[0]!.segmentIds).toEqual(["a", "b"]);
    expect(groups[1]!.segmentIds).toEqual(["c"]);
  });

  it("flushes on terminal punctuation (English)", () => {
    const segs: CaptionSegment[] = [
      { segmentId: "a", start: 0, end: 0.3, text: "Hello" },
      { segmentId: "b", start: 0.3, end: 0.6, text: "world." },
      { segmentId: "c", start: 0.6, end: 0.9, text: "Foo" },
    ];
    const groups = autoGroupSegments(segs, {
      maxWordsPerGroup: 99,
      style: { fontSize: 48 },
    });
    expect(groups.length).toBe(2);
  });
});

describe("HYPE_DEFAULT_ANIM", () => {
  it("ships with all three phases (entrance / highlight / exit)", () => {
    expect(HYPE_DEFAULT_ANIM.entrance).toBeDefined();
    expect(HYPE_DEFAULT_ANIM.highlight).toBeDefined();
    expect(HYPE_DEFAULT_ANIM.exit).toBeDefined();
  });
  it("highlight has both active and dim colors", () => {
    expect(HYPE_DEFAULT_ANIM.highlight?.activeColor).toMatch(/^#/);
    expect(HYPE_DEFAULT_ANIM.highlight?.dimColor).toMatch(/^#/);
  });
});
