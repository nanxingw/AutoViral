import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import http from "node:http";
import { WebSocket } from "ws";

// PRD-0010 A1 — every ChatBlock gets a stable, monotonic id ({sessionId}:{seq})
// when it enters messageHistory; the id is persisted to the chat log and carried
// by all THREE seed paths (HTTP /chat, WS message_history replay, WS live block).
// Legacy id-less jsonl lines synthesize `hist_{i}` by index. We mock spawn so no
// real `claude` runs; NDJSON frames are driven through the fake stdout.

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
  const dir = await mkdtemp(join(tmpdir(), "av-ws-blockid-"));
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeSocket(sink: string[]): never {
  return {
    readyState: 1 /* WebSocket.OPEN */,
    send: (m: string) => sink.push(m),
  } as unknown as never;
}

function emitAssistantText(proc: { stdout: EventEmitter }, text: string): void {
  proc.stdout.emit(
    "data",
    Buffer.from(
      JSON.stringify({
        type: "assistant",
        message: { id: "m_" + text, content: [{ type: "text", text }] },
      }) + "\n",
    ),
  );
}

/** Spin an http server bound to the bridge upgrade handler, connect a real
 *  browser WS to (work, sid), and resolve with the ids carried in the
 *  message_history replay frame. Mirrors the live browser reconnect path. */
