/**
 * ChatBackend — the seam between WsBridge's session orchestration and the
 * concrete chat CLI it drives (C2, PRD-0010).
 *
 * WsBridge owns everything session-shaped: browser sockets, message history,
 * sidecar/cliSessionId bookkeeping, cost ledger, checkpoints, memory sync, the
 * `trends_` research event filtering, and process lifecycle (exit/error). A
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
 * (behavior zero change). Backend-specific coupling that must stay put — e.g.
 * the `trends_` WebSearch tool-name matching — lives in WsBridge's callbacks
 * (via onRawMessage), NOT in the backend, per the C2 slice.
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

/**
 * The unified event surface a parser drives. WsBridge supplies these; the parser
 * calls them as it decodes the stream. Ordering per message: `onRawMessage`
 * first (the pre-dispatch peek — trends filtering lives here), then exactly one
 * of the typed callbacks (or `onOther` for an unrecognized frame). For an
 * assistant message, `onAssistantMessage` fires once before its blocks are
 * walked into onText / onThinking / onToolUse.
 */
export interface ChatStreamCallbacks {
  /** Every parsed frame, BEFORE type dispatch (the trends peek hook). */
  onRawMessage?(msg: ChatRawMessage): void;
  /** system.init — the backend session id (may be undefined on claude). */
  onSessionId(cliSessionId: string | undefined, msg: ChatRawMessage): void;
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
  /** Any frame not otherwise recognized (claude: forwarded as cli_event). */
  onOther(msg: ChatRawMessage): void;
}

/** A stateful line parser fed raw stdout chunks; it buffers partial lines. */
export interface ChatLineParser {
  push(chunk: string): void;
}

/** A concrete chat CLI backend. */
export interface ChatBackend {
  /** Stable id (e.g. "claude", "codex"). */
  readonly id: string;
  buildSpawn(input: ChatSpawnInput): ChatSpawnDescriptor;
  createLineParser(cb: ChatStreamCallbacks): ChatLineParser;
}
