import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// PRD-0015 W3.5 加固（W3 codex review findings）——逐条先落证红测试。
//
//   H1 · 队列消息被 dedup 吞掉 + 并发 result 重复 flush
//        - sendMessage 回放路径绕过 A2 去重（skipDedup）——队列消息绝不被去重窗口吞掉。
//        - flush 互斥：同进程双 result 帧只 flush 一条队列消息（不并发起两个 turn）。
//   H2 · killSession(cause) —— abort 路由带 cause="abort"（破坏性 settle+广播）。
//   H3 · killAllSessions —— 删 work 时杀【所有】session（非仅默认 session）。
//   M5 · snapshot 先于增量 —— 连接时 ui-workflow-snapshot 先于任何 ui-workflow 增量。
//
// spawn-mock + fake-socket 模式取自 kill-gate.test.ts / ui-workflow-envelope.test.ts。

const spawnCalls: { cmd: string; args: string[] }[] = [];
function makeFakeProc() {
  const killSignals: string[] = [];
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig?: string) => boolean;
    __killSignals: string[];
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = (sig?: string) => {
    killSignals.push(sig ?? "SIGTERM");
    return true;
  };
  proc.__killSignals = killSignals;
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
  const dir = await mkdtemp(join(tmpdir(), "av-kill-hard-"));
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

type Captured = Array<{ event: string; data: any }>;

function procOf(session: any) {
  return session.cliProcess as unknown as {
    stdout: EventEmitter;
    __killSignals: string[];
  } & EventEmitter;
}

/** 起一个已有活后台任务的 chat 会话（createSession 起进程 → 发 task_started）。 */
async function activeSession(dir: string, work: string, sid?: string) {
  const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
  const s = sid ?? DEFAULT_CHAT_SESSION_ID;
  await mkdir(join(dir, "works", work), { recursive: true });
  const bridge = new WsBridge(3271);
  await bridge.createSession(work, "开工", undefined, s);
  const session = bridge.getSession(work, s)!;
  const proc = procOf(session);
  emitLine(proc, {
    type: "system",
    subtype: "task_started",
    task_id: "wf",
    task_type: "local_workflow",
    description: "深度调研",
  });
  await sleep(10);
  return { bridge, session, proc, sid: s };
}

describe("WsBridge — H1 队列 dedup 绕过 + flush 互斥", () => {
  // ① 回放路径绕过 A2 去重：与 lastUserText 同文本、在去重窗口内，仍被真正发出（不蒸发）。
  it("① sendMessage skipDedup 绕过去重窗口（队列回放不被吞）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_skipdedup";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      await sleep(10);

      // 第一条 "继续"：无活任务 → 记录 + 起 turn（置 lastUserText="继续"、非 idle）。
      await bridge.sendMessage(work, "继续", DEFAULT_CHAT_SESSION_ID);
      await sleep(20);
      const afterFirst = spawnCalls.length;

      // 第二条同文本、窗口内 → A2 去重吞掉（不发、不起 turn）——回归锁：去重仍生效。
      await bridge.sendMessage(work, "继续", DEFAULT_CHAT_SESSION_ID);
      await sleep(20);
      expect(spawnCalls.length, "dedup should swallow the back-to-back duplicate").toBe(afterFirst);

      // skipDedup 回放路径：同文本、窗口内，绕过去重 → 真正起 turn（队列消息绝不蒸发）。
      await (bridge.sendMessage as any)(work, "继续", DEFAULT_CHAT_SESSION_ID, { skipDedup: true });
      await sleep(30);
      expect(spawnCalls.length, "skipDedup replay must actually spawn").toBe(afterFirst + 1);
    });
  });

  // ② 同进程双 result 帧只 flush 一条队列消息（互斥；不并发起两个 turn）。
  it("② 双 result 帧只 flush 一条队列消息（flush 互斥）", async () => {
    await withTempDataDir(async (dir) => {
      const { bridge, session, proc, sid } = await activeSession(dir, "w_double_flush");

      // 活任务运行中入队两条不同文本消息。
      await bridge.sendMessage("w_double_flush", "消息A", sid);
      await sleep(10);
      await bridge.sendMessage("w_double_flush", "消息B", sid);
      await sleep(10);
      expect(session.pendingMessages).toEqual(["消息A", "消息B"]);

      // 任务落定为终态（notification completed）。
      emitLine(proc, { type: "system", subtype: "task_notification", task_id: "wf", status: "completed" });
      await sleep(10);
      const before = spawnCalls.length;

      // 同进程双 result 帧（exp 实证同进程可有多个 result）——只应 flush 一条（消息A）。
      emitLine(proc, { type: "result" });
      emitLine(proc, { type: "result" });
      await sleep(60);

      expect(spawnCalls.length, "double result must flush exactly ONE queued message").toBe(before + 1);
      const last = spawnCalls[spawnCalls.length - 1];
      expect(last.args.join(" ")).toContain("消息A");
      // 第二条仍在队列，等下一个 turn 的 result 再 flush。
      expect(session.pendingMessages).toEqual(["消息B"]);
    });
  });
});

