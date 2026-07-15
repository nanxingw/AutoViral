import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { claudeBackend } from "../claude.js";
import type {
  ChatBackgroundTaskEvent,
  ChatRawMessage,
  ChatStreamCallbacks,
} from "../types.js";

// PRD-0015 S1 —— ChatBackend seam 后台任务生命周期归一化契约测试。
//
// claude print-mode 会把后台任务的生命周期以一组 `system` 帧写进 stream-json stdout
// （background_tasks_changed / task_started / task_updated / task_notification）。030
// 事故的根因之一就是这些帧被当作无名 cli_event 静默转发、前端零可见性。S1 在 seam
// 上新增 provider-agnostic 的 onBackgroundTask 回调，把这些帧翻译成归一化事件（保留
// taskId、tool_use id 关联、描述、状态、计数、usage），claude 后端翻译、codex 后端空
// 实现，registry 接管留给 S2。
//
// 本测试直接喂真实抓取（脱敏）的 fixture 流入 createLineParser：
//   ① 各 task 帧触发 onBackgroundTask 且字段映射正确（覆盖 local_bash 完成 / 上限强杀
//      killed+stopped / local_workflow 完成带 usage 三种真实形状）；
//   ② 未注册 onBackgroundTask 时行为与现状逐字节一致（task 帧仍走 onOther，向后兼容）；
//   ③ 注册后 task 帧【同时】走 onOther（cli_event 转发不回归，锁死这个语义）；
//   ④ tool_use_id 关联可用（started↔notification 同键，能把终态挂回 tool_use chip）。

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "__fixtures__", "claude-tasks");

