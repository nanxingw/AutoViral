import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";

// C3 (PRD-0010) — codex "真对话" integration lock at the WsBridge level.
//
// WHY THIS EXISTS: the browser E2E for C3 (CE1-codex真对话-F1) could not run —
// the claude-in-chrome extension was not connected to the session, so the four
// user-visible checks (选 Codex 后端 / 收到流式回复 / deliverable 快照 /
// checkpoint 新增) got zero browser evidence. `codex.test.ts` already locks the
// parser IN ISOLATION and `ws-bridge-backend-switch.test.ts` locks the spawn
// SELECTION, but nothing drove a WHOLE codex turn through the real
// spawnCli → codex parser → browser-broadcast + turn-complete hooks. This file
// closes that gap deterministically so the codex conversation path has CI
// coverage that does not depend on a live browser.
//
// It mirrors ws-bridge-chat-backend.test.ts (the equivalent CLAUDE full-turn
// lock) but feeds the C1 实测锚定 codex JSONL fixtures and asserts, in one turn:
//   1. backend=codex actually spawns the codex CLI (选 Codex 后端).
//   2. the codex frames map to the SAME unified browser-broadcast sequence a
//      claude turn produces — session_ready / tool_use / tool_result /
//      assistant_text / turn_complete (收到流式回复).
//   3. the codex turn CHANGES the deliverable (A→B) via its autoviral CLI tool,
//      and the backend-agnostic turn-complete hook snapshots that change — a
//      genuinely NEW checkpoint row appears past createCheckpoint's content-hash
//      dedup, and the snapshot on disk holds the changed yaml (spec C3 ①:
//      deliverable 变化二确, not mere first-snapshot creation).
//
// Spawn-mock + fake-socket + emit() patterns lifted verbatim from
// ws-bridge-chat-backend.test.ts; the REAL createCheckpoint runs against a real
// deliverable in the temp data dir (no checkpoint mock) so the assertion proves
// the actual snapshot, not just that a function was called.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "..", "..", "chat-backends", "__fixtures__", "codex");

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
  const dir = await mkdtemp(join(tmpdir(), "av-ws-codex-turn-"));
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

function fakeSocket(sink: string[]): never {
  return {
    readyState: 1 /* WebSocket.OPEN */,
    send: (m: string) => sink.push(m),
  } as unknown as never;
}

function events(sink: string[]): Array<{ event: string; data: any }> {
  return sink.map((m) => JSON.parse(m)).map((f) => ({ event: f.event, data: f.data }));
}

/** Feed one already-serialized JSONL line to the codex parser via stdout. */
function emitLine(proc: { stdout: EventEmitter }, line: string): void {
  proc.stdout.emit("data", Buffer.from(line + "\n"));
}

function readFixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURE_DIR, name), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

