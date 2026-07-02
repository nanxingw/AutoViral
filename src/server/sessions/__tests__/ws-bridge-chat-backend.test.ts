import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// C2 (PRD-0010) — CHARACTERIZATION / behavior-lock for the ChatBackend
// extraction. This file captures the CURRENT observable behavior of WsBridge's
// single spawn chokepoint (spawnCli) through its PUBLIC surface — the exact
// `claude` spawn args across flag combos (resume / 补教学 append / model), the
// spawn env + options, and the NDJSON → browser-broadcast event sequence for
// both a normal editing turn and a `trends_` research turn.
//
// It is GREEN on the pre-refactor code (it is the snapshot baseline) and MUST
// stay byte-for-byte GREEN after the ChatBackend interface is extracted and the
// claude implementation is moved — that unchanged-ness IS the pure-refactor
// proof the slice's acceptance criteria demand ("全套件绿且快照零 diff").
//
// Pattern lifted verbatim from ws-bridge-resume-prompt.test.ts (spawn mock) and
// ws-bridge-agent-cost.test.ts (fake-stdout frame driving + broadcast sink).

const spawnCalls: { cmd: string; args: string[]; options: any }[] = [];
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  return proc;
}
vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[], options: any) => {
    spawnCalls.push({ cmd, args, options });
    return makeFakeProc();
  },
}));

beforeEach(() => {
  spawnCalls.length = 0;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.AUTOVIRAL_DATA_DIR;
});

async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-ws-chatbackend-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastSpawn(): { cmd: string; args: string[]; options: any } {
  return spawnCalls[spawnCalls.length - 1];
}

/** Normalize the volatile arg VALUES (the prompt + the append-teaching text) to
 *  stable placeholders so the exact FLAG ORDERING + fixed flag values can be
 *  asserted as a snapshot regardless of the (large / dynamic) system prompt. */
function normArgs(args: string[]): string[] {
  const out = [...args];
  const p = out.indexOf("-p");
  if (p >= 0 && p + 1 < out.length) out[p + 1] = "<PROMPT>";
  const a = out.indexOf("--append-system-prompt");
  if (a >= 0 && a + 1 < out.length) out[a + 1] = "<APPEND>";
  return out;
}

const BASE_ARGS = [
  "-p",
  "<PROMPT>",
  "--output-format",
  "stream-json",
  "--verbose",
  "--dangerously-skip-permissions",
];

function fakeSocket(sink: string[]): never {
  return {
    readyState: 1 /* WebSocket.OPEN */,
    send: (m: string) => sink.push(m),
  } as unknown as never;
}

/** Parsed broadcast frames (timestamp stripped, block ids normalized) in the
 *  order they were pushed to the browser socket. */
function events(sink: string[]): Array<{ event: string; data: any }> {
  return sink.map((m) => JSON.parse(m)).map((f) => ({ event: f.event, data: f.data }));
}

function emit(proc: { stdout: EventEmitter }, frame: Record<string, unknown>): void {
  proc.stdout.emit("data", Buffer.from(JSON.stringify(frame) + "\n"));
}

describe("WsBridge — C2 claude spawn arg composition (locked across flag combos)", () => {
  it("FRESH session (no resume / no append / no model): base args only", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_fresh";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID);
      expect(lastSpawn().cmd).toBe("claude");
      expect(normArgs(lastSpawn().args)).toEqual(BASE_ARGS);
    });
  });

  it("RESUME at current version: base args + --resume, no append", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, PROMPT_VERSION } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_resume";
      await mkdir(join(dir, "works", work), { recursive: true });
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-current",
      });
      await sidecar.patch(DEFAULT_CHAT_SESSION_ID, { lastInjectedPromptVersion: PROMPT_VERSION });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);
      expect(normArgs(lastSpawn().args)).toEqual([...BASE_ARGS, "--resume", "cli-current"]);
    });
  });

  it("RESUME at TRAILING version: base args + --resume + --append-system-prompt (in that order)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, promptChangelogSince } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_trail";
      await mkdir(join(dir, "works", work), { recursive: true });
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-abc-123",
      });
      await sidecar.patch(DEFAULT_CHAT_SESSION_ID, { lastInjectedPromptVersion: 1 });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续做", undefined, DEFAULT_CHAT_SESSION_ID);

      expect(normArgs(lastSpawn().args)).toEqual([
        ...BASE_ARGS,
        "--resume",
        "cli-abc-123",
        "--append-system-prompt",
        "<APPEND>",
      ]);
      // The append VALUE is exactly the changelog delta since the stored version.
      const args = lastSpawn().args;
      expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(promptChangelogSince(1));
    });
  });

  it("MODEL set (fresh trend session, model=sonnet): base args + --model", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      await mkdir(join(dir, "works"), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createTrendSession("trends_douyin", "调研一下");
      expect(normArgs(lastSpawn().args)).toEqual([...BASE_ARGS, "--model", "sonnet"]);
    });
  });
});

