# 自动化测试基础设施 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建后端 API 驱动的 Headless Pipeline Runner + AI 质量评审系统，让开发者和 AI agent 可以通过 API 自动创建作品、跑完全流程、评估质量。

**Architecture:** Pipeline Runner 在 server 进程内直接操作 WsBridge 实例，通过事件回调（非 HTTP 轮询）等待 agent 完成每步。完成后 Quality Evaluator 用 haiku 模型评估内容质量。所有结果持久化到 `~/.autoviral/test-runs/`。

**Tech Stack:** TypeScript, Node.js, WsBridge (进程内事件), Claude CLI (`claude -p`), vitest

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `web/src/pages/Studio.svelte` | 修复 | `saveCurrentStepHistory` → `saveStepSnapshot` |
| `src/ws-bridge.ts` | 修改 | 新增 `onSessionEvent()` 回调 + 后端步骤历史保存 |
| `src/test-runner.ts` | 新建 | Headless pipeline 执行器 |
| `src/test-evaluator.ts` | 新建 | AI 质量评审 |
| `src/server/api.ts` | 修改 | 新增 /api/test/* 端点 |
| `src/logger.ts` | 修改 | 支持 runId 过滤 |

---

### Task 1: 修复步骤历史持久化 Bug

**Files:**
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: 修复 saveCurrentStepHistory 调用**

在 `Studio.svelte` 中，找到 `markCurrentStepDone()` 函数（约第 315 行），将 `saveCurrentStepHistory(currentStep, stepName)` 改为 `saveStepSnapshot(currentStep, stepName)`：

```typescript
function markCurrentStepDone() {
    if (!work || !currentStep || !work.pipeline[currentStep]) return;
    if (work.pipeline[currentStep].status !== "active") return;

    const stepName = work.pipeline[currentStep].name ?? currentStep;
    saveStepSnapshot(currentStep, stepName);  // 修复：之前是 saveCurrentStepHistory（未定义）

    work.pipeline[currentStep].status = "done";
    work.pipeline[currentStep].completedAt = new Date().toISOString();
    work = { ...work };
    updateWorkApi(workId, { pipeline: work.pipeline }).catch(() => {});
  }
```

- [ ] **Step 2: 验证编译**

```bash
npm run build:frontend
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Studio.svelte
git commit -m "fix(studio): replace undefined saveCurrentStepHistory with saveStepSnapshot"
```

---

### Task 2: WsBridge 事件监听接口 + 后端步骤历史保存

**Files:**
- Modify: `src/ws-bridge.ts`

- [ ] **Step 1: 新增事件监听器 Map 和 onSessionEvent 方法**

在 WsBridge 类中，`private sessions` 之后添加：

```typescript
private eventListeners: Map<string, Set<(event: string, data: unknown) => void>> = new Map();

/**
 * Register a listener for session events. Returns cleanup function.
 * Used by TestRunner to wait for turn_complete/pipeline_updated without polling.
 */
onSessionEvent(workId: string, callback: (event: string, data: unknown) => void): () => void {
  if (!this.eventListeners.has(workId)) {
    this.eventListeners.set(workId, new Set());
  }
  this.eventListeners.get(workId)!.add(callback);
  return () => {
    this.eventListeners.get(workId)?.delete(callback);
  };
}
```

- [ ] **Step 2: 在 broadcastToBrowsers 之后触发事件监听**

修改 `broadcastToBrowsers` 方法，在广播给浏览器之后触发注册的回调：

```typescript
private broadcastToBrowsers(workId: string, payload: { event: string; data: unknown }): void {
    const session = this.sessions.get(workId);
    if (!session) return;

    const message = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
    });

    for (const ws of session.browserSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }

    // Notify in-process event listeners (used by TestRunner)
    const listeners = this.eventListeners.get(workId);
    if (listeners) {
      for (const cb of listeners) {
        try { cb(payload.event, payload.data); } catch { /* listener error shouldn't crash bridge */ }
      }
    }
  }
