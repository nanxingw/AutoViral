import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// B7(a)-lite (PRD-0009) — resumed editing-agent sessions whose stored prompt
// version trails PROMPT_VERSION must get the intervening teaching injected via
// `--append-system-prompt`; current sessions must not; fresh sessions record
// the current version. We mock node:child_process.spawn to capture the args the
// bridge constructs (the real `claude` binary isn't present / shouldn't run),
// and assert ONLY on argument construction + the persisted version — the actual
// CLI insertion behaviour of --append-system-prompt is verified by a downstream
// E2E Workflow, not here.

// Capture every spawn() call's args. The bridge consumes proc.stdout?.on,
// proc.stderr?.on and proc.on — a bare EventEmitter with stub stream emitters
// satisfies all three without ever emitting (so no NDJSON is parsed).
const spawnCalls: { cmd: string; args: string[] }[] = [];
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
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
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
  const dir = await mkdtemp(join(tmpdir(), "av-ws-resume-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

function lastSpawnArgs(): string[] {
  return spawnCalls[spawnCalls.length - 1]?.args ?? [];
}

/** Extract the value passed to --append-system-prompt, or undefined. */
function appendedSystemPrompt(args: string[]): string | undefined {
  const i = args.indexOf("--append-system-prompt");
  return i >= 0 ? args[i + 1] : undefined;
}

describe("WsBridge — B7(a)-lite resume prompt-version injection", () => {
  it("pure changelog helper concatenates only versions strictly newer than stored", async () => {
    const { promptChangelogSince, PROMPT_VERSION, PROMPT_CHANGELOG } = await import(
      "../../../ws-bridge.js"
    );
    // Behind by everything → full changelog from v1..current.
    const full = promptChangelogSince(0);
    expect(full.length).toBeGreaterThan(0);
    expect(full).toBe(PROMPT_CHANGELOG[PROMPT_VERSION]); // only v2 exists today
    // Current → empty (nothing newer).
    expect(promptChangelogSince(PROMPT_VERSION)).toBe("");
    // Past the head → still empty.
    expect(promptChangelogSince(PROMPT_VERSION + 5)).toBe("");
  });

  it("the changelog entries are CONTEXT statements, not imperative commands (Opus override-resistance)", async () => {
    const { PROMPT_CHANGELOG } = await import("../../../ws-bridge.js");
    for (const text of Object.values(PROMPT_CHANGELOG)) {
      // No override-style command phrasing that the model is trained to resist.
      expect(text).not.toMatch(/忽略之前|忽略以上|regardless of|disregard/i);
      // It should read as a context note (提示 / 更新), not an order.
      expect(text).toMatch(/提示|更新|可用|支持/);
    }
  });

  it("resume of a session whose stored version TRAILS injects --append-system-prompt from the changelog", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, promptChangelogSince } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_trail";
      await mkdir(join(dir, "works", work), { recursive: true });

      // Seed a sidecar record with a real cliSessionId but an OLD prompt version.
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-abc-123",
      });
      await sidecar.patch(DEFAULT_CHAT_SESSION_ID, { lastInjectedPromptVersion: 1 });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续做", undefined, DEFAULT_CHAT_SESSION_ID);

      const args = lastSpawnArgs();
      // It resumed the stored cliSessionId…
      expect(args).toContain("--resume");
      expect(args[args.indexOf("--resume") + 1]).toBe("cli-abc-123");
      // …and injected the changelog delta since v1.
      const append = appendedSystemPrompt(args);
      expect(append).toBeDefined();
      expect(append).toBe(promptChangelogSince(1));

      // The session's stored version advanced to current so it won't re-inject.
      const { PROMPT_VERSION } = await import("../../../ws-bridge.js");
      const rec = await sidecar.get(DEFAULT_CHAT_SESSION_ID);
      expect(rec?.lastInjectedPromptVersion).toBe(PROMPT_VERSION);
    });
  });

  it("resume of a session already at the CURRENT version does NOT append a system prompt", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, PROMPT_VERSION } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_current";
      await mkdir(join(dir, "works", work), { recursive: true });

      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-current",
      });
      await sidecar.patch(DEFAULT_CHAT_SESSION_ID, {
        lastInjectedPromptVersion: PROMPT_VERSION,
      });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);

      const args = lastSpawnArgs();
      expect(args).toContain("--resume");
      expect(appendedSystemPrompt(args)).toBeUndefined();
    });
  });

  it("a FRESH session (no cliSessionId) does NOT append, and records the current version on system.init", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, PROMPT_VERSION } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_fresh";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID);

      // Fresh: full system prompt as -p, no resume, no append.
      const args = lastSpawnArgs();
      expect(args).not.toContain("--resume");
      expect(appendedSystemPrompt(args)).toBeUndefined();

      // Drive a system.init frame so the writeback stamps the version. The fake
      // proc is the most recent spawn's return value; re-create the bridge's
      // view by emitting on the captured stdout of the live session.
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      proc.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({ type: "system", subtype: "init", session_id: "cli-fresh-xyz" }) + "\n",
        ),
      );

      // The sidecar patch is fire-and-forget — give it a beat.
      await new Promise((r) => setTimeout(r, 50));
      const sidecar = new SessionSidecar(work, dir);
      const rec = await sidecar.get(DEFAULT_CHAT_SESSION_ID);
      expect(rec?.cliSessionId).toBe("cli-fresh-xyz");
      expect(rec?.lastInjectedPromptVersion).toBe(PROMPT_VERSION);
    });
  });

  it("a legacy resume record with NO stored version (undefined ⇒ 0) gets the full changelog", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, promptChangelogSince } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_legacy";
      await mkdir(join(dir, "works", work), { recursive: true });

      const sidecar = new SessionSidecar(work, dir);
      // No lastInjectedPromptVersion at all (legacy record).
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-legacy",
      });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);

      const append = appendedSystemPrompt(lastSpawnArgs());
      expect(append).toBe(promptChangelogSince(0));
    });
  });
});
