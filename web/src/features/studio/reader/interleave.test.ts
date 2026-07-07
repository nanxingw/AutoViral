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
