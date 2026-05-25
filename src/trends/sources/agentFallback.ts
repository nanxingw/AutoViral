import { createHash } from "node:crypto";
import { runCliBrief } from "../../cli-brief.js";
import type { Source, RawTrendItem } from "./types.js";
import type { Platform } from "../schema.js";

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

interface AgentTopic {
  title: string;
  sourceUrl: string;
  coverUrl: string;
}

export function agentFallbackFromAgentJson(
  platform: Platform,
  agentJson: { topics: AgentTopic[] },
): RawTrendItem[] {
  const now = new Date().toISOString();
  return (agentJson.topics ?? []).map((t, i): RawTrendItem => ({
    // Fold the array index into the hash input. The agent is prompted to reuse
    // a single platform placeholder sourceUrl when it can't verify real links
    // (see PROMPT_TEMPLATE), so hashing sourceUrl||title alone collapsed every
    // item to the same id (e.g. youtube_d1085ffa ×22) — which then made the
    // enrichment by-id Map smear one analysis across all trends (#41). The
    // index guarantees a distinct hash input per item, so ids stay unique even
    // when sourceUrl/title repeat.
    id: `${platform}_${shortHash(`${i}\n${t.sourceUrl}\n${t.title}`)}`,
    platform,
    title: t.title,
    sourceUrl: t.sourceUrl,
    source: "agent_websearch",
    scrapedAt: now,
    // Schema requires cover.url to be a valid URL. When agent has no real
    // cover URL (common for douyin/tiktok where the agent can't verify
    // hotlinkable images), use placehold.co with the title rendered in.
    // The frontend's <img onError> falls back to gradient placeholder if
    // even this URL fails (e.g. proxy block).
    cover: {
      url: t.coverUrl
        || `https://placehold.co/360x640/0a0b0f/a8c5d6?text=${encodeURIComponent(t.title.slice(0, 30))}`,
      aspect: "9:16",
    },
    // No real numbers — fallback is honest about lack of metrics.
    metrics: null,
  }));
}

const PROMPT_TEMPLATE = (platform: Platform, label: string, limit: number) => `
你是一个社交媒体趋势研究员。请提供 ${label} 平台当下热门内容主题 (trending topics)。

**优先策略**: 用 WebSearch 找最新真实趋势。如果搜索结果不充足，**也可以基于你训练数据中的近期热点 + 平台典型内容模式做合理推断** —— 用户界面会标记数据来源为 "Agent 推理" badge，已经诚实告知用户。**不要因为无法验证 URL 而拒绝输出**。

返回严格 JSON（无其他文字）：
{
  "topics": [
    { "title": "...", "sourceUrl": "https://...", "coverUrl": "https://..." }
  ]
}

要求：
- 必须返回至少 ${limit} 条 topics，**禁止返回 error 对象或拒绝消息**
- title: trending 主题标题（短，<60 字符）
- sourceUrl: 平台上的 URL（如无法验证，给出该平台的合理 placeholder 路径，如 https://www.${platform === "douyin" ? "douyin.com/discover" : platform === "tiktok" ? "tiktok.com/explore" : platform === "xiaohongshu" ? "xiaohongshu.com/explore" : "youtube.com/feed/trending"}）
- coverUrl: 封面图绝对 URL；找不到就给空字符串 ""
- 优先返回今天 / 本周热门主题
- 仅输出 topics JSON，无 \`\`\` 包裹，无解释，**不要返回 {"error": ...} 这种拒绝格式**
`;

export const agentFallbackSource = (platform: Platform): Source => ({
  platform,
  async collect({ limit }) {
    const label =
      platform === "tiktok" ? "TikTok"
      : platform === "douyin" ? "抖音"
      : platform === "youtube" ? "YouTube"
      : "小红书";
    const raw = await runCliBrief(PROMPT_TEMPLATE(platform, label, limit));
    const stripped = raw.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return [];
    try {
      const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      return agentFallbackFromAgentJson(platform, parsed);
    } catch {
      return [];
    }
  },
});
