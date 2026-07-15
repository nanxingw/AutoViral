/**
 * ChatBackend — the seam between WsBridge's session orchestration and the
 * concrete chat CLI it drives (C2, PRD-0010).
 *
 * WsBridge owns everything session-shaped: browser sockets, message history,
 * sidecar/cliSessionId bookkeeping, cost ledger, checkpoints, memory sync, the
 * process lifecycle (exit/error). A
 * ChatBackend owns only the two CLI-specific concerns:
 *
 *   - `buildSpawn`  — turn the logical spawn inputs (prompt / resume id / 补教学
 *     append / model) plus the session context (workId / port) into the exact
 *     `{ cmd, args, options }` to hand `child_process.spawn`.
 *   - `createLineParser` — translate the backend's streaming stdout (claude:
 *     NDJSON stream-json) into the UNIFIED event callbacks below, so WsBridge's
 *     dispatch is written once and reused across backends (claude today, codex
 *     in C3).
 *
 * The claude implementation is a pure move-over of the old inline spawnCli logic
 * (behavior zero change).
 */

import type { SpawnOptions } from "node:child_process";

/** The logical + session-scoped inputs a backend needs to build a spawn. */
export interface ChatSpawnInput {
  /** The full wire prompt handed to the CLI (`-p` for claude). */
  prompt: string;
  /** Resume an existing CLI conversation by its backend session id. */
  resumeId?: string;
  /** B7(a)-lite mid-conversation teaching append (claude: --append-system-prompt). */
  appendSystemPrompt?: string;
  /** Model alias for this turn (claude: --model). */
  model?: string;
  /** The work/session key — drives the AUTOVIRAL_WORK_ID / cwd env. */
  workId: string;
  /** The daemon's port — drives AUTOVIRAL_PORT so the CLI can reach the API. */
  serverPort: number;
  /** PRD-0015 S5 —— print-mode 后台任务等待上限（ms），注入
   *  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS。省略时后端用 ADR-015 定的默认值
   *  0（无限等待，result 帧不被 hold）。服务端配置（config.yaml `chat.bgWaitCeilingMs`）
   *  想设止损上限时由 WsBridge 从配置读出后填这里。claude 后端消费；codex 后端忽略。 */
  bgWaitCeilingMs?: number;
}

/** Everything `child_process.spawn(cmd, args, options)` needs. */
export interface ChatSpawnDescriptor {
  cmd: string;
  args: string[];
  options: SpawnOptions;
}

/** A permissive shape for a parsed streaming frame. Mirrors claude's stream-json
 *  NDJSON message; codex frames are normalized into this on the codex parser. */
export interface ChatRawMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: Array<Record<string, unknown>>; [key: string]: unknown };
  result?: unknown;
  usage?: Record<string, number>;
  total_cost_usd?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

/** The provider-normalized end-of-turn summary. Field names are backend-agnostic
 *  EXCEPT `usage`, whose keys mirror the claude usage frame (input_tokens etc.)
 *  because the browser + cost ledger read those keys directly — a codex parser
 *  populates the same keys. `result` is the final text ONLY when the frame
 *  carried a non-empty one; the empty/absent case is left `undefined` so the
 *  caller can fall back to its accumulated turn text. */
export interface ChatTurnComplete {
  result?: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  usage?: Record<string, number>;
}

/** Provider capabilities discovered from a real session init frame. */
export interface ChatProviderCapabilities {
  slashCommands: string[];
  skills: string[];
}

/** One entry in a `list_changed` background-task snapshot. */
export interface ChatBackgroundTaskSummary {
  taskId?: string;
  taskType?: string;
  description?: string;
}

/**
 * PRD-0015 S1 —— provider-agnostic 后台任务生命周期事件。
 *
 * claude print-mode 把后台任务的生命周期写成一组 `system` 帧
 * （background_tasks_changed / task_started / task_updated / task_notification）；
 * 归一化后同一形状供下游 registry（S2）/ 任务卡片（S4）消费，与具体 CLI 解耦。
 * `kind` 语义：
 *   - `started`      —— 任务起点（task_started）；带 tool_use id 缝合到启动它的 chip。
 *   - `updated`      —— 状态推进（task_updated）；`status` 为 running/completed/killed…，
 *                       `endTime` 是终态时间戳。
 *   - `notification` —— 终态通知（task_notification）；`status` 为 completed/stopped…，
 *                       带 `summary`/`outputFile`，Workflow 任务另带 `usage` 计数。
 *   - `list_changed` —— 活任务集合快照（background_tasks_changed）；`tasks: []` = 全部
 *                       drain。
 * 原始帧经回调第二参 `msg` 保留，下游需要扩展字段（如 Workflow 的 workflow_name）时直接读。
 */
export interface ChatBackgroundTaskEvent {
  kind: "started" | "updated" | "notification" | "list_changed";
  /** ephemeral 任务 id（list_changed 用 `tasks[].taskId`，其余帧用顶层）。 */
  taskId?: string;
  /** 关联启动该任务的 assistant tool_use block（started/notification 携带）。 */
  toolUseId?: string;
  /** 任务类型，如 `local_bash` / `local_workflow`（透传，不穷举）。 */
  taskType?: string;
  description?: string;
  /** 生命周期状态（updated/notification）：running/completed/killed/stopped…（透传）。 */
  status?: string;
  summary?: string;
  outputFile?: string;
  /** 终态时间戳（task_updated.patch.end_time）。 */
  endTime?: number;
  /** 用量/计数（Workflow task_notification.usage：total_tokens/tool_uses/duration_ms…）。 */
  usage?: Record<string, number>;
  /** list_changed 快照的活任务集合（`[]` = 全部 drain）。 */
  tasks?: ChatBackgroundTaskSummary[];
}

