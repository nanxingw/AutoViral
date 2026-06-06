/**
 * coach-session — D5 deep module (PRD-0006 v0.1.5).
 *
 * The "灵感/研究·策略 coach": a PERSISTED chat session (sidecar-backed, survives
 * reload — unlike the ephemeral `trends_` research sessions that intentionally
 * keep no history) whose agent wears a research/strategy persona rather than the
 * editing/delivery persona of the work-bound creative agent.
 *
 * Everything here is a PURE function over its inputs — no fs / no WsBridge — so
 * the honesty + cost-guardrail contracts are unit-testable in isolation (ADR-009
 * "pure core + thin shell"). The WsBridge wiring (sidecar persistence, spawn,
 * session-scoped model) lives in ws-bridge.ts and merely calls into this module.
 *
 * Cost guardrails baked into the contract:
 *   1. LAZY CONTEXT — `summarizeWorksForCoach` caps the works embedded in the
 *      system prompt to the top performers; the agent is told to ask for more
 *      rather than re-reading every work each turn.
 *   2. TOKEN BUDGET — `fitWorksToBudget` / `estimateTokens` keep the grounded
 *      prompt under `COACH_TOKEN_BUDGET`, so a large library can't blow up cost.
 *   3. READ-ONLY / ADVISORY — the persona prompt forbids destructive editing;
 *      the coach proposes topics, it doesn't mutate the user's works.
 *
 * Honesty constraint (PRD-0006): with thin data the prompt tells the agent to
 * SAY the sample is small and pivot to trend/interest grounding rather than
 * fabricate per-work statistical precision — and it never references metrics
 * AutoViral has never measured (retention / 完播 / hook-retention).
 */

// ── Keying ─────────────────────────────────────────────────────────────────

/** Prefix that namespaces a persisted coach session, parallel to `trends_`. */
export const COACH_KEY_PREFIX = "coach_";

/** Mint the stable storage key for a coach session (e.g. "main" → "coach_main"). */
export function coachKeyFor(slug: string): string {
  return `${COACH_KEY_PREFIX}${slug}`;
}

/** True iff `key` names a coach session (not a work id, not a trends_ key). */
export function isCoachKey(key: string): boolean {
  return key.startsWith(COACH_KEY_PREFIX);
}

/**
 * The coach's session-scoped default model alias. SESSION-scoped — distinct from
 * the global `config.model` the editing agent uses — so switching the coach's
 * tier never steals the editing agent's tier (the bug S6 fixes). A real alias,
 * never "" (which would fall back to whatever the global default happens to be).
 */
export const COACH_DEFAULT_MODEL = "sonnet";

// ── Cost guardrail: token budget + lazy works summary ──────────────────────

/**
 * Per-session context-token budget for the coach's grounded system prompt.
 * Picked so the prompt stays cheap to send every turn; `fitWorksToBudget`
 * trims the works block to respect it.
 */
export const COACH_TOKEN_BUDGET = 4000;

/** How many works the prompt embeds by default (lazy — top performers only). */
export const COACH_DEFAULT_MAX_WORKS = 12;

/** Below this work count we treat the data as "thin" and pivot to trends/interests. */
export const COACH_THIN_DATA_THRESHOLD = 3;

/**
 * Cheap, dependency-free token estimate. Mixed CJK/latin text: CJK chars are
 * ~1 token each, latin runs ~¼ token/char. We approximate by counting CJK code
 * points at 1 token and the remaining characters at ~0.25 token, which is close
 * enough to gate the prompt size without pulling a real tokenizer into the
 * server. Monotonic in length, which is all the budget logic relies on.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    // CJK Unified Ideographs + common Hiragana/Katakana ranges.
    if ((cp >= 0x3000 && cp <= 0x9fff) || (cp >= 0xff00 && cp <= 0xffef)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other / 4);
}

export interface CoachWorkInput {
  desc: string;
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
}

export interface WorksSummary {
  /** One human-readable line per (capped) work, top performers first. */
  lines: string[];
  /** True when more works existed than were embedded (lazy-loading cap hit). */
  truncated: boolean;
  /** True when the sample is too small to draw confident per-work conclusions. */
  thinData: boolean;
}

function byPlayDesc(a: CoachWorkInput, b: CoachWorkInput): number {
  return b.playCount - a.playCount;
}

/** One concise grounded line for a work — real metrics only, no fabrication. */
function summaryLine(w: CoachWorkInput): string {
  const desc = w.desc.trim().slice(0, 60) || "（无描述）";
  return `· ${desc} — 播放 ${w.playCount} / 点赞 ${w.diggCount} / 评论 ${w.commentCount} / 分享 ${w.shareCount} / 收藏 ${w.collectCount}`;
}

/**
 * Summarize the user's works for the coach prompt — LAZY: keeps only the top
 * `maxWorks` by play count so the prompt never embeds the full detail of every
 * work every turn. Flags `truncated` (cap hit) and `thinData` (too few works to
 * be confident). Real metrics only.
 */
export function summarizeWorksForCoach(
  works: CoachWorkInput[],
  opts: { maxWorks?: number } = {},
): WorksSummary {
  const maxWorks = opts.maxWorks ?? COACH_DEFAULT_MAX_WORKS;
  const sorted = [...works].sort(byPlayDesc);
  const kept = sorted.slice(0, maxWorks);
  return {
    lines: kept.map(summaryLine),
    truncated: sorted.length > kept.length,
    thinData: works.length < COACH_THIN_DATA_THRESHOLD,
  };
}

