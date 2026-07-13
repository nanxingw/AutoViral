import { describe, it, expect } from "vitest";
import { claudeBackend } from "./claude.js";
import type { ChatStreamCallbacks, ChatTurnComplete } from "./types.js";

// C2 (PRD-0010) — ChatBackend contract test for the claude implementation.
// This is the RED-first, fixture-driven equivalence check: the extracted
// `buildSpawn` must produce the exact same `claude` cmd/args/env the old inline
// spawnCli did, and `createLineParser` must translate a claude stream-json line
// stream into the unified event callbacks in the same order the old inline
// NDJSON dispatch fired them. The ws-bridge-chat-backend.test.ts characterization
// lock proves the WIRING is unchanged end-to-end; this file locks the seam
// itself, field by field.

const BASE_ARGS = [
  "-p",
  "<PROMPT>",
  "--output-format",
  "stream-json",
  "--verbose",
  "--dangerously-skip-permissions",
];

function normArgs(args: string[]): string[] {
  const out = [...args];
  const p = out.indexOf("-p");
  if (p >= 0 && p + 1 < out.length) out[p + 1] = "<PROMPT>";
  const a = out.indexOf("--append-system-prompt");
  if (a >= 0 && a + 1 < out.length) out[a + 1] = "<APPEND>";
  return out;
}

describe("claudeBackend.buildSpawn — arg composition", () => {
  it("FRESH: base args only", () => {
    const d = claudeBackend.buildSpawn({ prompt: "hi", workId: "w1", serverPort: 3271 });
    expect(d.cmd).toBe("claude");
    expect(normArgs(d.args)).toEqual(BASE_ARGS);
    // The prompt value is the raw prompt (unmodified) at -p+1.
    expect(d.args[d.args.indexOf("-p") + 1]).toBe("hi");
  });

  it("RESUME adds --resume <id> after the base args", () => {
    const d = claudeBackend.buildSpawn({ prompt: "hi", workId: "w1", serverPort: 3271, resumeId: "cli-x" });
    expect(normArgs(d.args)).toEqual([...BASE_ARGS, "--resume", "cli-x"]);
  });

  it("APPEND adds --append-system-prompt <text>", () => {
    const d = claudeBackend.buildSpawn({
      prompt: "hi",
      workId: "w1",
      serverPort: 3271,
      resumeId: "cli-x",
      appendSystemPrompt: "new teaching",
    });
    expect(normArgs(d.args)).toEqual([...BASE_ARGS, "--resume", "cli-x", "--append-system-prompt", "<APPEND>"]);
    expect(d.args[d.args.indexOf("--append-system-prompt") + 1]).toBe("new teaching");
  });

  it("MODEL adds --model <alias>", () => {
    const d = claudeBackend.buildSpawn({ prompt: "hi", workId: "w1", serverPort: 3271, model: "sonnet" });
    expect(normArgs(d.args)).toEqual([...BASE_ARGS, "--model", "sonnet"]);
  });

  it("FULL combo keeps the exact flag ordering: resume → append → model", () => {
    const d = claudeBackend.buildSpawn({
      prompt: "hi",
      workId: "w1",
      serverPort: 3271,
      resumeId: "cli-x",
      appendSystemPrompt: "t",
      model: "opus",
    });
    expect(normArgs(d.args)).toEqual([
      ...BASE_ARGS,
      "--resume",
      "cli-x",
      "--append-system-prompt",
      "<APPEND>",
      "--model",
      "opus",
    ]);
  });
});

describe("claudeBackend.buildSpawn — env + options", () => {
  it("sets piped stdio and the AUTOVIRAL_* + CLAUDE_CODE_ENTRYPOINT env", () => {
    const d = claudeBackend.buildSpawn({ prompt: "hi", workId: "w_env", serverPort: 4321 });
    expect(d.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    const env = d.options.env!;
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
    expect(env.AUTOVIRAL_WORK_ID).toBe("w_env");
    expect(env.AUTOVIRAL_PORT).toBe("4321");
    expect(typeof env.AUTOVIRAL_CWD).toBe("string");
    expect((env.AUTOVIRAL_CWD as string).endsWith(`works/w_env`)).toBe(true);
    expect(typeof env.AUTOVIRAL_PROJECT_DIR).toBe("string");
    expect(env.AUTOVIRAL_PROJECT_DIR).toBe(d.options.cwd);
    expect(typeof env.PATH).toBe("string");
    expect((env.PATH as string).length).toBeGreaterThan(0);
  });
});

function recorder() {
  const log: any[] = [];
  const cb: ChatStreamCallbacks = {
    onRawMessage: (m) => log.push(["raw", (m as any).type]),
    onSessionId: (id) => log.push(["session", id]),
    onCapabilities: (capabilities) => log.push(["capabilities", capabilities]),
    onAssistantMessage: (_m, blocks) => log.push(["assistantMsg", blocks.length]),
    onText: (t) => log.push(["text", t]),
    onThinking: (t) => log.push(["thinking", t]),
    onToolUse: (name, input) => log.push(["toolUse", name, input]),
    onToolResult: (c) => log.push(["toolResult", c]),
    onTurnComplete: (tc) => log.push(["turnComplete", tc]),
    onOther: (m) => log.push(["other", (m as any).type]),
  };
  return { log, cb };
}

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n";
}

