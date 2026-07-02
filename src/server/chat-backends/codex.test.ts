import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  codexBackend,
  checkCodexAuth,
  codexHomeDir,
  CODEX_NOT_FOUND_MESSAGE,
  CODEX_LOGIN_GUIDANCE_MESSAGE,
} from "./codex.js";
import { claudeBackend } from "./claude.js";
import type { ChatStreamCallbacks, ChatTurnComplete } from "./types.js";

// C3 (PRD-0010) — codex ChatBackend implementation.
// Consumes the C1 实测锚定 fixtures (src/server/chat-backends/__fixtures__/codex/)
// as the parser contract source, and locks the codex-specific spawn shape
// (exec / --json / resume subcommand / model flag), the login-before-spawn
// detection, and the per-backend ENOENT text. 测外部行为，不测实现细节。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "__fixtures__", "codex");

interface CodexEvent {
  type: string;
  thread_id?: string;
  item?: { id?: string; type?: string; command?: string; aggregated_output?: string; text?: string; [k: string]: unknown };
  usage?: Record<string, number>;
}

function readFixture(name: string): { raw: string; events: CodexEvent[] } {
  const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
  const events = raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as CodexEvent);
  return { raw, events };
}

function recorder() {
  const log: any[] = [];
  const cb: ChatStreamCallbacks = {
    onRawMessage: (m) => log.push(["raw", (m as any).type]),
    onSessionId: (id) => log.push(["session", id]),
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

// ── parser: fixture-driven unified event sequence ────────────────────────────

describe("codexBackend.createLineParser — C1 fixture → unified events", () => {
  it("exec-basic-tool-use.jsonl → ordered unified callbacks (逐项断言)", () => {
    const { raw, events } = readFixture("exec-basic-tool-use.jsonl");
    // Derive expected payloads FROM the fixture (真正消费 C1，不硬编码字面量).
    const threadId = events.find((e) => e.type === "thread.started")!.thread_id;
    const cmdStarted = events.find(
      (e) => e.type === "item.started" && e.item?.type === "command_execution",
    )!.item!;
    const cmdDone = events.find(
      (e) => e.type === "item.completed" && e.item?.type === "command_execution",
    )!.item!;
    const msg = events.find(
      (e) => e.type === "item.completed" && e.item?.type === "agent_message",
    )!.item!;
    const usage = events.find((e) => e.type === "turn.completed")!.usage;

    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    for (const line of raw.split("\n")) if (line.trim()) p.push(line + "\n");

    expect(log).toEqual([
      ["raw", "thread.started"],
      ["session", threadId],
      ["raw", "turn.started"],
      ["other", "turn.started"],
      ["raw", "item.started"],
      ["toolUse", "command_execution", { command: cmdStarted.command }],
      ["raw", "item.completed"],
      ["toolResult", cmdDone.aggregated_output],
      ["raw", "item.completed"],
      ["text", msg.text],
      ["raw", "turn.completed"],
      ["turnComplete", { usage }],
    ]);
  });

  it("exec-resume.jsonl → same shape, reuses the thread_id (resume 沿用 session)", () => {
    const { raw, events } = readFixture("exec-resume.jsonl");
    const threadId = events.find((e) => e.type === "thread.started")!.thread_id;
    const cmdStarted = events.find(
      (e) => e.type === "item.started" && e.item?.type === "command_execution",
    )!.item!;
    const cmdDone = events.find(
      (e) => e.type === "item.completed" && e.item?.type === "command_execution",
    )!.item!;
    const msg = events.find(
      (e) => e.type === "item.completed" && e.item?.type === "agent_message",
    )!.item!;
    const usage = events.find((e) => e.type === "turn.completed")!.usage;

    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    for (const line of raw.split("\n")) if (line.trim()) p.push(line + "\n");

    expect(log).toEqual([
      ["raw", "thread.started"],
      ["session", threadId],
      ["raw", "turn.started"],
      ["other", "turn.started"],
      ["raw", "item.started"],
      ["toolUse", "command_execution", { command: cmdStarted.command }],
      ["raw", "item.completed"],
      ["toolResult", cmdDone.aggregated_output],
      ["raw", "item.completed"],
      ["text", msg.text],
      ["raw", "turn.completed"],
      ["turnComplete", { usage }],
    ]);
  });

  it("turn.completed carries token usage only — no cost, no result (仅 token)", () => {
    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    p.push(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2, reasoning_output_tokens: 1 },
      }) + "\n",
    );
    const tc = log.find((e) => e[0] === "turnComplete")![1] as ChatTurnComplete;
    expect(tc.usage).toEqual({ input_tokens: 10, cached_input_tokens: 4, output_tokens: 2, reasoning_output_tokens: 1 });
    expect(tc.costUsd).toBeUndefined();
    expect(tc.result).toBeUndefined();
  });
});