/**
 * Trim a works list so the joined descriptions fit within `budget` estimated
 * tokens — the token-budget half of the cost guardrail (complements the count
 * cap in `summarizeWorksForCoach`). Keeps the highest-play works first.
 */
export function fitWorksToBudget(
  works: CoachWorkInput[],
  budget: number,
): CoachWorkInput[] {
  const sorted = [...works].sort(byPlayDesc);
  const kept: CoachWorkInput[] = [];
  let used = 0;
  for (const w of sorted) {
    const cost = estimateTokens(summaryLine(w)) + 1; // +1 for the newline
    if (used + cost > budget) break;
    kept.push(w);
    used += cost;
  }
  return kept;
}

// ── System prompt (research/strategy persona) ──────────────────────────────

export interface CoachContext {
  /** The platform the user is grounding against (e.g. "douyin"). */
  platform: string;
  /** The user's published works (frozen scrape) — may be empty. */
  works: CoachWorkInput[];
  /** Selected-platform trend topic titles (from the trends artifact). */
  trendTopics: string[];
  /** The user's configured content interests / niche. */
  interests: string[];
  /** Optional: cap embedded works (defaults to COACH_DEFAULT_MAX_WORKS). */
  maxWorks?: number;
  /** Optional token budget the works block must fit (defaults COACH_TOKEN_BUDGET). */
  tokenBudget?: number;
}

/**
 * Build the coach's research/strategy system prompt — PURE. Grounds in the
 * user's works + selected-platform trends + interests, enforces the
 * read-only/advisory + honest-about-thin-data contracts, and stays within the
 * token budget (works are first fit-to-budget, then summarized/capped).
 */
export function buildCoachSystemPrompt(ctx: CoachContext): string {
  const budget = ctx.tokenBudget ?? COACH_TOKEN_BUDGET;
  const maxWorks = ctx.maxWorks ?? COACH_DEFAULT_MAX_WORKS;

  // Reserve roughly a third of the budget for the works block; the rest is the
  // persona scaffold + trends + interests (all bounded inputs).
  const worksBudget = Math.floor(budget / 3);
  const budgeted = fitWorksToBudget(ctx.works, worksBudget);
  const summary = summarizeWorksForCoach(budgeted, { maxWorks });

  const interestsLine =
    ctx.interests.length > 0 ? ctx.interests.join("、") : "（用户尚未配置）";
  const trendsBlock =
    ctx.trendTopics.length > 0
      ? ctx.trendTopics.map((t) => `· ${t}`).join("\n")
      : "（暂无该平台趋势数据）";

  // Honesty: thin / zero data → tell the agent to SAY so and pivot to trends +
  // interests instead of fabricating per-work precision.
  let worksBlock: string;
  let honestyNote: string;
  if (ctx.works.length === 0) {
    worksBlock = "（用户还没有已发布的作品数据）";
    honestyNote =
      `用户**还没有**已发布作品的可用数据。诚实地说明这一点，**不要编造**任何历史表现或“过去的爆款”。把建议完全建立在下面的平台趋势和用户兴趣上。`;
  } else if (summary.thinData) {
    honestyNote =
      `用户已发布的作品很少、**数据样本太小**，单看几条作品得不出可靠的规律。请如实告诉用户样本太小，**不要假装有统计学上的精确结论**；把重心放在平台**趋势**和用户**兴趣**上来给方向，作品数据只作为弱信号参考。`;
    worksBlock = summary.lines.join("\n");
  } else {
    honestyNote =
      "建议要扎根在下面这些**真实**的作品数据上——**只引用这里出现过的指标**（播放/点赞/评论/分享/收藏）。任何不在这五项里的指标 AutoViral 从未测量，引用它就是编造，一律不许。";
    worksBlock = summary.lines.join("\n");
    if (summary.truncated) {
      worksBlock += `\n（仅展示表现最好的 ${summary.lines.length} 条；如需更多请向用户索取，不要假设其余作品的数字。）`;
    }
  }

  return `你是 AutoViral 的**研究 / 策略 coach**——一个帮创作者想清楚"下一个该做什么选题"的策略教练，**不是**剪辑 / 交付 agent。你的产出是**选题方向、角度、钩子建议和为什么这些在涨的判断**，不是去动用户的作品。

## 你的角色边界（只读 / 建议）
- 你是**只读、给建议**的角色。**不要**直接修改、改动或编辑用户的任何作品或 composition；**不要**调用剪辑类工具去落地成片。
- 需要把某个选题真正落成作品时，让用户去点"用此创作"由创作 agent 接手——你只负责出主意、讲清楚理由。
- 输出聚焦：给具体可执行的选题（标题/钩子/角度），并说明为什么契合用户赛道与当前趋势。

## 诚实纪律
${honestyNote}
- 中文优先；技术名词保留英文。
- 不要为了让结论显得专业而堆砌用户数据里没有的指标。

## 用户的赛道 / 兴趣
${interestsLine}

## 用户已发布作品（平台：${ctx.platform}，真实数据）
${worksBlock}

## ${ctx.platform} 当前趋势（供选题参考）
${trendsBlock}

请基于以上**真实**上下文与用户对话。用户问"下一个该做什么选题"时，给几个扎根于其作品表现 + 平台趋势 + 兴趣的具体选题方向，并解释取舍——数据薄时坦诚说明并转靠趋势/兴趣，绝不编造精度。`;
}