describe("claudeBackend.createLineParser — unified event translation", () => {
  it("captures slash_commands and skills from init, cache-merges repeated init updates, and dedupes names", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);

    p.push(line({
      type: "system",
      subtype: "init",
      session_id: "cli-1",
      slash_commands: ["compact", "review", "compact"],
      skills: ["review", "draft"],
    }));
    p.push(line({
      type: "system",
      subtype: "init",
      session_id: "cli-1",
      slash_commands: ["compact", "new-command"],
      skills: ["draft", "publish"],
    }));

    expect(log.filter((entry) => entry[0] === "capabilities")).toEqual([
      ["capabilities", {
        slashCommands: ["compact", "review"],
        skills: ["review", "draft"],
      }],
      ["capabilities", {
        slashCommands: ["compact", "review", "new-command"],
        skills: ["review", "draft", "publish"],
      }],
    ]);
    expect(log.filter((entry) => entry[0] === "session")).toEqual([
      ["session", "cli-1"],
      ["session", "cli-1"],
    ]);
  });

  it("translates a full claude turn into the ordered unified callbacks", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);
    p.push(line({ type: "system", subtype: "init", session_id: "cli-1" }));
    p.push(line({ type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "hmm" }] } }));
    p.push(line({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "hi" }] } }));
    p.push(line({ type: "assistant", message: { id: "m3", content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } }));
    p.push(line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }));
    p.push(line({ type: "result", result: "hi", total_cost_usd: 0.1, duration_ms: 42, session_id: "cli-1", usage: { input_tokens: 5, output_tokens: 3 } }));

    expect(log).toEqual([
      ["raw", "system"],
      ["session", "cli-1"],
      ["capabilities", { slashCommands: [], skills: [] }],
      ["raw", "assistant"],
      ["assistantMsg", 1],
      ["thinking", "hmm"],
      ["raw", "assistant"],
      ["assistantMsg", 1],
      ["text", "hi"],
      ["raw", "assistant"],
      ["assistantMsg", 1],
      ["toolUse", "Bash", { command: "ls" }],
      ["raw", "user"],
      ["toolResult", "ok"],
      ["raw", "result"],
      ["turnComplete", { result: "hi", sessionId: "cli-1", costUsd: 0.1, durationMs: 42, usage: { input_tokens: 5, output_tokens: 3 } }],
    ]);
  });

  it("buffers partial lines across push() calls (stream-chunk semantics)", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);
    const full = line({ type: "assistant", message: { id: "m", content: [{ type: "text", text: "spanned" }] } });
    const mid = Math.floor(full.length / 2);
    p.push(full.slice(0, mid));
    // Nothing complete yet.
    expect(log.filter((e) => e[0] === "text")).toEqual([]);
    p.push(full.slice(mid));
    expect(log.filter((e) => e[0] === "text")).toEqual([["text", "spanned"]]);
  });

  it("ignores non-JSON / blank lines without emitting", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);
    p.push("not json at all\n");
    p.push("\n");
    p.push("   \n");
    expect(log).toEqual([]);
  });

  it("routes an unrecognized frame type to onOther", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);
    p.push(line({ type: "mystery", foo: 1 }));
    expect(log).toEqual([["raw", "mystery"], ["other", "mystery"]]);
  });

  it("stringifies non-string tool_result content", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);
    p.push(line({ type: "user", message: { content: [{ type: "tool_result", content: [{ a: 1 }] }] } }));
    const tr = log.find((e) => e[0] === "toolResult");
    expect(tr).toEqual(["toolResult", JSON.stringify([{ a: 1 }])]);
  });

  it("turn_complete with an empty-string result yields result:undefined (turnText fallback stays with the caller)", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);
    p.push(line({ type: "result", result: "" }));
    const tc = log.find((e) => e[0] === "turnComplete")![1] as ChatTurnComplete;
    expect(tc.result).toBeUndefined();
  });

  it("assistant message without content falls through to onOther (matches old dispatch)", () => {
    const { log, cb } = recorder();
    const p = claudeBackend.createLineParser(cb);
    p.push(line({ type: "assistant", message: { id: "m" } }));
    expect(log).toEqual([["raw", "assistant"], ["other", "assistant"]]);
  });
});
