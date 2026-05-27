import { describe, it, expect } from "vitest";
import { isPlaceholderWorkTitle, displayWorkTitle } from "./workTitle";
import { MESSAGES } from "@/i18n/messages";

// #83 — work title localization. The root cause was NewWorkCard baking the
// localized "Untitled"/"未命名" placeholder into the persisted title, freezing
// its language. These helpers re-localize at render: blank titles AND historic
// baked-placeholder literals both fall back to the current-locale placeholder.

const EN_PLACEHOLDER = MESSAGES.en.works.untitledWork; // "Untitled"
const ZH_PLACEHOLDER = MESSAGES.zh.works.untitledWork; // "未命名"

describe("isPlaceholderWorkTitle (#83)", () => {
  it("treats empty / null / undefined as placeholder", () => {
    expect(isPlaceholderWorkTitle("")).toBe(true);
    expect(isPlaceholderWorkTitle(null)).toBe(true);
    expect(isPlaceholderWorkTitle(undefined)).toBe(true);
    expect(isPlaceholderWorkTitle("   ")).toBe(true); // whitespace-only
  });

  it("matches a baked EN placeholder literal", () => {
    expect(isPlaceholderWorkTitle(EN_PLACEHOLDER)).toBe(true);
  });

  it("matches a baked ZH placeholder literal (cross-locale)", () => {
    expect(isPlaceholderWorkTitle(ZH_PLACEHOLDER)).toBe(true);
  });

  it("does NOT match a real user title", () => {
    expect(isPlaceholderWorkTitle("樱花咖啡馆")).toBe(false);
    expect(isPlaceholderWorkTitle("My cool video")).toBe(false);
  });
});

describe("displayWorkTitle (#83)", () => {
  it("returns the current-locale placeholder for a blank title", () => {
    expect(displayWorkTitle("", "未命名")).toBe("未命名");
    expect(displayWorkTitle(null, "Untitled")).toBe("Untitled");
  });

  it("re-localizes a historic EN-baked title to the current locale", () => {
    // The bug: an EN-created blank work stored "Untitled". Viewed in ZH the
    // caller passes the ZH placeholder; we must show that, not "Untitled".
    expect(displayWorkTitle(EN_PLACEHOLDER, ZH_PLACEHOLDER)).toBe(ZH_PLACEHOLDER);
  });

  it("re-localizes a historic ZH-baked title when viewed in EN", () => {
    expect(displayWorkTitle(ZH_PLACEHOLDER, EN_PLACEHOLDER)).toBe(EN_PLACEHOLDER);
  });

  it("passes a real title through unchanged", () => {
    expect(displayWorkTitle("樱花咖啡馆", "未命名")).toBe("樱花咖啡馆");
  });
});
