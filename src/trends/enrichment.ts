import { validateCollection } from "./schema.js";
import type { TrendsCollectionResult, ValidationIssue, Platform } from "./schema.js";
import type { RawTrendItem } from "./sources/types.js";

export interface EnrichDeps {
  runCli: (prompt: string) => Promise<string>;
  maxRetries?: number;
}

function buildPrompt(
  raws: RawTrendItem[],
  platform: Platform,
  previousIssues?: ValidationIssue[],
): string {
  const itemsJson = JSON.stringify(raws.map((r) => ({
    id: r.id, title: r.title, sourceUrl: r.sourceUrl, metrics: r.metrics,
  })));
  const feedback = previousIssues && previousIssues.length > 0
    ? `\n上一次输出 validation 失败，issues:\n${previousIssues.map((i) => `- path: ${i.path}\n  message: ${i.message}`).join("\n")}\n请按 issue 修正后重新输出整个 JSON。\n`
    : "";
  return `
我已经为 ${platform} 平台采集到 ${raws.length} 个 raw trending items（已带真实 title/url/metrics）：

\`\`\`json
${itemsJson}
\`\`\`

请仅为每个 item 补充 analysis 字段，并保留其 id 不变。返回严格 JSON：
{
  "items": [
    {
      "id": "<原 id>",
      "analysis": {
        "heat": 1-5 整数,
        "competition": "低" | "中" | "高",
        "opportunity": "金矿" | "蓝海" | "红海",
        "description": ">=20 <=500 字符的描述",
        "tags": ["", "", ""] (3-5 个),
        "contentAngles": ["", ""] (2-3 个),
        "exampleHook": "<5-100 字符>",
        "category": "<分类>"
      }
    }
  ]
}

heat 评级参考: views > 1M → 5, 100K-1M → 4, 10K-100K → 3, < 10K → 2。无 metrics 时根据 title 主题热度判断。

输出纯 JSON，无 \`\`\` 包裹，无解释。${feedback}
`;
}

function stripFence(s: string): string {
  return s.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
}

/**
 * Attach each agent-produced analysis back onto its raw item.
 *
 * Normal path: align by id (a Map), which tolerates the agent reordering items.
 * Defense in depth for #41: if the raws carry duplicate ids (e.g. a source that
 * hashed a shared placeholder sourceUrl), a by-id Map collapses to one entry and
 * `get(id)` smears that single analysis across every trend. When we detect a
 * duplicate id we warn and fall back to positional alignment — the prompt sends
 * items in order and asks the agent to preserve it, so index i lines up.
 */
export function mergeAnalysisIntoRaws(
  raws: RawTrendItem[],
  agentItems: Array<{ id?: string; analysis?: unknown }>,
  platform: Platform,
): Array<RawTrendItem & { analysis: unknown }> {
  const ids = raws.map((r) => r.id);
  const dupCount = ids.length - new Set(ids).size;
  if (dupCount > 0) {
    console.warn(
      `[enrichment] ${platform}: ${dupCount} duplicate raw id(s) detected — ` +
        `aligning analysis by index instead of id to avoid analysis collapse (#41)`,
    );
    return raws.map((r, i) => ({ ...r, analysis: agentItems[i]?.analysis }));
  }
  // Only id-bearing agent items can align to a raw (every RawTrendItem.id is a
  // non-optional string). An agent item missing its id could never be retrieved
  // via byId.get(r.id) anyway, so dropping it here preserves the by-id alignment
  // exactly while keeping the Map keys strictly string.
  const byId = new Map<string, unknown>(
    agentItems
      .filter((x): x is { id: string; analysis?: unknown } => x.id !== undefined)
      .map((x) => [x.id, x.analysis]),
  );
  return raws.map((r) => ({ ...r, analysis: byId.get(r.id) }));
}

export async function enrichWithAnalysis(
  raws: RawTrendItem[],
  platform: Platform,
  deps: EnrichDeps,
): Promise<TrendsCollectionResult> {
  const maxRetries = deps.maxRetries ?? 2;
  let lastIssues: ValidationIssue[] = [];
  const collectedAt = new Date().toISOString();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt = buildPrompt(raws, platform, attempt > 0 ? lastIssues : undefined);
    const agentRaw = await deps.runCli(prompt);
    const stripped = stripFence(agentRaw);
    let agentParsed: any;
    try {
      agentParsed = JSON.parse(stripped);
    } catch {
      lastIssues = [{ path: "<root>", message: "agent returned non-JSON" }];
      continue;
    }
    const merged = mergeAnalysisIntoRaws(raws, agentParsed.items ?? [], platform);
    const candidate = {
      platform, items: merged, collectedAt,
      pipelineStatus: "ok" as const, errors: [],
      validation: { passed: true, issues: [] },
    };
    const outcome = validateCollection(candidate);
    if (outcome.passed && outcome.result) return outcome.result;
    lastIssues = outcome.issues;
  }

  // pipelineStatus "partial" signals callers (Task 13 pipeline) to skip strict
  // schema processing. items intentionally empty rather than partially valid
  // — avoids leaking unvalidated analysis fields into downstream consumers.
  return {
    platform,
    items: [] as any,
    collectedAt,
    pipelineStatus: "partial",
    errors: [`enrichment failed after ${maxRetries + 1} attempts`],
    validation: { passed: false, issues: lastIssues },
  };
}
