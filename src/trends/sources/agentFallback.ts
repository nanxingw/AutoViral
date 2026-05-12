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
  return (agentJson.topics ?? []).map((t): RawTrendItem => ({
    id: `${platform}_${shortHash(t.sourceUrl || t.title)}`,
    platform,
    title: t.title,
    sourceUrl: t.sourceUrl,
    source: "agent_websearch",
    scrapedAt: now,
    cover: t.coverUrl
      ? { url: t.coverUrl, aspect: "9:16" }
      : null,
    // No real numbers — fallback is honest about lack of metrics.
    metrics: null,
  }));
}

const PROMPT_TEMPLATE = (platform: Platform, label: string, limit: number) => `
你是一个社交媒体趋势研究员。用 WebSearch 找当下 ${label} 平台真实 trending 的内容（不要生成想象的内容；要可点开链接验证的）。

返回严格 JSON（无其他文字）：
{
  "topics": [
    { "title": "...", "sourceUrl": "https://...", "coverUrl": "https://..." }
  ]
}

要求：
- 至少 ${limit} 条
- title: 实际 trending item 标题（短，<60 字符）
- sourceUrl: 平台上真实可访问的 URL
- coverUrl: 该 item 的封面图绝对 URL；找不到就给空字符串 ""
- 优先返回今天 / 本周热门
- 仅输出 JSON，无 \`\`\` 包裹，无解释
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
    const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    return agentFallbackFromAgentJson(platform, parsed);
  },
});
