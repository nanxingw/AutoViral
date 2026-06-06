import { describe, it, expect } from "vitest";
import {
  buildCoachSystemPrompt,
  summarizeWorksForCoach,
  isCoachKey,
  coachKeyFor,
  estimateTokens,
  fitWorksToBudget,
  COACH_TOKEN_BUDGET,
  COACH_DEFAULT_MODEL,
  type CoachWorkInput,
  type CoachContext,
} from "./coach-session.js";

/**
 * Fixture inlined from the user's frozen Douyin scrape
 * (~/.autoviral/analytics/douyin/latest.json) — 9 real published works.
 * Do NOT depend on the user home dir; inline so the test is hermetic.
 * Highest-play work is the Egypt vlog (2705); lowest is the farewell clip (20).
 */
const WORKS: CoachWorkInput[] = [
  { desc: "陪女朋友看球赛~ #体育场看台拍照 #女球迷", playCount: 565, diggCount: 20, commentCount: 0, shareCount: 1, collectCount: 0 },
  { desc: "🖤#二次元 #壁纸", playCount: 67, diggCount: 8, commentCount: 0, shareCount: 0, collectCount: 0 },
  { desc: "lights on the street #街头穿搭 #蕾丝", playCount: 967, diggCount: 60, commentCount: 0, shareCount: 0, collectCount: 2 },
  { desc: "月球战争PV #科幻 #月球 #战争", playCount: 581, diggCount: 10, commentCount: 2, shareCount: 0, collectCount: 0 },
  { desc: "猪的忧郁我不懂 #生化危机 #忧郁 #猪猪侠", playCount: 63, diggCount: 6, commentCount: 0, shareCount: 0, collectCount: 0 },
  { desc: "起早了，梦到成哮天犬了#小狗🐶 #萌宠出道计划 #狗狗", playCount: 276, diggCount: 20, commentCount: 0, shareCount: 0, collectCount: 1 },
  { desc: "埃及奇遇 #我要上热门 #日常volg #感谢抖音官大大热门", playCount: 2705, diggCount: 23, commentCount: 0, shareCount: 0, collectCount: 3 },
  { desc: "”所以，我们还会再见吗？“", playCount: 20, diggCount: 2, commentCount: 0, shareCount: 0, collectCount: 0 },
  { desc: "“自由的从来不是眼前的风景，而是纯粹的灵魂。”", playCount: 377, diggCount: 2, commentCount: 0, shareCount: 0, collectCount: 0 },
];

const baseContext = (overrides: Partial<CoachContext> = {}): CoachContext => ({
  platform: "douyin",
  works: WORKS,
  trendTopics: ["秋冬穿搭挑战", "城市夜骑", "AI 写真"],
  interests: ["穿搭", "科幻"],
  ...overrides,
});

// ── Coach session keying (persisted, NOT ephemeral trends_) ────────────────

describe("coach session keying", () => {
  it("recognises coach_* keys and not trends_/work ids", () => {
    expect(isCoachKey("coach_main")).toBe(true);
    expect(isCoachKey(coachKeyFor("main"))).toBe(true);
    expect(isCoachKey("trends_douyin")).toBe(false);
    expect(isCoachKey("w_abc123")).toBe(false);
  });

  it("mints a stable coach key with the coach_ prefix", () => {
    expect(coachKeyFor("main")).toBe("coach_main");
    // distinct namespace from trends_
    expect(coachKeyFor("main").startsWith("coach_")).toBe(true);
    expect(coachKeyFor("main").startsWith("trends_")).toBe(false);
  });

  it("uses a session-scoped default model that is NOT the editing default", () => {
    // The coach picks its own tier; it must be a real alias and must not be the
    // empty string (which would fall back to whatever global config.model is).
    expect(["opus", "sonnet", "haiku"]).toContain(COACH_DEFAULT_MODEL);
  });
});

// ── summarizeWorksForCoach — lazy / capped context (cost guardrail) ─────────

