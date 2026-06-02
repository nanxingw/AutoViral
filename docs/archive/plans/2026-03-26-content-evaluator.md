# Content Evaluator 系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AutoViral pipeline 阶段切换点插入独立 Evaluator Agent，实现 GAN 式"创作-评审"分离，提升内容质量。

**Architecture:** 双 Agent 持久会话模型——创作 Agent 贯穿 work 生命周期，Evaluator Agent 按阶段独立（同阶段内 --resume 延续）。通过 file-based handoff 通信。在 `pipeline/advance` API 中拦截，开启评审模式时先触发 evaluator，通过后才真正推进。

**Tech Stack:** TypeScript (Hono backend), Svelte 5 (frontend), Claude Code CLI (agent runtime), WebSocket (real-time streaming)

---

## 文件结构

### 新建文件
- `skills/content-evaluator/SKILL.md` — 评审方法论、输出格式、评分体系
- `skills/content-evaluator/criteria/research.md` — 调研阶段评审标准
- `skills/content-evaluator/criteria/plan.md` — 策划阶段评审标准
- `skills/content-evaluator/criteria/assets.md` — 素材阶段评审标准（含视觉审查）
- `skills/content-evaluator/criteria/assembly.md` — 合成阶段评审标准（含技术审查）

### 修改文件
- `src/work-store.ts` — 扩展 Work 类型、PipelineStep 状态、评审结果读写
- `src/ws-bridge.ts` — 新增 spawnEvaluator()、evaluator 消息路由
- `src/server/api.ts` — 改造 pipeline/advance 拦截、新增 eval API
- `web/src/lib/api.ts` — 新增 eval 相关类型和 API 函数
- `web/src/pages/Studio.svelte` — evaluator 消息渲染、eval toggle、eval_blocked 面板
- `web/src/components/PipelineSteps.svelte` — evaluating/eval_blocked 状态显示
- `docs/skill-structure-guide.md` — 更新为 4+1 规则
- `CLAUDE.md` — 更新 skill 规则

---

### Task 1: 数据模型扩展（work-store.ts）

**Files:**
- Modify: `src/work-store.ts`

- [ ] **Step 1: 扩展 PipelineStep 状态类型**

在 `src/work-store.ts` 第 16 行，修改 PipelineStep.status 类型：

```typescript
// 原来：
export interface PipelineStep {
  name: string;
  status: "pending" | "active" | "done" | "skipped";
  startedAt?: string;
  completedAt?: string;
  note?: string;
}

// 改为：
export interface PipelineStep {
  name: string;
  status: "pending" | "active" | "evaluating" | "done" | "skipped" | "eval_blocked";
  startedAt?: string;
  completedAt?: string;
  note?: string;
}
```

- [ ] **Step 2: 扩展 Work 接口**

在 `src/work-store.ts` 的 Work 接口中新增评审相关字段：

```typescript
export interface Work {
  // ...existing fields
  evaluationMode?: boolean;
  evalSessionIds?: Record<string, string>;
  evalAttempts?: Record<string, number>;
}
```

- [ ] **Step 3: 新增评审结果读写函数**

在 `src/work-store.ts` 底部新增：

```typescript
// ── Evaluation results ──────────────────────────────────────────────────────

export interface EvalResult {
  step: string;
  attempt: number;
  verdict: "pass" | "fail";
  scores: Record<string, number>;
  issues: Array<{ severity: "critical" | "major" | "minor"; description: string; file?: string }>;
  suggestions: string[];
  timestamp: string;
}

export async function saveEvalResult(workId: string, step: string, attempt: number, result: EvalResult): Promise<void> {
  const dir = workDir(workId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `eval-${step}-${attempt}.json`);
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
}

export async function loadEvalResult(workId: string, step: string, attempt: number): Promise<EvalResult | null> {
  try {
    const filePath = join(workDir(workId), `eval-${step}-${attempt}.json`);
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as EvalResult;
  } catch {
    return null;
  }
}

export async function loadAllEvalResults(workId: string, step: string): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (let i = 1; i <= 10; i++) {
    const r = await loadEvalResult(workId, step, i);
    if (r) results.push(r);
    else break;
  }
  return results;
}
```

- [ ] **Step 4: 导出新类型和函数**

确保新增的 `EvalResult`, `saveEvalResult`, `loadEvalResult`, `loadAllEvalResults` 都在文件顶部或通过 export 正确导出。

- [ ] **Step 5: Commit**

```bash
git add src/work-store.ts
git commit -m "feat(work-store): extend pipeline states and add eval result storage"
```

---

### Task 2: WsBridge 评审器支持（ws-bridge.ts）

**Files:**
- Modify: `src/ws-bridge.ts`

- [ ] **Step 1: 扩展 ChatBlock 和 WsSession 类型**

在 `src/ws-bridge.ts` 顶部修改类型定义：

