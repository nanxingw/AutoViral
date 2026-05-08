import { describe, it, expect } from "vitest";
import { audienceStatusLabel } from "./Analytics";

describe("audienceStatusLabel", () => {
  it("returns 'still cold' when today has zero activity AND engagement is zero", () => {
    expect(audienceStatusLabel(0, 0, 0)).toBe("still cold");
  });

  it("returns 'warming up' for tiny but non-zero engagement", () => {
    expect(audienceStatusLabel(0.005, 1, 0)).toBe("warming up");
  });

  it("returns 'alive and well' in the typical creator range (1–5%)", () => {
    expect(audienceStatusLabel(0.025, 50, 8)).toBe("alive and well");
  });

  it("returns 'humming' between 5% and 10%", () => {
    expect(audienceStatusLabel(0.07, 200, 30)).toBe("humming");
  });

  it("returns 'on fire' above 10%", () => {
    expect(audienceStatusLabel(0.18, 1000, 200)).toBe("on fire");
  });

  it("does not return 'still cold' just because engagement is zero — checks today activity too", () => {
    // Theoretical: engagement was 0 last 7 days but new likes today — skip
    // 'still cold' bucket so we don't undersell the day. Goes to 'warming up'.
    expect(audienceStatusLabel(0, 5, 0)).toBe("warming up");
  });
});
