import { describe, it, expect } from "vitest";
import {
  parseCollectorResult,
  isCollectorError,
  type CollectorError,
} from "./collector-parse.js";
import type { CreatorData } from "./analytics-collector.js";

// ── D4 parse boundary (PRD-0006 §D4, slice S5) ───────────────────────────────
//
// The Douyin collector is a managed-venv Python script (f2 + browser_cookie3).
// Its actual scrape is integration-only (needs the user logged into douyin.com),
// but the boundary that turns the script's raw f2 JSON into our typed
// CreatorData — OR into a structured, actionable CollectorError — is a PURE
// function and is what the green-gate pins. These fixtures are inlined raw
// shapes the script emits; we never touch the user's home dir.

// A success payload, exactly the shape platforms/douyin.py prints to stdout.
// Trimmed to 2 works; the parser must not care how many.
const RAW_SUCCESS = {
  platform: "douyin",
  collected_at: "2026-05-14T11:00:10.487206+00:00",
  account: {
    sec_user_id: "MS4wLjABAAAArb6UbCYc8bNWAVqerlyO4jPoiCQ",
    nickname: "Mirodream",
    signature: "AI创作者_",
    uid: "3233008185010808",
    unique_id: "72777520517",
    follower_count: 5,
    following_count: 40,
    total_favorited: 152,
    aweme_count: 9,
  },
  works: [
    {
      aweme_id: "7637734153022270961",
      desc: "陪女朋友看球赛~ #体育场看台拍照 #女球迷",
      create_time: "2026-05-09 11:49:20",
      aweme_type: 0,
      play_count: 565,
      digg_count: 20,
      comment_count: 0,
      share_count: 1,
      collect_count: 0,
    },
    {
      aweme_id: "7519355599802944808",
      desc: "埃及奇遇 #我要上热门 #日常volg",
      create_time: "2025-06-24 11:40:16",
      aweme_type: 0,
      play_count: 2705,
      digg_count: 23,
      comment_count: 0,
      share_count: 0,
      collect_count: 3,
    },
  ],
  summary: {
    total_works_collected: 9,
    avg_play: 624,
    avg_digg: 16,
    avg_comment: 0,
    avg_share: 0,
    avg_collect: 0,
    engagement_rate: 0.0256,
  },
};

describe("parseCollectorResult — happy path (raw f2 JSON → CreatorData)", () => {
  it("returns a typed CreatorData for a well-formed success payload", () => {
    const out = parseCollectorResult(RAW_SUCCESS);
    expect(isCollectorError(out)).toBe(false);
    const data = out as CreatorData;
    expect(data.platform).toBe("douyin");
    expect(data.account.nickname).toBe("Mirodream");
    expect(data.account.follower_count).toBe(5);
    expect(data.works).toHaveLength(2);
    expect(data.works[0].aweme_id).toBe("7637734153022270961");
    expect(data.works[1].play_count).toBe(2705);
    expect(data.summary.total_works_collected).toBe(9);
    expect(data.summary.avg_play).toBe(624);
  });

  it("accepts a JSON string (the raw script stdout) as well as an object", () => {
    const out = parseCollectorResult(JSON.stringify(RAW_SUCCESS));
    expect(isCollectorError(out)).toBe(false);
    expect((out as CreatorData).account.nickname).toBe("Mirodream");
  });
});

describe("parseCollectorResult — expired cookie → structured CollectorError", () => {
  // The python collector's error_exit() prints {"error","message","platform"}.
  // An expired / app-changed session surfaces as NOT_LOGGED_IN / COOKIE_NOT_FOUND.
  it("maps a NOT_LOGGED_IN error envelope to a re-login CollectorError", () => {
    const out = parseCollectorResult({
      error: "NOT_LOGGED_IN",
      message:
        "No valid session found. Log in to douyin.com in your browser first, then close the browser and retry.",
      platform: "douyin",
    });
    expect(isCollectorError(out)).toBe(true);
    const err = out as CollectorError;
    expect(err.code).toBe("NOT_LOGGED_IN");
    // Actionable: the UI uses this flag to show a "re-login" CTA, not a blank page.
    expect(err.needsRelogin).toBe(true);
    expect(err.message).toContain("douyin.com");
  });

  it("treats a profile-fetch failure (cookie expired mid-scrape) as re-login", () => {
    const out = parseCollectorResult({
      error: "API_ERROR",
      message: "Profile fetch failed — cookie may be expired. Re-login and retry.",
      platform: "douyin",
    });
    expect(isCollectorError(out)).toBe(true);
    const err = out as CollectorError;
    expect(err.code).toBe("API_ERROR");
    // The message mentions an expired cookie → still actionable as re-login.
    expect(err.needsRelogin).toBe(true);
  });

  it("maps COOKIE_NOT_FOUND (browser still open) to a re-login CollectorError", () => {
    const out = parseCollectorResult({
      error: "COOKIE_NOT_FOUND",
      message: "Cannot read chrome cookies. Make sure chrome is fully closed, then retry.",
      platform: "douyin",
    });
    const err = out as CollectorError;
    expect(isCollectorError(out)).toBe(true);
    expect(err.code).toBe("COOKIE_NOT_FOUND");
    expect(err.needsRelogin).toBe(true);
  });

  it("a non-auth error (e.g. INVALID_URL) is structured but NOT a re-login prompt", () => {
    const out = parseCollectorResult({
      error: "INVALID_URL",
      message: "'foo' is not a valid Douyin profile URL.",
      platform: "douyin",
    });
    const err = out as CollectorError;
    expect(isCollectorError(out)).toBe(true);
    expect(err.code).toBe("INVALID_URL");
    expect(err.needsRelogin).toBe(false);
  });
});

describe("parseCollectorResult — malformed / unparseable output", () => {
  it("returns a PARSE_ERROR CollectorError for non-JSON garbage", () => {
    const out = parseCollectorResult("Traceback (most recent call last): ...");
    const err = out as CollectorError;
    expect(isCollectorError(out)).toBe(true);
    expect(err.code).toBe("PARSE_ERROR");
    expect(err.needsRelogin).toBe(false);
  });

  it("returns a PARSE_ERROR when the success shape is missing required keys", () => {
    // Looks like success (no `error` key) but has no works/account/summary.
    const out = parseCollectorResult({ platform: "douyin", collected_at: "x" });
    const err = out as CollectorError;
    expect(isCollectorError(out)).toBe(true);
    expect(err.code).toBe("PARSE_ERROR");
  });

  it("returns a PARSE_ERROR for null / undefined", () => {
    expect((parseCollectorResult(null) as CollectorError).code).toBe("PARSE_ERROR");
    expect((parseCollectorResult(undefined) as CollectorError).code).toBe("PARSE_ERROR");
  });
});
