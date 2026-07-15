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

  // ⑤ W4.5 H3 —— ceiling 强杀：任务在进程 exit 前就带上 killed 终态帧（settleOnExit 无新结算），
  //    journal 打捞仍必须触发，把该任务翻 orphaned 并广播（含 harvest 计数）。注入 harvestRunsFn
  //    返回受控 run，避免碰真实 ~/.claude 文件系统。
  it("H3 — 任务先收 killed 终态、进程再 exit，仍触发 journal 打捞并广播 orphaned", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_uiwf_ceiling";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      // 打捞需要 cliSessionId 推导 journal 路径——设个假的即可（harvestRunsFn 被注入，不真读盘）。
      session.cliSessionId = "sess-uuid-ceiling";
      // 注入受控 run：mtime 在 call 时求值（晚于任务 startTime），落进任务生命周期窗口。
      (bridge as any).harvestRunsFn = async () => [
        {
          runId: "wf_run",
          journalPath: "/j/wf_run/journal.jsonl",
          mtimeMs: Date.now(),
          counts: { completedAgents: 2, startedAgents: 3, resultSummary: "最后一个 agent 交付了" },
        },
      ];

      const proc = session.cliProcess as unknown as { stdout: EventEmitter } & EventEmitter;
      emitLine(proc, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_ceil",
        task_type: "local_workflow",
        description: "编排中",
      });
      // ceiling 强杀语义：任务在进程 exit 前就被标 killed（终态帧先到）。
      emitLine(proc, {
        type: "system",
        subtype: "task_notification",
        task_id: "wf_ceil",
        status: "killed",
      });
      await sleep(10);

      const captured: Array<{ event: string; data: any }> = [];
      bridge.onSessionEvent(work, (event, data) => captured.push({ event, data: data as any }));

      // 进程 exit：settleOnExit 对 killed 任务无新结算，但 H3 打捞候选从快照重算仍命中它。
      (proc as unknown as EventEmitter).emit("exit", 1, null);
      await sleep(30);

      const orphaned = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.taskId === "wf_ceil" && d.status === "orphaned");
      expect(orphaned.length).toBeGreaterThan(0);
      const last = orphaned[orphaned.length - 1];
      expect(last.harvest).toBeDefined();
      expect(last.harvest.completedAgents).toBe(2);
      expect(last.harvest.startedAgents).toBe(3);
      expect(last.harvest.runId).toBe("wf_run");
      expect(last.harvest.resultSummary).toBe("最后一个 agent 交付了"); // L10
    });
  });

  // ⑥ W4.5 H4 —— 陈旧 exit 门控：一个已被新进程接管（session.cliProcess 已换）的旧进程，其
  //    迟到 exit 绝不广播 cli_exited（否则客户端会把新代仍在跑的任务误翻 stopped）。但它仍按
  //    自己代际 settle 自己的活任务（证明 handler 确实跑了，no-broadcast 是门控而非 handler 没执行）。
  it("H4 — 被接管的旧进程迟到 exit 不广播 cli_exited（但仍 settle 自己代际的任务）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_uiwf_stale";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const oldProc = session.cliProcess as unknown as { stdout: EventEmitter } & EventEmitter;

      // 旧进程这代起了个活任务。
      emitLine(oldProc, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_old",
        task_type: "local_workflow",
      });
      await sleep(10);

      // 模拟新进程接管：session.cliProcess 换成另一个（旧进程从此是 stale）。
      const newProc = makeFakeProc();
      session.cliProcess = newProc as any;

      const captured: Array<{ event: string; data: any }> = [];
      bridge.onSessionEvent(work, (event, data) => captured.push({ event, data: data as any }));

      // 旧进程迟到 exit。
      (oldProc as unknown as EventEmitter).emit("exit", 0, null);
      await sleep(10);

      // 门控：绝不广播 cli_exited（否则新代任务被误 settle）。
      expect(captured.some((e) => e.event === "cli_exited")).toBe(false);
      // 但旧进程这代的活任务仍被 settle 并广播 stopped（证明 exit handler 真的执行了）。
      const settled = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.taskId === "wf_old" && d.status === "stopped");
      expect(settled.length).toBeGreaterThan(0);
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
