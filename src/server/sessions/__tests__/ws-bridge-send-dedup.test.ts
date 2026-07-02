import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// PRD-0010 A2 — server idempotency window. sendMessage must REJECT a duplicate
// user message (same session, CLI in-flight, text fully equal, ≤3s since the
// last accepted identical message): no second messageHistory entry, no disk
// append, and — critically — no SIGTERM of the mid-turn CLI. A duplicate sent
// >3s later, or to an idle (settled) CLI, is a legitimate resend (e.g. "继续")
// and must be accepted. The reject path logs.
//
// We mock spawn so no real `claude` runs, and capture logBridge calls to prove
// the reject is logged.

const spawnCalls: { cmd: string; args: string[] }[] = [];
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}
vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    return makeFakeProc();
  },
}));

// Capture logBridge calls to assert the reject path logs. vi.hoisted lets the
// array exist before the (hoisted) vi.mock factory references it.
const { logBridgeCalls } = vi.hoisted(() => ({
  logBridgeCalls: [] as Array<{ event: string; workId: string; data?: unknown }>,
}));
vi.mock("../../../infra/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../infra/logger.js")>();
  return {
    ...actual,
    logBridge: (event: string, workId: string, data?: unknown) => {
      logBridgeCalls.push({ event, workId, data });
    },
  };
});

beforeEach(() => {
  spawnCalls.length = 0;
  logBridgeCalls.length = 0;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.AUTOVIRAL_DATA_DIR;
});

async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-ws-dedup-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

async function workDir(dir: string, workId: string): Promise<string> {
  const wd = join(dir, "works", workId);
  await mkdir(wd, { recursive: true });
  return wd;
}

const userTexts = (blocks: Array<{ type: string; text: string }>) =>
  blocks.filter((b) => b.type === "user").map((b) => b.text);

describe("WsBridge — A2 sendMessage idempotency window", () => {
  it("rejects a duplicate (in-flight + same text + ≤3s): no history entry, no respawn, no mid-turn kill", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_dedup";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, "s_1");
      const session = bridge.getSession(work, "s_1")!;

      // First "继续" — accepted: records a user block + resumes (kill old, spawn new).
      const firstAccepted = await bridge.sendMessage(work, "继续", "s_1");
      expect(firstAccepted).toBe(true);

      const histLen = session.messageHistory.length;
      const spawnsAfterFirst = spawnCalls.length;
      const midTurnProc = session.cliProcess as unknown as { kill: ReturnType<typeof vi.fn> };
      logBridgeCalls.length = 0;

      // Immediate duplicate while the CLI is mid-turn — must be rejected.
      const dupAccepted = await bridge.sendMessage(work, "继续", "s_1");

      expect(dupAccepted).toBe(false);
      // Not recorded (no second落盘 / history entry).
      expect(session.messageHistory.length).toBe(histLen);
      expect(userTexts(session.messageHistory).filter((t) => t === "继续").length).toBe(1);
      // Not respawned — the mid-turn CLI process is untouched, never SIGTERM'd.
      expect(spawnCalls.length).toBe(spawnsAfterFirst);
      expect(session.cliProcess as unknown).toBe(midTurnProc);
      expect(midTurnProc.kill).not.toHaveBeenCalled();
      // Reject path logs.
      expect(logBridgeCalls.some((c) => c.event === "send_deduped")).toBe(true);
    });
  });

  it("accepts a same-text resend once >3s has elapsed (window closed)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_dedup_window";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, "s_1");
      const session = bridge.getSession(work, "s_1")!;

      await bridge.sendMessage(work, "继续", "s_1");
      const histLen = session.messageHistory.length;
      const spawnsBefore = spawnCalls.length;

      // Age the last-user timestamp past the 3s window.
      (session as unknown as { lastUserAt?: number }).lastUserAt = Date.now() - 3001;

      const accepted = await bridge.sendMessage(work, "继续", "s_1");
      expect(accepted).toBe(true);
      // A second "继续" user block is recorded, and the CLI resumes (respawn).
      expect(userTexts(session.messageHistory).filter((t) => t === "继续").length).toBe(2);
      expect(session.messageHistory.length).toBeGreaterThan(histLen);
      expect(spawnCalls.length).toBe(spawnsBefore + 1);
    });
  });

  it("accepts the same short text ('继续') when the CLI is idle (settled), even within 3s", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_dedup_idle";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, "s_1");
      const session = bridge.getSession(work, "s_1")!;

      await bridge.sendMessage(work, "继续", "s_1");
      const histLen = session.messageHistory.length;

      // Simulate the turn finishing: the CLI process exits → settled idle.
      session.idle = true;
      session.cliProcess = undefined;

      // Same short text, still within 3s — but the CLI is idle, so it's a
      // legitimate new turn and must be accepted.
      const accepted = await bridge.sendMessage(work, "继续", "s_1");
      expect(accepted).toBe(true);
      expect(userTexts(session.messageHistory).filter((t) => t === "继续").length).toBe(2);
      expect(session.messageHistory.length).toBeGreaterThan(histLen);
    });
  });

  it("does not reject a DIFFERENT mid-turn message (interrupt-and-resume still works)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_dedup_diff";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, "s_1");
      const session = bridge.getSession(work, "s_1")!;

      await bridge.sendMessage(work, "第一句", "s_1");
      const spawnsBefore = spawnCalls.length;

      // A different message mid-turn is a genuine follow-up — accept + resume.
      const accepted = await bridge.sendMessage(work, "第二句", "s_1");
      expect(accepted).toBe(true);
      expect(spawnCalls.length).toBe(spawnsBefore + 1);
      expect(userTexts(session.messageHistory)).toEqual(["第一句", "第二句"]);
    });
  });
});