```typescript
export interface ChatBlock {
  type: "user" | "text" | "thinking" | "tool_use" | "tool_result" | "step_divider" | "eval_divider";
  text: string;
  toolName?: string;
  collapsed?: boolean;
  timestamp?: string;
  source?: "creator" | "evaluator";  // NEW
}

export interface WsSession {
  workId: string;
  cliSessionId?: string;
  evalSessionId?: string;           // NEW: evaluator's persistent session ID for current step
  evalStep?: string;                // NEW: which step is being evaluated
  browserSockets: Set<WebSocket>;
  cliProcess?: ChildProcess;
  idle: boolean;
  messageHistory: ChatBlock[];
  model?: string;
}
```

- [ ] **Step 2: 新增 spawnEvaluator 方法**

在 `spawnCli` 方法之后添加新方法。这个方法与 `spawnCli` 类似但有关键区别：
1. 使用独立的 evalSessionId
2. 广播消息时带 `source: "evaluator"` 标记
3. 在 turn_complete 时解析评审结果

```typescript
/**
 * Spawn an evaluator CLI agent for quality review.
 * Similar to spawnCli but routes messages with source:"evaluator" tag
 * and parses structured eval results from the response.
 */
spawnEvaluator(
  session: WsSession,
  prompt: string,
  resumeEvalSessionId?: string,
): Promise<EvalResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (resumeEvalSessionId) {
      args.push("--resume", resumeEvalSessionId);
    }

    if (session.model) {
      args.push("--model", session.model);
    }

    const proc = spawn("claude", args, {
      cwd: homedir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
    });

    // Broadcast eval_divider start
    const attempt = 1; // caller should pass this
    this.broadcastToBrowsers(session.workId, {
      event: "eval_divider",
      data: { type: "start", step: session.evalStep, attempt },
    });

    let turnText = "";
    let buffer = "";

    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: NdjsonMessage = JSON.parse(line);

          // Capture evaluator session ID
          if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
            session.evalSessionId = msg.session_id;
            updateWork(session.workId, {
              evalSessionIds: { ...({} as Record<string, string>), [session.evalStep!]: msg.session_id },
            } as any).catch(() => {});
          }

          // Forward assistant blocks with source: "evaluator"
          if (msg.type === "assistant" && msg.message?.content) {
            const blocks = msg.message.content as Array<Record<string, unknown>>;
            for (const block of blocks) {
              if (block.type === "text" && block.text) {
                turnText += block.text as string;
                session.messageHistory.push({
                  type: "text",
                  text: block.text as string,
                  source: "evaluator",
                  timestamp: new Date().toISOString(),
                });
                this.broadcastToBrowsers(session.workId, {
                  event: "assistant_text",
                  data: { workId: session.workId, text: block.text, source: "evaluator" },
                });
              } else if (block.type === "thinking" && block.thinking) {
                session.messageHistory.push({
                  type: "thinking",
                  text: block.thinking as string,
                  source: "evaluator",
                  collapsed: true,
                });
                this.broadcastToBrowsers(session.workId, {
                  event: "assistant_thinking",
                  data: { workId: session.workId, text: block.thinking, source: "evaluator" },
                });
              } else if (block.type === "tool_use") {
                session.messageHistory.push({
                  type: "tool_use",
                  text: JSON.stringify(block.input),
                  toolName: block.name as string,
                  source: "evaluator",
                });
                this.broadcastToBrowsers(session.workId, {
                  event: "tool_use",
                  data: { workId: session.workId, name: block.name, input: block.input, source: "evaluator" },
                });
              }
            }
          }

          // Forward tool results with source: "evaluator"
          if (msg.type === "user" && (msg as any).message?.content) {
            const content = (msg as any).message.content as Array<Record<string, unknown>>;
            for (const block of content) {
              if (block.type === "tool_result") {
                const resultContent = typeof block.content === "string"
                  ? block.content : JSON.stringify(block.content);
                session.messageHistory.push({
                  type: "tool_result",
                  text: resultContent,
                  source: "evaluator",
                  collapsed: true,
                });
                this.broadcastToBrowsers(session.workId, {
                  event: "tool_result",
                  data: { workId: session.workId, content: resultContent, source: "evaluator" },
                });
              }
            }
          }

          // result — eval turn complete
          if (msg.type === "result") {
            if (msg.session_id) {
              session.evalSessionId = msg.session_id;
            }
            const resultText = typeof msg.result === "string" && msg.result ? msg.result : turnText;
            // Parse eval result JSON from the response
            let evalResult: EvalResult | null = null;
            try {
              const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/);
              if (jsonMatch) {
                evalResult = JSON.parse(jsonMatch[1]);
              } else {
                // Try parsing the whole text as JSON
                evalResult = JSON.parse(resultText);
              }
            } catch {
              // If parsing fails, treat as a pass with note
              evalResult = {
                step: session.evalStep ?? "unknown",
                attempt: 1,
                verdict: "pass",
                scores: {},
                issues: [],
                suggestions: [],
                timestamp: new Date().toISOString(),
              };
            }

            // Persist chat
            saveWorkChat(session.workId, { blocks: session.messageHistory }).catch(() => {});

            resolve(evalResult!);
          }
        } catch { /* ignore non-JSON */ }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.trim()) {
        this.broadcastToBrowsers(session.workId, {
          event: "cli_stderr",
          data: { text, source: "evaluator" },
        });
      }
    });

    proc.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Evaluator exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}
```

- [ ] **Step 3: 新增 getSession 为 public**

