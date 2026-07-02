/**
 * claude ChatBackend (C2, PRD-0010).
 *
 * A pure move-over of the `claude` spawn + NDJSON stream-json parsing that used
 * to live inline in WsBridge.spawnCli. Behavior is unchanged; the only shift is
 * that arg/env construction and the frame→event translation now sit behind the
 * ChatBackend interface so a second backend (codex, C3) can slot in. All the
 * session side effects (broadcast / record / sidecar / cost / checkpoint /
 * trends filtering) stay in WsBridge via the callbacks.
 */

import { join } from "node:path";
import type { SpawnOptions } from "node:child_process";
import { PACKAGE_ROOT, buildSpawnPath } from "../../infra/paths.js";
import { dataDir } from "../../infra/config.js";
import type {
  ChatBackend,
  ChatLineParser,
  ChatRawMessage,
  ChatSpawnDescriptor,
  ChatSpawnInput,
  ChatStreamCallbacks,
  ChatTurnComplete,
} from "./types.js";

/** Normalize a claude `result` frame into the provider-agnostic summary. */
function buildTurnComplete(msg: ChatRawMessage): ChatTurnComplete {
  const usage = msg.usage as Record<string, number> | undefined;
  const cost = (msg as Record<string, unknown>).total_cost_usd as number | undefined;
  const durationMs = (msg as Record<string, unknown>).duration_ms as number | undefined;
  return {
    // Only a non-empty string result counts; the empty/absent case stays
    // undefined so the caller falls back to its accumulated turn text (this is
    // exactly `typeof msg.result === "string" && msg.result ? msg.result : …`).
    result: typeof msg.result === "string" && msg.result ? msg.result : undefined,
    sessionId: msg.session_id,
    costUsd: cost,
    durationMs,
    usage,
  };
}

/** Dispatch one parsed claude frame to the unified callbacks. The branch order
 *  and guards mirror the old inline spawnCli dispatch byte-for-byte. */
function dispatch(msg: ChatRawMessage, cb: ChatStreamCallbacks): void {
  // Pre-dispatch peek (trends WebSearch filtering lives in the caller).
  cb.onRawMessage?.(msg);

  // system.init — capture session id.
  if (msg.type === "system" && msg.subtype === "init") {
    cb.onSessionId(msg.session_id, msg);
    return;
  }

  // assistant — forward all content blocks.
  if (msg.type === "assistant" && msg.message?.content) {
    const blocks = msg.message.content as Array<Record<string, unknown>>;
    cb.onAssistantMessage?.(msg, blocks);
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        cb.onText(block.text as string, msg);
      } else if (block.type === "thinking" && block.thinking) {
        cb.onThinking(block.thinking as string, msg);
      } else if (block.type === "tool_use") {
        cb.onToolUse(block.name as string | undefined, block.input, msg);
      }
    }
    return;
  }

  // user (tool results).
  if (msg.type === "user" && (msg as Record<string, unknown>).message) {
    const userMsg = (msg as Record<string, unknown>).message as Record<string, unknown>;
    const content = userMsg.content as Array<Record<string, unknown>> | undefined;
    if (content) {
      for (const block of content) {
        if (block.type === "tool_result") {
          const resultContent =
            typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          cb.onToolResult(resultContent, msg);
        }
      }
    }
    return;
  }

  // result — turn complete.
  if (msg.type === "result") {
    cb.onTurnComplete(buildTurnComplete(msg), msg);
    return;
  }

  // Everything else.
  cb.onOther(msg);
}

/** Per-backend ENOENT text — moved verbatim from the old inline ws-bridge
 *  error handler so a missing `claude` binary still surfaces the same actionable
 *  message (a packaged Electron app inherits a minimal GUI PATH that often lacks
 *  the CLI). Sourced from the backend so C3's codex path gets its own wording. */
export const CLAUDE_NOT_FOUND_MESSAGE =
  "无法启动创作 agent：找不到 `claude` 命令。请确认 Claude Code CLI 已安装并在 PATH 上（在终端运行 `claude --version` 验证）。";

export const claudeBackend: ChatBackend = {
  id: "claude",

  notFoundMessage: CLAUDE_NOT_FOUND_MESSAGE,

  buildSpawn(input: ChatSpawnInput): ChatSpawnDescriptor {
    const args = [
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (input.resumeId) {
      args.push("--resume", input.resumeId);
    }

    // B7(a)-lite (PRD-0009) — on resume, inject teaching added since this
    // session's stored prompt version as a mid-conversation system append.
    if (input.appendSystemPrompt) {
      args.push("--append-system-prompt", input.appendSystemPrompt);
    }

    if (input.model) {
      args.push("--model", input.model);
    }

    // Put the `autoviral` CLI on the agent's PATH (repo-contained shim) and
    // inject the per-work env the CLI requires (see the CLI_BIN_DIR invariant in
    // infra/paths.ts — the fail-fast assertCliBinDir guard stays in WsBridge
    // alongside the actual spawn). AUTOVIRAL_PORT is process-wide from
    // startServer() but set explicitly here to stay self-contained.
    const workCwd = join(dataDir, "works", input.workId);
    const options: SpawnOptions = {
      cwd: PACKAGE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: buildSpawnPath(),
        CLAUDE_CODE_ENTRYPOINT: "cli",
        AUTOVIRAL_PROJECT_DIR: PACKAGE_ROOT,
        AUTOVIRAL_WORK_ID: input.workId,
        AUTOVIRAL_PORT: String(input.serverPort),
        AUTOVIRAL_CWD: workCwd,
      },
    };

    return { cmd: "claude", args, options };
  },

  createLineParser(cb: ChatStreamCallbacks): ChatLineParser {
    let buffer = "";
    return {
      push(chunk: string): void {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as ChatRawMessage;
            dispatch(msg, cb);
          } catch {
            // Non-JSON line, ignore (matches the old inline swallow — the whole
            // parse+dispatch body was inside a single try/catch).
          }
        }
      },
    };
  },
};