function fixtureLines(name: string): string[] {
  const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

/** A recorder that captures both the normalized bg events and the raw onOther
 *  fallthrough, so a single fixture run proves both new behavior and no
 *  regression of the existing cli_event forwarding. `bgOff` builds the SAME
 *  callbacks WITHOUT onBackgroundTask (backward-compat baseline). */
function recorder(opts: { bgOff?: boolean } = {}) {
  const bg: Array<{ event: ChatBackgroundTaskEvent; msg: ChatRawMessage }> = [];
  const other: ChatRawMessage[] = [];
  const raw: ChatRawMessage[] = [];
  const cb: ChatStreamCallbacks = {
    onRawMessage: (m) => raw.push(m),
    onSessionId: () => {},
    onText: () => {},
    onThinking: () => {},
    onToolUse: () => {},
    onToolResult: () => {},
    onTurnComplete: () => {},
    onOther: (m) => other.push(m),
    ...(opts.bgOff
      ? {}
      : { onBackgroundTask: (event, msg) => bg.push({ event, msg }) }),
  };
  return { bg, other, raw, cb };
}

function feed(cb: ChatStreamCallbacks, name: string): void {
  const p = claudeBackend.createLineParser(cb);
  for (const l of fixtureLines(name)) p.push(l + "\n");
}

describe("claude task-frame 归一化 (PRD-0015 S1)", () => {
  it("① local_bash 完成生命周期 → 归一化事件序列 + 字段映射", () => {
    const r = recorder();
    feed(r.cb, "exp1-bgbash-terminal.jsonl");
    const kinds = r.bg.map((e) => e.event.kind);
    expect(kinds).toEqual([
      "list_changed",
      "started",
      "list_changed",
      "updated",
      "notification",
    ]);

    const listStart = r.bg[0].event;
    expect(listStart.tasks).toEqual([
      {
        taskId: "bvvyvbykg",
        taskType: "local_bash",
        description: "Sleep 8 seconds then echo bgdone in background",
      },
    ]);

    const started = r.bg[1].event;
    expect(started).toMatchObject({
      kind: "started",
      taskId: "bvvyvbykg",
      toolUseId: "toolu_015f7QP6AYp2Gu2791Su5X2o",
      taskType: "local_bash",
      description: "Sleep 8 seconds then echo bgdone in background",
    });

    // drain 快照：tasks 清空。
    expect(r.bg[2].event).toMatchObject({ kind: "list_changed", tasks: [] });

    const updated = r.bg[3].event;
    expect(updated).toMatchObject({
      kind: "updated",
      taskId: "bvvyvbykg",
      status: "completed",
      endTime: 1784114076921,
    });

    const notif = r.bg[4].event;
    expect(notif).toMatchObject({
      kind: "notification",
      taskId: "bvvyvbykg",
      toolUseId: "toolu_015f7QP6AYp2Gu2791Su5X2o",
      status: "completed",
    });
    expect(notif.outputFile).toContain("bvvyvbykg.output");
    expect(notif.summary).toContain("completed");
  });

  it("① 上限强杀 → 终态词汇 killed/stopped 正确归一化 (exp2)", () => {
    const r = recorder();
    feed(r.cb, "exp2-ceiling-terminal.jsonl");
    const updated = r.bg.find((e) => e.event.kind === "updated")!.event;
    expect(updated.status).toBe("killed");
    expect(updated.endTime).toBe(1784114111794);
    const notif = r.bg.find((e) => e.event.kind === "notification")!.event;
    expect(notif.status).toBe("stopped");
  });

  it("① Workflow 任务 → task_type=local_workflow + usage 计数归一化 (exp3)", () => {
    const r = recorder();
    feed(r.cb, "exp3-workflow-terminal.jsonl");
    const started = r.bg.find((e) => e.event.kind === "started")!.event;
    expect(started.taskType).toBe("local_workflow");
    expect(started.description).toBe("fixture probe");
    const notif = r.bg.find((e) => e.event.kind === "notification")!.event;
    expect(notif.status).toBe("completed");
    // 用量字段透传（decision #2：保留计数与用量）。
    expect(notif.usage).toEqual({ total_tokens: 0, tool_uses: 0, duration_ms: 6 });
  });

  it("① 归一化事件第二参保留原始帧引用", () => {
    const r = recorder();
    feed(r.cb, "exp1-bgbash-terminal.jsonl");
    for (const { event, msg } of r.bg) {
      expect(msg.type).toBe("system");
      if (event.kind === "started") {
        expect(msg.subtype).toBe("task_started");
        // 原始帧完整可读（下游若需 workflow_name/prompt 等扩展字段直接取 msg）。
        expect((msg as Record<string, unknown>).task_id).toBe(event.taskId);
      }
    }
  });

  it("② 未注册 onBackgroundTask：task 帧仍全部走 onOther（向后兼容）", () => {
    const r = recorder({ bgOff: true });
    feed(r.cb, "exp1-bgbash-terminal.jsonl");
    // 5 条全是 task-class system 帧；旧行为下它们逐条落 onOther。
    expect(r.other).toHaveLength(5);
    expect(r.other.map((m) => m.subtype)).toEqual([
      "background_tasks_changed",
      "task_started",
      "background_tasks_changed",
      "task_updated",
      "task_notification",
    ]);
    // onRawMessage 也照旧对每帧先触发。
    expect(r.raw).toHaveLength(5);
  });

  it("③ 注册后 task 帧【同时】走 onOther（cli_event 转发不回归）", () => {
    const r = recorder();
    feed(r.cb, "exp1-bgbash-terminal.jsonl");
    // 新回调触发 5 次…
    expect(r.bg).toHaveLength(5);
    // …且 onOther 仍收到同样 5 帧（web 侧 cli_event 消费不被抢走）。
    expect(r.other).toHaveLength(5);
    expect(r.other.map((m) => m.subtype)).toEqual([
      "background_tasks_changed",
      "task_started",
      "background_tasks_changed",
      "task_updated",
      "task_notification",
    ]);
  });

  it("④ tool_use_id 关联：started 与 notification 同键（终态可挂回 tool_use chip）", () => {
    const r = recorder();
    feed(r.cb, "exp3-workflow-terminal.jsonl");
    const started = r.bg.find((e) => e.event.kind === "started")!.event;
    const notif = r.bg.find((e) => e.event.kind === "notification")!.event;
    expect(started.toolUseId).toBeDefined();
    expect(started.toolUseId).toMatch(/^toolu_/);
    expect(notif.toolUseId).toBe(started.toolUseId);
    expect(notif.taskId).toBe(started.taskId);
  });

  it("非 task 的 system.init 帧不触发 onBackgroundTask（不误伤既有帧）", () => {
    const r = recorder();
    const p = claudeBackend.createLineParser(r.cb);
    p.push(JSON.stringify({ type: "system", subtype: "init", session_id: "cli-1" }) + "\n");
    expect(r.bg).toHaveLength(0);
  });
});