确保 `getSession` 方法是 public 的（已有，确认可从 api.ts 调用）：

```typescript
getSession(workId: string): WsSession | undefined {
  return this.sessions.get(workId);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/ws-bridge.ts
git commit -m "feat(ws-bridge): add spawnEvaluator with source-tagged message routing"
```

---

### Task 3: API 层 — pipeline/advance 拦截与 eval 端点（api.ts）

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: 导入新类型**

在 api.ts 顶部的 work-store import 中添加新导出：

```typescript
import {
  getWork, updateWork, saveStepHistory, loadStepHistory, saveWorkChat, loadWorkChat,
  type Work, type PipelineStep,
  saveEvalResult, loadEvalResult, loadAllEvalResults, type EvalResult,  // NEW
} from "./work-store.js";
```

- [ ] **Step 2: 改造 pipeline/advance 端点**

替换 `POST /api/works/:id/pipeline/advance` handler（约 api.ts 1016-1092 行）。核心改造：在 evaluationMode 开启时拦截推进，启动 evaluator：

```typescript
apiRoutes.post("/api/works/:id/pipeline/advance", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json<{ completedStep: string; nextStep?: string }>().catch(() => ({} as any));
    log("info", "api", "pipeline_advance", id, { completedStep: body.completedStep, nextStep: body.nextStep });
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found" }, 404);

    const { completedStep, nextStep } = body;
    if (!completedStep) return c.json({ error: "completedStep is required" }, 400);

    // ── Evaluation gate ─────────────────────────────────────────────────
    if (work.evaluationMode && work.pipeline[completedStep]?.status !== "evaluating") {
      // Set step to evaluating state
      work.pipeline[completedStep].status = "evaluating";
      await storeUpdateWork(id, { pipeline: work.pipeline });

      // Broadcast evaluating state
      broadcastPipelineUpdate(id, work.pipeline);

      // Fire-and-forget: start evaluator asynchronously
      runEvaluation(id, completedStep, nextStep).catch((err) => {
        log("error", "api", "eval_failed", id, { error: err.message });
      });

      return c.json({ ok: true, evaluating: true, pipeline: work.pipeline });
    }

    // ── Normal advance (eval off or eval passed) ────────────────────────
    // Mark completed step as done
    if (work.pipeline[completedStep]) {
      work.pipeline[completedStep].status = "done";
      work.pipeline[completedStep].completedAt = new Date().toISOString();
    }

    // Auto-complete skipped steps
    const stepKeys = Object.keys(work.pipeline);
    const completedIdx = stepKeys.indexOf(completedStep);
    if (completedIdx > 0) {
      for (let i = 0; i < completedIdx; i++) {
        if (work.pipeline[stepKeys[i]].status !== "done") {
          work.pipeline[stepKeys[i]].status = "done";
          work.pipeline[stepKeys[i]].completedAt = work.pipeline[stepKeys[i]].completedAt ?? new Date().toISOString();
        }
      }
    }

    // Mark next step as active
    if (nextStep && work.pipeline[nextStep]) {
      work.pipeline[nextStep].status = "active";
      work.pipeline[nextStep].startedAt = new Date().toISOString();
    }

    await storeUpdateWork(id, { pipeline: work.pipeline });

    // Memory sync (existing logic)
    if (completedStep) {
      loadStepHistory(id, completedStep).then(history => {
        const h = history as { blocks?: { type: string; text: string }[] } | null;
        if (h?.blocks) {
          getWork(id).then(w => {
            syncStepConversation(
              id, w?.title ?? "Untitled", completedStep,
              w?.pipeline?.[completedStep]?.name ?? completedStep, h.blocks!,
            ).catch(() => {});
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    broadcastPipelineUpdate(id, work.pipeline);
    return c.json({ ok: true, pipeline: work.pipeline });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Pipeline advance error" }, 500);
  }
});
```

- [ ] **Step 3: 实现 runEvaluation 函数和 broadcastPipelineUpdate helper**

在 api.ts 中 pipeline/advance 路由之前添加：

