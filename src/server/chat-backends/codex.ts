/**
 * codex ChatBackend (C3, PRD-0010).
 *
 * The second concrete ChatBackend behind the C2 seam: it drives OpenAI's
 * `codex` CLI in non-interactive `exec --json` mode and normalizes its JSONL
 * event stream into the SAME unified callbacks the claude backend produces, so
 * WsBridge's session orchestration (broadcast / record / sidecar / checkpoint /
 * memory sync) is reused byte-for-byte across backends.
 *
 * Anchored to the C1 实测 fixtures (src/server/chat-backends/__fixtures__/codex/,
 * codex-cli 0.142.4). Event mapping:
 *   - thread.started  → onSessionId(thread_id)         (resume reuses the id)
 *   - item.started {command_execution}   → onToolUse   (the shell invocation)
 *   - item.completed {command_execution} → onToolResult(aggregated_output)
 *   - item.completed {agent_message}     → onText(text)
 *   - turn.completed  → onTurnComplete({ usage })       (TOKEN-ONLY, no cost)
 *   - anything else (turn.started, unknown item.type like file_change /
 *     mcp_tool_call / web_search / reasoning, unknown top-level type) → onOther
 *     (GRACEFUL DEGRADE — item.type is an OPEN set, never穷举; never throw).
 *
 * GOTCHAS locked from C1:
 *   1. `codex exec resume` accepts a SMALLER flag set than `codex exec` — it
 *      rejects `-s/--sandbox` and `-C/--cd` (resume reuses the first turn's
 *      sandbox + cwd). buildSpawn NEVER copies those onto the resume command.
 *   2. reasoning has no standalone item event; it only shows up as
 *      turn.completed.usage.reasoning_output_tokens.
 *   3. codex has NO `--append-system-prompt` equivalent, so mid-conversation
 *      teaching (B7-lite) is PREPENDED into the wire prompt instead of a flag.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import type { SpawnOptions } from "node:child_process";
import { PACKAGE_ROOT, buildSpawnPath } from "../../infra/paths.js";
import { dataDir } from "../../infra/config.js";
import type {
  BackendAuthStatus,
  ChatBackend,
  ChatLineParser,
  ChatRawMessage,
  ChatSpawnDescriptor,
  ChatSpawnInput,
  ChatStreamCallbacks,
  ChatTurnComplete,
} from "./types.js";

/** Per-backend ENOENT text: names the `codex` binary (not `claude`). */
export const CODEX_NOT_FOUND_MESSAGE =
  "无法启动 Codex：找不到 `codex` 命令。请确认 Codex CLI 已安装并在 PATH 上（在终端运行 `codex --version` 验证）。";

/** Shown when codex is installed but not logged in — routes the user to the
 *  Terminal (login is interactive; the daemon can't do it). */
export const CODEX_LOGIN_GUIDANCE_MESSAGE =
  "无法启动 Codex：尚未登录。请在终端运行 `codex login` 完成登录（ChatGPT 或 API key 均可），然后重试。";

/** Where the codex CLI keeps its auth/config. Honors CODEX_HOME (the codex CLI's
 *  own override) so tests can point at a temp dir without mocking node:os. */
export function codexHomeDir(): string {
  const env = process.env.CODEX_HOME;
  return env && env.trim() ? env : join(homedir(), ".codex");
}

/**
 * Pre-spawn login detection. codex's `exec` fails opaquely when not logged in;
 * we probe `<codexHome>/auth.json` first so WsBridge can surface a `codex login`
 * nudge instead of a cryptic CLI error. Auth counts when the file parses AND
 * carries a real credential — a non-empty OPENAI_API_KEY (api-key mode) OR a
 * `tokens` object (ChatGPT mode). Never throws (missing/malformed → ok:false).
 */
export async function checkCodexAuth(opts?: { codexHome?: string }): Promise<BackendAuthStatus> {
  const home = opts?.codexHome ?? codexHomeDir();
  const authPath = join(home, "auth.json");
  try {
    const raw = await readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const hasApiKey = typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.length > 0;
    const hasTokens = !!parsed.tokens && typeof parsed.tokens === "object";
    if (hasApiKey || hasTokens) return { ok: true };
    return { ok: false, message: CODEX_LOGIN_GUIDANCE_MESSAGE };
  } catch {
    // Missing file / unreadable / malformed JSON — all mean "not logged in".
    return { ok: false, message: CODEX_LOGIN_GUIDANCE_MESSAGE };
  }
}

/** Normalize a codex `turn.completed` frame into the provider-agnostic summary.
 *  TOKEN-ONLY: codex reports usage but no per-turn USD, so `costUsd` stays
 *  undefined (honesty — the C4 badge is token-only, no local price guessing).
 *  `result` stays undefined so the caller falls back to its accumulated turn
 *  text (codex's final text arrives as an agent_message item, not on this
 *  frame). `usage` is passed through raw — input_tokens/output_tokens align with
 *  the claude keys the browser reads; cached/reasoning tokens ride along. */
function buildTurnComplete(msg: ChatRawMessage): ChatTurnComplete {
  const usage = (msg as Record<string, unknown>).usage as Record<string, number> | undefined;
  return usage ? { usage } : {};
}

