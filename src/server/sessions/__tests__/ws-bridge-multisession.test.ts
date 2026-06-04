import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// dataDir is frozen at module load from AUTOVIRAL_DATA_DIR — set it BEFORE the
// dynamic import of ws-bridge so chatLogPath / SessionSidecar resolve into the
// temp dir, then reset modules so a previously-cached ws-bridge doesn't keep a
// stale dataDir. Mirrors api.agent-model.test isolation discipline.
beforeEach(() => {
  vi.resetModules();
});

async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-ws-ms-"));
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

describe("WsBridge — multi-session keying + sidecar + migration + archive", () => {
  it("two concurrent chat sessions on one work keep independent history (separate chat logs)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_two";
      await workDir(dir, work);
      const bridge = new WsBridge(0);

      // Seed two live in-memory sessions WITHOUT spawning a CLI.
      bridge.ensureSession(work, "s_1");
      bridge.ensureSession(work, "s_2");

      // Record a distinct user line into each session.
      bridge.recordUserMessage(work, "hello from one", "s_1");
      bridge.recordUserMessage(work, "hello from two", "s_2");

      // In-memory histories are independent.
      const a = bridge.getSession(work, "s_1")!;
      const b = bridge.getSession(work, "s_2")!;
      expect(a.messageHistory.map((m) => m.text)).toEqual(["hello from one"]);
      expect(b.messageHistory.map((m) => m.text)).toEqual(["hello from two"]);

      // On-disk logs are independent: default → chat.jsonl, s_2 → chat-s_2.jsonl.
      expect(chatLogPath(work, DEFAULT_CHAT_SESSION_ID)).toBe(join(dir, "works", work, "chat.jsonl"));
      expect(chatLogPath(work, "s_2")).toBe(join(dir, "works", work, "chat-s_2.jsonl"));

      // appendToChatLog is fire-and-forget — give the awaitable writes a beat.
      await new Promise((r) => setTimeout(r, 50));
      const log1 = await readFile(chatLogPath(work, "s_1"), "utf-8");
      const log2 = await readFile(chatLogPath(work, "s_2"), "utf-8");
      expect(log1).toContain("hello from one");
      expect(log1).not.toContain("hello from two");
      expect(log2).toContain("hello from two");
      expect(log2).not.toContain("hello from one");
    });
  });

  it("listSessions returns the persisted manifest; createNewSession mints s_2", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_list";
      await workDir(dir, work);
      const bridge = new WsBridge(0);

      // First touch via recordUserMessage seeds the sidecar s_1 record.
      bridge.ensureSession(work, "s_1");
      // ensureSidecarRecord runs through handleBrowserConnection/createSession;
      // here we drive it explicitly via createNewSession which ensures s_1 first.
      const s2 = await bridge.createNewSession(work);
      expect(s2?.id).toBe("s_2");

      const sessions = await bridge.listSessions(work);
      expect(sessions.map((s) => s.id).sort()).toEqual(["s_1", "s_2"]);
    });
  });

  it("legacy single-cliSessionId work migrates to s_1 reusing chat.jsonl without losing history", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, chatLogPath } = await import("../../../ws-bridge.js");
      const { createWork, updateWork } = await import("../../../domain/work-store.js");
      const work = await createWork({ title: "Legacy", type: "short-video", platforms: ["douyin"] });
      // Legacy state: a cliSessionId on work.yaml + an existing chat.jsonl.
      await updateWork(work.id, { cliSessionId: "uuid-legacy-123" });
      const legacyLog = chatLogPath(work.id, DEFAULT_CHAT_SESSION_ID);
      await writeFile(
        legacyLog,
        JSON.stringify({ type: "user", text: "legacy first line" }) + "\n" +
          JSON.stringify({ type: "text", text: "legacy reply" }) + "\n",
        "utf-8",
      );

      const bridge = new WsBridge(0);
      const migrated = await bridge.migrateLegacyWork(work.id);
      expect(migrated).toBe(true);

      const sessions = await bridge.listSessions(work.id);
      expect(sessions).toHaveLength(1);
      const s1 = sessions[0];
      expect(s1.id).toBe(DEFAULT_CHAT_SESSION_ID);
      expect(s1.surface).toBe("chat");
      // cliSessionId carried over from work.yaml.
      expect(s1.cliSessionId).toBe("uuid-legacy-123");
      // preview seeded from the first user line.
      expect(s1.preview).toBe("legacy first line");

      // History is NOT moved — s_1 still maps to the legacy chat.jsonl, untouched.
      const stillThere = await readFile(legacyLog, "utf-8");
      expect(stillThere).toContain("legacy first line");
      expect(stillThere).toContain("legacy reply");

      // Idempotent — a second migration is a no-op.
      expect(await bridge.migrateLegacyWork(work.id)).toBe(false);
    });
  });

  it("archive sweep (injected tiny TTL) archives an idle session; reopening restores it", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_archive";
      await workDir(dir, work);

      // 1ms TTL so any past lastActive is immediately idle.
      const bridge = new WsBridge(0, { idleTtlMs: 1 });
      const sidecar = new SessionSidecar(work, dir);

      // Seed an idle session record (lastActive well in the past).
      await sidecar.create("chat", {
        now: "2026-01-01T00:00:00.000Z",
        id: "s_1",
        preview: "old chat",
      });
      // Also a live in-memory session to prove the sweep releases memory.
      bridge.ensureSession(work, "s_1");
      expect(bridge.getSession(work, "s_1")).toBeDefined();

      const archived = await bridge.archiveIdleSessions(work, Date.parse("2026-06-04T00:00:00Z"));
      expect(archived).toEqual(["s_1"]);

      // Record is flagged archived; chat log kept; in-memory session released.
      const all = await sidecar.list();
      expect(all.find((r) => r.id === "s_1")?.archived).toBe(true);
      expect(bridge.getWorkSessions(work).has("s_1")).toBe(false);

      // listSessions hides archived by default, shows with includeArchived.
      expect(await bridge.listSessions(work)).toHaveLength(0);
      expect(await bridge.listSessions(work, { includeArchived: true })).toHaveLength(1);

      // Reopening an archived session restores it (clears archived).
      await sidecar.restore("s_1", new Date().toISOString());
      expect((await sidecar.get("s_1"))?.archived).toBe(false);
      expect(await bridge.listSessions(work)).toHaveLength(1);
    });
  });

  it("deleteSession tombstones the record and removes its chat-{id}.jsonl (keeps legacy chat.jsonl)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath } = await import("../../../ws-bridge.js");
      const work = "w_delete";
      await workDir(dir, work);
      const bridge = new WsBridge(0);

      await bridge.createNewSession(work); // ensures s_1, mints s_2
      bridge.ensureSession(work, "s_2");
      bridge.recordUserMessage(work, "msg in two", "s_2");
      await new Promise((r) => setTimeout(r, 50));
      const s2log = chatLogPath(work, "s_2");
      expect(await readFile(s2log, "utf-8")).toContain("msg in two");

      expect(await bridge.deleteSession(work, "s_2")).toBe(true);
      expect((await bridge.listSessions(work)).map((s) => s.id)).toEqual(["s_1"]);
      // chat-s_2.jsonl removed.
      await expect(readFile(s2log, "utf-8")).rejects.toThrow();
    });
  });

  it("an s_2 per-session event does NOT bleed into an s_1 socket (ADR-008 §3 — only focus is work-scoped)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_isolation";
      await workDir(dir, work);
      const bridge = new WsBridge(0);

      // Two live sessions, each with one fake browser socket (readyState OPEN).
      const s1 = bridge.ensureSession(work, "s_1");
      const s2 = bridge.ensureSession(work, "s_2");
      const sentToS1: string[] = [];
      const sentToS2: string[] = [];
      const fakeSocket = (sink: string[]) =>
        ({ readyState: 1 /* WebSocket.OPEN */, send: (m: string) => sink.push(m) } as unknown as never);
      s1.browserSockets.add(fakeSocket(sentToS1));
      s2.browserSockets.add(fakeSocket(sentToS2));

      // A user echo on s_2 is per-session lifecycle, not work-scoped focus —
      // it must reach ONLY s_2's socket.
      bridge.recordUserMessage(work, "hello from two", "s_2");

      const s2Blocks = sentToS2.map((m) => JSON.parse(m)).filter((m) => m.event === "block");
      const s1Blocks = sentToS1.map((m) => JSON.parse(m)).filter((m) => m.event === "block");
      expect(s2Blocks).toHaveLength(1);
      expect(s2Blocks[0].data.text).toBe("hello from two");
      expect(s2Blocks[0].data.sessionId).toBe("s_2");
      // The s_1 socket must NOT have received the s_2 echo.
      expect(s1Blocks).toHaveLength(0);
    });
  });
});
