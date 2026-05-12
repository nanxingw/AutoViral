import { describe, it, expect } from "vitest";
import { audienceStatusLabel } from "./Analytics";

// Returns an i18n MessageKey since e2e-report F38 (hero hardcoded EN) — the
// actual displayed string is resolved by useT() at render time.
describe("audienceStatusLabel", () => {
  it("returns stillCold key when today has zero activity AND engagement is zero", () => {
    expect(audienceStatusLabel(0, 0, 0)).toBe("analytics.statusStillCold");
  });

  it("returns warmingUp key for tiny but non-zero engagement", () => {
    expect(audienceStatusLabel(0.005, 1, 0)).toBe("analytics.statusWarmingUp");
  });

  it("returns aliveAndWell key in the typical creator range (1–5%)", () => {
    expect(audienceStatusLabel(0.025, 50, 8)).toBe("analytics.statusAliveAndWell");
  });

  it("returns humming key between 5% and 10%", () => {
    expect(audienceStatusLabel(0.07, 200, 30)).toBe("analytics.statusHumming");
  });

  it("returns onFire key above 10%", () => {
    expect(audienceStatusLabel(0.18, 1000, 200)).toBe("analytics.statusOnFire");
  });

  it("does not return stillCold just because engagement is zero — checks today activity too", () => {
    // Theoretical: engagement was 0 last 7 days but new likes today — skip
    // 'still cold' bucket so we don't undersell the day. Goes to warmingUp.
    expect(audienceStatusLabel(0, 5, 0)).toBe("analytics.statusWarmingUp");
  });
});