async function captureHistoryIds(
  bridge: { handleUpgrade: (req: any, socket: any, head: any) => boolean },
  workId: string,
  sid: string,
): Promise<Array<string | undefined>> {
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    bridge.handleUpgrade(req, socket, head);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/browser/${workId}/${sid}`);
  const ids = await new Promise<Array<string | undefined>>((resolve) => {
    const timer = setTimeout(() => resolve([]), 1000);
    client.on("message", (d) => {
      const f = JSON.parse(d.toString());
      if (f.event === "message_history") {
        clearTimeout(timer);
        resolve((f.data?.blocks ?? []).map((b: { id?: string }) => b.id));
      }
    });
  });
  client.close();
  await new Promise<void>((r) => server.close(() => r()));
  return ids;
}

describe("WsBridge — A1 stable ChatBlock id threading", () => {
  it("assigns monotonic {sessionId}:{seq} ids; all three seed payloads carry the same id", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const { loadWorkChat } = await import("../../../domain/work-store.js");
      const work = "w_ids";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      // Fresh session spawns a (mocked) CLI so we have a stdout to drive.
      await bridge.createSession(work, "hi", undefined, "s_1");
      const session = bridge.getSession(work, "s_1")!;

      // Capture the session's live broadcasts.
      const sent: string[] = [];
      session.browserSockets.add(fakeSocket(sent));

      // User block → live "block" event, id s_1:0.
      bridge.recordUserMessage(work, "hello world", "s_1");
      // Assistant text → live "assistant_text" event, id s_1:1.
      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emitAssistantText(proc, "reply one");

      // fire-and-forget appends need a beat before we read disk.
      await sleep(60);

      // 1) messageHistory (= WS message_history payload) has monotonic ids.
      const historyIds = session.messageHistory.map((b) => b.id);
      expect(historyIds).toEqual(["s_1:0", "s_1:1"]);

      // 2) WS live block payloads carry the same ids.
      const frames = sent.map((m) => JSON.parse(m));
      const blockEv = frames.find((f) => f.event === "block");
      const textEv = frames.find((f) => f.event === "assistant_text");
      expect(blockEv?.data.id).toBe("s_1:0");
      expect(textEv?.data.id).toBe("s_1:1");

      // 3) HTTP /chat payload (loadWorkChat) carries the same ids.
      const chat = await loadWorkChat(work, "s_1");
      expect((chat?.blocks as Array<{ id?: string }>).map((b) => b.id)).toEqual([
        "s_1:0",
        "s_1:1",
      ]);

      // The persisted jsonl carries the id too (so a restart resumes them).
      const raw = await readFile(join(dir, "works", work, "chat.jsonl"), "utf-8");
      expect(raw).toContain('"id":"s_1:0"');
      expect(raw).toContain('"id":"s_1:1"');
    });
  });

  it("message_history replay ids are identical on reconnect (server restart round-trip)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath } = await import("../../../ws-bridge.js");
      const work = "w_reconnect";
      await workDir(dir, work);

      // Persist a chat log with stable ids (as A1 writes it).
      await writeFile(
        chatLogPath(work, "s_1"),
        JSON.stringify({ id: "s_1:0", type: "user", text: "a" }) +
          "\n" +
          JSON.stringify({ id: "s_1:1", type: "text", text: "b" }) +
          "\n",
        "utf-8",
      );

      // Two independent bridges (fresh in-memory state) = two "restarts".
      const b1 = new WsBridge(0);
      const first = await captureHistoryIds(b1, work, "s_1");
      const b2 = new WsBridge(0);
      const second = await captureHistoryIds(b2, work, "s_1");

      expect(first).toEqual(["s_1:0", "s_1:1"]);
      expect(second).toEqual(first);
    });
  });

  it("legacy jsonl lines with no id synthesize hist_{i} by index (message_history + createSession load)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath } = await import("../../../ws-bridge.js");
      const work = "w_legacy_ids";
      await workDir(dir, work);

      // Legacy log: no id field on any line.
      await writeFile(
        chatLogPath(work, "s_1"),
        JSON.stringify({ type: "user", text: "old-a" }) +
          "\n" +
          JSON.stringify({ type: "text", text: "old-b" }) +
          "\n",
        "utf-8",
      );

      // message_history replay synthesizes hist_0 / hist_1.
      const bridge = new WsBridge(0);
      const ids = await captureHistoryIds(bridge, work, "s_1");
      expect(ids).toEqual(["hist_0", "hist_1"]);

      // createSession's history load path applies the same fallback in-memory.
      const b2 = new WsBridge(3271);
      await b2.createSession(work, "继续", undefined, "s_1");
      const session = b2.getSession(work, "s_1")!;
      expect(session.messageHistory.slice(0, 2).map((b) => b.id)).toEqual([
        "hist_0",
        "hist_1",
      ]);
    });
  });

  it("collapses a pre-A1 double-write: adjacent id-less rows identical on type/text/toolName fold to ONE id (w_20260408_1347_db8 shape)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath } = await import("../../../ws-bridge.js");
      const work = "w_legacy_dup";
      await workDir(dir, work);

      // Real legacy shape (w_20260408_1347_db8 idx 341/342): ONE user line
      // recorded TWICE — identical type+text, differing ONLY by timestamp — then
      // a distinct assistant reply. Index-based hist_{i} would give the twins
      // hist_0 / hist_1 (DIFFERENT ids) so the client's by-id dedup can't fold
      // them → the doubled bubble survives A1. The twin must collapse here.
      await writeFile(
        chatLogPath(work, "s_1"),
        JSON.stringify({ type: "user", text: "同一句", timestamp: "2026-04-08T06:46:16.335Z" }) +
          "\n" +
          JSON.stringify({ type: "user", text: "同一句", timestamp: "2026-04-08T06:46:29.940Z" }) +
          "\n" +
          JSON.stringify({ type: "text", text: "reply" }) +
          "\n",
        "utf-8",
      );

      // message_history replay: the doubled user row folds to one id.
      const bridge = new WsBridge(0);
      const ids = await captureHistoryIds(bridge, work, "s_1");
      expect(ids).toEqual(["hist_0", "hist_2"]);

      // createSession's in-memory load path applies the SAME collapse.
      const b2 = new WsBridge(3271);
      await b2.createSession(work, "继续", undefined, "s_1");
      const session = b2.getSession(work, "s_1")!;
      expect(session.messageHistory.slice(0, 2).map((b) => b.id)).toEqual([
        "hist_0",
        "hist_2",
      ]);
    });
  });

  it("does NOT collapse adjacent id-less rows that differ (only true type+text+toolName twins fold)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath } = await import("../../../ws-bridge.js");
      const work = "w_legacy_nodup";
      await workDir(dir, work);
      await writeFile(
        chatLogPath(work, "s_1"),
        JSON.stringify({ type: "user", text: "a" }) +
          "\n" +
          JSON.stringify({ type: "user", text: "b" }) +
          "\n" +
          // same text, DIFFERENT toolName → distinct block, must be kept
          JSON.stringify({ type: "tool_use", text: "x", toolName: "Bash" }) +
          "\n" +
          JSON.stringify({ type: "tool_use", text: "x", toolName: "Read" }) +
          "\n",
        "utf-8",
      );
      const bridge = new WsBridge(0);
      const ids = await captureHistoryIds(bridge, work, "s_1");
      expect(ids).toEqual(["hist_0", "hist_1", "hist_2", "hist_3"]);
    });
  });

  it("a new block appended after loading legacy history continues the {sessionId}:{seq} sequence without colliding", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, chatLogPath } = await import("../../../ws-bridge.js");
      const work = "w_legacy_then_new";
      await workDir(dir, work);
      await writeFile(
        chatLogPath(work, "s_1"),
        JSON.stringify({ type: "user", text: "old-a" }) +
          "\n" +
          JSON.stringify({ type: "text", text: "old-b" }) +
          "\n",
        "utf-8",
      );

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, "s_1");
      const session = bridge.getSession(work, "s_1")!;
      // A fresh assistant block appended after the 2 legacy blocks (len 2) → s_1:2.
      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emitAssistantText(proc, "new reply");
      await sleep(40);

      const ids = session.messageHistory.map((b) => b.id);
      expect(ids).toEqual(["hist_0", "hist_1", "s_1:2"]);
      // No id collision anywhere.
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
