import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

// PRD-0015 S5 —— 上游终态签名探针（回归锁）。
//
// CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS 满上限后，claude CLI 在子进程内强杀全部后台
// 任务并吐出一组终态 system 帧（见 ADR-015 / 事故日志）。本仓的任务可见性链路（S1 seam
// 归一化 → S2 registry → S4 卡片）依赖这些帧的形状与"终态词汇"（task_updated 的
// patch.status="killed"、task_notification 的 status="stopped"）。fixture 是本机真跑
// `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5000 claude -p ...`（claude 2.1.210）采集、脱敏
// （去 session_id/uuid/绝对路径）后的原样 NDJSON。
//
// 这是"上游改口 CI 先红"的探针：若某天 Claude Code 升级把 killed→terminated 或
// task_updated→task_ended，本测试立刻红，逼我们在产线复发前修 parser，而不是让终态
// 静默丢失重演"被杀无提示"。codex/fixtures.test.ts 是同类 fixture 质量门的先例。

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(
  __dirname,
  "..",
  "__fixtures__",
  "claude-tasks",
  "exp2-ceiling-terminal.jsonl",
);

interface TaskFrame {
  type: string;
  subtype?: string;
  task_id?: string;
  tool_use_id?: string;
  status?: string;
  patch?: { status?: string; end_time?: number };
  tasks?: Array<{ task_id?: string; task_type?: string; description?: string }>;
  [k: string]: unknown;
}

function loadFrames(): TaskFrame[] {
  const raw = readFileSync(FIXTURE, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as TaskFrame);
}

describe("ceiling 终态签名探针 (PRD-0015 S5 上游回归锁)", () => {
  it("fixture 每行可 parse，且全部是 system 帧", () => {
    const frames = loadFrames();
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.type).toBe("system");
      expect(typeof f.subtype).toBe("string");
    }
  });

  it("脱敏彻底：不含 session_id / uuid / 绝对路径", () => {
    const raw = readFileSync(FIXTURE, "utf8");
    expect(raw).not.toContain("session_id");
    expect(raw).not.toContain("uuid");
    // 绝对路径（/Users, /private, /home）不得残留；output_file 已换成 <SCRATCH> 占位。
    expect(raw).not.toMatch(/"\/(Users|private|home)\//);
  });

  it("任务生命周期起点帧齐全：task_started 关联 tool_use_id", () => {
    const started = loadFrames().find((f) => f.subtype === "task_started");
    expect(started).toBeDefined();
    expect(typeof started!.task_id).toBe("string");
    // launch↔lifecycle 关联的缝合键（S1 seam 归一化要靠它把卡片挂回 tool_use chip）。
    expect(typeof started!.tool_use_id).toBe("string");
    expect(started!.tool_use_id).toMatch(/^toolu_/);
  });

  it("锁上游终态词汇 killed：task_updated.patch.status === 'killed'", () => {
    const updated = loadFrames().find((f) => f.subtype === "task_updated");
    expect(updated).toBeDefined();
    expect(updated!.task_id).toBe("bn8y7ej1w");
    expect(updated!.patch?.status).toBe("killed");
    expect(typeof updated!.patch?.end_time).toBe("number");
  });

  it("锁上游终态词汇 stopped：task_notification.status === 'stopped'", () => {
    const notif = loadFrames().find((f) => f.subtype === "task_notification");
    expect(notif).toBeDefined();
    expect(notif!.status).toBe("stopped");
    // notification 也带 tool_use_id，能把终态挂回同一个 launch 记录。
    expect(notif!.tool_use_id).toMatch(/^toolu_/);
  });

  it("background_tasks_changed 在终止后清空 tasks（无残留活任务）", () => {
    const changed = loadFrames().filter((f) => f.subtype === "background_tasks_changed");
    // 至少一条起点（非空）+ 一条终点（清空）。
    expect(changed.length).toBeGreaterThanOrEqual(2);
    expect(changed[changed.length - 1].tasks).toEqual([]);
  });
});
