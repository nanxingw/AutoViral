import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { BackgroundTaskRegistry } from "../background-task-registry.js";
import { claudeBackend } from "../../chat-backends/claude.js";
import type { ChatBackgroundTaskEvent } from "../../chat-backends/types.js";

// PRD-0015 S2 — BackgroundTaskRegistry 深模块单测。纯逻辑、时钟注入、零 I/O。
//
// 这是最好隔离的深模块：事件流进（applyEvent）→ 快照/终态出（snapshot/
// settleOnExit），不测内部 Map。所有"真值"取自九次受控实验的脱敏 fixture
// （src/server/chat-backends/__fixtures__/claude-tasks/），经真实 claude 后端
// parser 归一化后喂入 registry —— 同时锁住 S1→S2 的接线保真。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(
  __dirname,
  "..",
  "..",
  "chat-backends",
  "__fixtures__",
  "claude-tasks",
);

/** 把一个 fixture 文件的 task-class system 帧经真实 claude parser 归一化成
 *  ChatBackgroundTaskEvent 列表（保真 S1 的翻译，而非在测试里手抄字段名）。 */
function normalizeFixture(name: string): ChatBackgroundTaskEvent[] {
  const events: ChatBackgroundTaskEvent[] = [];
  const parser = claudeBackend.createLineParser({
    onSessionId: () => {},
    onText: () => {},
    onThinking: () => {},
    onToolUse: () => {},
    onToolResult: () => {},
    onTurnComplete: () => {},
    onOther: () => {},
    onBackgroundTask: (event) => events.push(event),
  });
  const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
  for (const line of raw.split("\n")) {
    if (line.trim().length > 0) parser.push(line + "\n");
  }
  return events;
}

/** 便捷：按 taskId 从 snapshot 取一条。 */
function byId(reg: BackgroundTaskRegistry, taskId: string) {
  return reg.snapshot().find((t) => t.taskId === taskId);
}

describe("BackgroundTaskRegistry — applyEvent upsert + 状态机", () => {
  it("① 同 id 两次 applyEvent 只有一条且状态覆盖（started→updated）", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 1000 });
    reg.beginGeneration();
    reg.applyEvent({
      kind: "started",
      taskId: "t_a",
      toolUseId: "toolu_1",
      taskType: "local_workflow",
      description: "probe",
    });
    reg.applyEvent({
      kind: "updated",
      taskId: "t_a",
      status: "completed",
      endTime: 1784116943801,
    });

    const snap = reg.snapshot();
    expect(snap).toHaveLength(1);
    const t = snap[0];
    expect(t.taskId).toBe("t_a");
    // 状态被后到的 updated 覆盖到 completed，但 started 携带的元数据不被清空。
    expect(t.status).toBe("completed");
    expect(t.toolUseId).toBe("toolu_1");
    expect(t.taskType).toBe("local_workflow");
    expect(t.description).toBe("probe");
    expect(t.endTime).toBe(1784116943801);
  });

  it("notification 累积 summary/outputFile/usage 且覆盖状态", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 1000 });
    reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t_b", taskType: "local_workflow" });
    reg.applyEvent({
      kind: "notification",
      taskId: "t_b",
      status: "completed",
      summary: "workflow done",
      outputFile: "<SCRATCH>/tasks/t_b.output",
      usage: { total_tokens: 1234, tool_uses: 5 },
    });
    const t = byId(reg, "t_b")!;
    expect(t.status).toBe("completed");
    expect(t.summary).toBe("workflow done");
    expect(t.outputFile).toBe("<SCRATCH>/tasks/t_b.output");
    expect(t.usage).toEqual({ total_tokens: 1234, tool_uses: 5 });
  });
});

describe("BackgroundTaskRegistry — settleOnExit", () => {
  it("② 把仍 running 的任务合成 stopped 终态并带 reason", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 42 });
    reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t_live", taskType: "local_bash" });
    expect(byId(reg, "t_live")!.status).toBe("running");

    const settled = reg.settleOnExit("cli_exit");
    expect(settled).toHaveLength(1);
    const t = byId(reg, "t_live")!;
    expect(t.status).toBe("stopped");
    expect(t.settleReason).toBe("cli_exit");
    // 合成终态盖上进程退出的时钟。
    expect(t.endTime).toBe(42);
  });

  it("pending-settle（清单里消失但无终态）也被 settleOnExit 收尾", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 7 });
    reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t_gone" });
    // 清单快照里已经不含它 → reconcile 标 pending-settle（不抢跑成 orphaned）。
    reg.applyEvent({ kind: "list_changed", tasks: [] });
    expect(byId(reg, "t_gone")!.status).toBe("pending-settle");

    reg.settleOnExit("killed_by_us");
    const t = byId(reg, "t_gone")!;
    expect(t.status).toBe("stopped");
    expect(t.settleReason).toBe("killed_by_us");
  });
});

