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
});
