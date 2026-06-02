# 自动化测试基础设施 设计文档

## 目标

构建后端 API 驱动的 Pipeline Runner 和质量评估系统，让开发者和 AI agent 可以：
- 通过一个 API 调用创建作品并自动跑完全部 4 步 pipeline
- 实时查询执行状态和结构化日志
- 自动评估输出质量（流程完整性 + 输出完整性 + AI 评分）
- 所有结果持久化，方便回溯和对比

## 架构

```
POST /api/test/run
  → TestRunner.run()
    → createWork()
    → for each step:
        → wsBridge.createSession() / sendMessage()
        → 等待 CLI turn_complete（进程内事件监听）
        → 保存步骤历史
        → 检测 pipeline advance
    → TestEvaluator.evaluate()
    → 返回完整报告

GET /api/test/status/:runId → 实时状态
GET /api/test/runs → 历史列表
GET /api/test/runs/:runId/report → 完整报告
```

Runner 和 Server 在同一进程，Runner 直接操作 WsBridge 实例——不走 HTTP 轮询，通过事件回调等待 agent 完成。

---

## 前置修复：步骤历史持久化 Bug

### 问题

`Studio.svelte` 的 `markCurrentStepDone()` 调用了 `saveCurrentStepHistory()`，但这个函数**从未定义**。导致大部分步骤的聊天记录没有保存到 `steps/*.json`。

### 修复

1. 将 `saveCurrentStepHistory()` 改为调用已有的 `saveStepSnapshot()`
2. 在后端 `ws-bridge.ts` 的 `turn_complete` 处理中，也主动保存步骤历史到文件——不依赖前端

后端保存逻辑：当 CLI 进程的一轮对话完成（`msg.type === "result"`）时，读取 `session.messageHistory` 中的当前步骤消息，写入 `steps/{currentStep}.json`。这样即使前端不在线，步骤历史也能保存。

---

## 模块 1: Pipeline Runner (`src/test-runner.ts`)

### 接口

```typescript
interface RunConfig {
  title?: string           // 默认 "Test Run {timestamp}"
  type: "short-video" | "image-text"
  platform: "douyin" | "xiaohongshu"
  topicHint?: string       // 选题方向
  model?: string           // 默认用 config.model
  stepMessages?: Record<string, string>  // 每步的额外指令
}

interface RunResult {
  runId: string
  workId: string
  status: "running" | "completed" | "failed"
  startedAt: string
  completedAt?: string
  duration?: number        // seconds
  steps: StepResult[]
  evaluation?: EvaluationReport
  error?: string
}

interface StepResult {
  key: string              // "research" | "plan" | "assets" | "assembly"
  name: string
  status: "completed" | "failed" | "timeout"
  duration: number         // seconds
  messageCount: number     // 对话消息数
  toolCalls: string[]      // 使用的工具列表
  error?: string
}
```

### 执行逻辑

```
1. 创建作品（createWork）
2. 获取 pipeline 步骤列表
3. 对第一个 pending 步骤:
   a. 构建 step prompt（和 /step/:step API 相同逻辑）
   b. 创建 CLI session（wsBridge.createSession）
   c. 注册一次性事件监听:
      - 监听 turn_complete → 记录结果
      - 监听 pipeline_updated → 检测自动推进
      - 监听 cli_exit → 检测异常退出
   d. 等待 Promise resolve（最长 5 分钟超时）
   e. 保存步骤历史
4. 检查 pipeline 状态:
   - 如果 agent 已自动推进到下一步 → 步骤 3
   - 如果当前步骤 done 但下一步还是 pending → 手动推进并回到步骤 3
   - 如果所有步骤 done → 进入评估
   - 如果超时或错误 → 标记 failed
5. 调用 TestEvaluator
6. 保存完整报告到 ~/.autoviral/test-runs/{runId}/
```

### 事件监听机制

Runner 不轮询 API，而是在 WsBridge 上注册回调。需要在 WsBridge 中暴露一个事件监听接口：

```typescript
// ws-bridge.ts 新增
onSessionEvent(workId: string, callback: (event: string, data: any) => void): () => void
```

回调在 `broadcastToBrowsers` 之后触发。Runner 通过返回的 cleanup 函数取消监听。

### 超时处理