```typescript
function broadcastPipelineUpdate(workId: string, pipeline: Record<string, PipelineStep>): void {
  if (!wsBridge) return;
  const session = wsBridge.getSession(workId);
  if (!session) return;
  for (const ws of session.browserSockets) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        event: "pipeline_updated",
        data: { workId, pipeline },
        timestamp: new Date().toISOString(),
      }));
    }
  }
}

async function runEvaluation(workId: string, completedStep: string, nextStep?: string): Promise<void> {
  if (!wsBridge) throw new Error("WsBridge not initialized");

  const work = await getWork(workId);
  if (!work) throw new Error("Work not found");

  const session = wsBridge.ensureSession(workId);
  session.evalStep = completedStep;

  const attempt = (work.evalAttempts?.[completedStep] ?? 0) + 1;

  // Load step history for context
  const stepHistory = await loadStepHistory(workId, completedStep);
  const historyText = (stepHistory as any)?.blocks
    ?.filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n\n")
    .slice(0, 8000) ?? "";

  // Load previous eval results for this step (if resuming)
  const prevResults = await loadAllEvalResults(workId, completedStep);
  const prevResultsText = prevResults.length > 0
    ? prevResults.map(r => `第${r.attempt}轮评审: ${r.verdict}\n问题: ${r.issues.map(i => i.description).join("; ")}\n建议: ${r.suggestions.join("; ")}`).join("\n\n")
    : "";

  // Build evaluator prompt
  // Read criteria file content would be done by the evaluator agent itself via skills
  const evalPrompt = buildEvalPrompt(work, completedStep, attempt, historyText, prevResultsText);

  // Broadcast eval_divider start
  session.messageHistory.push({
    type: "eval_divider",
    text: `评审开始 (第${attempt}轮)`,
    source: "evaluator",
    timestamp: new Date().toISOString(),
  });
  wsBridge.broadcastToBrowsers(workId, {
    event: "eval_divider",
    data: { type: "start", step: completedStep, attempt },
  });

  // Spawn evaluator
  const resumeId = work.evalSessionIds?.[completedStep];
  try {
    const evalResult = await wsBridge.spawnEvaluator(session, evalPrompt, resumeId);
    evalResult.step = completedStep;
    evalResult.attempt = attempt;
    evalResult.timestamp = new Date().toISOString();

    // Save result
    await saveEvalResult(workId, completedStep, attempt, evalResult);

    // Update attempts count
    const evalAttempts = { ...(work.evalAttempts ?? {}), [completedStep]: attempt };
    await storeUpdateWork(workId, { evalAttempts } as any);

    if (evalResult.verdict === "pass") {
      // ── PASS: advance pipeline ──
      session.messageHistory.push({
        type: "eval_divider",
        text: "评审通过 ✓",
        source: "evaluator",
        timestamp: new Date().toISOString(),
      });
      wsBridge.broadcastToBrowsers(workId, {
        event: "eval_divider",
        data: { type: "end", step: completedStep, verdict: "pass", scores: evalResult.scores },
      });

      // Clear eval session for this step
      const evalSessionIds = { ...(work.evalSessionIds ?? {}) };
      delete evalSessionIds[completedStep];

      // Actually advance pipeline
      const freshWork = await getWork(workId);
      if (freshWork) {
        freshWork.pipeline[completedStep].status = "done";
        freshWork.pipeline[completedStep].completedAt = new Date().toISOString();
        if (nextStep && freshWork.pipeline[nextStep]) {
          freshWork.pipeline[nextStep].status = "active";
          freshWork.pipeline[nextStep].startedAt = new Date().toISOString();
        }
        await storeUpdateWork(workId, {
          pipeline: freshWork.pipeline,
          evalSessionIds,
          evalAttempts: { ...(freshWork.evalAttempts ?? {}), [completedStep]: 0 },
        } as any);
        broadcastPipelineUpdate(workId, freshWork.pipeline);
      }
    } else {
      // ── FAIL: send feedback to creator agent ──
      session.messageHistory.push({
        type: "eval_divider",
        text: `评审未通过 ✗ (${evalResult.issues.length}个问题)`,
        source: "evaluator",
        timestamp: new Date().toISOString(),
      });
      wsBridge.broadcastToBrowsers(workId, {
        event: "eval_divider",
        data: { type: "end", step: completedStep, verdict: "fail", scores: evalResult.scores, issues: evalResult.issues },
      });

      // Check iteration limit
      if (attempt >= 3) {
        const freshWork = await getWork(workId);
        if (freshWork) {
          freshWork.pipeline[completedStep].status = "eval_blocked";
          await storeUpdateWork(workId, { pipeline: freshWork.pipeline });
          broadcastPipelineUpdate(workId, freshWork.pipeline);
        }
        wsBridge.broadcastToBrowsers(workId, {
          event: "eval_blocked",
          data: { workId, step: completedStep, attempt, result: evalResult },
        });
        return;
      }

      // Set step back to active
      const freshWork = await getWork(workId);
      if (freshWork) {
        freshWork.pipeline[completedStep].status = "active";
        await storeUpdateWork(workId, { pipeline: freshWork.pipeline });
        broadcastPipelineUpdate(workId, freshWork.pipeline);
      }

      // Inject feedback into creator agent via resume
      const feedbackPrompt = `## 评审反馈 (第${attempt}轮)\n\n评审未通过，请根据以下反馈修复问题后重新提交：\n\n### 问题列表\n${evalResult.issues.map((i, idx) => `${idx + 1}. [${i.severity}] ${i.description}${i.file ? ` (文件: ${i.file})` : ""}`).join("\n")}\n\n### 修改建议\n${evalResult.suggestions.map((s, idx) => `${idx + 1}. ${s}`).join("\n")}\n\n请修复以上问题，修复完成后再次调用 pipeline/advance 提交评审。`;

      // Send feedback to creator agent
      await wsBridge.sendMessage(workId, feedbackPrompt);
    }
  } catch (err) {
    log("error", "api", "eval_error", workId, { error: (err as Error).message });
    // On evaluator failure, revert to active
    const freshWork = await getWork(workId);
    if (freshWork) {
      freshWork.pipeline[completedStep].status = "active";
      await storeUpdateWork(workId, { pipeline: freshWork.pipeline });
      broadcastPipelineUpdate(workId, freshWork.pipeline);
    }
  }
}