```

- [ ] **Step 3: 后端步骤历史自动保存**

在 `turn_complete` 处理逻辑中（`msg.type === "result"` 块里），在 broadcastToBrowsers 之后，添加后端步骤历史保存：

```typescript
// Auto-save step history from backend (doesn't rely on frontend)
if (!session.workId.startsWith("trends_") && resultText) {
  getWork(session.workId).then(w => {
    if (!w) return;
    const activeStep = Object.entries(w.pipeline).find(([, s]) => s.status === "active");
    if (activeStep) {
      const [stepKey, stepInfo] = activeStep;
      const blocks = session.messageHistory.map(m => ({
        type: m.role === "user" ? "user" : "text",
        text: m.text,
      }));
      saveStepHistory(session.workId, stepKey, {
        stepKey,
        stepName: stepInfo.name,
        completedAt: new Date().toISOString(),
        blocks,
      }).catch(() => {});
    }
  }).catch(() => {});
}
```

需要在文件顶部确保 `saveStepHistory` 从 work-store 导入（已在 api.ts 中导入，但 ws-bridge.ts 可能没有）。如果没有，添加：
```typescript
import { saveStepHistory } from "./work-store.js";
```
同时确保 `getWork` 已导入（应该已有 `import { getWork, updateWork } from "./work-store.js"`）。

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/ws-bridge.ts
git commit -m "feat(ws-bridge): add onSessionEvent listener + backend step history auto-save"
```

---

### Task 3: Test Runner

**Files:**
- Create: `src/test-runner.ts`

- [ ] **Step 1: 创建 Test Runner**

