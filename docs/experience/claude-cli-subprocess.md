# Claude CLI 子进程调用经验

> 在 AutoViral 中通过 Node.js 调用 Claude Code CLI 的实战经验

## 核心模式

```typescript
import { spawn } from "node:child_process";

const proc = spawn("claude", [
  "-p", prompt,
  "--output-format", "stream-json",  // 或 "json"
  "--verbose",
  "--dangerously-skip-permissions",
  "--model", "haiku",
], {
  cwd: homedir(),
  stdio: ["ignore", "pipe", "pipe"],  // 关键：stdin 必须是 "ignore"
});
```

## 踩坑记录

### 1. stdin 必须设为 "ignore"

**问题**：当 `stdio` 设为 `["pipe", "pipe", "pipe"]` 时，CLI 会等待 stdin 输入而不处理 `-p` 参数，导致进程无限挂起。

**根因**：CLI 检测到 stdin 是 pipe 后进入交互模式，忽略 `-p` 参数。

**解决**：`stdin: "ignore"` 或 spawn 后立即 `proc.stdin.end()`。

```typescript
// ✅ 正确
stdio: ["ignore", "pipe", "pipe"]

// ❌ 错误 — 会导致 CLI 挂死
stdio: ["pipe", "pipe", "pipe"]
```

### 2. --sdk-url 在 v2.1.77 不存在

**问题**：设计文档参考了 pneuma-skills 项目的 `--sdk-url` WebSocket 模式，但 Claude Code 2.1.77 没有这个 flag。

**解决**：改用 stdout pipe 模式（`-p` + `--output-format stream-json`）。

### 3. stream-json 需要 --verbose

```bash
# ❌ 报错
claude -p "hello" --output-format stream-json

# ✅ 正确
claude -p "hello" --output-format stream-json --verbose
```

### 4. JSON 输出的 result 字段可能为空

用 `--output-format json` 时，`result` 字段经常为空字符串（即使 CLI 确实产出了内容）。需要从 stream-json 的 assistant message 中提取文本。

### 5. NDJSON 解析

stream-json 输出是 NDJSON（每行一个 JSON）。关键消息类型：

```
system.init       → session_id, model, tools
assistant(text)   → 实际文本输出
assistant(thinking) → 思考过程
assistant(tool_use) → 工具调用
user(tool_result) → 工具返回
result            → 最终结果 + session_id
```

## 多轮对话（--resume）

Claude CLI 不支持 stdin pipe 多轮对话。替代方案：

```typescript
// 第一轮：-p 传入初始 prompt
spawn("claude", ["-p", firstPrompt, ...flags]);
// 解析输出获取 session_id

// 第二轮：--resume + 新 -p
spawn("claude", ["-p", followUpMessage, "--resume", sessionId, ...flags]);
```

每轮对话是独立进程，通过 `session_id` 恢复上下文。

## 性能提示

- `--model haiku` 用于快速任务（趋势调研、状态检测）
- `--model sonnet` 用于创作任务（内容生成、脚本写作）
- 对于需要网络搜索的任务，CLI 会自动使用 WebSearch 工具
- 60 秒 timeout 足够大多数单轮任务
