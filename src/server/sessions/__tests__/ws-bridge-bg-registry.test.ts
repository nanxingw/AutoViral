import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// PRD-0015 S2 — ws-bridge 接线锁：S1 归一化后台任务事件 → registry.applyEvent；
// 进程 exit → registry.settleOnExit("cli_exit")。本片仍不做 WS 广播（S3 的事），
// 只断言 registry 在 WsSession 上被正确喂入 + 退出时把活任务合成终态。
//
// spawn-mock + fake-socket 模式取自 ws-bridge-codex-turn.test.ts。

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
  const dir = await mkdtemp(join(tmpdir(), "av-ws-bg-registry-"));
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

describe("WsBridge — PRD-0015 S2 registry 接线 + settleOnExit", () => {
  it("归一化任务事件喂入 session.taskRegistry；进程 exit 把活任务合成 stopped", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_bg_registry";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "跑个后台 workflow", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;

      // registry 挂在 session 上（per workId×sessionId）。
      expect(session.taskRegistry).toBeDefined();

      const proc = session.cliProcess as unknown as { stdout: EventEmitter } & EventEmitter;

      // 驱动一段 local_workflow 任务的生命周期起点：background_tasks_changed（快照含它）
      // + task_started（running）。此刻任务仍 running。
      emitLine(proc, {
        type: "system",
        subtype: "background_tasks_changed",
        tasks: [{ task_id: "wf_live", task_type: "local_workflow", description: "深度调研" }],
      });
      emitLine(proc, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_live",
        tool_use_id: "toolu_x",
        task_type: "local_workflow",
        description: "深度调研",
      });
      await sleep(10);

      const live = session.taskRegistry!.snapshot().find((t) => t.taskId === "wf_live")!;
      expect(live).toBeDefined();
      expect(live.status).toBe("running");
      expect(live.taskType).toBe("local_workflow");

      // 进程退出（turn 结束、宿主 CLI 死）→ exit handler 调 settleOnExit("cli_exit")，
      // 仍 running 的任务被合成 stopped 终态并标 reason（030 事故的"被杀无提示"止损）。
      (proc as unknown as EventEmitter).emit("exit", 0, null);
      await sleep(10);

      const settled = session.taskRegistry!.snapshot().find((t) => t.taskId === "wf_live")!;
      expect(settled.status).toBe("stopped");
      expect(settled.settleReason).toBe("cli_exit");
    });
  });

  // finding 3（PRD-0015 S6 更新）—— superseded 进程 exit 也要 settle 它代际里【迟到冲出】的
  // 活任务：被顶掉的旧进程走 exit handler 的 superseded 分支（跳过 UI/session 副作用），此前
  // 直接 return 导致旧代活任务永远残留 running（030"被杀无提示"经切模型/命令路径复现）。
  //
  // S6 收窄了触发条件：切模型/命令 passthrough 遇【活】后台任务时改为【拒绝】（不杀，见
  // kill-gate.test.ts ⑥），所以"顶掉带活任务的进程"这一 orphan 场景从源头被 KillGate 挡住。
  // 但【无活任务时】切模型照旧 kill+supersede；若被杀进程的 stdout 缓冲里迟到冲出一个同代
  // task_started，exit 的 superseded 分支仍必须把它 settle 成 stopped(superseded)——本 case 锁这条。
  it("superseded 进程 exit settle 迟到活任务(superseded)，不残留 running", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_supersede";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const proc1 = session.cliProcess as unknown as { stdout: EventEmitter } & EventEmitter;

      // 无活任务 → 切模型照旧 kill+supersede proc1（S6 只在【有】活任务时才拒绝）。
      const ok = bridge.setSessionModel(work, "sonnet", DEFAULT_CHAT_SESSION_ID);
      expect(ok).toBe(true);
      expect(session.cliProcess).toBeUndefined();

      // proc1 stdout 缓冲里迟到冲出一个 task_started（同代 running）——被杀但 parser 仍在读缓冲。
      emitLine(proc1, {
        type: "system",
        subtype: "task_started",
        task_id: "wf_old",
        task_type: "local_workflow",
      });
      await sleep(10);
      expect(
        session.taskRegistry!.snapshot().find((t) => t.taskId === "wf_old")!.status,
      ).toBe("running");

      // proc1 退出走 superseded 分支——必须先按本代 settleOnExit 收尾迟到活任务。
      (proc1 as unknown as EventEmitter).emit("exit", null, "SIGTERM");
      await sleep(10);

      const settled = session.taskRegistry!.snapshot().find((t) => t.taskId === "wf_old")!;
      expect(settled.status).toBe("stopped");
      expect(settled.settleReason).toBe("superseded");
    });
  });

  // finding 4 —— 迟到 exit 不清空新进程状态：sendMessage 杀旧进程（未入 supersededSet）后
  // 立即 spawn 新进程；旧进程的迟到 exit 走主分支，若无条件清 cliProcess/置 idle，会把刚
  // spawn 的新进程状态抹掉（pre-existing 竞态）。仅当 session.cliProcess === proc 才清。
  it("sendMessage 杀旧进程→立即 spawn 新进程→旧 exit 迟到→新进程状态不被覆盖", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_late_exit";
      await mkdir(join(dir, "works", work), { recursive: true });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const proc1 = session.cliProcess;

      // 发新消息（文案不同，绕开 dedup）：杀 proc1（不入 supersededSet）+ 立即 spawn proc2。
      await bridge.sendMessage(work, "再来一条不同的消息", DEFAULT_CHAT_SESSION_ID);
      const proc2 = session.cliProcess;
      expect(proc2).not.toBe(proc1);
      expect(proc2).toBeDefined();
      expect(session.idle).toBe(false);

      // proc1 迟到 exit——不得清掉 proc2 / 置 idle=true。
      (proc1 as unknown as EventEmitter).emit("exit", 0, null);
      await sleep(10);

      expect(session.cliProcess).toBe(proc2);
      expect(session.idle).toBe(false);
    });
  });
});
