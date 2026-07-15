import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

// PRD-0015 S5（修正包）—— 任务帧 **parser 契约回归**（不是上游行为探测器）。
//
// 诚实定位（codex review 后续）：本测试锁的是**已采集 fixture 里任务生命周期 system 帧的
// 形状**——S1 seam 归一化（normalizeBackgroundTaskFrame）依赖的字段名与终态词汇
// （task_updated.patch.status、task_notification.status、background_tasks_changed.tasks[]）。
// 它是一道"给定这些真跑采集的帧，我们 parser 期望的形状仍成立"的契约回归，只在有人**重采**
// fixture 时才应变动。
//
// 它 **不**、也**无法**自动探测上游 CLI 漂移：CI 环境没有 claude 登录凭据，跑不了真
// `claude -p`，所以"上游把 killed→terminated / task_updated→task_ended 改口"这类漂移
// **只能靠手动重采**触发红——重采脚本 `scripts/probes/recapture-ceiling.sh`（升 claude CLI
// 后跑一次，diff 新旧 fixture）。本测试的价值是：重采后若帧形状变了，这里立刻红，逼在产线
// 复发"被杀无提示"前修 parser。codex `__fixtures__/codex/fixtures.test.ts` 是同类 fixture
// 质量门的先例。

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "__fixtures__", "claude-tasks");
const fixturePath = (name: string) => join(FIXTURE_DIR, name);

interface TaskFrame {
  type: string;
  subtype?: string;
  task_id?: string;
  tool_use_id?: string;
  task_type?: string;
  status?: string;
  patch?: { status?: string; end_time?: number };
  usage?: Record<string, number>;
  tasks?: Array<{ task_id?: string; task_type?: string; description?: string }>;
  [k: string]: unknown;
}

function loadFrames(name: string): TaskFrame[] {
  const raw = readFileSync(fixturePath(name), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as TaskFrame);
}

// 全体任务 fixture（bash/workflow × 正常完成/上限强杀/无限等待）。
const ALL_FIXTURES = [
  "exp1-bgbash-terminal.jsonl",
  "exp2-ceiling-terminal.jsonl",
  "exp3-workflow-terminal.jsonl",
  "exp7-workflow-slow-terminal.jsonl",
  "exp8-workflow-ceiling15k-terminal.jsonl",
  "exp9-workflow-ceiling0-terminal.jsonl",
] as const;

