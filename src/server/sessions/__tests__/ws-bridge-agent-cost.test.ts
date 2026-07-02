import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import http from "node:http";
import { WebSocket } from "ws";

// PRD-0010 B3 — agent cost persistence + cumulative-delta empirical lock.
//
// Two guarantees this file locks:
//   1) The per-turn `usage` (costUsd / durationMs / tokens) stamped onto the
//      LAST assistant text block on turn_complete is carried by ALL THREE seed
//      paths (HTTP /chat, WS message_history replay, WS live turn_complete) AND
//      persisted to the jsonl so a refresh / restart does not reset the badge.
//   2) The agent turn cost is recorded into the cost-ledger exactly ONCE per
//      turn, at the frame's `total_cost_usd` DIRECTLY — no delta subtraction.
//
// ── CUMULATIVE-DELTA EMPIRICAL FINDING (2026-07-02 live probe) ───────────────
// The slice title says "cumulative delta" and the stale code comment (citing
// pneuma's "modelUsage cumulative" gotcha) warned to subtract a per-turn delta.
// A live probe with the REAL claude CLI (v2.1.198, model haiku) settled it for
// AutoViral's architecture — which spawns a FRESH `claude --resume <id> -p`
// process for every turn (see ws-bridge.sendMessage → spawnCli):
//
//   turn 1 (fresh)  total_cost_usd = 0.016906   num_turns = 1
//   turn 2 (resume) total_cost_usd = 0.002837   num_turns = 1
//   turn 3 (resume) total_cost_usd = 0.002814   num_turns = 1
//
// A CUMULATIVE value would grow monotonically (~0.0169 → ~0.0197 → ~0.0225);
// instead each resumed turn reports num_turns=1 and an INDEPENDENT small charge.
// Conclusion: in a fresh-spawn-per-turn model total_cost_usd is PER-TURN, NOT
// cumulative — the pneuma gotcha applies only to a long-lived streaming SDK
// process (pneuma keeps one). Therefore we record total_cost_usd DIRECTLY;
// subtracting a delta would UNDER-count (and could go negative on a cheaper
// later turn). The fixture below encodes the PER-TURN reality: two frames of
// 0.10 then 0.15 record 0.10 and 0.15 (sum 0.25), NOT 0.10 then 0.05.
//
// We mock spawn so no real `claude` runs; frames are driven through fake stdout.

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
  const dir = await mkdtemp(join(tmpdir(), "av-ws-agentcost-"));
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

/** Drive a `result` (turn_complete) frame with a per-turn cost + token usage,
 *  exactly as the claude CLI's stream-json emits it at the end of a turn. */