/** A structured command request presented to a backend adapter. */
export interface ChatBackendCommandInput {
  name: string;
  args: string;
  capabilities?: ChatProviderCapabilities;
}

/** A backend adapter either produces a controlled wire prompt or rejects the
 * command. Unsupported commands never carry a prompt, which prevents callers
 * from accidentally downgrading a slash command into an ordinary model turn. */
export type ChatBackendCommandResult =
  | {
      status: "ready";
      kind: "translate" | "passthrough";
      command: string;
      prompt: string;
    }
  | {
      status: "unsupported";
      errorCode: "unsupported_command";
      command: string;
      message: string;
    };

/**
 * The unified event surface a parser drives. WsBridge supplies these; the parser
 * calls them as it decodes the stream. Ordering per message: `onRawMessage`
 * first, then exactly one
 * of the typed callbacks (or `onOther` for an unrecognized frame). For an
 * assistant message, `onAssistantMessage` fires once before its blocks are
 * walked into onText / onThinking / onToolUse.
 */
export interface ChatStreamCallbacks {
  /** Every parsed frame, BEFORE type dispatch. */
  onRawMessage?(msg: ChatRawMessage): void;
  /** system.init — the backend session id (may be undefined on claude). */
  onSessionId(cliSessionId: string | undefined, msg: ChatRawMessage): void;
  /** Provider command/skill catalog discovered from a real init frame. */
  onCapabilities?(capabilities: ChatProviderCapabilities, msg: ChatRawMessage): void;
  /** An assistant message with content, once, before its blocks are walked. */
  onAssistantMessage?(msg: ChatRawMessage, blocks: Array<Record<string, unknown>>): void;
  /** An assistant text block. */
  onText(text: string, msg: ChatRawMessage): void;
  /** An assistant thinking block. */
  onThinking(text: string, msg: ChatRawMessage): void;
  /** An assistant tool_use block (name may be undefined). */
  onToolUse(name: string | undefined, input: unknown, msg: ChatRawMessage): void;
  /** A user tool_result block (content already coerced to a string). */
  onToolResult(content: string, msg: ChatRawMessage): void;
  /** The end-of-turn result frame, normalized. */
  onTurnComplete(tc: ChatTurnComplete, msg: ChatRawMessage): void;
  /** PRD-0015 S1 —— 后台任务生命周期归一化事件（started/updated/notification/
   *  list_changed）。可选：codex 后端不产生这类帧、旧调用方不注册即视为未接管。
   *  【关键语义】task-class system 帧【同时】走此回调【和】onOther——归一化事件供
   *  registry/任务卡片消费，onOther 的 cli_event 转发保持不回归（web 侧既有消费不被
   *  抢走）。第二参 `msg` 保留原始帧引用。 */
  onBackgroundTask?(event: ChatBackgroundTaskEvent, msg: ChatRawMessage): void;
  /** Any frame not otherwise recognized (claude: forwarded as cli_event). */
  onOther(msg: ChatRawMessage): void;
}

/** A stateful line parser fed raw stdout chunks; it buffers partial lines. */
export interface ChatLineParser {
  push(chunk: string): void;
}

/** Result of a pre-spawn auth probe. `ok:false` carries a user-facing `message`
 *  that WsBridge surfaces instead of spawning (e.g. "run `codex login`"). */
export interface BackendAuthStatus {
  ok: boolean;
  message?: string;
}

/** A concrete chat CLI backend. */
export interface ChatBackend {
  /** Stable id (e.g. "claude", "codex"). */
  readonly id: string;
  /** Per-backend ENOENT text: what to tell the user when the CLI binary is not
   *  on PATH (a packaged app inherits a minimal GUI PATH). Sourced from the
   *  backend so the message names the RIGHT binary. */
  readonly notFoundMessage: string;
  /** Optional stderr signature of a dead `--resume` target (the stored CLI
   *  session id no longer exists in the CLI's local conversation store — e.g.
   *  after an account switch). When a resume spawn exits non-zero with ZERO
   *  turn text and stderr matches, WsBridge clears the stale id and respawns
   *  the turn fresh instead of leaving the chat silently dead. */
  readonly staleResumePattern?: RegExp;
  buildSpawn(input: ChatSpawnInput): ChatSpawnDescriptor;
  /** Resolve only explicitly supported slash commands. An unsupported result
   * has no prompt and must never be passed to buildSpawn. */
  resolveCommand(input: ChatBackendCommandInput): ChatBackendCommandResult;
  createLineParser(cb: ChatStreamCallbacks): ChatLineParser;
  /** Optional pre-spawn login/auth check. Backends whose CLI needs an
   *  interactive login (codex) implement this to probe local auth state.
   *  INTENDED contract: WsBridge would call it BEFORE spawn and, when
   *  `ok:false`, surface the guidance message instead of spawning. NOT YET
   *  WIRED — `spawnCli` (src/ws-bridge.ts) currently spawns without calling
   *  this, so the method is defined + unit-tested but has no production caller
   *  (the spawn-time gate is a C3/C4 follow-up; see ADR-013 §4). claude omits it
   *  (auth is handled by the claude CLI itself). */
  checkAuth?(): Promise<BackendAuthStatus>;
}