/** Dispatch one parsed codex frame to the unified callbacks. */
function dispatch(msg: ChatRawMessage, cb: ChatStreamCallbacks): void {
  // Pre-dispatch peek (parity with claude; the trends filter is a no-op here —
  // codex frame types differ and trend sessions stay on claude, per C5 scope).
  cb.onRawMessage?.(msg);

  const type = msg.type;

  // thread.started — the codex session/thread id (reused verbatim on resume).
  if (type === "thread.started") {
    cb.onSessionId((msg as Record<string, unknown>).thread_id as string | undefined, msg);
    return;
  }

  // item lifecycle — command_execution (tool) + agent_message (text). item.type
  // is an OPEN set: any type we don't recognize degrades to onOther.
  if (type === "item.started" || type === "item.completed") {
    const item = (msg as Record<string, unknown>).item as Record<string, unknown> | undefined;
    const itemType = item?.type;

    if (itemType === "command_execution") {
      if (type === "item.started") {
        // The shell invocation — surface the command as the tool "input".
        cb.onToolUse("command_execution", { command: item?.command }, msg);
      } else {
        // Completed — the aggregated stdout/stderr is the tool result.
        const out = item?.aggregated_output;
        cb.onToolResult(typeof out === "string" ? out : JSON.stringify(out ?? ""), msg);
      }
      return;
    }

    if (itemType === "agent_message") {
      // Final assistant text only appears on item.completed (no started).
      const text = item?.text;
      if (type === "item.completed" && typeof text === "string" && text) {
        cb.onText(text, msg);
        return;
      }
      // agent_message.started / empty text — nothing to render.
      cb.onOther(msg);
      return;
    }

    // Unknown item.type (file_change / mcp_tool_call / web_search / reasoning …)
    // — graceful degrade, forward raw, never crash.
    cb.onOther(msg);
    return;
  }

  // turn.completed — token usage only.
  if (type === "turn.completed") {
    cb.onTurnComplete(buildTurnComplete(msg), msg);
    return;
  }

  // PRD-0015 S1 —— 后台任务生命周期归一化（onBackgroundTask）是 claude print-mode
  // 专有的 system 帧；codex exec 的事件流里没有对应帧，故本后端【空实现】——不产生
  // 归一化任务事件（onBackgroundTask 可选，不注册即视为未接管）。未识别帧照常降级
  // 到下面的 onOther。



  // turn.started and any unrecognized top-level type.
  cb.onOther(msg);
}

export const codexBackend: ChatBackend = {
  id: "codex",

  notFoundMessage: CODEX_NOT_FOUND_MESSAGE,

  resolveCommand(input) {
    const name = input.name.replace(/^\/+/, "").trim();
    return {
      status: "unsupported",
      errorCode: "unsupported_command",
      command: name,
      message: `Codex exec does not support /${name}.`,
    };
  },

  buildSpawn(input: ChatSpawnInput): ChatSpawnDescriptor {
    // "全放开权限模式" — the equivalent of claude's --dangerously-skip-permissions.
    // --dangerously-bypass-approvals-and-sandbox skips all confirmations AND the
    // sandbox; it is accepted by BOTH `exec` and `exec resume` (unlike -s/-C).
    // --skip-git-repo-check lets codex run from a non-git cwd (packaged app).
    const FULL_ACCESS = "--dangerously-bypass-approvals-and-sandbox";

    // codex has no --append-system-prompt: fold mid-conversation teaching into
    // the wire prompt as a PREFIX (GOTCHA 3). Fresh spawns carry the full system
    // prompt already, so appendSystemPrompt is only ever set on resume.
    const wirePrompt = input.appendSystemPrompt
      ? `${input.appendSystemPrompt}\n\n---\n\n${input.prompt}`
      : input.prompt;

    let args: string[];
    if (input.resumeId) {
      // GOTCHA 1: resume takes NO -s/--sandbox and NO -C/--cd — it reuses the
      // first turn's sandbox + cwd. Only the flags resume actually accepts.
      args = ["exec", "resume", input.resumeId, "--json", FULL_ACCESS, "--skip-git-repo-check"];
    } else {
      args = ["exec", "--json", FULL_ACCESS, "--skip-git-repo-check"];
    }

    if (input.model) {
      args.push("--model", input.model);
    }

    // Prompt is the trailing positional `[PROMPT]` (matches the C1 collection
    // command). Kept last so the flags above bind unambiguously.
    args.push(wirePrompt);

    // Same PATH/cwd/env contract as the claude backend: run from PACKAGE_ROOT
    // (a git repo in dev; --skip-git-repo-check covers the packaged case) with
    // the `autoviral` shim on PATH and the per-work env the CLI reads.
    const workCwd = join(dataDir, "works", input.workId);
    const options: SpawnOptions = {
      cwd: PACKAGE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: buildSpawnPath(),
        AUTOVIRAL_PROJECT_DIR: PACKAGE_ROOT,
        AUTOVIRAL_WORK_ID: input.workId,
        AUTOVIRAL_PORT: String(input.serverPort),
        AUTOVIRAL_CWD: workCwd,
      },
    };

    return { cmd: "codex", args, options };
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
            // Non-JSON line (codex prints nothing but JSONL on stdout, but stay
            // defensive) — ignore, matching the claude parser's swallow.
          }
        }
      },
    };
  },

  async checkAuth(): Promise<BackendAuthStatus> {
    return checkCodexAuth();
  },
};
