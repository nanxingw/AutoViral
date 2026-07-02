import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// C4 (PRD-0010) — per-session backend selection at the WsBridge spawn
// chokepoint + the established-session switch lockout.
//
// Locks:
//   1. A fresh session created with backend="codex" spawns the `codex` CLI;
//      the default (no backend) session spawns `claude`.
//   2. The chosen backend persists to the sidecar record (round-trip / restart).
//   3. A RESUMED session reads its backend from the sidecar (codex record →
//      codex spawn), independent of any passed arg.
//   4. setSessionBackend rejects an ESTABLISHED session (has a cliSessionId or
//      history — cross-backend resume is incompatible) and leaves it unchanged;
//      it switches a FRESH session (kill+respawn, mirroring setSessionModel).
//
// Spawn-mock pattern lifted verbatim from ws-bridge-chat-backend.test.ts.

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
  const dir = await mkdtemp(join(tmpdir(), "av-ws-backend-switch-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

function lastSpawn(): { cmd: string; args: string[]; options: any } {
  return spawnCalls[spawnCalls.length - 1];
}

describe("WsBridge — C4 per-session backend spawn selection", () => {
  it("a fresh session with backend=codex spawns the codex CLI", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_codex";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID, "codex");
      expect(lastSpawn().cmd).toBe("codex");
      expect(lastSpawn().args).toContain("exec");
    });
  });

  it("a fresh session with no backend spawns claude (default)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_claude";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID);
      expect(lastSpawn().cmd).toBe("claude");
    });
  });

  it("persists the chosen backend to the sidecar record", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_persist";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID, "codex");
      const rec = await new SessionSidecar(work, dir).get(DEFAULT_CHAT_SESSION_ID);
      expect(rec?.backend).toBe("codex");
    });
  });

  it("a RESUMED session reads its backend from the sidecar (codex record → codex spawn)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, PROMPT_VERSION } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_resume_codex";
      await mkdir(join(dir, "works", work), { recursive: true });
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "thread-abc",
        backend: "codex",
      });
      await sidecar.patch(DEFAULT_CHAT_SESSION_ID, { lastInjectedPromptVersion: PROMPT_VERSION });

      const bridge = new WsBridge(3271);
      // No backend arg passed — it must come from the persisted record.
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);
      expect(lastSpawn().cmd).toBe("codex");
      // codex resumes with `exec resume <id>`.
      expect(lastSpawn().args.slice(0, 3)).toEqual(["exec", "resume", "thread-abc"]);
    });
  });
});

describe("WsBridge — C4 setSessionBackend lockout", () => {
  it("rejects switching an ESTABLISHED session (has a cliSessionId) and leaves it unchanged", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, PROMPT_VERSION } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_established";
      await mkdir(join(dir, "works", work), { recursive: true });
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-existing",
      });
      await sidecar.patch(DEFAULT_CHAT_SESSION_ID, { lastInjectedPromptVersion: PROMPT_VERSION });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      expect(session.cliSessionId).toBe("cli-existing"); // established

      const ok = bridge.setSessionBackend(work, "codex", DEFAULT_CHAT_SESSION_ID);
      expect(ok).toBe(false);
      expect(session.backend).toBe("claude"); // unchanged
    });
  });

  it("switches a FRESH session (no history / no cliSessionId) and respawns", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_fresh_switch";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      // Fresh session (mock never emits system.init → no cliSessionId, no history).
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      expect(session.cliSessionId).toBeUndefined();
      expect(session.messageHistory.length).toBe(0);

      const ok = bridge.setSessionBackend(work, "codex", DEFAULT_CHAT_SESSION_ID);
      expect(ok).toBe(true);
      expect(session.backend).toBe("codex");
      // setSessionModel-style respawn: the live CLI is killed so the next turn
      // rebuilds on the new backend.
      expect(session.cliProcess).toBeUndefined();
    });
  });

  it("returns false for an unknown session", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      await mkdir(join(dir, "works", "w_none"), { recursive: true });
      const bridge = new WsBridge(3271);
      expect(bridge.setSessionBackend("w_none", "codex", "s_1")).toBe(false);
    });
  });
});
