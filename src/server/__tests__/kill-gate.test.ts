import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// PRD-0015 S6 —— KillGate drain 纪律锁。
//
// 全部 CLI 进程回收路径收敛过单一 chokepoint `requestKill(session, cause)`：registry（S2）
// 报告当前代际有非终态任务时按 cause 分级——
//   - 破坏性用户意图（session_replace / user_stop / session_delete / daemon_shutdown）：
//     总是杀 + settleOnExit(cause) + 广播合成终态 ui-workflow（绝不静默）。
//   - user_new_message：活任务时 **不杀**——消息进 per-session 队列 + 广播用户可见提示，
//     进程 result 到达（turn 完成、任务落定）后自动 flush。
//   - model_switch / backend_switch / command_passthrough：活任务时拒绝 + 广播提示。
//   - browser_disconnect_grace / idle_ttl：活任务时跳过本轮回收（进程继续跑）。
// 裸 `cliProcess.kill(` 只允许出现在 chokepoint 内部（源码 grep sweep-gate 挡未来新增）。
//
// spawn-mock + fake-socket 模式取自 ui-workflow-envelope.test.ts。

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
  const dir = await mkdtemp(join(tmpdir(), "av-kill-gate-"));
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

/** 起一个已有活后台任务的 chat 会话：createSession 起进程 → 发 task_started（running）。
 *  返回 bridge / session / proc / 从此刻开始捕获的广播 sink。 */
async function activeSession(dir: string, work: string) {
  const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
  await mkdir(join(dir, "works", work), { recursive: true });
  const bridge = new WsBridge(3271);
  await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
  const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
  const proc = session.cliProcess as unknown as {
    stdout: EventEmitter;
    __killSignals: string[];
  } & EventEmitter;
  emitLine(proc, {
    type: "system",
    subtype: "task_started",
    task_id: "wf",
    task_type: "local_workflow",
    description: "深度调研",
  });
  await sleep(10);
  const captured: Captured = [];
  bridge.onSessionEvent(work, (event, data) => captured.push({ event, data: data as any }));
  return { bridge, session, proc, captured, sid: DEFAULT_CHAT_SESSION_ID };
}

