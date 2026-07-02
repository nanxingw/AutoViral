# codex `exec --json` 事件 schema 实测锚定 fixture

PRD-0010 切片 **C1**。本目录的 JSONL 是**本机真跑** `codex exec --json` 采集的原样事件流，
作为 C3 codex-backend parser 的契约来源。**改 parser 前先读这里，别猜 schema。**

## 采集环境

| 项 | 值 |
|---|---|
| codex 版本 | `codex-cli 0.142.4` |
| 登录态 | `Logged in using ChatGPT`（`codex login status`） |
| 平台 | macOS (darwin 25.4.0), Apple Silicon |
| 采集日期 | 2026-07-02 |

## 采集命令（原样）

第一轮（含工具使用，工作目录内预置了 `alpha.txt` / `beta.md` / `gamma.json`）：

```sh
codex exec --json --skip-git-repo-check -s read-only \
  -C "<cwd>" -o last-message-basic.txt \
  "请运行 ls 命令列出当前目录的文件，然后告诉我这里有哪些文件" \
  > exec-basic-tool-use.jsonl
```

Resume 一轮（复用第一轮的 thread_id）：

```sh
codex exec resume 019f219f-64ea-7fe0-81b1-4a6466e5c21b --json --skip-git-repo-check \
  -o last-message-resume.txt \
  "请运行 pwd 命令，告诉我当前工作目录的绝对路径" \
  > exec-resume.jsonl
```

> **CLI gotcha（实测）**：`codex exec resume` 的旗标集比 `codex exec` **小**——
> 它**不接受** `-s/--sandbox`，也**不接受** `-C/--cd`（两者只属于基础 `exec`）。
> resume 会沿用第一轮记录的 sandbox 策略与 cwd。传了会报
> `error: unexpected argument '-s' found`。

## 文件清单

| 文件 | 内容 |
|---|---|
| `exec-basic-tool-use.jsonl` | 完整一轮：thread 启动 → 跑 `ls`（command_execution）→ agent 回复 → turn 完成（含 usage）。6 行。 |
| `exec-resume.jsonl` | resume 一轮：复用同一 `thread_id`，跑 `pwd` → agent 回复 → turn 完成。6 行。 |

两份都不含 stderr（stderr 单独重定向，未混入 JSONL）。每行均为独立 JSON 对象（JSONL）。

## 观察到的事件类型清单（顶层 `type`）

这五种在两份 fixture 里都出现：

| `type` | payload 结构 | 说明 |
|---|---|---|
| `thread.started` | `{ type, thread_id }` | 会话开始，`thread_id` 是 UUIDv7；resume 复用同一个 id。 |
| `turn.started` | `{ type }` | 无额外字段。 |
| `item.started` | `{ type, item }` | item 生命周期开始（如命令 `in_progress`）。 |
| `item.completed` | `{ type, item }` | item 生命周期结束（命令 `completed` / agent 消息定稿）。 |
| `turn.completed` | `{ type, usage }` | 本轮结束，携带 token 用量。 |

### `item.type` 变体（实测出现的）

| `item.type` | 字段 | 说明 |
|---|---|---|
| `command_execution` | `{ id, type, command, aggregated_output, exit_code, status }` | 工具使用。`item.started` 时 `exit_code: null` / `status: "in_progress"`；`item.completed` 时 `exit_code` 为整数、`status: "completed"`、`aggregated_output` 填充。同一命令的两次事件靠 **`id` 缝合**（如 `item_0`）。 |
| `agent_message` | `{ id, type, text }` | 助手最终文本回复。只在 `item.completed` 出现（无 started）。 |

> **本轮未观察到但可能存在的 item 变体**：`reasoning`、`file_change`、`mcp_tool_call`、
> `web_search` 等——这两轮简单命令没触发。**C3 的 parser 必须把 `item.type` 集合当作开放集**，
> 遇到未知 type 优雅降级（不 crash、可透传），而不是穷举当前清单。

### `turn.completed.usage` 字段结构（实测）

```jsonc
"usage": {
  "input_tokens": 29456,
  "cached_input_tokens": 19200,
  "output_tokens": 191,
  "reasoning_output_tokens": 54
}
```

四个字段均为整数。注意：**reasoning 只以 `reasoning_output_tokens` 计数出现**，
本轮**没有**独立的 `reasoning` item 事件——per-work 成本埋点（PRD-0010 成本六路）
如需 reasoning token，从这里取，别指望 item 流。

## 校验方式（未跑 vitest，用 node 断言脚本，见 `fixtures.test.ts`）

采集时用 `node -e` / python 逐行 `JSON.parse` + 断言必需事件类型齐全，输出全绿。
`fixtures.test.ts` 是同等逻辑的 vitest 版，交由主套件运行（本片采集期间禁止并发跑 vitest）。