describe("BackgroundTaskRegistry — snapshot", () => {
  it("③ 返回当前全量（多任务、含终态与活任务）", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 1000 });
    reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t1", taskType: "local_bash" });
    reg.applyEvent({ kind: "started", taskId: "t2", taskType: "local_workflow" });
    reg.applyEvent({ kind: "updated", taskId: "t1", status: "completed" });

    const snap = reg.snapshot();
    expect(snap).toHaveLength(2);
    const ids = snap.map((t) => t.taskId).sort();
    expect(ids).toEqual(["t1", "t2"]);
    expect(byId(reg, "t1")!.status).toBe("completed");
    expect(byId(reg, "t2")!.status).toBe("running");
    // snapshot 是拷贝：改返回值不污染 registry 内部。
    snap[0].status = "orphaned";
    expect(reg.snapshot().find((t) => t.taskId === snap[0].taskId)!.status).not.toBe(
      "orphaned",
    );
  });
});

describe("BackgroundTaskRegistry — 进程代际隔离", () => {
  it("④ 新代同名 taskId 不吞旧代终态（各成一条）", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 1000 });
    const g1 = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "reused" });
    reg.applyEvent({ kind: "updated", taskId: "reused", status: "completed" });

    // 新进程代际：CLI ephemeral id 复用同一短串。
    const g2 = reg.beginGeneration();
    expect(g2).toBeGreaterThan(g1);
    reg.applyEvent({ kind: "started", taskId: "reused" });

    const snap = reg.snapshot();
    // 两条独立记录：旧代终态 completed + 新代 running。
    expect(snap.filter((t) => t.taskId === "reused")).toHaveLength(2);
    const g1Task = snap.find((t) => t.taskId === "reused" && t.generation === g1)!;
    const g2Task = snap.find((t) => t.taskId === "reused" && t.generation === g2)!;
    expect(g1Task.status).toBe("completed");
    expect(g2Task.status).toBe("running");
  });

  it("settleOnExit 只收尾当前代际的活任务，不动旧代终态", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 1000 });
    const g1 = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "a" });
    reg.applyEvent({ kind: "updated", taskId: "a", status: "completed" });

    reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "b" });

    const settled = reg.settleOnExit("cli_exit");
    // 只有当代 running 的 b 被收尾。
    expect(settled.map((t) => t.taskId)).toEqual(["b"]);
    expect(byId(reg, "a")!.status).toBe("completed"); // 旧代终态不被触碰
    expect(byId(reg, "b")!.status).toBe("stopped");
  });
});

describe("BackgroundTaskRegistry — fixture 回放（真值表保真）", () => {
  it("⑤ exp7 序列 changed→updated(killed)→notification 不误标 orphaned", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 9999 });
    reg.beginGeneration();
    const events = normalizeFixture("exp7-workflow-slow-terminal.jsonl");
    // 逐帧回放，并在 bash 任务从清单消失的那一刻断言它是 pending-settle 而非 orphaned。
    let assertedPendingSettle = false;
    for (const ev of events) {
      reg.applyEvent(ev);
      const bash = byId(reg, "bj4kugy5f");
      // 清单去掉 bj4kugy5f 后、其 task_updated(killed) 到达前的那一帧：pending-settle。
      if (
        ev.kind === "list_changed" &&
        bash &&
        bash.status === "pending-settle" &&
        !assertedPendingSettle
      ) {
        assertedPendingSettle = true;
      }
      // 任何时刻都不允许 reconcile 抢跑把它标成 orphaned。
      if (bash) expect(bash.status).not.toBe("orphaned");
    }
    expect(assertedPendingSettle).toBe(true);

    // 落定终态：bash 任务被 killed→stopped 覆盖到 stopped；workflow 任务 completed。
    const bash = byId(reg, "bj4kugy5f")!;
    const workflow = byId(reg, "w4kngjqsl")!;
    expect(bash.status).toBe("stopped");
    expect(bash.taskType).toBe("local_bash");
    expect(bash.toolUseId).toBe("toolu_01Bd4kChU66pMHwMERRwXawK");
    expect(workflow.status).toBe("completed");
    // 全部落定 → 没有任何活任务留待 settleOnExit。
    expect(reg.settleOnExit("cli_exit")).toHaveLength(0);
  });

  it("⑥ exp1 双 result：任务终态 completed 不被 settleOnExit 覆盖", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 5555 });
    reg.beginGeneration();
    const events = normalizeFixture("exp1-bgbash-terminal.jsonl");
    for (const ev of events) reg.applyEvent(ev);

    const task = byId(reg, "bvvyvbykg")!;
    expect(task.status).toBe("completed");

    // bash 完成触发 re-invoke 出第二个 result 帧后进程仍会退出 → settleOnExit。
    // 已终态的 completed 绝不能被合成 stopped 覆盖（否则前端会把完成的任务误标终止）。
    const settled = reg.settleOnExit("cli_exit");
    expect(settled).toHaveLength(0);
    expect(byId(reg, "bvvyvbykg")!.status).toBe("completed");
    expect(byId(reg, "bvvyvbykg")!.settleReason).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-0015 S2 加固（codex review findings）——逐条先落证红测试。
// ─────────────────────────────────────────────────────────────────────────────

