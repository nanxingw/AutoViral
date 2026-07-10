import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// PRD-0013 S2 regression net — the pill fallback rule (Studio plain buttons)
// pins font-size:11px / font-weight:500. S2 wrapped its selector in :where()
// to drop it to (0,0,0) so CSS Modules (0,1,0) can override. BUT the sibling
// reset `button { font: inherit }` sits at (0,0,1) — strictly above (0,0,0) —
// so it re-inherited a larger/lighter font onto every plain Studio pill,
// silently undoing the pinned chrome (invisible to jsdom cascade).
//
// Contract this guards (external cascade behaviour, not implementation):
//   1. For a plain <button> inside .studio-shell, the pill rule's font-size
//      MUST win over the `button { font: inherit }` reset.
//   2. The pill rule MUST still lose to a single CSS-Module class (0,1,0) —
//      S2's whole point — so an over-correction that bumps it above modules
//      is also caught.
//
// Approach mirrors tokens.contrast.test.ts: parse globals.css, hand-roll the
// tiny bit of CSS algebra we need (specificity + tie-by-source-order) rather
// than pull in a heavy CSS engine.

type Spec = [number, number, number];

function cmp(a: Spec, b: Spec): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

// Compute CSS specificity [id, class/attr/pseudo-class, element/pseudo-element].
// Handles :where() (→ 0), :is()/:not()/:has() (→ most specific argument).
function computeSpecificity(selector: string): Spec {
  let a = 0;
  let b = 0;
  let c = 0;
  const s = selector;
  let i = 0;
  const isIdent = (ch: string) =>
    /[a-zA-Z0-9_-]/.test(ch) || ch.charCodeAt(0) > 127;
  function readIdent(): string {
    const start = i;
    while (i < s.length && isIdent(s[i])) i++;
    return s.slice(start, i);
  }
  function readParen(): string {
    // assumes s[i] === '('
    let depth = 0;
    const start = i;
    for (; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          return s.slice(start + 1, i - 1);
        }
      }
    }
    return s.slice(start + 1);
  }
  while (i < s.length) {
    const ch = s[i];
    if (ch === "#") {
      i++;
      readIdent();
      a++;
    } else if (ch === ".") {
      i++;
      readIdent();
      b++;
    } else if (ch === "[") {
      b++;
      while (i < s.length && s[i] !== "]") i++;
      if (i < s.length) i++;
    } else if (ch === ":") {
      if (s[i + 1] === ":") {
        i += 2;
        readIdent();
        c++;
        if (i < s.length && s[i] === "(") readParen();
      } else {
        i++;
        const name = readIdent().toLowerCase();
        let inner = "";
        if (i < s.length && s[i] === "(") inner = readParen();
        if (name === "where") {
          // contributes nothing
        } else if (name === "not" || name === "is" || name === "has") {
          let best: Spec = [0, 0, 0];
          for (const arg of splitTopLevel(inner, ",")) {
            const sp = computeSpecificity(arg);
            if (cmp(sp, best) > 0) best = sp;
          }
          a += best[0];
          b += best[1];
          c += best[2];
        } else {
          // ordinary pseudo-class (incl. functional like :nth-child)
          b++;
        }
      }
    } else if (isIdent(ch)) {
      const id = readIdent();
      if (id && id !== "*") c++;
    } else {
      // combinators, whitespace, '*', commas handled by caller
      i++;
    }
  }
  return [a, b, c];
}

const cssPath = resolve(__dirname, "../styles/globals.css");
// Strip /* … */ comments so selector text can't be polluted by prose that
// happens to mention `button` / `studio-shell`.
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Extract the `button { font: inherit }` reset selector (whatever form it now
// takes — bare `button` or lowered `:where(button)`).
function extractResetSelector(): { selector: string; index: number } {
  const m = css.match(
    /(?:^|\n)([^\n{}]*?)\s*\{\s*font:\s*inherit;?\s*\}/,
  );
  if (!m) throw new Error("could not find `button { font: inherit }` reset");
  return { selector: m[1].trim(), index: m.index ?? 0 };
}

// Extract the pill rule block that pins font-size:11px + font-weight:500 and
// return the selector in its list that targets a plain <button> in .studio-shell.
function extractPillPlainButtonSelector(): { selector: string; index: number } {
  const blocks = css.split("}");
  let offset = 0;
  for (const block of blocks) {
    const blockStart = offset;
    offset += block.length + 1; // +1 for the stripped '}'
    if (block.includes("font-size: 11px") && block.includes("font-weight: 500")) {
      const braceAt = block.indexOf("{");
      const selectorList = block.slice(0, braceAt);
      const selectors = splitTopLevel(selectorList, ",");
      // plain-button selector = the one referencing both studio-shell + button
      const plain = selectors.find(
        (sel) => sel.includes("button") && sel.includes("studio-shell"),
      );
      if (!plain) {
        throw new Error(
          "pill rule found but no studio-shell button selector: " + selectorList,
        );
      }
      return { selector: plain, index: blockStart + selectorList.indexOf(plain) };
    }
  }
  throw new Error("could not find pill rule (font-size:11px + font-weight:500)");
}

describe("Studio pill fallback cascade (PRD-0013 S2)", () => {
  const reset = extractResetSelector();
  const pill = extractPillPlainButtonSelector();
  const specReset = computeSpecificity(reset.selector);
  const specPill = computeSpecificity(pill.selector);

  it("pins font over the `button { font: inherit }` reset", () => {
    // Winner = higher specificity; on a tie, the later-declared rule wins.
    const pillWins =
      cmp(specPill, specReset) > 0 ||
      (cmp(specPill, specReset) === 0 && pill.index > reset.index);
    expect(
      pillWins,
      `pill selector "${pill.selector}" (${specPill}) must beat reset "${reset.selector}" (${specReset}) for a plain Studio button; reset@${reset.index} pill@${pill.index}`,
    ).toBe(true);
  });

  it("still loses to a single CSS-Module class (S2 invariant)", () => {
    const moduleClass: Spec = [0, 1, 0];
    expect(
      cmp(specPill, moduleClass) < 0,
      `pill selector "${pill.selector}" (${specPill}) must stay below a CSS-Module class (0,1,0) so components can override`,
    ).toBe(true);
  });

  it("specificity helper handles :where / :not correctly (self-check)", () => {
    expect(computeSpecificity("button")).toEqual([0, 0, 1]);
    expect(computeSpecificity(":where(button)")).toEqual([0, 0, 0]);
    expect(computeSpecificity(".foo")).toEqual([0, 1, 0]);
    expect(
      computeSpecificity(
        ":where(.studio-shell) :where(button:not(.send-btn):not([data-bare]))",
      ),
    ).toEqual([0, 0, 0]);
  });
});