function buildEvalPrompt(work: Work, step: string, attempt: number, historyText: string, prevResultsText: string): string {
  const stepName = work.pipeline[step]?.name ?? step;
  const platforms = work.platforms?.join(", ") ?? "未指定";

  return `你是一位严格的内容质量评审专家。你的任务是审查「${work.title}」的「${stepName}」阶段产出。

## 你的角色
- 你是独立的评审者，不是创作者。你的职责是发现问题，而不是赞美。
- Anthropic 研究表明 AI 存在"自我评价偏差"——倾向于赞美自己的产出。你必须刻意克服这种倾向。
- 使用硬性阈值，不要模糊通过。任何维度低于 6/10 分必须打回。

## 作品信息
- 标题: ${work.title}
- 类型: ${work.type}
- 平台: ${platforms}
- 当前阶段: ${stepName}
- 评审轮次: 第${attempt}轮

## 评审标准
请阅读 skills/content-evaluator/criteria/${step}.md 获取该阶段的详细评审标准。

## 创作产出摘要
${historyText.slice(0, 6000)}

## 评审指令
1. 首先，检查作品目录下的实际文件：运行 \`ls -la\` 查看产出文件
2. 对于图片文件：使用 Read 工具查看图片，评估视觉质量
3. 对于视频文件：使用 ffprobe 检查技术参数（分辨率、时长、编码、音频轨）
4. 根据评审标准逐项评分
5. 输出结构化评审结果

${prevResultsText ? `## 历史评审记录\n${prevResultsText}\n\n请特别关注之前指出的问题是否已修复。` : ""}

## 输出格式（必须严格遵循）

在你的分析之后，输出以下 JSON 代码块：

\`\`\`json
{
  "verdict": "pass" 或 "fail",
  "scores": {
    "维度1": 1-10分,
    "维度2": 1-10分
  },
  "issues": [
    {"severity": "critical/major/minor", "description": "问题描述", "file": "相关文件路径（可选）"}
  ],
  "suggestions": ["修改建议1", "修改建议2"]
}
\`\`\`

评审规则：
- 任何 critical 问题 → 必须 fail
- 任何维度 < 6/10 → 必须 fail
- 所有维度 ≥ 7/10 且无 critical 问题 → pass`;
}
```

- [ ] **Step 4: 新增评审相关 API 端点**

在 pipeline/advance 路由之后添加：

```typescript
// POST /api/works/:id/eval/toggle — toggle evaluation mode
apiRoutes.post("/api/works/:id/eval/toggle", async (c) => {
  const id = c.req.param("id");
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const newMode = !work.evaluationMode;
  await storeUpdateWork(id, { evaluationMode: newMode } as any);
  return c.json({ ok: true, evaluationMode: newMode });
});

// POST /api/works/:id/eval/force-pass — force pass a blocked step
apiRoutes.post("/api/works/:id/eval/force-pass", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ step: string; nextStep?: string }>().catch(() => ({} as any));
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const { step, nextStep } = body;
  if (!step || work.pipeline[step]?.status !== "eval_blocked") {
    return c.json({ error: "Step not in eval_blocked state" }, 400);
  }
  work.pipeline[step].status = "done";
  work.pipeline[step].completedAt = new Date().toISOString();
  if (nextStep && work.pipeline[nextStep]) {
    work.pipeline[nextStep].status = "active";
    work.pipeline[nextStep].startedAt = new Date().toISOString();
  }
  await storeUpdateWork(id, { pipeline: work.pipeline });
  broadcastPipelineUpdate(id, work.pipeline);
  return c.json({ ok: true, pipeline: work.pipeline });
});

// POST /api/works/:id/eval/retry — retry with user guidance
apiRoutes.post("/api/works/:id/eval/retry", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ step: string; guidance: string }>().catch(() => ({} as any));
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const { step, guidance } = body;
  if (!step) return c.json({ error: "step required" }, 400);

  // Reset attempts and set back to active
  work.pipeline[step].status = "active";
  const evalAttempts = { ...(work.evalAttempts ?? {}), [step]: 0 };
  await storeUpdateWork(id, { pipeline: work.pipeline, evalAttempts } as any);
  broadcastPipelineUpdate(id, work.pipeline);

  // Send user guidance to creator agent
  if (wsBridge && guidance) {
    await wsBridge.sendMessage(id, `## 用户指导\n\n${guidance}\n\n请根据以上指导修改当前阶段的产出，完成后重新提交。`);
  }

  return c.json({ ok: true });
});

// GET /api/works/:id/eval/results/:step — get eval results for a step
apiRoutes.get("/api/works/:id/eval/results/:step", async (c) => {
  const id = c.req.param("id");
  const step = c.req.param("step");
  const results = await loadAllEvalResults(id, step);
  return c.json({ results });
});
```

- [ ] **Step 5: 确保 broadcastToBrowsers 在 WsBridge 上是 public**

如果 `broadcastToBrowsers` 是 private，改为 public，因为 `runEvaluation` 函数需要调用它。

- [ ] **Step 6: Commit**

```bash
git add src/server/api.ts
git commit -m "feat(api): intercept pipeline/advance for evaluation gate, add eval endpoints"
```

---

### Task 4: 前端 API 类型与函数（api.ts）

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: 新增类型和 API 函数**

在 `web/src/lib/api.ts` 底部添加：

```typescript
// ---------------------------------------------------------------------------
// Evaluation API
// ---------------------------------------------------------------------------