describe("WsBridge — C3 codex full turn (真对话) integration lock", () => {
  it("selects codex, streams the reply to the browser, and snapshots the deliverable", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const { listCheckpoints, createCheckpoint } = await import("../../checkpoints.js");

      const work = "w_codex_turn";
      const wDir = join(dir, "works", work);
      const compositionPath = join(wDir, "composition.yaml");
      const snapDir = join(wDir, ".snapshots");
      await mkdir(wDir, { recursive: true });
      // Seed a real deliverable at a KNOWN pre-turn state (A). This is what the
      // work looked like before the codex turn touched it.
      const beforeYaml = "version: 1\ntracks: []\n";
      await writeFile(compositionPath, beforeYaml, "utf-8");
      // Baseline snapshot of A BEFORE the turn. Without a prior snapshot the
      // turn-complete hook would just take a first snapshot regardless of any
      // change — that only proves "a checkpoint exists", not "the deliverable
      // CHANGED". With this baseline, createCheckpoint's content-hash dedup
      // (checkpoints.ts: `if (latest.sha === sha) continue`) means a SECOND row
      // can only appear if the yaml actually changed — so `length === 2` below
      // is itself the 变化 proof (spec C3 dimension ①: deliverable 变化二确).
      await createCheckpoint(work);
      expect((await listCheckpoints(work)).length).toBe(1);

      const bridge = new WsBridge(3271);
      // 1. 选 Codex 后端 — a backend=codex session must spawn the codex CLI.
      await bridge.createSession(work, "看看这个作品", undefined, DEFAULT_CHAT_SESSION_ID, "codex");
      expect(lastSpawn().cmd).toBe("codex");
      expect(lastSpawn().args).toContain("exec");

      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const sink: string[] = [];
      session.browserSockets.add(fakeSocket(sink));

      // 2. 收到流式回复 — drive the real C1 fixture frames through spawnCli's
      // codex parser and assert the unified browser-broadcast sequence.
      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      const lines = readFixtureLines("exec-basic-tool-use.jsonl");
      // Drive the turn up to (but not including) completion.
      const tcIdx = lines.findIndex((l) => l.includes('"turn.completed"'));
      expect(tcIdx).toBeGreaterThan(0);
      for (let i = 0; i < tcIdx; i++) emitLine(proc, lines[i]);

      // Mid-turn, the codex agent edits the deliverable via its `autoviral` CLI
      // tool (spec C3 ①: "让它经 autoviral CLI 改一次 work"). spawn is mocked, so
      // the fixture's command_execution can't touch the real FS — we write the
      // changed deliverable ourselves to mirror that on-disk side effect (B ≠ A),
      // then complete the turn so the checkpoint hook snapshots THIS change.
      const afterYaml = "version: 1\ntracks:\n  - id: t_codex\n    clips: []\n";
      await writeFile(compositionPath, afterYaml, "utf-8");
      emitLine(proc, lines[tcIdx]);
      await sleep(60);

      const seq = events(sink);
      // The full honest wire sequence. `turn.started` has no unified mapping, so
      // the codex parser folds it to onOther → a raw `cli_event` (see codex.test
      // "unknown TOP-LEVEL event type folds to onOther"). The web client SILENTLY
      // ignores cli_event (useChatSocket.ts), so it never becomes chat junk — but
      // it IS on the wire, and this lock documents that truthfully.
      expect(seq.map((e) => e.event)).toEqual([
        "session_ready", // thread.started → onSessionId
        "cli_event", // turn.started → onOther (client-ignored)
        "tool_use", // item.started command_execution
        "tool_result", // item.completed command_execution
        "assistant_text", // item.completed agent_message
        "turn_complete", // turn.completed
      ]);
      // The user-meaningful projection (what the browser actually renders) is
      // exactly the claude turn's shape — this is 收到流式回复 proven at the bridge.
      expect(seq.map((e) => e.event).filter((e) => e !== "cli_event")).toEqual([
        "session_ready",
        "tool_use",
        "tool_result",
        "assistant_text",
        "turn_complete",
      ]);

      // session_ready carries the codex thread_id as the cliSessionId.
      const ready = seq.find((e) => e.event === "session_ready")!;
      expect(ready.data.cliSessionId).toBe("019f219f-64ea-7fe0-81b1-4a6466e5c21b");
      // the agent's streamed text reached the browser.
      const text = seq.find((e) => e.event === "assistant_text")!;
      expect(text.data.text).toContain("当前目录有这些文件");
      const tc = seq.find((e) => e.event === "turn_complete")!;
      expect(tc.data.idle).toBe(true);

      // 3. deliverable 变化二确 — the backend-agnostic turn-complete hook fired
      // createCheckpoint for the codex turn, and because the deliverable ACTUALLY
      // changed (A→B), a genuinely NEW snapshot row appears past the content-hash
      // dedup. Poll (the snapshot write is fire-and-forget inside onTurnComplete).
      let cps = await listCheckpoints(work);
      for (let i = 0; i < 20 && cps.length < 2; i++) {
        await sleep(25);
        cps = await listCheckpoints(work);
      }
      // 第一确 (变化): a second row exists. If the codex turn had NOT changed the
      // deliverable, dedup would keep this at the 1 baseline row — so reaching 2
      // is exactly the "deliverable changed" signal, not first-snapshot creation.
      expect(cps.length).toBe(2);
      expect(cps.every((c) => c.deliverable === "composition.yaml")).toBe(true);
      // 第二确 (内容): read the snapshots off disk — one holds the pre-turn A, the
      // other the post-turn B. The turn-complete checkpoint captured the codex
      // change, not a stale copy.
      const snapshotContents = cps.map((c) =>
        readFileSync(join(snapDir, c.file), "utf8"),
      );
      expect(snapshotContents).toContain(beforeYaml);
      expect(snapshotContents).toContain(afterYaml);
    });
  });
});
