import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listAssets, loadStepHistory } from "./work-store.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface QualityDimension {
  name: string;
  score: number;    // 1-10
  feedback: string;
}

export interface EvaluationReport {
  processScore: number;
  outputScore: number;
  qualityScore: number;
  totalScore: number;
  details: {
    process: CheckResult[];
    output: CheckResult[];
    quality: QualityDimension[];
  };
  suggestions: string[];
}

// ── Evaluator ──────────────────────────────────────────────────────────────

export async function evaluateWork(
  workId: string,
  contentType: "short-video" | "image-text",
): Promise<EvaluationReport> {
  log("info", "server", "evaluation_started", workId);

  const processChecks = await checkProcess(workId);
  const outputChecks = await checkOutput(workId, contentType);
  const qualityDimensions = await evaluateQuality(workId);

  const processScore = Math.round(
    (processChecks.filter(c => c.passed).length / Math.max(processChecks.length, 1)) * 100
  );
  const outputScore = Math.round(
    (outputChecks.filter(c => c.passed).length / Math.max(outputChecks.length, 1)) * 100
  );
  const qualityScore = qualityDimensions.length > 0
    ? Math.round(qualityDimensions.reduce((sum, d) => sum + d.score, 0) / qualityDimensions.length * 10)
    : -1;

  const totalScore = qualityScore >= 0
    ? Math.round(processScore * 0.2 + outputScore * 0.3 + qualityScore * 0.5)
    : Math.round(processScore * 0.4 + outputScore * 0.6);

  const suggestions = qualityDimensions
    .filter(d => d.score < 7)
    .map(d => `${d.name}: ${d.feedback}`);

  const report: EvaluationReport = {
    processScore,
    outputScore,
    qualityScore,
    totalScore,
    details: {
      process: processChecks,
      output: outputChecks,
      quality: qualityDimensions,
    },
    suggestions,
  };

  log("info", "server", "evaluation_completed", workId, {
    processScore, outputScore, qualityScore, totalScore,
  });

  return report;
}

// ── Process Checks ─────────────────────────────────────────────────────────

async function checkProcess(workId: string): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const { getWork } = await import("./work-store.js");
  const work = await getWork(workId);

  if (!work) {
    checks.push({ name: "作品存在", passed: false, detail: "作品未找到" });
    return checks;
  }

  // Check all steps done
  const steps = Object.entries(work.pipeline);
  for (const [key, step] of steps) {
    checks.push({
      name: `步骤 ${step.name} 完成`,
      passed: step.status === "done",
      detail: `status: ${step.status}`,
    });
  }

  // Check step histories exist
  for (const [key] of steps) {
    const history = await loadStepHistory(workId, key);
    checks.push({
      name: `步骤 ${key} 有聊天记录`,
      passed: !!(history && (history as any).blocks?.length > 0),
      detail: history ? `${(history as any).blocks?.length ?? 0} blocks` : "无记录",
    });
  }

  return checks;
}

// ── Output Checks ──────────────────────────────────────────────────────────

async function checkOutput(workId: string, contentType: string): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  try {
    const assets = await listAssets(workId);
    const images = assets.filter((a: string) => /\.(png|jpe?g|webp)$/i.test(a));
    const videos = assets.filter((a: string) => /\.(mp4|mov|webm)$/i.test(a));

    // Image count
    const minImages = contentType === "image-text" ? 4 : 3;
    checks.push({
      name: `图片数量 >= ${minImages}`,
      passed: images.length >= minImages,
      detail: `${images.length} 张图片`,
    });

    // Publish text exists
    const hasPublishText = assets.some((a: string) => a.includes("publish-text"));
    checks.push({
      name: "发布文案存在",
      passed: hasPublishText,
      detail: hasPublishText ? "publish-text.md 存在" : "未找到",
    });

    // If publish text exists, check content
    if (hasPublishText) {
      try {
        const workDir = join(homedir(), ".autoviral", "works", workId);
        const textPath = assets.find((a: string) => a.includes("publish-text"))!;
        const text = await readFile(join(workDir, textPath), "utf-8");
        checks.push({
          name: "文案长度 > 100 字",
          passed: text.length > 100,
          detail: `${text.length} 字符`,
        });
        const tagCount = (text.match(/#/g) || []).length;
        checks.push({
          name: "标签数 >= 5",
          passed: tagCount >= 5,
          detail: `${tagCount} 个标签`,
        });
      } catch {
        checks.push({ name: "文案可读取", passed: false, detail: "读取失败" });
      }
    }
  } catch {
    checks.push({ name: "素材目录可访问", passed: false, detail: "目录不存在" });
  }

  return checks;
}

// ── AI Quality Evaluation ──────────────────────────────────────────────────

async function evaluateQuality(workId: string): Promise<QualityDimension[]> {
  try {
    // Gather content for evaluation
    const workDir = join(homedir(), ".autoviral", "works", workId);
    const assets = await listAssets(workId);

    let publishText = "";
    const textAsset = assets.find((a: string) => a.includes("publish-text"));
    if (textAsset) {
      publishText = await readFile(join(workDir, textAsset), "utf-8").catch(() => "");
    }

    let planText = "";
    const planAsset = assets.find((a: string) => a.includes("content_plan"));
    if (planAsset) {
      planText = await readFile(join(workDir, planAsset), "utf-8").catch(() => "");
    }

    const imageCount = assets.filter((a: string) => /\.(png|jpe?g|webp)$/i.test(a)).length;

    if (!publishText) return [];

    // Call Claude haiku for quality assessment
    const evalPrompt = `你是一个专业的社交媒体内容审核专家。请评估以下小红书/抖音内容的质量。

发布文案:
${publishText.slice(0, 2000)}

内容规划:
${(planText || "无").slice(0, 1000)}

图片数量: ${imageCount}

请按以下 4 个维度评分（1-10分），并给出具体反馈。只输出 JSON，格式如下:
{"dimensions":[
  {"name":"标题吸引力","score":8,"feedback":"..."},
  {"name":"文案质量","score":7,"feedback":"..."},
  {"name":"选题深度","score":6,"feedback":"..."},
  {"name":"整体可发布度","score":7,"feedback":"..."}
]}`;

    const { stdout } = await execFileAsync("claude", [
      "-p", evalPrompt,
      "--output-format", "text",
      "--model", "haiku",
    ], { timeout: 60000 });

    // Parse JSON from output
    const stripped = stdout.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const data = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      return data.dimensions ?? [];
    }
  } catch (err) {
    log("warn", "server", "quality_eval_failed", workId, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return [];
}