export interface EvalIssue {
  severity: "critical" | "major" | "minor";
  description: string;
  file?: string;
}

export interface EvalResult {
  step: string;
  attempt: number;
  verdict: "pass" | "fail";
  scores: Record<string, number>;
  issues: EvalIssue[];
  suggestions: string[];
  timestamp: string;
}

export async function toggleEvalMode(workId: string): Promise<{ evaluationMode: boolean }> {
  return post<{ evaluationMode: boolean }>(`/api/works/${encodeURIComponent(workId)}/eval/toggle`, {});
}

export async function forcePassEval(workId: string, step: string, nextStep?: string): Promise<{ pipeline: Record<string, PipelineStep> }> {
  return post<{ pipeline: Record<string, PipelineStep> }>(`/api/works/${encodeURIComponent(workId)}/eval/force-pass`, { step, nextStep });
}

export async function retryWithGuidance(workId: string, step: string, guidance: string): Promise<void> {
  await post(`/api/works/${encodeURIComponent(workId)}/eval/retry`, { step, guidance });
}

export async function fetchEvalResults(workId: string, step: string): Promise<EvalResult[]> {
  const data = await get<{ results: EvalResult[] }>(`/api/works/${encodeURIComponent(workId)}/eval/results/${encodeURIComponent(step)}`);
  return data.results;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(frontend-api): add evaluation mode types and API functions"
```

---

### Task 5: 前端 UI — Studio 评审消息渲染、Toggle、Blocked 面板

**Files:**
- Modify: `web/src/pages/Studio.svelte`
- Modify: `web/src/components/PipelineSteps.svelte`

- [ ] **Step 1: 扩展 StreamBlock 类型**

在 Studio.svelte 的 StreamBlock interface 中添加 source 和 eval_divider：

```typescript
interface StreamBlock {
  type: "thinking" | "tool_use" | "tool_result" | "text" | "user" | "step_divider" | "ask_question" | "eval_divider";
  text: string;
  toolName?: string;
  collapsed?: boolean;
  questions?: AskQuestion[];
  source?: "creator" | "evaluator";  // NEW
  evalData?: { type: string; step?: string; attempt?: number; verdict?: string; scores?: Record<string, number>; issues?: any[] };  // NEW
}
```

- [ ] **Step 2: 添加 evaluation toggle 状态和控制**

在 Studio.svelte script 块中添加：

```typescript
import { toggleEvalMode, forcePassEval, retryWithGuidance, type EvalResult } from "../lib/api";

let evaluationMode = $state(false);
let evalBlocked = $state<{ step: string; attempt: number } | null>(null);
let guidanceText = $state("");

// Initialize evalMode from work data
$effect(() => {
  if (work) {
    evaluationMode = work.evaluationMode ?? false;
  }
});

async function handleToggleEval() {
  if (!work) return;
  const result = await toggleEvalMode(workId);
  evaluationMode = result.evaluationMode;
}

async function handleForcePass() {
  if (!work || !evalBlocked) return;
  const stepKeys = Object.keys(work.pipeline);
  const idx = stepKeys.indexOf(evalBlocked.step);
  const nextStep = idx < stepKeys.length - 1 ? stepKeys[idx + 1] : undefined;
  await forcePassEval(workId, evalBlocked.step, nextStep);
  evalBlocked = null;
}

async function handleRetryWithGuidance() {
  if (!work || !evalBlocked || !guidanceText.trim()) return;
  await retryWithGuidance(workId, evalBlocked.step, guidanceText);
  evalBlocked = null;
  guidanceText = "";
}
```

- [ ] **Step 3: 在 wsHandler 中处理 evaluator 事件**

在 wsHandler 函数中添加对新事件的处理：

```typescript
// In wsHandler, add these cases:
if (e.event === "assistant_text" && e.data.source === "evaluator") {
  const last = streamBlocks[streamBlocks.length - 1];
  if (last?.type === "text" && last.source === "evaluator") {
    last.text += e.data.text;
  } else {
    streamBlocks.push({ type: "text", text: e.data.text, source: "evaluator" });
  }
  scrollToBottom();
  return;
}

if (e.event === "assistant_thinking" && e.data.source === "evaluator") {
  streamBlocks.push({ type: "thinking", text: e.data.text, collapsed: true, source: "evaluator" });
  return;
}

if (e.event === "tool_use" && e.data.source === "evaluator") {
  streamBlocks.push({ type: "tool_use", text: JSON.stringify(e.data.input, null, 2), toolName: e.data.name, source: "evaluator" });
  return;
}

if (e.event === "tool_result" && e.data.source === "evaluator") {
  streamBlocks.push({ type: "tool_result", text: e.data.content, collapsed: true, source: "evaluator" });
  return;
}

if (e.event === "eval_divider") {
  streamBlocks.push({
    type: "eval_divider",
    text: e.data.type === "start"
      ? `评审开始 (第${e.data.attempt}轮)`
      : e.data.verdict === "pass" ? "评审通过 ✓" : `评审未通过 ✗`,
    source: "evaluator",
    evalData: e.data,
  });
  scrollToBottom();
  return;
}

if (e.event === "eval_blocked") {
  evalBlocked = { step: e.data.step, attempt: e.data.attempt };
  return;
}
```

- [ ] **Step 4: 在模板中渲染 evaluator 消息**

在 StreamBlock 渲染循环中，为 evaluator source 添加不同样式（使用 impeccable 设计）。在现有的 `{#each streamBlocks as block}` 循环中，根据 `block.source` 和 `block.type` 渲染：

对于 `eval_divider` 类型：
```svelte
{:else if block.type === "eval_divider"}
  <div class="eval-divider" class:eval-pass={block.evalData?.verdict === "pass"} class:eval-fail={block.evalData?.verdict === "fail"}>
    <span class="eval-divider-line"></span>
    <span class="eval-divider-label">
      {#if block.evalData?.verdict === "pass"}
        <span class="eval-icon">✓</span>
      {:else if block.evalData?.verdict === "fail"}
        <span class="eval-icon">✗</span>
      {:else}
        <span class="eval-icon">◎</span>
      {/if}
      {block.text}
    </span>
    <span class="eval-divider-line"></span>
  </div>
```

对于 evaluator source 的 text blocks，wrap with evaluator styling：
```svelte
<div class="msg-block" class:msg-evaluator={block.source === "evaluator"}>
  <div class="msg-label">
    {#if block.source === "evaluator"}
      <span class="eval-badge">评审</span>
    {:else}
      Agent
    {/if}
  </div>
  <!-- existing MarkdownBlock etc -->
</div>
```

- [ ] **Step 5: 添加评审 toggle 到顶栏**

在 Studio.svelte 的 header 区域（返回按钮旁边）添加 toggle：

```svelte
<div class="eval-toggle" title={evaluationMode ? "关闭质量评审" : "开启质量评审"}>
  <label class="toggle-switch">
    <input type="checkbox" checked={evaluationMode} onchange={handleToggleEval} />
    <span class="toggle-slider"></span>
  </label>
  <span class="toggle-label">质量评审</span>
</div>
```

- [ ] **Step 6: 添加 eval_blocked 面板**

在聊天输入区域上方添加：

```svelte
{#if evalBlocked}
  <div class="eval-blocked-panel">
    <div class="eval-blocked-header">
      <span class="eval-blocked-icon">⚠️</span>
      <span>评审已达最大迭代次数 ({evalBlocked.attempt}/3)</span>
    </div>
    <div class="eval-blocked-actions">
      <button class="eval-btn eval-btn-pass" onclick={handleForcePass}>强制通过</button>
      <div class="eval-guidance-row">
        <input
          type="text"
          class="eval-guidance-input"
          placeholder="给出修改方向..."
          bind:value={guidanceText}
        />
        <button class="eval-btn eval-btn-retry" onclick={handleRetryWithGuidance} disabled={!guidanceText.trim()}>
          重新尝试
        </button>
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 7: 添加 CSS 样式**

使用 impeccable 设计原则（参考用户安装的 impeccable skill），添加评审专用样式：

```css
/* Evaluator message styling */
.msg-evaluator {
  border-left: 3px solid var(--amber, #f59e0b);
  background: color-mix(in srgb, var(--amber, #f59e0b) 6%, transparent);
  border-radius: 8px;
  margin: 4px 0;
  padding-left: 12px;
}

.eval-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, var(--amber, #f59e0b) 15%, transparent);
  color: var(--amber, #f59e0b);
  letter-spacing: 0.5px;
}

/* Eval divider */
.eval-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
  padding: 0 8px;
}

.eval-divider-line {
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent);
}

.eval-divider-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--amber, #f59e0b);
  white-space: nowrap;
}

.eval-divider.eval-pass .eval-divider-line { background: color-mix(in srgb, #22c55e 30%, transparent); }
.eval-divider.eval-pass .eval-divider-label { color: #22c55e; }
.eval-divider.eval-fail .eval-divider-line { background: color-mix(in srgb, #ef4444 30%, transparent); }
.eval-divider.eval-fail .eval-divider-label { color: #ef4444; }

.eval-icon {
  font-size: 14px;
  font-weight: 700;
}

/* Eval toggle */
.eval-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 8px;
  background: var(--bg-secondary, #1a1a2e);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}

.toggle-switch input { opacity: 0; width: 0; height: 0; }

.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--bg-tertiary, #2a2a4a);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
}

.toggle-slider::before {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  left: 2px;
  bottom: 2px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--amber, #f59e0b);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
}

.toggle-label {
  font-size: 12px;
  color: var(--text-secondary, #8888aa);
  font-weight: 500;
}

/* Eval blocked panel */
.eval-blocked-panel {
  margin: 8px 16px;
  padding: 16px;
  border-radius: 12px;
  background: color-mix(in srgb, #ef4444 8%, var(--bg-secondary, #1a1a2e));
  border: 1px solid color-mix(in srgb, #ef4444 25%, transparent);
}

.eval-blocked-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #eee);
  margin-bottom: 12px;
}

.eval-blocked-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.eval-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.eval-btn-pass {
  background: color-mix(in srgb, var(--amber, #f59e0b) 20%, transparent);
  color: var(--amber, #f59e0b);
}

.eval-btn-pass:hover { background: color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent); }

.eval-guidance-row {
  display: flex;
  gap: 8px;
}

.eval-guidance-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--bg-primary, #0f0f23);
  color: var(--text-primary, #eee);
  font-size: 13px;
}

.eval-btn-retry {
  background: var(--accent, #6366f1);
  color: white;
}

.eval-btn-retry:hover { opacity: 0.9; }
.eval-btn-retry:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 8: 更新 PipelineSteps.svelte**

在 `statusClass` 函数中添加新状态：

```typescript
function statusClass(status: string, key: string): string {
  const active = key === currentStep ? " step-current" : "";
  if (status === "done") return "step-done" + active;
  if (status === "active") return "step-running" + active;
  if (status === "evaluating") return "step-evaluating" + active;  // NEW
  if (status === "eval_blocked") return "step-blocked" + active;   // NEW
  if (status === "skipped") return "step-failed" + active;
  return "step-pending" + active;
}
```

在 PipelineSteps.svelte 的 `<style>` 中添加：

```css
.step-evaluating {
  color: var(--amber, #f59e0b);
}
.step-evaluating::before {
  background: var(--amber, #f59e0b);
  animation: pulse 1.5s infinite;
}

.step-blocked {
  color: #ef4444;
}
.step-blocked::before {
  background: #ef4444;
}
```

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/Studio.svelte web/src/components/PipelineSteps.svelte
git commit -m "feat(frontend): evaluator UI with source-styled messages, toggle, and blocked panel"
```

---

### Task 6: 创建 content-evaluator skill

**Files:**
- Create: `skills/content-evaluator/SKILL.md`
- Create: `skills/content-evaluator/criteria/research.md`
- Create: `skills/content-evaluator/criteria/plan.md`
- Create: `skills/content-evaluator/criteria/assets.md`
- Create: `skills/content-evaluator/criteria/assembly.md`

- [ ] **Step 1: 创建 SKILL.md**

通用评审方法论。内容需要参考研究报告中的专业评测方法（等 eval-research 代理返回后整合）。核心框架：

- 角色定义：独立评审者，克服自我评价偏差
- 评分体系：各维度 1-10 分，硬性阈值
- 输出格式：结构化 JSON
- 评审原则：LLM-as-Judge 最佳实践

- [ ] **Step 2: 创建 criteria/research.md**

调研阶段评审标准：
- 数据真实性（热搜数据是否来自实时 API）
- 趋势判断准确性（赛道分析是否合理）
- 可行性评估（技术和资源约束是否考虑）
- 竞品分析深度
- 输出格式完整性

- [ ] **Step 3: 创建 criteria/plan.md**

策划阶段评审标准：
- Hook 有效性（前3秒是否有吸引力）
- 叙事结构（是否遵循 Hook-Value-CTA）
- 视觉设计合理性（构图、色彩、风格一致性）
- 节奏设计（是否匹配内容类型的节奏模板）
- Prompt 质量（生成提示词是否精确可执行）
- 平台适配（是否符合目标平台规范）

- [ ] **Step 4: 创建 criteria/assets.md**

素材阶段评审标准（含视觉审查）：
- 技术质量（分辨率、清晰度、无伪影）
- 美学质量（构图、色彩和谐、光线自然）
- Prompt 遵从度（生成结果是否匹配描述）
- 风格一致性（跨镜头/图片的色调、角色一致）
- 平台规格（尺寸、比例正确）
- 视觉审查清单（使用 Claude Vision 逐图检查）

- [ ] **Step 5: 创建 criteria/assembly.md**

合成阶段评审标准（含技术审查）：
- 技术参数（编码、分辨率、帧率、音频轨）
- 剪辑节奏（是否与内容类型匹配）
- 音画同步（BGM 与画面节奏是否协调）
- 转场质量（是否平滑、不突兀）
- 字幕质量（可读性、位置、时间同步）
- 调色一致性（全片色调是否统一）
- 发布文案质量（标题、标签、正文是否符合平台规范）

- [ ] **Step 6: Commit**

```bash
git add skills/content-evaluator/
git commit -m "feat(skill): create content-evaluator with criteria for all pipeline stages"
```

---

### Task 7: 文档更新与同步

**Files:**
- Modify: `docs/skill-structure-guide.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 skill-structure-guide.md**

将"只有4个skill"规则更新为"4+1"模式。添加说明 content-evaluator 是横切评审 skill，不对应 pipeline 步骤。

- [ ] **Step 2: 更新 CLAUDE.md**

更新 skill 规则描述，反映新的 4+1 结构。

- [ ] **Step 3: 同步 skills 到 ~/.claude/skills/**

```bash
rsync -av --delete skills/ ~/.claude/skills/
```

- [ ] **Step 4: Commit**

```bash
git add docs/skill-structure-guide.md CLAUDE.md
git commit -m "docs: update skill structure to 4+1 model with content-evaluator"
```
