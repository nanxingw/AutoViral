import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// dataDir is frozen at module load from AUTOVIRAL_DATA_DIR — set it BEFORE the
// dynamic import of ws-bridge so chatLogPath / SessionSidecar resolve into the
// temp dir, then reset modules. Mirrors ws-bridge-multisession isolation.
beforeEach(() => {
  vi.resetModules();
});

async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-coach-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("WsBridge — persisted coach session (D5)", () => {
  it("a coach_ key gets a PERSISTED sidecar + chat log, NOT the ephemeral trends_ null path", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const bridge = new WsBridge(0);
      const coach = "coach_main";

      // Seed a live in-memory coach session WITHOUT spawning a CLI, then record
      // a user line — this exercises the SAME persistence path a coach turn uses.
      bridge.ensureSession(coach, DEFAULT_CHAT_SESSION_ID);
      bridge.recordUserMessage(coach, "下一个该做什么选题", DEFAULT_CHAT_SESSION_ID);

      // In-memory history kept.
      const s = bridge.getSession(coach, DEFAULT_CHAT_SESSION_ID)!;
      expect(s.messageHistory.map((m) => m.text)).toEqual(["下一个该做什么选题"]);

      // appendToChatLog is fire-and-forget — give the awaitable writes a beat.
      await new Promise((r) => setTimeout(r, 60));

      // PERSISTED to disk: coach chat log written under works/coach_main/.
      const log = chatLogPath(coach, DEFAULT_CHAT_SESSION_ID);
      expect(log).toBe(join(dir, "works", coach, "chat.jsonl"));
      const raw = await readFile(log, "utf-8");
      expect(raw).toContain("下一个该做什么选题");

      // The sidecar lists the coach session — proving sidecarFor returned a real
      // sidecar for coach_ (unlike trends_ which would be null → no record).
      const sessions = await bridge.listSessions(coach);
      expect(sessions.map((r) => r.id)).toContain(DEFAULT_CHAT_SESSION_ID);
    });
  });

  it("an ephemeral trends_ key does NOT persist a sidecar/chat log (contrast)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const bridge = new WsBridge(0);
      const trends = "trends_douyin";

      bridge.ensureSession(trends, DEFAULT_CHAT_SESSION_ID);
      bridge.recordUserMessage(trends, "find trends", DEFAULT_CHAT_SESSION_ID);
      await new Promise((r) => setTimeout(r, 60));

      // trends_ chat log is NEVER written (appendToChatLog early-returns).
      expect(await exists(chatLogPath(trends, DEFAULT_CHAT_SESSION_ID))).toBe(false);
      // and the sidecar yields no sessions (sidecarFor → null).
      expect(await bridge.listSessions(trends)).toEqual([]);
    });
  });

  it("setSessionModel scopes the model to ONE session, leaving sibling sessions + global config untouched", async () => {
    await withTempDataDir(async () => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const { loadConfig } = await import("../../../infra/config.js");
      const bridge = new WsBridge(0);

      // The coach session and a work's editing session both live, each with a model.
      const coach = bridge.ensureSession("coach_main", DEFAULT_CHAT_SESSION_ID);
      coach.model = "sonnet";
      const edit = bridge.ensureSession("w_edit", DEFAULT_CHAT_SESSION_ID);
      edit.model = "opus";

      const globalBefore = (await loadConfig()).model;

      // Switch ONLY the coach's tier.
      expect(bridge.setSessionModel("coach_main", "haiku", DEFAULT_CHAT_SESSION_ID)).toBe(true);

      // Coach changed; the editing session's tier is untouched (no cross-talk).
      expect(bridge.getSession("coach_main", DEFAULT_CHAT_SESSION_ID)!.model).toBe("haiku");
      expect(bridge.getSession("w_edit", DEFAULT_CHAT_SESSION_ID)!.model).toBe("opus");

      // And the GLOBAL config.model is NOT mutated (the old ModelSwitcher bug).
      const globalAfter = (await loadConfig()).model;
      expect(globalAfter).toBe(globalBefore);
    });
  });

  it("setSessionModel returns false for an unknown session", async () => {
    await withTempDataDir(async () => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const bridge = new WsBridge(0);
      expect(bridge.setSessionModel("coach_nope", "haiku", DEFAULT_CHAT_SESSION_ID)).toBe(false);
    });
  });

  it("createCoachSession rejects a non-coach key (guards the persisted-kind invariant)", async () => {
    await withTempDataDir(async () => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const bridge = new WsBridge(0);
      await expect(bridge.createCoachSession("w_not_coach", "hi")).rejects.toThrow(/coach_/);
    });
  });
});