```typescript
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWork, getWork, updateWork, listAssets } from "./work-store.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import type { WsBridge } from "./ws-bridge.js";

const TEST_RUNS_DIR = join(homedir(), ".autoviral", "test-runs");

// ── Types ──────────────────────────────────────────────────────────────────

export interface RunConfig {
  title?: string;
  type: "short-video" | "image-text";
  platform: "douyin" | "xiaohongshu";
  topicHint?: string;
  model?: string;
  stepTimeout?: number; // ms, default 300000 (5 min)
  stepMessages?: Record<string, string>;
}

export interface StepResult {
  key: string;
  name: string;
  status: "completed" | "failed" | "timeout";
  duration: number;
  messageCount: number;
  toolCalls: string[];
  error?: string;
}

export interface RunResult {
  runId: string;
  workId: string;
  config: RunConfig;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  duration?: number;
  steps: StepResult[];
  evaluation?: unknown;
  error?: string;
}

// ── Active runs store ──────────────────────────────────────────────────────

const activeRuns = new Map<string, RunResult>();

export function getRunStatus(runId: string): RunResult | undefined {
  return activeRuns.get(runId);
}

export async function listRuns(): Promise<RunResult[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    const dirs = await readdir(TEST_RUNS_DIR);
    const runs: RunResult[] = [];
    for (const d of dirs.sort().reverse().slice(0, 50)) {
      try {
        const raw = await readFile(join(TEST_RUNS_DIR, d, "result.json"), "utf-8");
        runs.push(JSON.parse(raw));
      } catch { /* skip */ }
    }
    // Also include any active (in-memory) runs not yet saved
    for (const [, run] of activeRuns) {
      if (!runs.some(r => r.runId === run.runId)) runs.unshift(run);
    }
    return runs;
  } catch {
    return [...activeRuns.values()];
  }
}

export async function getRunReport(runId: string): Promise<RunResult | null> {
  // Check active first
  if (activeRuns.has(runId)) return activeRuns.get(runId)!;
  // Check disk
  try {
    const raw = await readFile(join(TEST_RUNS_DIR, runId, "result.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────

function generateRunId(): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const hex = Math.random().toString(16).slice(2, 5);
  return `tr_${ts}_${hex}`;
}

export async function runPipeline(wsBridge: WsBridge, config: RunConfig): Promise<RunResult> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const stepTimeout = config.stepTimeout ?? 300000;
  const appConfig = await loadConfig();
  const model = config.model ?? appConfig.model;

  const result: RunResult = {
    runId,
    workId: "",
    config,
    status: "running",
    startedAt,
    steps: [],
  };

  activeRuns.set(runId, result);
  log("info", "server", "test_run_started", undefined, { runId, config: config as any });

  try {
    // 1. Create work
    const title = config.title ?? `Test ${runId}`;
    const work = await createWork({
      title,
      type: config.type,
      platforms: [config.platform],
      topicHint: config.topicHint,
    });
    result.workId = work.id;
    log("info", "server", "test_work_created", work.id, { runId });

    // 2. Execute each pipeline step
    const stepKeys = Object.keys(work.pipeline);

    for (const stepKey of stepKeys) {
      const stepStart = Date.now();
      const stepInfo = work.pipeline[stepKey];
      const stepResult: StepResult = {
        key: stepKey,
        name: stepInfo.name,
        status: "failed",
        duration: 0,
        messageCount: 0,
        toolCalls: [],
      };

      log("info", "server", "test_step_started", work.id, { runId, step: stepKey });

      try {
        // Build step prompt (same logic as /step/:step API)
        const extraMsg = config.stepMessages?.[stepKey] ?? "";
        let prompt = `请开始执行「${stepInfo.name}」步骤。${extraMsg}`;

        // For assets step, add instruction to use scripts
        if (stepKey === "assets") {
          prompt += " 使用 python3 ~/.claude/skills/asset-generation/scripts/openrouter_generate.py 生成图片，不需要逐张确认，直接全部生成。";
        }
        if (stepKey === "assembly") {
          prompt += " 生成小红书发布文案写入 output/publish-text.md，然后推进pipeline到完成。";
        }

        // Wait for step completion via event listener
        const completion = await waitForStepCompletion(wsBridge, work.id, stepKey, prompt, model, stepTimeout);

        stepResult.status = completion.status;
        stepResult.messageCount = completion.messageCount;
        stepResult.toolCalls = completion.toolCalls;
        if (completion.error) stepResult.error = completion.error;

      } catch (err) {
        stepResult.status = "timeout";
        stepResult.error = err instanceof Error ? err.message : String(err);
        log("warn", "server", "test_step_timeout", work.id, { runId, step: stepKey });
      }

      stepResult.duration = Math.round((Date.now() - stepStart) / 1000);
      result.steps.push(stepResult);
      log("info", "server", "test_step_completed", work.id, {
        runId, step: stepKey, status: stepResult.status, duration: stepResult.duration,
      });

      // Re-read work to check pipeline state
      const updatedWork = await getWork(work.id);
      if (!updatedWork) break;

      // If this step failed and it's critical, stop
      if (stepResult.status === "failed" || stepResult.status === "timeout") {
        // Try to continue anyway — agent may have advanced
        const nextPending = Object.entries(updatedWork.pipeline).find(([, s]) => s.status === "pending");
        if (!nextPending) break; // All done or no more steps
      }
    }

    // 3. Final status
    const allDone = result.steps.every(s => s.status === "completed");
    result.status = allDone ? "completed" : "failed";

  } catch (err) {
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
    log("error", "server", "test_run_error", result.workId, { runId, error: result.error });
  }

  result.completedAt = new Date().toISOString();
  result.duration = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);

  // 4. Save to disk
  await saveRunResult(runId, result);
  activeRuns.delete(runId);

  log("info", "server", "test_run_completed", result.workId, {
    runId, status: result.status, duration: result.duration,
    stepsCompleted: result.steps.filter(s => s.status === "completed").length,
  });

  return result;
}

// ── Step Execution Helper ──────────────────────────────────────────────────

interface StepCompletion {
  status: "completed" | "failed";
  messageCount: number;
  toolCalls: string[];
  error?: string;
}

async function waitForStepCompletion(
  wsBridge: WsBridge,
  workId: string,
  stepKey: string,
  prompt: string,
  model: string,
  timeout: number,
): Promise<StepCompletion> {
  return new Promise<StepCompletion>((resolve, reject) => {
    const toolCalls: string[] = [];
    let messageCount = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        // Kill the session
        wsBridge.killSession(workId);
        reject(new Error(`Step ${stepKey} timed out after ${timeout / 1000}s`));
      }
    }, timeout);

    // Listen for events
    const cleanup = wsBridge.onSessionEvent(workId, (event, data: any) => {
      if (settled) return;

      if (event === "tool_use") {
        toolCalls.push(data.name ?? "unknown");
      }

      if (event === "assistant_text") {
        messageCount++;
      }

      if (event === "turn_complete" || event === "cli_exited") {
        // Check if pipeline advanced (agent marked step as done)
        getWork(workId).then(w => {
          if (!w) return;
          const step = w.pipeline[stepKey];
          if (step?.status === "done") {
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve({ status: "completed", messageCount, toolCalls });
          }
          // If CLI exited but step not done, agent may need another round
          // For test runner, we treat cli_exited + step not done as the end of this turn
          // The runner will check and potentially send another message
          if (event === "cli_exited" && step?.status !== "done") {
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve({ status: "completed", messageCount, toolCalls });
          }
        }).catch(() => {});
      }
    });

    // Trigger the step
    const session = wsBridge.getSession(workId);
    if (session) {
      wsBridge.sendMessage(workId, prompt).catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve({ status: "failed", messageCount, toolCalls, error: err.message });
        }
      });
    } else {
      wsBridge.createSession(workId, prompt, model).catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve({ status: "failed", messageCount, toolCalls, error: err.message });
        }
      });
    }
  });
}

// ── Persistence ────────────────────────────────────────────────────────────

async function saveRunResult(runId: string, result: RunResult): Promise<void> {
  const dir = join(TEST_RUNS_DIR, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), JSON.stringify(result.config, null, 2), "utf-8");
  await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2), "utf-8");
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/test-runner.ts
git commit -m "feat: add headless pipeline test runner"
```

