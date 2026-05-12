import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R119 F559 — `<html lang>` must be synced before first paint so SR engines,
// browser auto-translate, and Googlebot all see the right locale. The store
// (web/src/i18n/store.ts) handles runtime locale changes via applyToDOM, but
// the BRIEF FOUC window before the React bundle parses/executes still serves
// the static <html lang> attribute to bots and pre-script SR snapshots. The
// inline <script> in index.html closes that window by reading
// `autoviral.locale` from localStorage (same source of truth as store.ts) and
// setting <html lang> synchronously, mirroring the existing data-theme script.
//
// This contract test guards against the script being trimmed or moved out of
// the synchronous pre-paint position. It does NOT run the script — it just
// asserts the source HTML contains both the localStorage read and the
// `<html lang>` setattribute call.

describe("index.html F559 lang sync (synchronous pre-paint)", () => {
  const html = readFileSync(
    resolve(__dirname, "../../index.html"),
    "utf-8",
  );

  it("reads autoviral.locale from localStorage", () => {
    expect(html).toMatch(/localStorage\.getItem\(\s*["']autoviral\.locale["']\s*\)/);
  });

  it("falls back to navigator.language /^zh/i when localStorage missing", () => {
    expect(html).toMatch(/\/\^zh\/i\.test\(/);
  });

  it("sets <html lang> to zh-CN or en-US synchronously", () => {
    expect(html).toMatch(/setAttribute\(\s*["']lang["']\s*,\s*l === "zh" \? "zh-CN" : "en-US"\s*\)/);
  });

  it("the lang script runs in the same <script> block as the data-theme script (single sync block)", () => {
    // Both setters must live inside the same head <script> so a single
    // synchronous execution covers both; if someone refactors them apart
    // we risk an extra parse/exec hop and a longer FOUC window.
    const scriptBlocks = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    const inlineScript = scriptBlocks.find((m) => m[1].includes("data-theme"));
    expect(inlineScript).toBeDefined();
    expect(inlineScript![1]).toContain("autoviral.locale");
    expect(inlineScript![1]).toContain("lang");
  });
});