- 每个步骤最长 5 分钟（可配置）
- 超时后 kill CLI 进程，标记步骤 failed
- 继续尝试下一步骤（某一步失败不阻断整体）

---

## 模块 2: Quality Evaluator (`src/test-evaluator.ts`)

### 评估维度

**1. 流程完整性（自动检查）**
- 4 个步骤全部 done
- 无 error 日志
- 每步有聊天记录（messageCount > 0）
- CLI 正常退出（code === 0）

**2. 输出完整性（自动检查）**
- 图片数量 >= 预期（图文 >= 6，视频 >= 5）
- publish-text.md 存在且 > 100 字
- 有标签（> 5 个）
- 有标题（> 5 字）

**3. AI 质量评分（Claude 评估）**
用 haiku 模型评估以下维度（1-10 分）：
- 标题吸引力：是否符合平台特征，能否引发点击
- 文案质量：语气、结构、是否有 CTA
- 选题深度：调研是否充分，切入角度是否独特
- 整体可发布度：作为一个整体内容，能否直接发布

评估输入：调研报告 + 内容规划 + 发布文案 + 图片列表
评估输出：各维度分数 + 总分 + 改进建议

### 评估报告结构

```typescript
interface EvaluationReport {
  processScore: number     // 流程完整性 0-100
  outputScore: number      // 输出完整性 0-100
  qualityScore: number     // AI 质量评分 0-100
  totalScore: number       // 加权总分
  details: {
    process: ProcessCheck[]
    output: OutputCheck[]
    quality: QualityDimension[]
  }
  suggestions: string[]    // 改进建议
}
```

---

## 模块 3: Test API 端点

### `POST /api/test/run`

触发一次完整测试运行。

```json
Request: {
  "type": "image-text",
  "platform": "xiaohongshu",
  "topicHint": "春日咖啡角布置",
  "model": "opus"
}

Response: {
  "runId": "tr_20260320_1500_a1f",
  "workId": "w_20260320_1500_b2c",
  "status": "running"
}
```

Runner 在后台异步执行，通过 status API 查询进度。

### `GET /api/test/status/:runId`

```json
Response: {
  "runId": "tr_20260320_1500_a1f",
  "status": "running",
  "currentStep": "assets",
  "elapsed": 180,
  "steps": [
    { "key": "research", "status": "completed", "duration": 45 },
    { "key": "plan", "status": "completed", "duration": 30 },
    { "key": "assets", "status": "running", "duration": 105 }
  ],
  "logs": [
    { "ts": "...", "event": "step_started", "step": "assets" },
    { "ts": "...", "event": "tool_use", "tool": "Bash" }
  ]
}
```

### `GET /api/test/runs`

```json
Response: {
  "runs": [
    {
      "runId": "tr_20260320_1500_a1f",
      "title": "春日咖啡角布置",
      "status": "completed",
      "totalScore": 82,
      "duration": 320,
      "createdAt": "2026-03-20T15:00:00Z"
    }
  ]
}
```

### `GET /api/test/runs/:runId/report`

返回完整的评估报告，包含步骤历史、资产列表、评估分数、日志。

---

## 存储

```
~/.autoviral/test-runs/
  tr_20260320_1500_a1f/
    config.json     # 运行配置
    result.json     # RunResult
    evaluation.json # EvaluationReport
    logs.jsonl      # 该次运行的所有日志
```

---

## 文件变动清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `web/src/pages/Studio.svelte` | 修复 | `saveCurrentStepHistory` → `saveStepSnapshot` |
| `src/ws-bridge.ts` | 修改 | 新增 `onSessionEvent()` 回调接口 + 后端步骤历史保存 |
| `src/test-runner.ts` | 新建 | Headless pipeline 执行器 |
| `src/test-evaluator.ts` | 新建 | AI 质量评审 |
| `src/server/api.ts` | 修改 | 新增 /api/test/* 端点 |
| `src/logger.ts` | 修改 | 支持按 runId 过滤日志 |

## 错误隔离

- Runner 失败不影响正常的前端使用
- 评估器调用 AI 失败时返回 qualityScore: -1，不阻断报告生成
- 每次 run 的日志独立存储，不混入主日志
- 超时杀进程时确保 cleanup（关闭 session、保存已有数据）
