# WsBridge 会话管理经验

> Studio 页面与 Claude CLI 之间的 WebSocket 桥接

## 架构

```
浏览器 (Studio.svelte)
  ↕ WebSocket /ws/browser/:workId
服务器 (WsBridge)
  ↕ stdout pipe (NDJSON)
Claude CLI 进程
```

**不使用 WebSocket 与 CLI 通信**（`--sdk-url` 不可用），而是通过 stdout pipe 读取 NDJSON。

## 会话生命周期

### 创建会话

```typescript
// WsBridge.createSession(workId, prompt, model)
// 1. spawn claude -p <prompt> --output-format stream-json --verbose
// 2. stdin: "ignore"（不用 pipe）
// 3. 解析 stdout NDJSON → 转发到浏览器 WebSocket
```

### 多轮对话

```typescript
// WsBridge.sendMessage(workId, text)
// 1. 杀掉当前 CLI 进程（如果还在运行）
// 2. 用 --resume <sessionId> + -p <newMessage> 启动新进程
// 3. 新进程继承之前的对话上下文
```

**关键**：每次用户发消息都会创建一个新的 CLI 进程。不是一个常驻进程。

### 浏览器连接

浏览器可以在 CLI 启动前就连接 WebSocket。`ensureSession()` 创建一个空壳 session 持有 browser socket，等 CLI 启动后自动转发事件。

## 事件流

### CLI → 浏览器

| 事件 | 来源 | 前端处理 |
|------|------|---------|
| `session_ready` | system.init | 标记 sessionReady=true |
| `assistant_text` | assistant(text blocks) | 追加到流式输出 |
| `assistant_thinking` | assistant(thinking) | 折叠显示 |
| `tool_use` | assistant(tool_use) | 显示工具名+参数 |
| `tool_result` | user(tool_result) | 折叠显示结果 |
| `turn_complete` | result | 停止 streaming，推进 pipeline |
| `cli_exited` | process exit | 恢复输入 |

### 浏览器 → CLI

浏览器发送 `{action: "send", text: "..."}` → WsBridge 调用 `sendMessage()` → 新 CLI 进程。

## 踩坑

### 1. turnText 累积

assistant 消息可能分多次发送（每次一个 content block）。需要在整个 turn 期间累积 text，最终在 turn_complete 时合并。

### 2. 浏览器连接早于 CLI

浏览器 WS 连接可能在 CLI 启动之前。`ensureSession()` 解决了这个鸡生蛋问题。

### 3. 15 秒 inactivity timeout

CLI 工具调用失败时可能静默退出。前端设置 15 秒无事件 timeout，自动恢复 streaming 状态。

### 4. Auto-run pipeline

turn_complete → 标记当前步骤 done → 3 秒延迟 → 自动触发下一步。用户可以随时 toggle OFF。
