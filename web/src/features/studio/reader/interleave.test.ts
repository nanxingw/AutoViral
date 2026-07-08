import { describe, it, expect } from "vitest";
import { splitScriptByAnchors } from "./interleave";
import { makeScene } from "../../../test/composition-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// splitScriptByAnchors — the pure layout kernel behind the ScriptReader's single
// interleaved reading flow. Given the 剧本 markdown + the 分镜 scenes, it slices
// the markdown at ATX headings and threads each scene's card in AFTER the heading
// whose text matches its `mdAnchor`; scenes with no matching heading fall to the
// `trailing` bucket (the 分镜册 section rendered after the prose), ordered by
// `order`. This is the test-first主对象 — every branch of the interleave is a
// contract case here, so the component can trust the shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("splitScriptByAnchors — segment slicing", () => {
  it("slices markdown into one segment per ATX heading (# .. ######)", () => {
    const md = ["# Opening", "Hook line.", "", "## Beat two", "Body two."].join(
      "\n",
    );
    const { segments, trailing } = splitScriptByAnchors(md, []);
    expect(segments).toHaveLength(2);
    expect(segments[0].heading).toBe("Opening");
    expect(segments[0].level).toBe(1);
    expect(segments[0].markdown).toContain("# Opening");
    expect(segments[0].markdown).toContain("Hook line.");
    // The first segment must NOT bleed into the next heading's body.
    expect(segments[0].markdown).not.toContain("Beat two");
    expect(segments[1].heading).toBe("Beat two");
    expect(segments[1].level).toBe(2);
    expect(trailing).toHaveLength(0);
  });

  it("captures pre-heading prose as a preamble segment (heading=null)", () => {
    const md = ["Cold open, no heading.", "", "# First shot", "Body."].join(
      "\n",
    );
    const { segments } = splitScriptByAnchors(md, []);
    expect(segments[0].heading).toBeNull();
    expect(segments[0].level).toBeNull();
    expect(segments[0].markdown).toContain("Cold open");
    expect(segments[1].heading).toBe("First shot");
  });

  it("pure text with NO heading → one preamble segment, no headings", () => {
    const md = "Just a paragraph.\nAnd another line.";
    const { segments, trailing } = splitScriptByAnchors(md, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].heading).toBeNull();
    expect(segments[0].markdown).toContain("Just a paragraph.");
    expect(trailing).toHaveLength(0);
  });

  it("empty / whitespace-only script → zero segments", () => {
    expect(splitScriptByAnchors("", []).segments).toHaveLength(0);
    expect(splitScriptByAnchors("   \n\n  ", []).segments).toHaveLength(0);
  });

  it("does NOT treat a '#' inside a fenced code block as a heading", () => {
    const md = ["# Real heading", "```", "# not a heading", "```"].join("\n");
    const { segments } = splitScriptByAnchors(md, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].heading).toBe("Real heading");
    // The fenced content stays inside the one real segment.
    expect(segments[0].markdown).toContain("# not a heading");
  });
});

