import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWork, getWork, updateWork, listAssets } from "./work-store.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import type { WsBridge, ChatBlock } from "./ws-bridge.js";

const execFileAsync = promisify(execFile);

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

    // 2. Invoke each capability module in turn (test runner exercises the
    //    full agent loop sequentially — this is internal QA, not a pipeline).
    const MODULE_NAMES: Record<string, string> = {
      research: "话题调研",
      plan: "内容规划",
      assets: "素材生成",
      assembly: "成片合成",
    };
    const moduleKeys = Object.keys(MODULE_NAMES);

    for (const moduleKey of moduleKeys) {
      const stepStart = Date.now();
      const moduleName = MODULE_NAMES[moduleKey];
      const stepResult: StepResult = {
        key: moduleKey,
        name: moduleName,
        status: "failed",
        duration: 0,
        messageCount: 0,
        toolCalls: [],
      };

      log("info", "server", "test_module_started", work.id, { runId, module: moduleKey });

      try {
        const extraMsg = config.stepMessages?.[moduleKey] ?? "";
        let prompt = `请使用「${moduleName}」（${moduleKey}）能力处理本作品。${extraMsg}`;

        if (moduleKey === "assets") {
          prompt += " 使用 python3 ~/.claude/skills/autoviral/modules/assets/scripts/openrouter_generate.py 生成图片，不需要逐张确认，直接全部生成。";
        }
        if (moduleKey === "assembly") {
          prompt += " 生成小红书发布文案写入 output/publish-text.md。";
        }

        const completion = await waitForStepCompletion(wsBridge, work.id, moduleKey, prompt, model, stepTimeout);

        stepResult.status = completion.status;
        stepResult.messageCount = completion.messageCount;
        stepResult.toolCalls = completion.toolCalls;
        if (completion.error) stepResult.error = completion.error;
      } catch (err) {
        stepResult.status = "timeout";
        stepResult.error = err instanceof Error ? err.message : String(err);
        log("warn", "server", "test_module_timeout", work.id, { runId, module: moduleKey });
      }

      stepResult.duration = Math.round((Date.now() - stepStart) / 1000);
      result.steps.push(stepResult);
      log("info", "server", "test_module_completed", work.id, {
        runId, module: moduleKey, status: stepResult.status, duration: stepResult.duration,
      });

      const updatedWork = await getWork(work.id);
      if (!updatedWork) break;
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
    let lastAssistantText = "";  // Accumulate agent's text output for this turn
    let turnCount = 0;
    const MAX_TURNS = 10; // Safety limit to prevent infinite conversation loops

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        wsBridge.killSession(workId);
        reject(new Error(`Step ${stepKey} timed out after ${timeout / 1000}s`));
      }
    }, timeout);

    const cleanup = wsBridge.onSessionEvent(workId, (event, data: any) => {
      if (settled) return;

      if (event === "tool_use") {
        toolCalls.push(data.name ?? "unknown");
      }

      if (event === "assistant_text") {
        messageCount++;
        lastAssistantText += (data.text ?? "");
      }

      // turn_complete: agent finished this turn — resolve as completed.
      // D3: there is no pipeline gate; the test runner advances on each turn.
      if (event === "turn_complete") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ status: "completed", messageCount, toolCalls });
      }

      // cli_exited: CLI process has exited — agent is waiting for user input.
      // If we have not seen turn_complete yet (rare), simulate a reply up to MAX_TURNS.
      if (event === "cli_exited") {
        turnCount++;
        if (settled) return;

        if (turnCount >= MAX_TURNS) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve({ status: "completed", messageCount, toolCalls });
          return;
        }

        getWork(workId).then(async w => {
          if (!w || settled) return;
          log("info", "server", "test_simulating_user", workId, {
            module: stepKey, turnCount, agentTextLen: lastAssistantText.length,
          });

          try {
            const userReply = await generateUserReply(lastAssistantText, stepKey, w.title);
            lastAssistantText = "";
            log("info", "server", "test_user_reply", workId, {
              module: stepKey, reply: userReply.slice(0, 100),
            });
            await wsBridge.sendMessage(workId, userReply);
          } catch (err) {
            log("warn", "server", "test_user_reply_failed", workId, {
              error: err instanceof Error ? err.message : String(err),
            });
            await wsBridge.sendMessage(workId, "好的，请继续").catch(() => {});
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

// ── AI-Simulated User Reply ────────────────────────────────────────────────

async function generateUserReply(
  agentText: string,
  stepKey: string,
  workTitle: string,
): Promise<string> {
  const prompt = `你正在模拟一个用户与AI创作助手的对话。AI助手刚刚说了以下内容：

---
${agentText.slice(-2000)}
---

作品标题：${workTitle}
当前模块：${stepKey}

请作为用户回复。规则：
- 如果AI在问问题，给出合理的选择或回答
- 如果AI在等确认，回复"好的，请继续"
- 如果AI展示了方案让你选择，选择第一个或推荐的选项
- 如果AI完成了工作在等反馈，回复"很好，那就继续推进吧"
- 回复要简短自然，像真实用户一样
- 只输出用户回复的内容，不要加任何解释

用户回复：`;

  const { stdout } = await execFileAsync("claude", [
    "-p", prompt,
    "--output-format", "text",
    "--model", "haiku",
  ], { timeout: 30000 });

  return stdout.trim() || "好的，请继续";
}

// ── Persistence ────────────────────────────────────────────────────────────

async function saveRunResult(runId: string, result: RunResult): Promise<void> {
  const dir = join(TEST_RUNS_DIR, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), JSON.stringify(result.config, null, 2), "utf-8");
  await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2), "utf-8");
}
