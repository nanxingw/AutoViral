/**
 * `autoviral inspect` — text-overflow + out-of-canvas detection.
 *
 * H1.2 ships a static-analysis approximation rather than the full
 * Puppeteer pipeline that hyperframes uses. Reasoning: a render-based
 * check needs (a) a full Chrome instance, (b) Remotion render lifecycle
 * + ffmpeg, and (c) per-frame DOM walks — all of which we already get
 * for free when the user runs `autoviral export`. For the iterating-
 * agent loop (hundreds of inspections per session) a fast static check
 * catches 80%+ of the issues at <10ms per composition.
 *
 * Heuristics applied:
 *   text-overflow:  estimated rendered width (chars × avgGlyphPx) vs
 *                    composition width minus 2× padding
 *   out-of-canvas:  caption bottomOffsetPx + style.fontSize must fit in
 *                    composition.height
 *
 * A future H1.2.b can add the puppeteer-based pixel-accurate version
 * gated behind an `--accurate` flag.
 */
import { CompositionSchema, type Composition } from "../../shared/composition.js";

export interface InspectFinding {
  severity: "error" | "warning";
  ruleId: "text-overflow" | "caption-out-of-canvas" | "text-line-too-long";
  message: string;
  locator?: string;
}

export interface InspectReport {
  findings: InspectFinding[];
  counts: Record<"error" | "warning", number>;
}

// Conservative average glyph width as a fraction of the font size — Inter
// at 56px renders ~0.55em per char for mixed-Latin text. CJK is wider so
// the estimate is intentionally pessimistic.
const AVG_GLYPH_FRACTION = 0.6;

export function inspectComposition(input: unknown): InspectReport {
  const parsed = CompositionSchema.safeParse(input);
  if (!parsed.success) {
    // Schema errors are lint's job; inspect is silent on malformed input.
    return { findings: [], counts: { error: 0, warning: 0 } };
  }
  const comp = parsed.data;
  const findings: InspectFinding[] = [];

  // Caption group overflow + out-of-canvas
  if (comp.captions) {
    const captions = comp.captions;
    const containerPadX = 80; // safe inside margin
    const usableWidth = comp.width - containerPadX * 2;
    captions.groups.forEach((g, gi) => {
      // fontSize is `number | string` in the schema; arithmetic below relies
      // on JS numeric coercion (`"40" * 1.4` === 40 * 1.4), so coerce once to
      // keep the exact same numeric outcome (NaN for non-numeric strings too).
      const fontSize = Number(g.style.fontSize);
      // bottomOffsetPx is optional; when absent the original `undefined + x`
      // yielded NaN and `NaN > height` was false (no finding). NaN preserves
      // that exact "no spurious finding" outcome.
      const bottomOffset = g.style.bottomOffsetPx ?? Number.NaN;
      // out-of-canvas: caption baseline + line height beyond frame bottom?
      const estLineHeight = fontSize * 1.4;
      if (bottomOffset + estLineHeight > comp.height) {
        findings.push({
          severity: "error",
          ruleId: "caption-out-of-canvas",
          message: `group "${g.groupId}" bottomOffset(${bottomOffset}) + lineHeight(${estLineHeight.toFixed(0)}) exceeds frame height ${comp.height}`,
          locator: `captions.groups[${gi}]`,
        });
      }
      // text-overflow: estimate line width from concatenated segment text
      const lineText = g.segmentIds
        .map((sid) => captions.segments.find((s) => s.segmentId === sid)?.text ?? "")
        .join(" ");
      const estWidth = lineText.length * fontSize * AVG_GLYPH_FRACTION;
      if (estWidth > usableWidth) {
        findings.push({
          severity: "warning",
          ruleId: "text-line-too-long",
          message: `group "${g.groupId}" line "${lineText.slice(0, 32)}…" estimated ${estWidth.toFixed(0)}px exceeds usable ${usableWidth}px (composition width ${comp.width}, ~${containerPadX * 2}px safe margins)`,
          locator: `captions.groups[${gi}]`,
        });
      }
    });
  }

  // Text track clips — same overflow heuristic
  comp.tracks.forEach((track, ti) => {
    if (track.kind !== "text") return;
    track.clips.forEach((clip, ci) => {
      const c = clip as unknown as {
        id?: string;
        text?: string;
        style?: { fontSize?: number };
      };
      if (!c.text || !c.style?.fontSize) return;
      const fs = c.style.fontSize;
      const est = c.text.length * fs * AVG_GLYPH_FRACTION;
      if (est > comp.width * 0.9) {
        findings.push({
          severity: "warning",
          ruleId: "text-overflow",
          message: `text clip "${c.id ?? ""}" estimated ${est.toFixed(0)}px may overflow composition width ${comp.width}`,
          locator: `tracks[${ti}].clips[${ci}]`,
        });
      }
    });
  });

  return tally(findings);
}

function tally(findings: InspectFinding[]): InspectReport {
  const counts = { error: 0, warning: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return { findings, counts };
}