describe("WsBridge — H2 killSession(cause) abort", () => {
  it("abort 路由 cause 经 killSession 透传：settle 广播 settleReason=abort", async () => {
    await withTempDataDir(async (dir) => {
      const { bridge, proc, sid } = await activeSession(dir, "w_abort");
      const captured: Captured = [];
      bridge.onSessionEvent("w_abort", (event, data) => captured.push({ event, data: data as any }));

      const ok = (bridge.killSession as any)("w_abort", sid, "abort");
      await sleep(10);

      expect(ok).toBe(true);
      expect(proc.__killSignals).toContain("SIGTERM");
      const terminal = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.taskId === "wf" && d.status === "stopped");
      expect(terminal.length).toBeGreaterThan(0);
      expect(terminal[terminal.length - 1].settleReason).toBe("abort");
    });
  });
});

describe("WsBridge — H3 killAllSessions", () => {
  it("删 work 杀【所有】session：两个 session 各挂进程都被 settle + kill", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../ws-bridge.js");
      const work = "w_killall";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);

      // 两个并发 session，各自起进程 + 各挂一个活任务。
      await bridge.createSession(work, "开工", undefined, "s_1");
      await bridge.createSession(work, "开工2", undefined, "s_2");
      const s1 = bridge.getSession(work, "s_1")!;
      const s2 = bridge.getSession(work, "s_2")!;
      const p1 = procOf(s1);
      const p2 = procOf(s2);
      emitLine(p1, { type: "system", subtype: "task_started", task_id: "t1", task_type: "local_workflow" });
      emitLine(p2, { type: "system", subtype: "task_started", task_id: "t2", task_type: "local_workflow" });
      await sleep(10);

      const captured: Captured = [];
      bridge.onSessionEvent(work, (event, data) => captured.push({ event, data: data as any }));

      const n = (bridge as any).killAllSessions(work, "work_delete");
      await sleep(10);

      expect(n).toBe(2);
      // 两个进程都被 SIGTERM。
      expect(p1.__killSignals).toContain("SIGTERM");
      expect(p2.__killSignals).toContain("SIGTERM");
      // 两个 session 的活任务都被合成终态并广播（work_delete 绝不静默）。
      const stopped = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.status === "stopped" && d.settleReason === "work_delete");
      const ids = new Set(stopped.map((d) => d.taskId));
      expect(ids.has("t1")).toBe(true);
      expect(ids.has("t2")).toBe(true);
    });
  });
});

describe("WsBridge — M5 snapshot 先于增量", () => {
  // 确定性构造：在 handleBrowserConnection 的 sidecar 读（setup await）里同步推一个增量。
  // 现状 socket 早在这些 await 之前就加入了 fan-out → 增量抢在 snapshot 之前抵达；修复后
  // socket 只在 snapshot 发出之后才加入 fan-out → setup 期间的增量到不了本连接，snapshot
  // 必然先于任何增量。用 sidecar.get 的 spy 精确卡在 setup 的 await 点触发增量（不靠 sleep 竞时）。
  it("连接时 ui-workflow-snapshot 先于任何 ui-workflow 增量", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const { SessionSidecar } = await import("../sessions/sessions-sidecar.js");
      const work = "w_snap_order";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const proc = procOf(session);
      // 连接前 registry 已有一个活任务 → snapshot 非空。
      emitLine(proc, { type: "system", subtype: "task_started", task_id: "wf1", task_type: "local_workflow" });
      await sleep(10);

      const sink: string[] = [];
      const ws = { readyState: 1, send: (m: string) => sink.push(m), on: () => {} };

      // 每次 handleBrowserConnection 的 sidecar.get（setup await 点）resolve 时，同步推一个增量。
      // arming 后才生效，只作用于本连接的 setup。
      let armed = false;
      const origGet = SessionSidecar.prototype.get;
      const spy = vi
        .spyOn(SessionSidecar.prototype, "get")
        .mockImplementation(async function (this: any, id: string) {
          const r = await origGet.call(this, id);
          if (armed) {
            emitLine(proc, {
              type: "system",
              subtype: "task_notification",
              task_id: "wf1",
              status: "running",
            });
          }
          return r;
        });

      try {
        armed = true;
        (bridge as any).browserWss.emit("connection", ws, {
          url: `/ws/browser/${work}/${DEFAULT_CHAT_SESSION_ID}`,
        });
        await sleep(50);
      } finally {
        armed = false;
        spy.mockRestore();
      }

      const frames = sink.map((m) => JSON.parse(m));
      const snapIdx = frames.findIndex((f) => f.event === "ui-workflow-snapshot");
      const incrIdx = frames.findIndex((f) => f.event === "ui-workflow");
      expect(snapIdx, "snapshot delivered on connect").toBeGreaterThanOrEqual(0);
      if (incrIdx !== -1) {
        expect(snapIdx, "snapshot must precede any ui-workflow increment").toBeLessThan(incrIdx);
      }
    });
  });
});
