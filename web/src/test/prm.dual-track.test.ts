import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R126 F607 + F608 + F616 seed — `prefers-reduced-motion` defense lives in
// two independent tracks (M222): CSS `@media` in globals.css handles CSS
// animation/transition, and JS reads `useReducedMotion()` to gate framer-
// motion + DOM APIs like `scrollIntoView({ behavior: "smooth" })`.
// Before R127, the JS track was completely absent (0 hits across web/src).
// This contract test pins the wiring so a future PR introducing another
// motion component without PRM gating regresses CI rather than silently
// shipping vestibular-unsafe behavior.

const read = (rel: string) =>
  readFileSync(resolve(__dirname, "..", rel), "utf-8");

describe("PRM dual-track defense (R126 F607 / F608 / F616 seed)", () => {
  // F607 — main.tsx must wrap the app in `<MotionConfig reducedMotion="user">`
  // so all 9 framer-motion dialog/sidebar components inherit PRM-respecting
  // defaults automatically. `reducedMotion="user"` is the documented opt-in
  // that makes motion components honor the OS-level setting.
  describe("F607 — <MotionConfig reducedMotion='user'> at root", () => {
    const src = read("main.tsx");

    it("imports MotionConfig from motion/react", () => {
      expect(src).toMatch(/import\s*{[^}]*\bMotionConfig\b[^}]*}\s*from\s*["']motion\/react["']/);
    });

    it('wraps the router tree with reducedMotion="user"', () => {
      expect(src).toMatch(/<MotionConfig\s+reducedMotion=["']user["']\s*>/);
    });

    it("MotionConfig encloses BrowserRouter (not the other way around)", () => {
      const mcOpen = src.indexOf("<MotionConfig");
      const brOpen = src.indexOf("<BrowserRouter");
      const brClose = src.indexOf("</BrowserRouter>");
      const mcClose = src.indexOf("</MotionConfig>");
      // Order must be: MotionConfig open → BrowserRouter open → BrowserRouter close → MotionConfig close
      expect(mcOpen).toBeGreaterThan(-1);
      expect(brOpen).toBeGreaterThan(mcOpen);
      expect(brClose).toBeGreaterThan(brOpen);
      expect(mcClose).toBeGreaterThan(brClose);
    });
  });

  // F608 — SettingsPanel.tsx had `scrollIntoView({ behavior: "smooth" })`
  // hardcoded; CSS PRM can't reach JS option values (M223), so this had to
  // be gated by `useReducedMotion()` at runtime.
  describe("F608 — SettingsPanel scrollIntoView is PRM-gated", () => {
    const src = read("features/settings/SettingsPanel.tsx");

    it("imports useReducedMotion from motion/react", () => {
      expect(src).toMatch(/import\s*{[^}]*\buseReducedMotion\b[^}]*}\s*from\s*["']motion\/react["']/);
    });

    it("reads useReducedMotion() into a local variable", () => {
      expect(src).toMatch(/const\s+\w+\s*=\s*useReducedMotion\s*\(\s*\)/);
    });

    it("does NOT call scrollIntoView with hardcoded smooth behavior", () => {
      // The literal hardcoded form must be gone. Allow the ternary form
      // `behavior: prm ? "auto" : "smooth"` to remain.
      expect(src).not.toMatch(/scrollIntoView\s*\(\s*{\s*behavior:\s*["']smooth["']/);
    });

    it("scrollIntoView call references the PRM variable for behavior", () => {
      // Match `scrollIntoView({ behavior: <ident> ? "auto" : "smooth", ... })`
      // where <ident> is the const captured from useReducedMotion().
      expect(src).toMatch(
        /scrollIntoView\s*\(\s*{[^}]*behavior:\s*\w+\s*\?\s*["']auto["']\s*:\s*["']smooth["']/,
      );
    });
  });

  // F616 — globals.css PRM block stays in place as the CSS half of M222.
  // Removing it would silently disable PRM for all CSS animations, so the
  // dual-track defense requires both halves to exist.
  describe("F616 — globals.css PRM block still present (CSS half of M222)", () => {
    const src = read("styles/globals.css");

    it("declares @media (prefers-reduced-motion: reduce)", () => {
      expect(src).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
    });

    it("the PRM block caps animation-duration", () => {
      // Pattern intentionally loose — match either 0.01ms canonical or 0s.
      expect(src).toMatch(/animation-duration\s*:\s*0(?:\.\d+ms|s|ms)/);
    });
  });
});