function emitResult(
  proc: { stdout: EventEmitter },
  opts: {
    result?: string;
    totalCostUsd?: number;
    durationMs?: number;
    sessionId?: string;
    inputTokens?: number;
    outputTokens?: number;
  },
): void {
  const frame: Record<string, unknown> = { type: "result" };
  if (opts.result !== undefined) frame.result = opts.result;
  if (opts.totalCostUsd !== undefined) frame.total_cost_usd = opts.totalCostUsd;
  if (opts.durationMs !== undefined) frame.duration_ms = opts.durationMs;
  if (opts.sessionId !== undefined) frame.session_id = opts.sessionId;
  frame.usage = {
    input_tokens: opts.inputTokens ?? 0,
    output_tokens: opts.outputTokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  proc.stdout.emit("data", Buffer.from(JSON.stringify(frame) + "\n"));
}

/** Connect a real browser WS and resolve with the FULL blocks carried in the
 *  message_history replay frame (mirrors the live browser reconnect path). */
async function captureHistoryBlocks(
  bridge: { handleUpgrade: (req: any, socket: any, head: any) => boolean },
  workId: string,
  sid: string,
): Promise<Array<Record<string, any>>> {
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    bridge.handleUpgrade(req, socket, head);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/browser/${workId}/${sid}`);
  const blocks = await new Promise<Array<Record<string, any>>>((resolve) => {
    const timer = setTimeout(() => resolve([]), 1000);
    client.on("message", (d) => {
      const f = JSON.parse(d.toString());
      if (f.event === "message_history") {
        clearTimeout(timer);
        resolve((f.data?.blocks ?? []) as Array<Record<string, any>>);
      }
    });
  });
  client.close();
  await new Promise<void>((r) => server.close(() => r()));
  return blocks;
}

describe("WsBridge — B3 agent usage threading + persistence", () => {
  it("stamps per-turn usage on the last text block and carries it through ALL THREE seed paths", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const { loadWorkChat } = await import("../../../domain/work-store.js");
      const work = "w_usage";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, "s_1");
      const session = bridge.getSession(work, "s_1")!;

      // Capture live broadcasts (the WS-live seed path).
      const sent: string[] = [];
      session.browserSockets.add(fakeSocket(sent));

      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emitAssistantText(proc, "reply one");
      emitResult(proc, {
        result: "reply one",
        totalCostUsd: 0.1,
        durationMs: 1234,
        inputTokens: 100,
        outputTokens: 50,
      });
      await sleep(80);

      // ── Path 3: WS live — turn_complete frame carries the per-turn cost/usage.
      const liveTurn = sent
        .map((m) => JSON.parse(m))
        .find((f) => f.event === "turn_complete");
      expect(liveTurn?.data.cost).toBeCloseTo(0.1, 6);
      expect(liveTurn?.data.durationMs).toBe(1234);
      expect(liveTurn?.data.usage?.input_tokens).toBe(100);
      expect(liveTurn?.data.usage?.output_tokens).toBe(50);

      // ── Path 2: WS message_history — the block itself carries `usage`.
      const historyBlocks = await captureHistoryBlocks(bridge, work, "s_1");
      const lastText = [...historyBlocks].reverse().find((b) => b.type === "text");
      expect(lastText?.usage?.costUsd).toBeCloseTo(0.1, 6);
      expect(lastText?.usage?.durationMs).toBe(1234);
      expect(lastText?.usage?.inputTokens).toBe(100);
      expect(lastText?.usage?.outputTokens).toBe(50);

      // ── Path 1: HTTP /chat (loadWorkChat) — the block carries `usage` too.
      const chat = await loadWorkChat(work, "s_1");
      const httpBlocks = (chat?.blocks ?? []) as Array<Record<string, any>>;
      const httpLastText = [...httpBlocks].reverse().find((b) => b.type === "text");
      expect(httpLastText?.usage?.costUsd).toBeCloseTo(0.1, 6);
      expect(httpLastText?.usage?.outputTokens).toBe(50);

      // Persisted jsonl must carry usage so a RESTART survives (not just memory).
      const raw = await readFile(join(dir, "works", work, "chat.jsonl"), "utf-8");
      expect(raw).toContain('"usage"');
      expect(raw).toContain('"costUsd":0.1');
    });
  });

  it("survives a server restart: a fresh bridge reloads the persisted usage from jsonl", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_usage_restart";
      await workDir(dir, work);

      const b1 = new WsBridge(3271);
      await b1.createSession(work, "hi", undefined, "s_1");
      const session = b1.getSession(work, "s_1")!;
      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emitAssistantText(proc, "reply one");
      emitResult(proc, { result: "reply one", totalCostUsd: 0.1, durationMs: 900, outputTokens: 42 });
      await sleep(80);

      // A brand-new bridge = a restart. It reseeds messageHistory from jsonl.
      const b2 = new WsBridge(0);
      const blocks = await captureHistoryBlocks(b2, work, "s_1");
      const lastText = [...blocks].reverse().find((b) => b.type === "text");
      expect(lastText?.usage?.costUsd).toBeCloseTo(0.1, 6);
      expect(lastText?.usage?.outputTokens).toBe(42);
    });
  });
});

describe("WsBridge — B3 agent cost ledger (per-turn, NOT cumulative delta)", () => {
  it("records ONE agent ledger row per turn at total_cost_usd DIRECTLY (0.10 then 0.15 → 0.25, not 0.10 then 0.05)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      const work = "w_agentcost";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, "s_1");
      const s1 = bridge.getSession(work, "s_1")!;

      // Turn 1 — fresh, total_cost_usd = 0.10.
      let proc = s1.cliProcess as unknown as { stdout: EventEmitter };
      emitAssistantText(proc, "reply one");
      emitResult(proc, { result: "reply one", totalCostUsd: 0.1, sessionId: "cli-uuid-1" });
      await sleep(80);

      // Turn 2 — resume. In the REAL CLI this reports the PER-TURN cost of just
      // this invocation. The fixture reports total_cost_usd = 0.15 (an
      // independent per-turn charge, NOT a cumulative 0.10+something running
      // total). We MUST record 0.15 directly — a delta subtraction (0.15-0.10)
      // would wrongly bill 0.05 and understate the true spend.
      await bridge.sendMessage(work, "again", "s_1");
      proc = bridge.getSession(work, "s_1")!.cliProcess as unknown as { stdout: EventEmitter };
      emitAssistantText(proc, "reply two");
      emitResult(proc, { result: "reply two", totalCostUsd: 0.15, sessionId: "cli-uuid-1" });
      await sleep(80);

      const summary = getCostLedger()!.summaryForWork(work);
      const agent = summary.byKind.find((k) => k.kind === "agent");
      expect(agent).toBeDefined();
      expect(agent!.count).toBe(2); // one row per turn, NOT double-counted
      expect(agent!.estimated).toBe(false); // real metered charge
      expect(agent!.usd).toBeCloseTo(0.25, 6); // 0.10 + 0.15, direct per-turn sum

      const rows = getCostLedger()!.listForWork(work);
      const agentRows = rows.filter((r) => r.kind === "agent");
      expect(agentRows.map((r) => r.usd).sort()).toEqual([0.1, 0.15]);

      setCostLedger(null);
    });
  });

  it("does not record an agent row when a turn reports no cost (free/local turn)", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      const work = "w_agentcost_free";
      await workDir(dir, work);

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hi", undefined, "s_1");
      const proc = bridge.getSession(work, "s_1")!
        .cliProcess as unknown as { stdout: EventEmitter };
      emitAssistantText(proc, "reply");
      emitResult(proc, { result: "reply" }); // no total_cost_usd
      await sleep(80);

      const summary = getCostLedger()!.summaryForWork(work);
      expect(summary.byKind.find((k) => k.kind === "agent")).toBeUndefined();
      setCostLedger(null);
    });
  });
});