describe("WsBridge — C2 claude spawn env + options (locked)", () => {
  it("passes cwd=PACKAGE_ROOT, piped stdio, and the AUTOVIRAL_* + CLAUDE_CODE_ENTRYPOINT env", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const { PACKAGE_ROOT } = await import("../../../infra/paths.js");
      const work = "w_env";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(4321);
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID);

      const { options } = lastSpawn();
      expect(options.cwd).toBe(PACKAGE_ROOT);
      expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
      expect(options.env.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
      expect(options.env.AUTOVIRAL_PROJECT_DIR).toBe(PACKAGE_ROOT);
      expect(options.env.AUTOVIRAL_WORK_ID).toBe(work);
      expect(options.env.AUTOVIRAL_PORT).toBe("4321");
      expect(options.env.AUTOVIRAL_CWD).toBe(join(dir, "works", work));
      expect(typeof options.env.PATH).toBe("string");
      expect(options.env.PATH!.length).toBeGreaterThan(0);
    });
  });
});

describe("WsBridge — C2 NDJSON → broadcast event sequence (editing turn, locked)", () => {
  it("system.init / thinking / text / tool_use / tool_result / result map to the exact broadcast sequence", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_seq";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const sink: string[] = [];
      session.browserSockets.add(fakeSocket(sink));

      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emit(proc, { type: "system", subtype: "init", session_id: "cli-1" });
      emit(proc, { type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "let me think" }] } });
      emit(proc, { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "hello there" }] } });
      emit(proc, { type: "assistant", message: { id: "m3", content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } });
      emit(proc, { type: "user", message: { content: [{ type: "tool_result", content: "file.txt" }] } });
      emit(proc, { type: "result", result: "hello there", total_cost_usd: 0.1, duration_ms: 42, session_id: "cli-1", usage: { input_tokens: 5, output_tokens: 3 } });
      await sleep(40);

      const seq = events(sink);
      expect(seq.map((e) => e.event)).toEqual([
        "session_ready",
        "assistant_thinking",
        "assistant_text",
        "tool_use",
        "tool_result",
        "turn_complete",
      ]);

      // Spot-check the unified payloads survive the mapping unchanged.
      const ready = seq.find((e) => e.event === "session_ready")!;
      expect(ready.data.cliSessionId).toBe("cli-1");
      expect(seq.find((e) => e.event === "assistant_thinking")!.data.text).toBe("let me think");
      expect(seq.find((e) => e.event === "assistant_text")!.data.text).toBe("hello there");
      const tu = seq.find((e) => e.event === "tool_use")!;
      expect(tu.data.name).toBe("Bash");
      expect(tu.data.input).toEqual({ command: "ls" });
      expect(seq.find((e) => e.event === "tool_result")!.data.content).toBe("file.txt");
      const tc = seq.find((e) => e.event === "turn_complete")!;
      expect(tc.data.idle).toBe(true);
      expect(tc.data.result).toBe("hello there");
      expect(tc.data.sessionId).toBe("cli-1");
      expect(tc.data.cost).toBeCloseTo(0.1, 6);
      expect(tc.data.durationMs).toBe(42);
      expect(tc.data.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
    });
  });

  it("an unrecognized frame type falls through to a cli_event broadcast", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_other";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const sink: string[] = [];
      session.browserSockets.add(fakeSocket(sink));

      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emit(proc, { type: "mystery", foo: "bar" });
      await sleep(20);

      const seq = events(sink);
      expect(seq.map((e) => e.event)).toEqual(["cli_event"]);
      expect(seq[0].data).toEqual({ type: "mystery", foo: "bar" });
    });
  });
});

describe("WsBridge — C2 trends NDJSON → research event sequence (locked)", () => {
  it("WebSearch tool_use → search_query+tool_use; tool_result → search_result+tool_result; text → analyzing+assistant_text", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      await mkdir(join(dir, "works"), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createTrendSession("trends_douyin", "调研");
      const session = bridge.getSession("trends_douyin", DEFAULT_CHAT_SESSION_ID)!;
      const sink: string[] = [];
      session.browserSockets.add(fakeSocket(sink));

      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emit(proc, { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", name: "WebSearch", input: { query: "热点" } }] } });
      emit(proc, { type: "user", message: { content: [{ type: "tool_result", content: "搜到了三条" }] } });
      emit(proc, { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "分析结果" }] } });
      await sleep(40);

      const seq = events(sink);
      expect(seq.map((e) => e.event)).toEqual([
        "search_query",
        "tool_use",
        "search_result",
        "tool_result",
        "analyzing",
        "assistant_text",
      ]);
      expect(seq.find((e) => e.event === "search_query")!.data.query).toBe("热点");
      expect(seq.find((e) => e.event === "search_result")!.data.summary).toBe("搜到了三条");
      expect(seq.find((e) => e.event === "assistant_text")!.data.text).toBe("分析结果");
    });
  });
});
