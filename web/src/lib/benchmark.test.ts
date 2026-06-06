import { describe, it, expect } from "vitest";
import {
  followerTier,
  positionInBand,
  type BenchmarkMetric,
  type Platform,
} from "./benchmark";

/**
 * D2 — benchmark positioning pure core (PRD-0006 S3).
 *
 * Tests assert the external contract only: (platform, tier, metric, value) →
 * {band position, diagnostic copy key, reassurance copy key}. The honesty
 * constraint is the load-bearing test: the user's REAL platform is Douyin, so
 * a Douyin engagement band MUST be platform-correct (referenceOnly === false)
 * — never a silent apples-to-oranges TikTok/IG borrow. Any (platform, metric)
 * combo without a trustworthy Douyin baseline MUST be labelled referenceOnly
 * so the UI can say 「参考性、非你所在平台」.
 */

describe("followerTier", () => {
  it("maps the user's 5-follower account into the nano tier", () => {
    expect(followerTier(5)).toBe("nano");
  });

  it("walks the tier ladder by follower count", () => {
    expect(followerTier(0)).toBe("nano");
    expect(followerTier(999)).toBe("nano");
    expect(followerTier(1_000)).toBe("micro");
    expect(followerTier(9_999)).toBe("micro");
    expect(followerTier(10_000)).toBe("mid");
    expect(followerTier(99_999)).toBe("mid");
    expect(followerTier(100_000)).toBe("macro");
    expect(followerTier(5_000_000)).toBe("macro");
  });
});

describe("positionInBand — band classification", () => {
  it("classifies a value below the band low as 'below'", () => {
    // Douyin nano engagement band is well above 2.6% at the low end; 0.026
    // (2.6%) should read as below the nano median.
    const r = positionInBand("douyin", "nano", "engagement", 0.026);
    expect(r.band).toBe("below");
    expect(r.value).toBe(0.026);
  });

  it("classifies a value inside the band as 'within'", () => {
    const within = (lo: number, hi: number) => (lo + hi) / 2;
    const r = positionInBand("douyin", "nano", "engagement", within(0.06, 0.12));
    expect(r.band).toBe("within");
  });

  it("classifies a value above the band high as 'above'", () => {
    const r = positionInBand("douyin", "nano", "engagement", 0.5);
    expect(r.band).toBe("above");
  });

  it("exposes the band's low / median / high for the UI rail", () => {
    const r = positionInBand("douyin", "nano", "engagement", 0.026);
    expect(r.low).toBeGreaterThan(0);
    expect(r.high).toBeGreaterThan(r.low);
    expect(r.median).toBeGreaterThanOrEqual(r.low);
    expect(r.median).toBeLessThanOrEqual(r.high);
  });
});

describe("positionInBand — diagnostic + reassurance copy keys", () => {
  it("returns a diagnostic key + the band range as params (a diagnostic statement, not an isolated number)", () => {
    const r = positionInBand("douyin", "nano", "engagement", 0.026);
    expect(r.diagnosticKey).toMatch(/^analytics\.benchmark\.diag/);
    // the UI needs the band edges to render '目标区间 X–Y'
    expect(r.diagnosticParams).toHaveProperty("low");
    expect(r.diagnosticParams).toHaveProperty("high");
    expect(r.diagnosticParams).toHaveProperty("median");
  });

  it("attaches the 'small accounts engage higher' reassurance only when below-band on the nano/micro tiers", () => {
    const below = positionInBand("douyin", "nano", "engagement", 0.026);
    expect(below.reassuranceKey).toBe("analytics.benchmark.reassureSmallAccount");

    // within/above band: no reassurance needed — don't nag a healthy number.
    const within = positionInBand("douyin", "nano", "engagement", 0.09);
    expect(within.reassuranceKey).toBeNull();

    // a macro account below band gets no "you're small" reassurance (it's not).
    const macroBelow = positionInBand("douyin", "macro", "engagement", 0.001);
    expect(macroBelow.reassuranceKey).toBeNull();
  });
});

describe("positionInBand — HONESTY constraint (no silent apples-to-oranges)", () => {
  it("uses a platform-correct Douyin band for the user's real platform (NOT a borrowed TikTok/IG band)", () => {
    const r = positionInBand("douyin", "nano", "engagement", 0.026);
    expect(r.platform).toBe("douyin");
    expect(r.referenceOnly).toBe(false);
    // a real Douyin baseline must carry a provenance source, not be anonymous
    expect(r.source).toBeTruthy();
  });

  it("marks a band as referenceOnly when there is no trustworthy Douyin baseline for that metric", () => {
    // We do NOT publish trustworthy per-tier Douyin baselines for absolute
    // play/like/comment counts (too content-dependent). If a band is offered
    // at all for those, it MUST be flagged reference-only, never silently
    // compared as if it were the user's platform.
    const r = positionInBand("douyin", "nano", "playCount" as BenchmarkMetric, 624);
    if (r.band !== "unavailable") {
      expect(r.referenceOnly).toBe(true);
    } else {
      // honest alternative: no band at all rather than a fake one
      expect(r.referenceOnly).toBe(true);
      expect(r.diagnosticKey).toBe("analytics.benchmark.noBand");
    }
  });

  it("marks a band as referenceOnly when the platform itself has no trustworthy Douyin-equivalent baseline", () => {
    // xiaohongshu has no public engagement baseline we trust — if we still
    // show a band, it must be flagged reference-only so the user is never
    // told a number is 'good/bad for their platform' when it isn't.
    const r = positionInBand("xiaohongshu" as Platform, "nano", "engagement", 0.026);
    expect(r.referenceOnly).toBe(true);
  });

  it("never returns referenceOnly:false without a real source (the flag and the data can't disagree)", () => {
    const platforms: Platform[] = ["douyin", "xiaohongshu", "tiktok", "youtube"];
    for (const p of platforms) {
      const r = positionInBand(p, "nano", "engagement", 0.026);
      if (r.referenceOnly === false) {
        expect(r.source).toBeTruthy();
        expect(r.platform).toBe(p);
      }
    }
  });
});
