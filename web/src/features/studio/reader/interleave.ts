import type { Scene } from "@shared/composition";

// ─────────────────────────────────────────────────────────────────────────────
// splitScriptByAnchors — the pure layout kernel behind the ScriptReader.
//
// The reader is a SINGLE interleaved column: the 剧本 (plan/script.md markdown)
// reads top-to-bottom, and each 分镜 card is threaded in RIGHT AFTER the heading
// whose text matches its `scene.mdAnchor` (the weak link between the narrative
// layer and the execution layer). Scenes with no matching heading — or no anchor
// at all — collect in `trailing`, rendered as the 分镜册 (storyboard) section
// after the prose, ordered by `order`.
//
// Slicing rule: scan the markdown line-by-line for ATX headings (`#{1,6} title`),
// skipping any inside a fenced code block (``` / ~~~) so a `# comment` in a code
// sample never splits the flow. Each heading opens a segment that runs to the
// next heading. Text before the first heading becomes a heading-less preamble
// segment (dropped when it's only whitespace).
//
// Matching is trimmed-string equality; a scene anchors to the FIRST segment whose
// heading equals its anchor (deterministic under duplicate headings). Multiple
// scenes may share one anchor — they all thread under that heading, order-sorted.
//
// This is the test-first主对象 — every branch is a contract case in
// interleave.test.ts, so the component can trust the returned shape.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScriptSegment {
  /** Heading text (trimmed), or null for the pre-heading preamble segment. */
  heading: string | null;
  /** ATX heading level 1..6, or null for the preamble. */
  level: number | null;
  /** Raw markdown for this segment (heading line + body up to the next heading),
   *  fed straight to <Markdown>. */
  markdown: string;
  /** Scenes whose mdAnchor matches this heading, sorted by `order`. */
  scenes: Scene[];
}

export interface InterleavedFlow {
  segments: ScriptSegment[];
  /** Scenes with no matching heading anchor, sorted by `order` — the 分镜册
   *  section rendered after the prose. */
  trailing: Scene[];
}

// `#{1,6}` + at least one space/tab + a non-empty title.
const HEADING_RE = /^(#{1,6})[ \t]+(.+)$/;
// Fence open/close: 3+ backticks or tildes (leading whitespace allowed).
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Strip an optional trailing ATX close sequence (`### `) + surrounding space. */
function normalizeHeading(raw: string): string {
  return raw.replace(/\s+#+\s*$/, "").trim();
}

export function splitScriptByAnchors(
  md: string,
  scenes: Scene[],
): InterleavedFlow {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const lines = (md ?? "").split("\n");

  // Locate every real heading (line index + level + trimmed text).
  const heads: { heading: string; level: number; start: number }[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return;
    }
    if (fence !== null) return; // inside a code fence — not a heading
    const m = HEADING_RE.exec(line);
    if (m) {
      heads.push({
        heading: normalizeHeading(m[2]),
        level: m[1].length,
        start: i,
      });
    }
  });

  const segments: ScriptSegment[] = [];

  // Preamble: any content before the first heading (dropped if only whitespace).
  const firstStart = heads.length > 0 ? heads[0].start : lines.length;
  if (firstStart > 0) {
    const text = lines.slice(0, firstStart).join("\n").replace(/\n+$/, "");
    if (text.trim() !== "") {
      segments.push({ heading: null, level: null, markdown: text, scenes: [] });
    }
  }

  // One segment per heading, running to the next heading start.
  heads.forEach((h, idx) => {
    const end = idx + 1 < heads.length ? heads[idx + 1].start : lines.length;
    const markdown = lines.slice(h.start, end).join("\n").replace(/\n+$/, "");
    segments.push({
      heading: h.heading,
      level: h.level,
      markdown,
      scenes: [],
    });
  });

  // Anchor each scene to the FIRST segment whose heading matches; else trailing.
  const trailing: Scene[] = [];
  for (const scene of ordered) {
    const anchor = scene.mdAnchor?.trim();
    const seg = anchor
      ? segments.find((s) => s.heading !== null && s.heading === anchor)
      : undefined;
    if (seg) seg.scenes.push(scene);
    else trailing.push(scene);
  }

  return { segments, trailing };
}