describe("BackgroundTaskRegistry — 显式代际绑定（finding 1）", () => {
  it("旧代迟到帧只更新旧代记录，绝不污染新代同名 taskId", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 1000 });
    const g1 = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "reused" }, g1);
    // 新进程代际：CLI ephemeral id 复用同一短串。
    const g2 = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "reused" }, g2);

    // 旧代 g1 的一帧迟到 updated(completed)——必须显式落在 g1，不动 g2。
    reg.applyEvent({ kind: "updated", taskId: "reused", status: "completed" }, g1);

    const snap = reg.snapshot();
    const g1Task = snap.find((t) => t.taskId === "reused" && t.generation === g1)!;
    const g2Task = snap.find((t) => t.taskId === "reused" && t.generation === g2)!;
    expect(g1Task.status).toBe("completed");
    // 关键：新代 g2 不被旧代迟到帧污染。
    expect(g2Task.status).toBe("running");
  });

  it("拒绝未初始化代际（0 / 未来代）——不建记录", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 1000 });
    // 尚未 beginGeneration：currentGeneration=0。
    reg.applyEvent({ kind: "started", taskId: "x" }, 0);
    expect(reg.snapshot()).toHaveLength(0);

    const g1 = reg.beginGeneration();
    // 未来代（尚不存在）也拒绝，避免凭空建代。
    reg.applyEvent({ kind: "started", taskId: "y" }, g1 + 5);
    expect(reg.snapshot()).toHaveLength(0);

    // 合法当前代正常建条。
    reg.applyEvent({ kind: "started", taskId: "z" }, g1);
    expect(reg.snapshot().map((t) => t.taskId)).toEqual(["z"]);
  });
});

describe("BackgroundTaskRegistry — 终态单调性（finding 2）", () => {
  it("settleOnExit 后迟到的 started 帧不得复活任务", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 100 });
    const g = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t" }, g);
    reg.settleOnExit("cli_exit", g);
    expect(byId(reg, "t")!.status).toBe("stopped");

    // 进程死后 parser 冲刷出的迟到 started 不得把 stopped 拉回 running。
    reg.applyEvent({ kind: "started", taskId: "t" }, g);
    expect(byId(reg, "t")!.status).toBe("stopped");
  });

  it("终态后迟到的 updated(running) 帧不得复活任务", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 100 });
    const g = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t" }, g);
    reg.applyEvent({ kind: "updated", taskId: "t", status: "completed" }, g);
    reg.applyEvent({ kind: "updated", taskId: "t", status: "running" }, g);
    expect(byId(reg, "t")!.status).toBe("completed");
  });

  it("终态→终态（CLI 权威 killed→stopped）仍允许覆盖", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 100 });
    const g = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t" }, g);
    reg.applyEvent({ kind: "updated", taskId: "t", status: "killed" }, g);
    expect(byId(reg, "t")!.status).toBe("killed");
    reg.applyEvent({ kind: "notification", taskId: "t", status: "stopped" }, g);
    expect(byId(reg, "t")!.status).toBe("stopped");
  });

  it("rejected transition 触发观测回调（logBridge 可挂）", () => {
    const rejected: Array<{ taskId?: string; from: string; to: string }> = [];
    const reg = new BackgroundTaskRegistry({
      now: () => 100,
      onRejectedTransition: (info) =>
        rejected.push({ taskId: info.taskId, from: info.from, to: info.to }),
    });
    const g = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t" }, g);
    reg.applyEvent({ kind: "updated", taskId: "t", status: "completed" }, g);
    reg.applyEvent({ kind: "updated", taskId: "t", status: "running" }, g);
    expect(rejected).toEqual([{ taskId: "t", from: "completed", to: "running" }]);
  });
});

describe("BackgroundTaskRegistry — 状态词汇归一化（finding 5）", () => {
  it("failed 纳入终态：settleOnExit 不覆盖成 stopped", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 100 });
    const g = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t" }, g);
    reg.applyEvent({ kind: "updated", taskId: "t", status: "failed" }, g);
    expect(byId(reg, "t")!.status).toBe("failed");

    const settled = reg.settleOnExit("cli_exit", g);
    expect(settled).toHaveLength(0);
    expect(byId(reg, "t")!.status).toBe("failed");
  });

  it("done → completed 集中归一化", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 100 });
    const g = reg.beginGeneration();
    reg.applyEvent({ kind: "started", taskId: "t" }, g);
    reg.applyEvent({ kind: "notification", taskId: "t", status: "done" }, g);
    expect(byId(reg, "t")!.status).toBe("completed");
  });
});

describe("BackgroundTaskRegistry — snapshot 深拷贝 usage（finding 6）", () => {
  it("snapshot/settleOnExit 返回的 usage 是深拷贝，改它不污染内部", () => {
    const reg = new BackgroundTaskRegistry({ now: () => 100 });
    const g = reg.beginGeneration();
    reg.applyEvent(
      { kind: "notification", taskId: "t", status: "completed", usage: { total_tokens: 10 } },
      g,
    );
    const snap = reg.snapshot();
    snap[0].usage!.total_tokens = 999;
    // 内部 usage 不受快照拷贝的突变影响。
    expect(reg.snapshot()[0].usage!.total_tokens).toBe(10);
  });
});
