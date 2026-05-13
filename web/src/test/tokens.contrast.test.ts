import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R121 contrast horizontal slice — design tokens were systemically failing
// WCAG 2.1 SC 1.4.3 (AA normal text, 4.5:1) and 1.4.11 (UI components, 3.0:1)
// with zero CI guard. R124 closes F571 (--text-dimmer dual-theme AA fail) +
// F572 (--status-warn undefined in both themes), and seeds the first contrast
// regression net per R121 F575 (0 axe/contrast CI gate).
//
// Approach: parse tokens.css, extract per-theme values, compute relative
// luminance + contrast ratio against the theme background, assert ≥ 4.5 for
// normal text or ≥ 3.0 for UI/large. We deliberately avoid pulling in
// @axe-core/* as a heavy CI dep — a 60-line hand-rolled WCAG ratio computer
// covers the tokens we own.

function parseHex(s: string): [number, number, number] | null {
  // #rgb or #rrggbb
  const m = s.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3
    ? m[1].split("").map((c) => c + c).join("")
    : m[1];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const t = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * t(r) + 0.7152 * t(g) + 0.0722 * t(b);
}

function contrast(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) throw new Error(`bad hex ${a} ${b}`);
  const la = relLuminance(ra);
  const lb = relLuminance(rb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(
  resolve(__dirname, "../styles/tokens.css"),
  "utf-8",
);

/** Extract a per-token map for a given selector block (`:root` for dark, `[data-theme="light"]` for light). */
function extractBlock(selector: string): Record<string, string> {
  const escapedSel = selector.replace(/[\[\]="]/g, (c) => `\\${c}`);
  const re = new RegExp(`${escapedSel}\\s*\\{([\\s\\S]*?)\\}`, "m");
  const m = css.match(re);
  if (!m) throw new Error(`block ${selector} not found in tokens.css`);
  const body = m[1];
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const dm = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+?)\s*;/i);
    if (dm) out[dm[1]] = dm[2].trim();
  }
  return out;
}

const dark = extractBlock(":root");
const light = extractBlock('[data-theme="light"]');

describe("tokens.css contrast (R121 F571/F572 + R127 F622/F624 — full text+status token sweep)", () => {
  // R121 F571 — --text-dimmer was 3.02 (light) / 3.37 (dark), now lifted past AA.
  it("dark --text-dimmer ≥ AA 4.5 vs --bg (F571)", () => {
    const ratio = contrast(dark["--text-dimmer"], dark["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
  it("light --text-dimmer ≥ AA 4.5 vs --bg (F571)", () => {
    const ratio = contrast(light["--text-dimmer"], light["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  // R121 F572 — --status-warn must exist in both themes and meet AA against bg
  // so warn UI is legible (it's an information channel, not decoration).
  it("dark --status-warn is defined", () => {
    expect(dark["--status-warn"]).toBeTruthy();
  });
  it("light --status-warn is defined", () => {
    expect(light["--status-warn"]).toBeTruthy();
  });
  it("dark --status-warn ≥ AA 4.5 vs --bg (F572)", () => {
    const ratio = contrast(dark["--status-warn"], dark["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
  it("light --status-warn ≥ AA 4.5 vs --bg (F572)", () => {
    const ratio = contrast(light["--status-warn"], light["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  // R127 F622 — --status-pending was 3.81 (dark) / 2.27 (light), double-FAIL AA.
  // R121 modeling left this token unaudited — M230 "point fix ≠ table sweep"
  // closure starts here. Lifted in both themes past AA.
  it("dark --status-pending ≥ AA 4.5 vs --bg (R127 F622)", () => {
    const ratio = contrast(dark["--status-pending"], dark["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
  it("light --status-pending ≥ AA 4.5 vs --bg (R127 F622)", () => {
    const ratio = contrast(light["--status-pending"], light["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  // R127 F624 — --text-muted was 2.11 (dark) / 1.75 (light), catastrophic FAIL
  // even against AA Large (3.0). Surfaces disabled placeholder + archived-meta;
  // was completely illegible to low-vision users.
  it("dark --text-muted ≥ AA 4.5 vs --bg (R127 F624)", () => {
    const ratio = contrast(dark["--text-muted"], dark["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
  it("light --text-muted ≥ AA 4.5 vs --bg (R127 F624)", () => {
    const ratio = contrast(light["--text-muted"], light["--bg"]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  // Regression net for the other text-tier tokens that already passed at R121
  // audit time — keeps them from being silently darkened/lightened away.
  it("dark --text & --text-dim still meet AA vs --bg", () => {
    expect(contrast(dark["--text"], dark["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark["--text-dim"], dark["--bg"])).toBeGreaterThanOrEqual(4.5);
  });
  it("light --text & --text-dim still meet AA vs --bg", () => {
    expect(contrast(light["--text"], light["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light["--text-dim"], light["--bg"])).toBeGreaterThanOrEqual(4.5);
  });

  // R127 M230 — full-table sweep guard. Once R121 contrast plane is "closed",
  // every text + status token that surfaces user-visible labels must clear AA.
  // This loop is the structural enforcement: if a future PR adds a new
  // --text-* or --status-* hex token, it falls into this matrix automatically.
  // Excluded: --status-running / --status-done / --status-error (saturated
  // accent colors with intentional brand hue — they're audited as a separate
  // tier for ratio ≥ 3.0 + non-text use; promoting to 4.5 would break the
  // editorial palette).
  const TEXT_TOKENS_REQUIRING_AA = [
    "--text",
    "--text-dim",
    "--text-dimmer",
    "--text-muted",
    "--status-pending",
    "--status-warn",
  ] as const;
  for (const tok of TEXT_TOKENS_REQUIRING_AA) {
    it(`dark ${tok} clears AA matrix gate (full-sweep guard, M230)`, () => {
      expect(contrast(dark[tok], dark["--bg"])).toBeGreaterThanOrEqual(4.5);
    });
    it(`light ${tok} clears AA matrix gate (full-sweep guard, M230)`, () => {
      expect(contrast(light[tok], light["--bg"])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
