/**
 * D3 — insight-guardrail: the honesty enforcer (PRD-0006 v0.1.5 S12).
 *
 * A local agent reads the user's 9 published works and emits candidate
 * "最新洞察" lines. AutoViral has on disk ONLY five per-post metrics:
 *   play / digg / comment / share / collect.
 * It NEVER measures retention / 完播率 / 钩子留存 / hook-timing / watch-time.
 *
 * This module is the regression gate that turns "honesty" from a human review
 * step into a TESTED contract: any candidate insight that references a metric
 * outside the on-disk set is fabrication and is REJECTED before it can ever
 * reach the UI. Two layers of defence:
 *   1. the candidate's DECLARED `metrics[]` must all be available, and
 *   2. the candidate's BODY prose must not mention any never-measured metric
 *      (an agent that declares only `play` but writes "完播率…" in prose is
 *      still lying — we catch that too).
 *
 * Everything here is a PURE function over its inputs — no fs, no network — so
 * the honesty contract is unit-testable in isolation (ADR-009 "pure core +
 * thin shell"). The server route (`routes/analytics.ts`) runs the agent and
 * merely calls into this module to parse + filter.
 */

/** The metrics actually present on disk (the frozen Douyin scrape). */
export const AVAILABLE_METRICS: ReadonlySet<string> = new Set([
  "play",
  "digg",
  "comment",
  "share",
  "collect",
]);

/**
 * Keywords that name a metric AutoViral has NEVER measured. If any appears in
 * an insight's prose (or in its declared metrics, normalised), the insight is
 * a fabrication and is rejected. Covers ZH + EN surface forms the agent might
 * reach for. Matched case-insensitively as substrings.
 */
export const FORBIDDEN_METRIC_KEYWORDS: readonly string[] = [
  // completion / 完播
  "完播",
  "completion rate",
  "completion-rate",
  "completionrate",
  // retention / 留存 / hook retention
  "留存",
  "retention",
  // hook timing / 钩子留存 / 钩子前 N 秒
  "钩子留存",
  "hook timing",
  "hook-timing",
  "hook retention",
  // watch time / 观看时长 / 平均播放时长
  "watch time",
  "watch-time",
  "watchtime",
  "观看时长",
  "播放时长",
  "平均播放时长",
  // skip / drop-off at second N (留存曲线 proxies)
  "drop-off",
  "drop off",
  "完成率",
];

/** Aliases the agent's declared `metrics[]` might use for a forbidden metric. */
const FORBIDDEN_METRIC_ALIASES: ReadonlySet<string> = new Set([
  "retention",
  "completion",
  "completionrate",
  "completion_rate",
  "watchtime",
  "watch_time",
  "hooktiming",
  "hook_timing",
  "hookretention",
  "hook_retention",
  "dropoff",
  "drop_off",
  "留存",
  "完播",
  "完成率",
  "观看时长",
  "播放时长",
]);

/** A candidate insight emitted by the agent, before the guardrail runs. */
export interface InsightCandidate {
  /** The human-readable insight line. */
  body: string;
  /** A short label/tag (e.g. "互动" / "方向"). */
  tag: string;
  /**
   * The metrics the insight claims to cite. Optional — when omitted the
   * guardrail falls back to scanning the body prose only (still strict).
   */
  metrics?: string[];
}

/** An insight that passed the guardrail, shaped for the UI (InsightsList). */
export interface PassedInsight {
  body: string;
  tag: string;
  /** ISO date (collection date or render date) for the row's timestamp. */
  date: string;
}

/** Normalise a declared metric token for comparison (lowercase, strip noise). */
function normaliseMetricToken(raw: string): string {
  return raw.toLowerCase().replace(/[\s_-]+/g, "").replace(/count$/, "").trim();
}

/**
 * Scan free text for any never-measured metric keyword. Returns the matched
 * keywords (empty array → clean). Case-insensitive substring match — deliberate
 * over-reach is acceptable here: a false positive only drops one fabricated-
 * looking line, whereas a false negative would let a lie reach the user.
 */
export function detectForbiddenMetrics(text: string): string[] {
  const lower = (text ?? "").toLowerCase();
  const hits: string[] = [];
  for (const kw of FORBIDDEN_METRIC_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }
  return hits;
}

/** True iff every declared metric is on disk AND none is a forbidden alias. */
function declaredMetricsAreHonest(
  metrics: string[] | undefined,
  available: ReadonlySet<string>,
): boolean {
  if (!metrics || metrics.length === 0) return true; // nothing declared → body scan decides
  for (const m of metrics) {
    const tok = normaliseMetricToken(m);
    if (FORBIDDEN_METRIC_ALIASES.has(tok) || FORBIDDEN_METRIC_ALIASES.has(m.toLowerCase())) {
      return false;
    }
    if (!available.has(tok)) return false;
  }
  return true;
}

