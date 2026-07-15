import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// PRD-0015 S3 —— ui-workflow 信封 + snapshot-on-connect 广播接线锁。
//
// registry（S2）的两个变更点在 ws-bridge 里接上 chat 会话 WS 广播：
//   - onBackgroundTask 里 applyEvent 后 → 增量广播 `ui-workflow`（同 sessionId+taskId+
//     generation 覆盖式 replace）。
//   - 进程 exit → settleOnExit 合成终态后 → 广播终态 `ui-workflow`（030"被杀无提示"止损）。
//   - 新 browser 连接（handleBrowserConnection）→ 先发全量 `ui-workflow-snapshot`
//     （对照 render-ws 的 snapshot-then-push）。
//   - `ui-progress` 行为零变化（它是 work 级 bridge-ws 的独立信封，本 slice 不碰它，
//     且 chat 流上的任务广播绝不复用/发出 ui-progress）。
//
// spawn-mock + fake-socket 模式取自 ws-bridge-bg-registry.test.ts / ws-bridge-codex-turn.test.ts。

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
  const dir = await mkdtemp(join(tmpdir(), "av-ui-workflow-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emitLine(proc: { stdout: EventEmitter }, obj: Record<string, unknown>): void {
  proc.stdout.emit("data", Buffer.from(JSON.stringify(obj) + "\n"));
}

/** A minimal browser WebSocket stand-in for handleBrowserConnection: it needs
 *  `send` (capture), `on` (no-op registration) and an OPEN readyState. */
function fakeWs(sink: string[]): unknown {
  return {
    readyState: 1 /* WebSocket.OPEN */,
    send: (m: string) => sink.push(m),
    on: () => {},
  };
}

function framesOf(sink: string[]): Array<{ event: string; data: any }> {
  return sink.map((m) => JSON.parse(m));
}

describe("WsBridge — PRD-0015 S3 ui-workflow 信封 + snapshot-on-connect", () => {
  // ① applyEvent 后广播 ui-workflow，payload 携带身份（sessionId+taskId+generation）与
  //    元数据（taskType/description/status/summary/usage/ts）。
  it("applyEvent 后广播 ui-workflow，payload 形状正确", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_uiwf_apply";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "跑个后台 workflow", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;

      const captured: Array<{ event: string; data: any }> = [];
      bridge.onSessionEvent(work, (event, data) => captured.push({ event, data: data as any }));

      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emitLine(proc, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_a",
        tool_use_id: "toolu_1",
        task_type: "local_workflow",
        description: "深度调研",
      });
      await sleep(10);

      const started = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.taskId === "wf_a");
      expect(started.length).toBeGreaterThan(0);
      const s = started[started.length - 1];
      expect(s.sessionId).toBe(DEFAULT_CHAT_SESSION_ID);
      expect(s.taskId).toBe("wf_a");
      expect(typeof s.generation).toBe("number");
      expect(s.generation).toBeGreaterThanOrEqual(1);
      expect(s.status).toBe("running");
      expect(s.taskType).toBe("local_workflow");
      expect(s.description).toBe("深度调研");
      expect(typeof s.ts).toBe("number");

      // notification 携带 summary/usage → 广播 payload 透传这些字段（同 id replace）。
      emitLine(proc, {
        type: "system",
        subtype: "task_notification",
        task_id: "wf_a",
        status: "completed",
        summary: "报告已出",
        usage: { total_tokens: 1234, tool_uses: 3 },
      });
      await sleep(10);

      const done = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.taskId === "wf_a" && d.status === "completed");
      expect(done.length).toBeGreaterThan(0);
      const d = done[done.length - 1];
      expect(d.summary).toBe("报告已出");
      expect(d.usage).toEqual({ total_tokens: 1234, tool_uses: 3 });
      // same-id replace：仍是同一 taskId + generation，不是新记录。
      expect(d.taskId).toBe("wf_a");
      expect(d.generation).toBe(s.generation);
    });
  });

  // ② 新 browser 连接先收全量 ui-workflow-snapshot（当前代际 + 未清理终态）。
  it("新 browser 连接先收 ui-workflow-snapshot（含当前任务）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_uiwf_snap";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;

      const proc = session.cliProcess as unknown as { stdout: EventEmitter };
      emitLine(proc, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_snap",
        task_type: "local_workflow",
        description: "编排中",
      });
      await sleep(10);

      // 模拟一个新 browser 连接（upgrade → browserWss "connection"）：先收快照。
      const sink: string[] = [];
      (bridge as any).browserWss.emit("connection", fakeWs(sink), {
        url: `/ws/browser/${work}/${DEFAULT_CHAT_SESSION_ID}`,
      });
      await sleep(30);

      const snap = framesOf(sink).find((f) => f.event === "ui-workflow-snapshot");
      expect(snap).toBeDefined();
      expect(snap!.data.sessionId).toBe(DEFAULT_CHAT_SESSION_ID);
      expect(Array.isArray(snap!.data.tasks)).toBe(true);
      const t = snap!.data.tasks.find((x: any) => x.taskId === "wf_snap");
      expect(t).toBeDefined();
      expect(t.status).toBe("running");
      expect(t.taskType).toBe("local_workflow");
    });
  });

  // ③ settleOnExit 合成终态后向 chat 流广播 ui-workflow（带 settleReason）——被杀不静默。
  it("settleOnExit 后广播合成终态 ui-workflow（stopped + settleReason）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_uiwf_settle";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;

      const proc = session.cliProcess as unknown as { stdout: EventEmitter } & EventEmitter;
      emitLine(proc, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_live",
        task_type: "local_workflow",
      });
      await sleep(10);

      // 只捕获 exit 之后的广播（起点广播不干扰断言）。
      const captured: Array<{ event: string; data: any }> = [];
      bridge.onSessionEvent(work, (event, data) => captured.push({ event, data: data as any }));

      (proc as unknown as EventEmitter).emit("exit", 0, null);
      await sleep(10);

      const terminal = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.taskId === "wf_live");
      expect(terminal.length).toBeGreaterThan(0);
      const last = terminal[terminal.length - 1];
      expect(last.status).toBe("stopped");
      expect(last.settleReason).toBe("cli_exit");
      expect(last.sessionId).toBe(DEFAULT_CHAT_SESSION_ID);
      expect(last.generation).toBeGreaterThanOrEqual(1);
    });
  });

  // ④ ui-progress 行为零变化：整段 bg 任务生命周期广播绝不发出 ui-progress，且 chat 流上
  //    唯一的新 ui-* 信封是 ui-workflow / ui-workflow-snapshot（不复用 ui-progress）。
  it("bg 任务生命周期广播不触碰 ui-progress（回归锁）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_uiwf_progress";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;

      const captured: Array<{ event: string; data: any }> = [];
      bridge.onSessionEvent(work, (event, data) => captured.push({ event, data: data as any }));

      const proc = session.cliProcess as unknown as { stdout: EventEmitter } & EventEmitter;
      emitLine(proc, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_p",
        task_type: "local_workflow",
      });
      emitLine(proc, {
        type: "system",
        subtype: "task_notification",
        task_id: "wf_p",
        status: "running",
      });
      await sleep(10);
      (proc as unknown as EventEmitter).emit("exit", 0, null);
      await sleep(10);

      const events = captured.map((e) => e.event);
      // ui-progress 从未出现在 chat 流（它属 work 级 bridge-ws，本 slice 未触碰）。
      expect(events).not.toContain("ui-progress");
      // 本 slice 在 chat 流上引入的唯一 ui-* 信封是 ui-workflow(-snapshot)。
      const newUiEnvelopes = events.filter(
        (e) => e.startsWith("ui-") && e !== "ui-workflow" && e !== "ui-workflow-snapshot",
      );
      expect(newUiEnvelopes).toEqual([]);
      // 正向：确有 ui-workflow 广播（否则上面的"无 ui-progress"是空断言）。
      expect(events.filter((e) => e === "ui-workflow").length).toBeGreaterThan(0);
    });
  });
});