// ── parser: open-set item.type + unknown-frame graceful degrade ──────────────

describe("codexBackend.createLineParser — 未知 type 优雅降级不抛", () => {
  function line(obj: Record<string, unknown>): string {
    return JSON.stringify(obj) + "\n";
  }

  it("unknown item.type folds to onOther (does not throw, does not guess)", () => {
    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    // file_change / mcp_tool_call / web_search / reasoning etc. are未观察到但可能存在
    expect(() =>
      p.push(line({ type: "item.completed", item: { id: "x", type: "file_change", path: "a.txt" } })),
    ).not.toThrow();
    expect(log).toEqual([
      ["raw", "item.completed"],
      ["other", "item.completed"],
    ]);
  });

  it("unknown TOP-LEVEL event type folds to onOther", () => {
    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    p.push(line({ type: "error", message: "boom" }));
    expect(log).toEqual([
      ["raw", "error"],
      ["other", "error"],
    ]);
  });

  it("agent_message with empty text does not emit onText (falls to onOther)", () => {
    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    p.push(line({ type: "item.completed", item: { id: "m", type: "agent_message", text: "" } }));
    expect(log).toEqual([
      ["raw", "item.completed"],
      ["other", "item.completed"],
    ]);
  });

  it("ignores non-JSON / blank lines without emitting or throwing", () => {
    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    expect(() => {
      p.push("not json at all\n");
      p.push("\n");
      p.push("   \n");
    }).not.toThrow();
    expect(log).toEqual([]);
  });

  it("buffers partial lines across push() calls (stream-chunk semantics)", () => {
    const { log, cb } = recorder();
    const p = codexBackend.createLineParser(cb);
    const full = line({ type: "item.completed", item: { id: "m", type: "agent_message", text: "spanned" } });
    const mid = Math.floor(full.length / 2);
    p.push(full.slice(0, mid));
    expect(log.filter((e) => e[0] === "text")).toEqual([]);
    p.push(full.slice(mid));
    expect(log.filter((e) => e[0] === "text")).toEqual([["text", "spanned"]]);
  });
});

// ── buildSpawn: arg composition + env ────────────────────────────────────────