/**
 * THE honesty gate. Keep a candidate insight only when:
 *   - it has a non-empty body, AND
 *   - every metric it DECLARES is in `available` (and none is a forbidden
 *     alias), AND
 *   - its body prose mentions no never-measured metric.
 *
 * Any candidate that references a metric not on disk — especially retention /
 * 完播 / hook-timing — is rejected. This is the core regression gate for
 * honesty (PRD-0006: "把诚实从人肉 review 升级为测试门控").
 */
export function filterInsights(
  candidates: InsightCandidate[],
  available: ReadonlySet<string> = AVAILABLE_METRICS,
): InsightCandidate[] {
  return candidates.filter((c) => {
    if (!c || typeof c.body !== "string" || c.body.trim().length === 0) return false;
    if (!declaredMetricsAreHonest(c.metrics, available)) return false;
    if (detectForbiddenMetrics(c.body).length > 0) return false;
    return true;
  });
}

// ── Agent-output boundary: parse raw CLI text → candidates → guardrail ───────

/** Pull the first JSON array out of arbitrary agent text (fences/preamble). */
function extractJsonArray(raw: string): unknown[] | null {
  if (!raw) return null;
  // 1) try the whole thing
  const direct = tryParseArray(raw.trim());
  if (direct) return direct;
  // 2) try a ```json … ``` (or bare ```) fenced block
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const inner = tryParseArray(fence[1].trim());
    if (inner) return inner;
  }
  // 3) greedy slice from the first '[' to the last ']'
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const sliced = tryParseArray(raw.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return null;
}

function tryParseArray(s: string): unknown[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Parse the local agent's raw output into guardrail-passed candidates. Robust
 * to markdown fences / chatter; returns [] (never throws) on garbage so the UI
 * never renders junk. The surviving insights have ALL passed D3.
 */
export function parseAgentInsights(
  raw: string,
  available: ReadonlySet<string> = AVAILABLE_METRICS,
): InsightCandidate[] {
  const arr = extractJsonArray(raw);
  if (!arr) return [];
  const candidates: InsightCandidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const body = typeof obj.body === "string" ? obj.body : "";
    const tag = typeof obj.tag === "string" ? obj.tag : "";
    const metrics = Array.isArray(obj.metrics)
      ? obj.metrics.filter((m): m is string => typeof m === "string")
      : undefined;
    candidates.push({ body, tag, metrics });
  }
  return filterInsights(candidates, available);
}

// ── Prompt: ground the agent on REAL metrics, forbid invented ones ──────────

export interface InsightWorkInput {
  desc: string;
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
}

function worksBlock(works: InsightWorkInput[]): string {
  if (works.length === 0) return "（用户暂无已发布作品数据）";
  return works
    .map(
      (w) =>
        `· ${(w.desc || "（无描述）").slice(0, 60)} — 播放 ${w.playCount} / 点赞 ${w.diggCount} / 评论 ${w.commentCount} / 分享 ${w.shareCount} / 收藏 ${w.collectCount}`,
    )
    .join("\n");
}

/**
 * Build the prompt for the local insight agent. It grounds the agent on the
 * user's REAL per-work metrics and explicitly forbids inventing any metric
 * AutoViral never measured (完播 / 留存 / retention / hook-timing). The agent
 * is asked to return a JSON array of {body, tag, metrics} — D3 then filters it.
 */
export function buildInsightPrompt(works: InsightWorkInput[]): string {
  return `你是 AutoViral 的数据洞察助手。下面是用户在抖音已发布作品的**真实**指标——这是磁盘上**仅有**的数据：

${worksBlock(works)}

请基于以上**真实**数据，生成 2–4 条简洁、可执行的中文洞察（每条 ≤ 60 字）。

## 诚实硬约束（违反即作废）
- 你**只能**引用这五个指标：**播放(play) / 点赞(digg) / 评论(comment) / 分享(share) / 收藏(collect)**。
- AutoViral **从未测量** 完播率 / 留存率 / 钩子留存 / 观看时长(retention / completion / hook-timing / watch-time)——**绝对不要**提及或推断任何这些指标。引用它们就是编造，会被直接丢弃。
- ${works.length === 0 ? "用户暂无作品数据时，请如实说明数据不足，不要编造历史表现。" : "只能基于上面出现过的真实数字下结论，不要假设没给出的数据。"}

## 输出格式
返回一个 JSON 数组，每个元素形如：
{ "body": "洞察正文", "tag": "短标签（如 互动/方向/曝光）", "metrics": ["play","digg"] }
其中 metrics 列出该条洞察引用到的指标（只能是上面五个之一）。只返回 JSON，不要其它文字。`;
}
