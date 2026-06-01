/**
 * `autoviral validate` — WCAG contrast audit on declared color tokens.
 *
 * H1.3 static-analysis approximation. Samples each caption group's
 * declared text color against its declared background color (rgba string
 * parsed, alpha-blended against an estimated frame mean). The runtime
 * puppeteer-based pixel sampling is a follow-up (--accurate flag).
 *
 * Uses the hand-rolled WCAG ratio formula (per memory
 * reference_wcag_token_test_pattern.md) — no axe-core / paint dependency.
 */
import { CompositionSchema } from "../../shared/composition.js";

export interface WcagFinding {
  severity: "warning";
  ruleId: "wcag-aa-contrast" | "wcag-aaa-contrast";
  message: string;
  locator?: string;
  ratio: number;
  threshold: number;
}

export interface ValidateReport {
  findings: WcagFinding[];
  counts: { warning: number };
}

// ── WCAG ratio helpers — single source of truth, no dep ──────────────
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{3,8})$/.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!;
  if (h.length === 3) {
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16)];
  }
  if (h.length === 6 || h.length === 8) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

function parseRgba(s: string): [number, number, number, number] | null {
  const m = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(s);
  if (!m) return null;
  return [+m[1]!, +m[2]!, +m[3]!, m[4] !== undefined ? +m[4]! : 1];
}

function parseColor(s: string | undefined): [number, number, number, number] | null {
  // color/background are optional in the schema; an absent value parses to
  // null (same as an unparseable string) so callers hit the `if (!fg...)`
  // early-return — the existing graceful-skip path.
  if (s === undefined) return null;
  if (s.startsWith("rgb")) return parseRgba(s);
  const hex = parseHex(s);
  return hex ? [hex[0], hex[1], hex[2], 1] : null;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(...fg);
  const l2 = relativeLuminance(...bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function alphaBlend(
  fg: [number, number, number, number],
  bg: [number, number, number],
): [number, number, number] {
  // Composite RGBA over an opaque RGB base
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}

// Assume a mid-gray base behind the caption layer for the static check.
// The real pixel sampler will hit the actual frame.
const ASSUMED_FRAME_BASE: [number, number, number] = [80, 80, 80];

export function validateComposition(input: unknown): ValidateReport {
  const parsed = CompositionSchema.safeParse(input);
  if (!parsed.success) {
    return { findings: [], counts: { warning: 0 } };
  }
  const comp = parsed.data;
  const findings: WcagFinding[] = [];

  if (comp.captions) {
    comp.captions.groups.forEach((g, gi) => {
      const fg = parseColor(g.style.color);
      const bgRgba = parseColor(g.style.background);
      if (!fg || !bgRgba) return;
      // Composite caption bg over assumed frame base, then check fg vs that.
      const effectiveBg = alphaBlend(bgRgba, ASSUMED_FRAME_BASE);
      const r = ratio([fg[0], fg[1], fg[2]], effectiveBg);
      // Large text threshold (≥18pt or 14pt bold) is 3:1; the conservative
      // default for caption-style text is 4.5:1 AA.
      // fontSize is `number | string`; `>=` already coerced strings to numbers
      // at runtime (`"40" >= 56` === `40 >= 56`), so Number(...) is identical.
      const isLargeText = Number(g.style.fontSize) >= 56; // ~24pt+ at standard DPI
      const threshold = isLargeText ? 3 : 4.5;
      if (r < threshold) {
        findings.push({
          severity: "warning",
          ruleId: "wcag-aa-contrast",
          message: `group "${g.groupId}" contrast ${r.toFixed(2)}:1 below AA ${threshold}:1 (fg ${g.style.color} on bg ${g.style.background})`,
          locator: `captions.groups[${gi}]`,
          ratio: r,
          threshold,
        });
      }
    });
  }

  return { findings, counts: { warning: findings.length } };
}