describe("codexBackend.buildSpawn — arg composition", () => {
  const prompt = "你好，帮我看看这个作品";

  it("FRESH: codex exec --json --dangerously-bypass-approvals-and-sandbox, prompt positional last", () => {
    const d = codexBackend.buildSpawn({ prompt, workId: "w1", serverPort: 3271 });
    expect(d.cmd).toBe("codex");
    // exec subcommand + JSONL + full-access + git-check skip.
    expect(d.args[0]).toBe("exec");
    expect(d.args).toContain("--json");
    expect(d.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    // The prompt is the LAST positional arg (codex reads `[PROMPT]` positionally).
    expect(d.args[d.args.length - 1]).toBe(prompt);
    // NOT the resume subcommand.
    expect(d.args).not.toContain("resume");
  });

  it("RESUME: codex exec resume <id> ... — resume subcommand + id, NO exec-only -s/-C", () => {
    const d = codexBackend.buildSpawn({ prompt, workId: "w1", serverPort: 3271, resumeId: "019f-thread" });
    expect(d.args[0]).toBe("exec");
    expect(d.args[1]).toBe("resume");
    expect(d.args[2]).toBe("019f-thread");
    expect(d.args).toContain("--json");
    // GOTCHA 1 (C1 README): resume 旗标集比 exec 小 —— 不接受 -s/--sandbox 与 -C/--cd.
    expect(d.args).not.toContain("-s");
    expect(d.args).not.toContain("--sandbox");
    expect(d.args).not.toContain("-C");
    expect(d.args).not.toContain("--cd");
    // prompt still last positional.
    expect(d.args[d.args.length - 1]).toBe(prompt);
  });

  it("MODEL adds --model <alias> (both fresh and resume)", () => {
    const fresh = codexBackend.buildSpawn({ prompt, workId: "w1", serverPort: 3271, model: "gpt-5.4" });
    expect(fresh.args).toContain("--model");
    expect(fresh.args[fresh.args.indexOf("--model") + 1]).toBe("gpt-5.4");
    const resume = codexBackend.buildSpawn({ prompt, workId: "w1", serverPort: 3271, resumeId: "t", model: "gpt-5.4" });
    expect(resume.args).toContain("--model");
    expect(resume.args[resume.args.indexOf("--model") + 1]).toBe("gpt-5.4");
  });

  it("APPEND teaching is PREPENDED into the prompt (no --append-system-prompt equivalent)", () => {
    const d = codexBackend.buildSpawn({
      prompt,
      workId: "w1",
      serverPort: 3271,
      resumeId: "t",
      appendSystemPrompt: "提示：视频画幅默认跟画布走",
    });
    // codex has no --append-system-prompt flag.
    expect(d.args).not.toContain("--append-system-prompt");
    const wire = d.args[d.args.length - 1];
    expect(wire).toContain("提示：视频画幅默认跟画布走");
    expect(wire).toContain(prompt);
    // teaching comes BEFORE the user prompt.
    expect(wire.indexOf("提示：视频画幅默认跟画布走")).toBeLessThan(wire.indexOf(prompt));
  });
});

describe("codexBackend.buildSpawn — env + options", () => {
  it("injects the AUTOVIRAL_* env (preserved for the `autoviral` CLI) + piped stdio", () => {
    const d = codexBackend.buildSpawn({ prompt: "hi", workId: "w_env", serverPort: 4321 });
    expect(d.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    const env = d.options.env!;
    expect(env.AUTOVIRAL_WORK_ID).toBe("w_env");
    expect(env.AUTOVIRAL_PORT).toBe("4321");
    expect(typeof env.AUTOVIRAL_CWD).toBe("string");
    expect((env.AUTOVIRAL_CWD as string).endsWith(`works/w_env`)).toBe(true);
    expect(env.AUTOVIRAL_PROJECT_DIR).toBe(d.options.cwd);
    expect(typeof env.PATH).toBe("string");
    expect((env.PATH as string).length).toBeGreaterThan(0);
  });
});

// ── login detection: auth 缺失 → 引导文案；有 auth → ok ────────────────────────

describe("checkCodexAuth — login-before-spawn detection", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "codex-auth-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("auth.json MISSING → { ok:false } with a `codex login` guidance message (does not spawn)", async () => {
    const res = await checkCodexAuth({ codexHome: tmp });
    expect(res.ok).toBe(false);
    expect(res.message).toBe(CODEX_LOGIN_GUIDANCE_MESSAGE);
    expect(res.message).toMatch(/codex login/);
  });

  it("auth.json with an OPENAI_API_KEY → { ok:true }", async () => {
    writeFileSync(join(tmp, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-live-xyz" }));
    const res = await checkCodexAuth({ codexHome: tmp });
    expect(res.ok).toBe(true);
  });

  it("auth.json with ChatGPT tokens (no api key) → { ok:true }", async () => {
    writeFileSync(
      join(tmp, "auth.json"),
      JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { access_token: "a", refresh_token: "r" } }),
    );
    const res = await checkCodexAuth({ codexHome: tmp });
    expect(res.ok).toBe(true);
  });

  it("empty / signal-less auth.json → { ok:false }", async () => {
    writeFileSync(join(tmp, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null }));
    const res = await checkCodexAuth({ codexHome: tmp });
    expect(res.ok).toBe(false);
    expect(res.message).toBe(CODEX_LOGIN_GUIDANCE_MESSAGE);
  });

  it("malformed auth.json → { ok:false } (never throws)", async () => {
    writeFileSync(join(tmp, "auth.json"), "{ not valid json");
    const res = await checkCodexAuth({ codexHome: tmp });
    expect(res.ok).toBe(false);
  });

  it("codexHomeDir honors CODEX_HOME env for test injection", () => {
    const prev = process.env.CODEX_HOME;
    try {
      process.env.CODEX_HOME = "/some/where/.codex";
      expect(codexHomeDir()).toBe("/some/where/.codex");
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
    }
  });

  it("codexBackend.checkAuth() delegates to checkCodexAuth against the real CODEX_HOME", async () => {
    const prev = process.env.CODEX_HOME;
    const emptyHome = mkdtempSync(join(tmpdir(), "codex-empty-"));
    try {
      process.env.CODEX_HOME = emptyHome;
      const res = await codexBackend.checkAuth!();
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/codex login/);
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});

// ── per-backend ENOENT text ──────────────────────────────────────────────────

describe("per-backend notFoundMessage (ENOENT 文案)", () => {
  it("codex backend has a codex-specific not-found message", () => {
    expect(codexBackend.id).toBe("codex");
    expect(codexBackend.notFoundMessage).toBe(CODEX_NOT_FOUND_MESSAGE);
    expect(codexBackend.notFoundMessage).toMatch(/codex/i);
    // must NOT be the claude message.
    expect(codexBackend.notFoundMessage).not.toBe(claudeBackend.notFoundMessage);
  });

  it("claude backend still carries its own claude not-found message", () => {
    expect(claudeBackend.notFoundMessage).toMatch(/claude/i);
  });
});