describe("任务帧 parser 契约回归 (PRD-0015 S5)", () => {
  it("每个 fixture 每行可 parse，且全部是任务类 system 帧", () => {
    const TASK_SUBTYPES = new Set([
      "background_tasks_changed",
      "task_started",
      "task_updated",
      "task_notification",
    ]);
    for (const name of ALL_FIXTURES) {
      const frames = loadFrames(name);
      expect(frames.length, name).toBeGreaterThan(0);
      for (const f of frames) {
        expect(f.type, name).toBe("system");
        expect(typeof f.subtype, name).toBe("string");
        expect(TASK_SUBTYPES.has(f.subtype!), `${name} subtype=${f.subtype}`).toBe(true);
      }
    }
  });

  it("脱敏彻底：所有 fixture 不含 session_id / uuid / 任意平台绝对路径", () => {
    // LOW #6 —— 路径 pattern 扩到 /tmp | /var | /Volumes | Windows 盘符，不只 /Users|/private|/home。
    const ABS_PATH_RX = /"(\/(Users|private|home|tmp|var|Volumes|opt|etc|root)\/|[A-Za-z]:\\\\)/;
    for (const name of ALL_FIXTURES) {
      const raw = readFileSync(fixturePath(name), "utf8");
      expect(raw, name).not.toContain("session_id");
      expect(raw, name).not.toContain("uuid");
      // output_file 已换成 <SCRATCH> 占位；任意平台绝对路径都不得残留。
      expect(ABS_PATH_RX.test(raw), `${name} leaked abs path`).toBe(false);
    }
  });

  // ── exp2：local_bash 型任务被小 ceiling 强杀的终态签名（既有回归，保留）───────────
  describe("exp2 · local_bash 上限强杀终态", () => {
    const frames = () => loadFrames("exp2-ceiling-terminal.jsonl");

    it("task_started 关联 tool_use_id（launch↔lifecycle 缝合键）", () => {
      const started = frames().find((f) => f.subtype === "task_started");
      expect(started).toBeDefined();
      expect(typeof started!.task_id).toBe("string");
      expect(started!.tool_use_id).toMatch(/^toolu_/);
    });

    it("终态词汇 killed：task_updated.patch.status === 'killed'", () => {
      const updated = frames().find((f) => f.subtype === "task_updated");
      expect(updated).toBeDefined();
      expect(updated!.task_id).toBe("bn8y7ej1w");
      expect(updated!.patch?.status).toBe("killed");
      expect(typeof updated!.patch?.end_time).toBe("number");
    });

    it("终态词汇 stopped：task_notification.status === 'stopped'，带 tool_use_id", () => {
      const notif = frames().find((f) => f.subtype === "task_notification");
      expect(notif).toBeDefined();
      expect(notif!.status).toBe("stopped");
      expect(notif!.tool_use_id).toMatch(/^toolu_/);
    });

    it("background_tasks_changed 在终止后清空 tasks（无残留活任务）", () => {
      const changed = frames().filter((f) => f.subtype === "background_tasks_changed");
      expect(changed.length).toBeGreaterThanOrEqual(2);
      expect(changed[changed.length - 1].tasks).toEqual([]);
    });
  });

  // ── exp8：local_workflow 型任务被有限 ceiling(15k) 强杀 ─────────────────────────
  describe("exp8 · local_workflow 上限强杀终态", () => {
    const frames = () => loadFrames("exp8-workflow-ceiling15k-terminal.jsonl");

    it("快照里出现 local_workflow 任务类型", () => {
      const changed = frames().find((f) => f.subtype === "background_tasks_changed");
      expect(changed!.tasks!.some((t) => t.task_type === "local_workflow")).toBe(true);
    });

    it("workflow 被上限强杀：某 task_updated.patch.status === 'killed'，终态通知 stopped", () => {
      const killed = frames().filter(
        (f) => f.subtype === "task_updated" && f.patch?.status === "killed",
      );
      expect(killed.length).toBeGreaterThanOrEqual(1);
      const stopped = frames().filter(
        (f) => f.subtype === "task_notification" && f.status === "stopped",
      );
      expect(stopped.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── exp7 / exp9：workflow 自然完成（无限等待）+ 嵌套 local_bash 上卷 ──────────────
  describe("exp7 / exp9 · workflow 自然完成 + 嵌套 bash 上卷", () => {
    for (const name of [
      "exp7-workflow-slow-terminal.jsonl",
      "exp9-workflow-ceiling0-terminal.jsonl",
    ] as const) {
      it(`${name}：workflow 走到 completed（非 killed），带 usage 计数`, () => {
        const completedNotif = loadFrames(name).find(
          (f) => f.subtype === "task_notification" && f.status === "completed",
        );
        expect(completedNotif, `${name} 缺 completed 终态通知`).toBeDefined();
        // Workflow 终态通知带用量计数（total_tokens / tool_uses / duration_ms）。
        expect(completedNotif!.usage).toBeDefined();
        expect(typeof completedNotif!.usage!.total_tokens).toBe("number");
        expect(typeof completedNotif!.usage!.duration_ms).toBe("number");
      });

      it(`${name}：嵌套 local_bash 任务上卷到外层帧流（task_started task_type=local_bash）`, () => {
        // "嵌套上卷"契约：workflow 内 subagent 的 bash 任务出现在外层进程的帧流里。
        const nested = loadFrames(name).find(
          (f) => f.subtype === "task_started" && f.task_type === "local_bash",
        );
        expect(nested, `${name} 缺嵌套 local_bash task_started`).toBeDefined();
        expect(nested!.tool_use_id).toMatch(/^toolu_/);
      });

      it(`${name}：终点 background_tasks_changed 清空（tasks:[] = 全部 drain）`, () => {
        const changed = loadFrames(name).filter(
          (f) => f.subtype === "background_tasks_changed",
        );
        expect(changed[changed.length - 1].tasks).toEqual([]);
      });
    }
  });
});
