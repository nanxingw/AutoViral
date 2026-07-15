# claude print-mode 后台任务终态帧实测锚定 fixture

PRD-0015 **S5**。本目录的 JSONL 是**本机真跑** `claude -p --output-format stream-json` 采集的原样任务生命周期 system 帧（脱敏后），作为上游终态签名的回归锁与 S1 seam 归一化的契约来源。**改 parser / 任务可见性链路前先读这里，别猜 schema。**

## 采集环境

| 项 | 值 |
|---|---|
| claude 版本 | `2.1.210 (Claude Code)`（`claude --version`）——与 030 事故同版本 |
| 平台 | macOS (darwin 25.4.0), Apple Silicon |
| node | v22 |
| 采集日期 | 2026-07-15 |

## 采集命令（原样）

小 ceiling 复现终止签名（`sleep 30` > ceiling `5000ms`，30s 任务被上限强杀）：

```sh
CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5000 claude -p \
  '用 Bash 工具以 run_in_background:true 运行命令 `sleep 30 && echo neverseen`，然后立刻回复"started"结束本轮。不要等待任务。' \
  --output-format stream-json --verbose --dangerously-skip-permissions
```

## 文件清单

| 文件 | 内容 |
|---|---|
| `exp2-ceiling-terminal.jsonl` | 从上述会话原样 stdout 抽取的 5 条任务生命周期 system 帧：`background_tasks_changed`（起点，tasks 非空）→ `task_started`（关联 `tool_use_id`）→ `background_tasks_changed`（终点，tasks 清空）→ `task_updated`（`patch.status="killed"`）→ `task_notification`（`status="stopped"`）。非任务帧（init/assistant/user/result 等）未纳入本 fixture。 |

## 脱敏

采集原始流含会话/机器标识，入库前逐字段清除：

- **去 `session_id`**（每帧都有的会话 UUID）。
- **去 `uuid`**（每帧的 event UUID）。
- **绝对路径**：`task_notification.output_file` 的机器绝对路径换成 `<SCRATCH>/tasks/<task_id>.output` 占位。

保留 `task_id`（`bn8y7ej1w`，ephemeral 任务 id）与 `tool_use_id`（`toolu_…`，launch↔lifecycle 缝合键）——它们是 seam 归一化把终态挂回 tool_use chip 所必需的关联键，非敏感。

## 观察到的任务类 system 帧（`subtype`）

| `subtype` | 关键字段 | 说明 |
|---|---|---|
| `background_tasks_changed` | `tasks: [{ task_id, task_type, description }]` | 后台任务集合快照；任务全部收尾/被杀后 `tasks: []`。 |
| `task_started` | `task_id, tool_use_id, description, task_type` | 任务起点；`tool_use_id` 关联启动它的 assistant `tool_use` block。 |
| `task_updated` | `task_id, patch: { status, end_time }` | 任务状态推进；**上限强杀时 `patch.status="killed"`**、带 `end_time` 时间戳。 |
| `task_notification` | `task_id, tool_use_id, status, output_file, summary` | 任务终态通知；**上限强杀时 `status="stopped"`**。 |

## 回归锁

`../../__tests__/ceiling-signature.probe.test.ts` 对上述帧形状与**终态词汇**（`killed` / `stopped`）断言。上游（Claude Code）升级若把词汇或帧名改口（如 `killed→terminated`、`task_updated→task_ended`），探针 CI 先红——逼在产线复发"被杀无提示"前修 parser，而不是让终态静默丢失。codex `__fixtures__/codex/fixtures.test.ts` 是同类 fixture 质量门的先例。