---

### Task 4: Quality Evaluator

**Files:**
- Create: `src/test-evaluator.ts`

- [ ] **Step 1: 创建评估器**

```typescript
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
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/test-evaluator.ts
git commit -m "feat: add AI quality evaluator for test pipeline"
```

---

### Task 5: Test API 端点

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: 添加 import**

在 api.ts 顶部添加：

```typescript
import { runPipeline, getRunStatus, listRuns, getRunReport, type RunConfig } from "../test-runner.js";
import { evaluateWork } from "../test-evaluator.js";
```

- [ ] **Step 2: 添加 test API 端点**

在文件末尾（logs API 之后）添加：

```typescript
// ---------------------------------------------------------------------------
// Test Runner API
// ---------------------------------------------------------------------------

// POST /api/test/run — trigger a full pipeline test run
apiRoutes.post("/api/test/run", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<RunConfig>();
    if (!body.type || !body.platform) {
      return c.json({ error: "type and platform are required" }, 400);
    }

    // Start run in background
    const resultPromise = runPipeline(wsBridge, body);

    // Don't await — return immediately with runId
    // We need to peek at the runId before the promise resolves
    // Use a small delay to let the run initialize
    await new Promise(r => setTimeout(r, 100));

    // Find the active run (most recent)
    const runs = await listRuns();
    const activeRun = runs.find(r => r.status === "running");

    if (activeRun) {
      // After pipeline completes, run evaluation
      resultPromise.then(async (result) => {
        try {
          const evaluation = await evaluateWork(result.workId, body.type);
          result.evaluation = evaluation;
          // Re-save with evaluation
          const { writeFile, mkdir } = await import("node:fs/promises");
          const dir = join(homedir(), ".autoviral", "test-runs", result.runId);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2), "utf-8");
          await writeFile(join(dir, "evaluation.json"), JSON.stringify(evaluation, null, 2), "utf-8");
        } catch { /* evaluation failure is non-blocking */ }
      }).catch(() => {});

      return c.json({ runId: activeRun.runId, workId: activeRun.workId, status: "running" });
    }

    return c.json({ error: "Failed to start run" }, 500);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Run failed" }, 500);
  }
});

// GET /api/test/status/:runId
apiRoutes.get("/api/test/status/:runId", async (c) => {
  const runId = c.req.param("runId");
  const run = getRunStatus(runId) ?? await getRunReport(runId);
  if (!run) return c.json({ error: "Run not found" }, 404);
  return c.json(run);
});

// GET /api/test/runs
apiRoutes.get("/api/test/runs", async (c) => {
  const runs = await listRuns();
  return c.json({ runs });
});

// GET /api/test/runs/:runId/report
apiRoutes.get("/api/test/runs/:runId/report", async (c) => {
  const runId = c.req.param("runId");
  const report = await getRunReport(runId);
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json(report);
});
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/server/api.ts
git commit -m "feat(api): add /api/test/* endpoints for pipeline runner"
```

---

### Task 6: 集成测试

- [ ] **Step 1: 编译全部**

```bash
npm run build:backend && npm run build:frontend
```

- [ ] **Step 2: 重启服务**

```bash
node dist/index.js stop; sleep 1; node dist/index.js start
```

- [ ] **Step 3: 触发一次测试运行**

```bash
curl -X POST http://localhost:3271/api/test/run \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image-text",
    "platform": "xiaohongshu",
    "topicHint": "居家咖啡角布置灵感，6张图",
    "stepMessages": {
      "assets": "使用 openrouter_generate.py 脚本生成所有图片，不需要确认"
    }
  }'
```

Expected: 返回 `{ runId, workId, status: "running" }`

- [ ] **Step 4: 查询运行状态**

```bash
# 替换为实际的 runId
curl http://localhost:3271/api/test/status/{runId} | python3 -m json.tool
```

- [ ] **Step 5: 等待完成后查看报告**

```bash
# 等待 5-10 分钟后
curl http://localhost:3271/api/test/runs/{runId}/report | python3 -m json.tool
```

Expected: 完整报告包含 steps + evaluation

- [ ] **Step 6: 检查日志**

```bash
curl "http://localhost:3271/api/logs?source=server" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for e in data['entries']:
    if 'test_' in e['event']:
        print(f\"{e['ts'][:19]} {e['event']} {json.dumps(e.get('data',{}), ensure_ascii=False)[:100}\")
"
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: complete test infrastructure with pipeline runner + AI evaluator"
```
