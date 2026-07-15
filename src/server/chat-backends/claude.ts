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
  ChatBackendCommandResult,
  ChatLineParser,
  ChatRawMessage,
  ChatSpawnDescriptor,
  ChatSpawnInput,
  ChatStreamCallbacks,
  ChatTurnComplete,
} from "./types.js";
import { isDeniedChatCommandName } from "../chat-commands/registry.js";

/** PRD-0015 S5 —— print-mode 后台任务等待上限默认值。
 *  claude CLI 的 CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS 满上限后会在子进程内强杀全部
 *  后台任务再退出（030 事故直接死因，2.1.210 二进制内默认 600000ms）。默认注入 0 =
 *  无限等待：实测（ADR-015）result 帧不被 hold、首个回复不阻塞、chat UX 无损，而任何
 *  有限值都会重演 030。服务端配置可覆盖为止损上限（AutoViral 侧的杀前 drain 由 S6
 *  KillGate 负责，不靠这个上限止血）。 */
export const DEFAULT_PRINT_BG_WAIT_CEILING_MS = 0;

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
function dispatch(
  msg: ChatRawMessage,
  cb: ChatStreamCallbacks,
  capabilityCache: { slashCommands: string[]; skills: string[] },
): void {
  // Pre-dispatch peek (trends WebSearch filtering lives in the caller).
  cb.onRawMessage?.(msg);

  // system.init — capture session id.
  if (msg.type === "system" && msg.subtype === "init") {
    cb.onSessionId(msg.session_id, msg);
    const mergeNames = (current: string[], incoming: unknown): string[] => {
      if (!Array.isArray(incoming)) return current;
      const next = [...current];
      const seen = new Set(current);
      for (const value of incoming) {
        if (typeof value !== "string") continue;
        const name = value.replace(/^\/+/, "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        next.push(name);
      }
      return next;
    };
    capabilityCache.slashCommands = mergeNames(
      capabilityCache.slashCommands,
      msg.slash_commands,
    );
    capabilityCache.skills = mergeNames(capabilityCache.skills, msg.skills);
    cb.onCapabilities?.(
      {
        slashCommands: [...capabilityCache.slashCommands],
        skills: [...capabilityCache.skills],
      },
      msg,
    );
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

  // `claude --resume <uuid>` against an id missing from the local conversation
  // store (account switch / store pruned) prints exactly this and exits 1.
  staleResumePattern: /No conversation found with session ID/i,

  resolveCommand(input): ChatBackendCommandResult {
    const name = input.name.replace(/^\/+/, "").trim().toLowerCase();
    const slashCommands = new Set(input.capabilities?.slashCommands ?? []);
    const skills = new Set(input.capabilities?.skills ?? []);
    const dynamicallyAvailable = slashCommands.has(name) || skills.has(name);
    const allowed = name === "compact" ? slashCommands.has("compact") : skills.has(name);
    if (!dynamicallyAvailable || !allowed || isDeniedChatCommandName(name)) {
      return {
        status: "unsupported",
        errorCode: "unsupported_command",
        command: name,
        message: `Claude command /${name} is not available for this session.`,
      };
    }
    const args = input.args.trim();
    return {
      status: "ready",
      kind: "passthrough",
      command: name,
      prompt: `/${name}${args ? ` ${args}` : ""}`,
    };
  },

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
        // PRD-0015 S5（止血）—— 显式钉住 print-mode 后台任务等待上限，别继承上游
        // 二进制内默认的 600000ms（030 事故直接死因）。默认 0 = 无限等待；服务端
        // 配置 chat.bgWaitCeilingMs 可覆盖为止损上限。详见 ADR-015。
        CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: String(
          input.bgWaitCeilingMs ?? DEFAULT_PRINT_BG_WAIT_CEILING_MS,
        ),
      },
    };

    return { cmd: "claude", args, options };
  },

  createLineParser(cb: ChatStreamCallbacks): ChatLineParser {
    let buffer = "";
    const capabilityCache = { slashCommands: [] as string[], skills: [] as string[] };
    return {
      push(chunk: string): void {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as ChatRawMessage;
            dispatch(msg, cb, capabilityCache);
          } catch {
            // Non-JSON line, ignore (matches the old inline swallow — the whole
            // parse+dispatch body was inside a single try/catch).
          }
        }
      },
    };
  },
};