describe("summarizeWorksForCoach", () => {
  it("produces one concise summary line per work with its real metrics", () => {
    const out = summarizeWorksForCoach(WORKS);
    expect(out.lines).toHaveLength(9);
    // the highest-play work surfaces its real play count, not a fabricated one
    const top = out.lines.find((l) => l.includes("埃及奇遇"));
    expect(top).toBeDefined();
    expect(top).toContain("2705");
    expect(out.truncated).toBe(false);
  });

  it("caps the number of summarized works (lazy loading — never embeds all detail)", () => {
    const many: CoachWorkInput[] = Array.from({ length: 50 }, (_, i) => ({
      desc: `work ${i}`,
      playCount: i,
      diggCount: 0,
      commentCount: 0,
      shareCount: 0,
      collectCount: 0,
    }));
    const out = summarizeWorksForCoach(many, { maxWorks: 12 });
    expect(out.lines.length).toBeLessThanOrEqual(12);
    expect(out.truncated).toBe(true);
    // it keeps the top performers, not an arbitrary head slice
    expect(out.lines.some((l) => l.includes("work 49"))).toBe(true);
  });

  it("flags thin data when there are very few works", () => {
    const out = summarizeWorksForCoach(WORKS.slice(0, 2));
    expect(out.thinData).toBe(true);
    const full = summarizeWorksForCoach(WORKS);
    expect(full.thinData).toBe(false);
  });
});

// ── buildCoachSystemPrompt — research/strategy persona, grounded ────────────

describe("buildCoachSystemPrompt", () => {
  it("is a research/strategy coach persona, NOT the editing/delivery persona", () => {
    const p = buildCoachSystemPrompt(baseContext());
    expect(p).toMatch(/研究|策略|选题/);
    // must NOT instruct the agent to edit/deliver a composition like the editor
    // persona does — that would make it grab the editing tools.
    expect(p).not.toContain("composition.yaml");
    expect(p).not.toContain("autoviral clip add");
    expect(p).not.toContain("carousel.yaml");
  });

  it("grounds in the user's local works (real metrics in-prompt)", () => {
    const p = buildCoachSystemPrompt(baseContext());
    expect(p).toContain("埃及奇遇");
    expect(p).toContain("2705");
  });

  it("grounds in the selected-platform trend topics", () => {
    const p = buildCoachSystemPrompt(baseContext());
    expect(p).toContain("秋冬穿搭挑战");
    expect(p).toContain("douyin");
  });

  it("grounds in the user's configured interests", () => {
    const p = buildCoachSystemPrompt(baseContext());
    expect(p).toContain("穿搭");
    expect(p).toContain("科幻");
  });

  it("carries a read-only / advisory contract (no destructive editing)", () => {
    const p = buildCoachSystemPrompt(baseContext());
    expect(p).toMatch(/只读|建议|不要(直接)?(修改|改动|编辑)|read-only|advisory/i);
  });

  it("is honest about thin data and pivots to trends/interests instead of fabricating precision", () => {
    const p = buildCoachSystemPrompt(baseContext({ works: WORKS.slice(0, 1) }));
    // thin-data honesty: must acknowledge the small sample and lean on trends/interests
    expect(p).toMatch(/数据(太少|很少|不足|有限)|样本(太小|很少|不足)/);
    expect(p).toMatch(/趋势|兴趣/);
    // must NOT claim per-work statistical precision it can't have
    expect(p).not.toMatch(/完播率|留存率|retention/i);
  });

  it("is honest with zero works (no fabricated history)", () => {
    const p = buildCoachSystemPrompt(baseContext({ works: [] }));
    expect(p).toMatch(/还没有|暂无|没有(已发布的)?作品/);
    // still gives the agent something to ground on
    expect(p).toContain("秋冬穿搭挑战");
  });

  it("never references metrics AutoViral does not measure (retention/完播)", () => {
    const p = buildCoachSystemPrompt(baseContext());
    expect(p).not.toMatch(/完播率|留存率|retention/i);
  });
});

// ── Token budget guardrail (cost) ──────────────────────────────────────────

describe("token budget guardrail", () => {
  it("estimates a positive token count that scales with text length", () => {
    const short = estimateTokens("hi");
    const long = estimateTokens("hi".repeat(500));
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("trims the works context to fit within the per-session token budget", () => {
    const many: CoachWorkInput[] = Array.from({ length: 400 }, (_, i) => ({
      desc: `这是一条相当长的作品描述用于撑大上下文 number ${i}`,
      playCount: i,
      diggCount: 0,
      commentCount: 0,
      shareCount: 0,
      collectCount: 0,
    }));
    const fitted = fitWorksToBudget(many, COACH_TOKEN_BUDGET);
    expect(fitted.length).toBeLessThan(many.length);
    const joined = fitted.map((w) => w.desc).join("\n");
    expect(estimateTokens(joined)).toBeLessThanOrEqual(COACH_TOKEN_BUDGET);
  });

  it("the full grounded prompt stays within the per-session token budget", () => {
    const p = buildCoachSystemPrompt(baseContext());
    expect(estimateTokens(p)).toBeLessThanOrEqual(COACH_TOKEN_BUDGET);
  });

  it("exposes a sane positive token budget", () => {
    expect(COACH_TOKEN_BUDGET).toBeGreaterThan(0);
  });
});