describe("splitScriptByAnchors — scene anchoring", () => {
  it("threads a scene AFTER the heading its mdAnchor matches (trimmed equality)", () => {
    const md = ["# Opening", "Hook.", "## Payoff", "End."].join("\n");
    const scenes = [
      makeScene({ id: "s1", order: 0, mdAnchor: "Opening" }),
      makeScene({ id: "s2", order: 1, mdAnchor: "  Payoff  " }),
    ];
    const { segments, trailing } = splitScriptByAnchors(md, scenes);
    expect(segments[0].scenes.map((s) => s.id)).toEqual(["s1"]);
    expect(segments[1].scenes.map((s) => s.id)).toEqual(["s2"]);
    expect(trailing).toHaveLength(0);
  });

  it("a scene with no matching heading falls to trailing, ordered by `order`", () => {
    const md = "# Only heading\nBody.";
    const scenes = [
      makeScene({ id: "late", order: 2, mdAnchor: "Nope" }),
      makeScene({ id: "early", order: 1 }), // no mdAnchor at all
    ];
    const { segments, trailing } = splitScriptByAnchors(md, scenes);
    expect(segments[0].scenes).toHaveLength(0);
    expect(trailing.map((s) => s.id)).toEqual(["early", "late"]);
  });

  it("multiple scenes sharing one anchor all thread under that heading, order-sorted", () => {
    const md = "# Shared\nBody.";
    const scenes = [
      makeScene({ id: "b", order: 1, mdAnchor: "Shared" }),
      makeScene({ id: "a", order: 0, mdAnchor: "Shared" }),
    ];
    const { segments } = splitScriptByAnchors(md, scenes);
    expect(segments[0].scenes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("duplicate headings — a scene anchors to the FIRST matching segment", () => {
    const md = ["# Dup", "One.", "# Dup", "Two."].join("\n");
    const scenes = [makeScene({ id: "s1", order: 0, mdAnchor: "Dup" })];
    const { segments } = splitScriptByAnchors(md, scenes);
    expect(segments[0].scenes.map((s) => s.id)).toEqual(["s1"]);
    expect(segments[1].scenes).toHaveLength(0);
  });

  it("empty script but non-empty scenes → all scenes trailing, order-sorted", () => {
    const scenes = [
      makeScene({ id: "z", order: 2 }),
      makeScene({ id: "y", order: 0 }),
      makeScene({ id: "x", order: 1 }),
    ];
    const { segments, trailing } = splitScriptByAnchors("", scenes);
    expect(segments).toHaveLength(0);
    expect(trailing.map((s) => s.id)).toEqual(["y", "x", "z"]);
  });
});

// ─── tolerant anchoring (E2E regression 2026-07-07) ─────────────────────────
//
// Real agent-drafted works title their headings with duration/beat suffixes —
// `## 开场 · Hook（0–8s）` — while the scene's mdAnchor carries just the beat
// name `开场 · Hook`. Strict equality dumped EVERY scene of the E2E work into
// the trailing 分镜册, silently killing the interleave. Anchoring must accept a
// prefix drift in either direction while keeping exact match the winner.
describe("splitScriptByAnchors — tolerant anchoring (heading/anchor prefix drift)", () => {
  it("anchors when the heading extends the anchor with a suffix (real-work shape)", () => {
    const md = [
      "# 三分钟看懂拿铁拉花",
      "导语。",
      "## 开场 · Hook（0–8s）",
      "奶泡倾泻。",
      "## 主体 · Build（8–24s）",
      "三步演示。",
    ].join("\n");
    const scenes = [
      makeScene({ id: "s1", order: 0, mdAnchor: "开场 · Hook" }),
      makeScene({ id: "s2", order: 1, mdAnchor: "主体 · Build" }),
    ];
    const { segments, trailing } = splitScriptByAnchors(md, scenes);
    expect(trailing).toHaveLength(0);
    expect(segments[1].heading).toBe("开场 · Hook（0–8s）");
    expect(segments[1].scenes.map((s) => s.id)).toEqual(["s1"]);
    expect(segments[2].scenes.map((s) => s.id)).toEqual(["s2"]);
  });

  it("anchors when the anchor extends the heading (script trimmed after drafting)", () => {
    const md = "# Opening\nBody.";
    const scenes = [
      makeScene({ id: "s1", order: 0, mdAnchor: "Opening (draft v2)" }),
    ];
    const { segments, trailing } = splitScriptByAnchors(md, scenes);
    expect(trailing).toHaveLength(0);
    expect(segments[0].scenes.map((s) => s.id)).toEqual(["s1"]);
  });

  it("an EXACT heading match beats an earlier prefix match", () => {
    const md = ["# Hook（0–8s）", "One.", "# Hook", "Two."].join("\n");
    const scenes = [makeScene({ id: "s1", order: 0, mdAnchor: "Hook" })];
    const { segments } = splitScriptByAnchors(md, scenes);
    // Segment 0 would prefix-match, but segment 1 is the exact anchor — it wins.
    expect(segments[0].scenes).toHaveLength(0);
    expect(segments[1].scenes.map((s) => s.id)).toEqual(["s1"]);
  });

  it("unrelated headings still fall to trailing (prefix tolerance ≠ fuzzy match)", () => {
    const md = "# 收尾 · Payoff\nBody.";
    const scenes = [makeScene({ id: "s1", order: 0, mdAnchor: "开场 · Hook" })];
    const { trailing } = splitScriptByAnchors(md, scenes);
    expect(trailing.map((s) => s.id)).toEqual(["s1"]);
  });
});
