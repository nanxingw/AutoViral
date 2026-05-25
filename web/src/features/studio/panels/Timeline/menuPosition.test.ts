import { describe, it, expect } from "vitest";
import { clampMenuToViewport } from "./menuPosition";

const VW = 1000;
const VH = 1262; // mirrors the issue's window.innerHeight
const MENU_W = 200;
const MENU_H = 210; // ~6 items, like the #39 repro

// Regression net for #39: a low track's menu opened below the fold with 0/6
// items clickable. These lock the clamp that keeps it on screen.
describe("clampMenuToViewport", () => {
  it("leaves an in-bounds position untouched", () => {
    expect(clampMenuToViewport({ top: 300, left: 400 }, MENU_W, MENU_H, VW, VH)).toEqual({
      top: 300,
      left: 400,
    });
  });

  it("pulls a bottom-overflowing menu up so its bottom edge fits (the #39 case)", () => {
    // Issue repro: top=1249 with a 210px menu → bottom 1459 >> 1262.
    const out = clampMenuToViewport({ top: 1249, left: 120 }, MENU_W, MENU_H, VW, VH);
    expect(out.top).toBe(VH - MENU_H - 8); // 1044
    expect(out.top + MENU_H).toBeLessThanOrEqual(VH); // fully visible
  });

  it("pulls a right-overflowing menu left", () => {
    const out = clampMenuToViewport({ top: 100, left: 980 }, MENU_W, MENU_H, VW, VH);
    expect(out.left).toBe(VW - MENU_W - 8); // 792
    expect(out.left + MENU_W).toBeLessThanOrEqual(VW);
  });

  it("never positions above/left of the margin", () => {
    const out = clampMenuToViewport({ top: -50, left: -50 }, MENU_W, MENU_H, VW, VH);
    expect(out).toEqual({ top: 8, left: 8 });
  });

  it("is idempotent — re-clamping a clamped value is a no-op (prevents layout-effect loop)", () => {
    const once = clampMenuToViewport({ top: 1249, left: 980 }, MENU_W, MENU_H, VW, VH);
    const twice = clampMenuToViewport(once, MENU_W, MENU_H, VW, VH);
    expect(twice).toEqual(once);
  });

  it("keeps the top-left corner visible when the menu is taller than the viewport", () => {
    const out = clampMenuToViewport({ top: 900, left: 100 }, MENU_W, 2000, VW, VH);
    expect(out.top).toBe(8); // margin wins over a negative maxTop
  });
});