describe("WsBridge — PRD-0015 S6 KillGate drain 纪律", () => {
  // ① 活任务 + user_new_message → 不杀、消息入队、广播提示、无新 spawn。
  it("① 活任务时发新消息不杀活进程，改为入队 + 广播提示", async () => {
    await withTempDataDir(async (dir) => {
      const { bridge, session, proc, captured, sid } = await activeSession(dir, "w_queue");
      const before = spawnCalls.length;

      const ok = await bridge.sendMessage("w_queue", "第二条消息", sid);
      await sleep(20);

      expect(ok).toBe(true);
      // 活进程未被杀（030 根因：绝不 SIGTERM 带活任务的 turn）。
      expect(proc.__killSignals).toEqual([]);
      // 未 spawn 新进程。
      expect(spawnCalls.length).toBe(before);
      // 消息进 per-session 队列。
      expect(session.pendingMessages).toContain("第二条消息");
      // chat 流广播用户可见提示。
      const notice = captured.find(
        (e) => e.event === "chat_notice" && e.data?.kind === "queued_message",
      );
      expect(notice).toBeDefined();
      expect(typeof notice!.data.message).toBe("string");
      expect(notice!.data.message.length).toBeGreaterThan(0);
    });
  });

  // ② 破坏性 cause（user_stop / killSession）→ 杀 + settleOnExit + 广播合成终态，绝不静默。
  it("② /stop 杀活进程并广播 stopped 终态（settleReason=user_stop）", async () => {
    await withTempDataDir(async (dir) => {
      const { bridge, proc, captured, sid } = await activeSession(dir, "w_stop");

      const ok = bridge.killSession("w_stop", sid);
      await sleep(10);

      expect(ok).toBe(true);
      // 进程被 SIGTERM。
      expect(proc.__killSignals).toContain("SIGTERM");
      // 合成终态经 ui-workflow 广播（被杀不静默）。
      const terminal = captured
        .filter((e) => e.event === "ui-workflow")
        .map((e) => e.data)
        .filter((d) => d.taskId === "wf");
      expect(terminal.length).toBeGreaterThan(0);
      const last = terminal[terminal.length - 1];
      expect(last.status).toBe("stopped");
      expect(last.settleReason).toBe("user_stop");
      // session_killed 信号照旧（S6 不移除既有 UI 信号，与 ui-workflow 互补）。
      expect(captured.find((e) => e.event === "session_killed")).toBeDefined();
    });
  });

  // ③ 无活任务 → 行为与现状一致：发新消息杀旧进程 + 起新 turn（回归锁）。
  it("③ 无活任务时发新消息照旧杀旧进程 + 起新 turn", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../ws-bridge.js");
      const work = "w_noactive";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "开工", undefined, DEFAULT_CHAT_SESSION_ID);
      const session = bridge.getSession(work, DEFAULT_CHAT_SESSION_ID)!;
      const proc = session.cliProcess as unknown as { __killSignals: string[] };
      // 无 task_started → 无活任务。
      const before = spawnCalls.length;

      const ok = await bridge.sendMessage(work, "普通消息", DEFAULT_CHAT_SESSION_ID);
      await sleep(50);

      expect(ok).toBe(true);
      expect(proc.__killSignals).toContain("SIGTERM");
      expect(spawnCalls.length).toBe(before + 1);
      expect(session.pendingMessages ?? []).toEqual([]);
    });
  });

  // ④ sweep matrix：枚举 cause 家族，逐一断言 requestKill chokepoint 的行为
  //    （contract-test-sweep-gate 纪律：一处枚举整族，未来新增 cause 必须显式落表）。
  it("④ requestKill sweep：每类 cause 的放行/杀/settle 行为", async () => {
    const SWEEP: Array<{
      cause: string;
      disp: string;
      kills: boolean;
      settles: boolean;
    }> = [
      // 破坏性用户意图 —— 总是杀 + 合成终态广播。
      { cause: "session_replace", disp: "killed", kills: true, settles: true },
      { cause: "user_stop", disp: "killed", kills: true, settles: true },
      { cause: "session_delete", disp: "killed", kills: true, settles: true },
      { cause: "daemon_shutdown", disp: "killed", kills: true, settles: true },
      // 可延迟 —— 活任务时入队。
      { cause: "user_new_message", disp: "queued", kills: false, settles: false },
      // 可拒绝 —— 活任务时拒绝。
      { cause: "backend_switch", disp: "rejected", kills: false, settles: false },
      { cause: "model_switch", disp: "rejected", kills: false, settles: false },
      { cause: "command_passthrough", disp: "rejected", kills: false, settles: false },
      // 可跳过 —— 活任务时本轮不回收。
      { cause: "browser_disconnect_grace", disp: "skipped", kills: false, settles: false },
      { cause: "idle_ttl", disp: "skipped", kills: false, settles: false },
    ];

    await withTempDataDir(async (dir) => {
      for (const { cause, disp, kills, settles } of SWEEP) {
        const { bridge, session, proc, captured } = await activeSession(dir, `w_sweep_${cause}`);
        const result = (bridge as any).requestKill(session, cause);
        await sleep(10);

        expect(result, `disposition for ${cause}`).toBe(disp);
        if (kills) {
          expect(proc.__killSignals, `${cause} should kill`).toContain("SIGTERM");
        } else {
          expect(proc.__killSignals, `${cause} must not kill`).toEqual([]);
        }

        const stoppedFrames = captured
          .filter((e) => e.event === "ui-workflow")
          .map((e) => e.data)
          .filter((d) => d.taskId === "wf" && d.status === "stopped");
        if (settles) {
          expect(stoppedFrames.length, `${cause} should broadcast terminal`).toBeGreaterThan(0);
          expect(stoppedFrames[stoppedFrames.length - 1].settleReason).toBe(cause);
        } else {
          expect(stoppedFrames, `${cause} must not synthesize terminal`).toEqual([]);
        }
      }
    });
  });

  // ⑤ 队列 flush：活任务时入队 → 任务落定 → result 帧到达 → 自动发出（新 spawn 携带队列文本）。
  it("⑤ result 帧到达且任务落定后自动 flush 队列（发出被延迟的消息）", async () => {
    await withTempDataDir(async (dir) => {
      const { bridge, session, proc, sid } = await activeSession(dir, "w_flush");

      // 活任务时入队。
      await bridge.sendMessage("w_flush", "延迟消息", sid);
      await sleep(20);
      expect(session.pendingMessages).toContain("延迟消息");
      const before = spawnCalls.length;

      // 任务落定为终态（notification completed）。
      emitLine(proc, {
        type: "system",
        subtype: "task_notification",
        task_id: "wf",
        status: "completed",
      });
      await sleep(10);

      // result 帧到达（turn 完成）→ flush → 起新 turn 发出队列消息。
      emitLine(proc, { type: "result" });
      await sleep(60);

      expect(spawnCalls.length).toBe(before + 1);
      const last = spawnCalls[spawnCalls.length - 1];
      expect(last.args.join(" ")).toContain("延迟消息");
      expect(session.pendingMessages ?? []).toEqual([]);
    });
  });

  // ⑥ 拒绝路径 wiring：活任务时切模型被拒 + 广播提示 + 不改 model + 不杀。
  it("⑥ 活任务时 setSessionModel 被拒绝并广播提示（不改 model、不杀进程）", async () => {
    await withTempDataDir(async (dir) => {
      const { bridge, session, proc, captured } = await activeSession(dir, "w_reject");
      const modelBefore = session.model;

      const ok = bridge.setSessionModel("w_reject", "opus", session.sessionId);
      await sleep(10);

      expect(ok).toBe(false);
      expect(session.model).toBe(modelBefore);
      expect(proc.__killSignals).toEqual([]);
      const notice = captured.find(
        (e) => e.event === "chat_notice" && e.data?.kind === "kill_rejected",
      );
      expect(notice).toBeDefined();
    });
  });

  // ⑦ sweep-gate：裸 `.kill(` 只允许出现在 requestKill chokepoint 的 BEGIN/END 之间，
  //    且恰好 2 处（SIGTERM + SIGKILL 升级）。未来任何调用点绕过 chokepoint 直接 kill → 红。
  it("⑦ 裸 .kill( 仅出现在 requestKill chokepoint 内（防未来新增裸 kill）", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../ws-bridge.ts", import.meta.url)),
      "utf-8",
    );
    const lines = src.split("\n");
    const begin = lines.findIndex((l) => l.includes("requestKill chokepoint (BEGIN)"));
    const end = lines.findIndex((l) => l.includes("requestKill chokepoint (END)"));
    expect(begin, "BEGIN sentinel present").toBeGreaterThan(-1);
    expect(end, "END sentinel after BEGIN").toBeGreaterThan(begin);

    const killLineNos: number[] = [];
    lines.forEach((l, i) => {
      if (/\.kill\(/.test(l)) killLineNos.push(i);
    });
    expect(killLineNos.length, "at least one .kill( in file").toBeGreaterThan(0);
    for (const i of killLineNos) {
      expect(i, `.kill( at line ${i + 1} must be inside chokepoint`).toBeGreaterThan(begin);
      expect(i, `.kill( at line ${i + 1} must be inside chokepoint`).toBeLessThan(end);
    }
    // 恰好 2 处：SIGTERM + user_stop 的 SIGKILL 升级。多一处即回归。
    expect(killLineNos.length).toBe(2);
  });
});
