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
    const byId = new Map<string, any>(
      (agentParsed.items ?? []).map((x: any) => [x.id, x.analysis]),
    );
    const merged = raws.map((r) => ({ ...r, analysis: byId.get(r.id) }));
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
