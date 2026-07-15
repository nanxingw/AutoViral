/**
 * BackgroundTaskRegistry — PRD-0015 S2 的深模块：把 ChatBackend seam（S1）归一化出来的
 * 后台任务生命周期事件收敛成一张"活着的、可并发变化的任务表"，供重连 snapshot（S3）与
 * 任务卡片（S4）消费。这是 030/031 事故的结构性修复的核心：进程退出时它替仍在跑的任务
 * 合成终态并给出 reason，"被杀无提示"从此有一处权威登记。
 *
 * 设计守则：
 *   - **纯逻辑、零 I/O、时钟注入**——最好隔离的单测对象；不碰文件、不碰 socket、不裸调
 *     Date.now（构造注入 `now`）。广播交给上层（S3），本模块只维护状态。
 *   - **同 taskId upsert + 状态机**——一个任务在其生命周期里只有一条记录，后到的帧覆盖式
 *     推进它的状态与元数据（不新建重复条）。
 *   - **进程代际隔离**——claude CLI 的后台任务 id 是 per-process ephemeral 短串（`bvvyvbykg`），
 *     不同 turn 的新进程会复用同一串。registry 按 `generation::taskId` 键，旧代任务不被新代
 *     同名事件复活/吞并（`beginGeneration()` 每次 spawnCli 前推进代号）。
 *
 * 状态机（真值表来自九次受控实验，见 __fixtures__/claude-tasks/README.md）：
 *
 *   started ─────────────▶ running
 *                            │  list_changed 里消失且尚无终态
 *                            ▼
 *                       pending-settle ──┐
 *                            │           │  updated/notification 到达
 *   running ────────────────┼───────────┼──▶ completed | killed | stopped
 *   （updated/notification 携带的 status 透传覆盖，killed→stopped 这种终态→终态的
 *     覆盖是 CLI 权威序列，允许）
 *                            │
 *                            └── settleOnExit(reason) ──▶ stopped（合成终态，带 reason；
 *                                只作用于「非终态」任务，绝不覆盖已 completed/killed/stopped）
 *
 * `orphaned` 是保留的终态词汇（S7 journal 打捞才产生）；本模块的 reconcile 绝不抢跑把
 * "清单里消失但还没等到终态帧"的任务标成 orphaned——exp7 实录证明落定顺序可能是
 * changed(去掉) → updated(killed) → notification(stopped)，抢跑会误标。
 */

import type { ChatBackgroundTaskEvent } from "../chat-backends/types.js";

/** 任务状态词汇。running/pending-settle 为「活」（可被 settleOnExit 收尾）；
 *  completed/killed/stopped/orphaned 为「终态」（不可被合成终态覆盖）。 */
export type BackgroundTaskStatus =
  | "running"
  | "pending-settle"
  | "completed"
  | "killed"
  | "stopped"
  | "orphaned";

/** 终态集合——一旦落入，settleOnExit 的合成终态不再覆盖它。注意 CLI 权威帧
 *  （applyEvent 的 updated/notification）仍可做终态→终态的覆盖（killed→stopped）。 */
const TERMINAL_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  "completed",
  "killed",
  "stopped",
  "orphaned",
]);

export function isTerminalStatus(status: BackgroundTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** registry 对外暴露的一条任务快照（拷贝，改它不污染内部状态）。 */
export interface BackgroundTaskSnapshot {
  /** claude 的 ephemeral 任务 id（进程内唯一，跨进程可能复用）。 */
  taskId: string;
  /** 进程代际——同 taskId 不同 generation 是两条独立记录。 */
  generation: number;
  status: BackgroundTaskStatus;
  taskType?: string;
  description?: string;
  /** 关联启动它的 assistant tool_use block。 */
  toolUseId?: string;
  summary?: string;
  outputFile?: string;
  /** 用量/计数（Workflow notification.usage）。 */
  usage?: Record<string, number>;
  /** 起点时钟（started/首次入表时注入的 now）。 */
  startTime?: number;
  /** 终态时钟（updated.end_time；或 settleOnExit 合成时注入的 now）。 */
  endTime?: number;
  /** 被 settleOnExit 合成终态时的原因（cli_exit | killed_by_us | …）；CLI 自然终态无此字段。 */
  settleReason?: string;
}

/** 内部可变记录。 */
interface TaskRecord extends BackgroundTaskSnapshot {}

export interface BackgroundTaskRegistryOptions {
  /** 注入时钟——生产传 `() => Date.now()`，测试传固定值。 */
  now?: () => number;
}

export class BackgroundTaskRegistry {
  private readonly now: () => number;
  /** 键 = `${generation}::${taskId}`，值 = 可变记录。插入顺序即 snapshot 顺序。 */
  private readonly tasks = new Map<string, TaskRecord>();
  private currentGeneration = 0;

  constructor(options: BackgroundTaskRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** 每次 spawnCli 前调用：推进进程代号并返回新代号。新代事件不会复活/吞并旧代任务。 */
  beginGeneration(): number {
    this.currentGeneration += 1;
    return this.currentGeneration;
  }

  /** 当前代号（尚未 beginGeneration 时为 0）。 */
  get generation(): number {
    return this.currentGeneration;
  }

  private keyFor(taskId: string, generation: number): string {
    return `${generation}::${taskId}`;
  }

  /** 取当前代的记录（不存在返回 undefined）。 */
  private current(taskId: string): TaskRecord | undefined {
    return this.tasks.get(this.keyFor(taskId, this.currentGeneration));
  }

  /** upsert 当前代的记录：不存在则以 running 起点建条并注入 startTime。 */
  private ensure(taskId: string, seed: Partial<TaskRecord>): TaskRecord {
    const key = this.keyFor(taskId, this.currentGeneration);
    let rec = this.tasks.get(key);
    if (!rec) {
      rec = {
        taskId,
        generation: this.currentGeneration,
        status: "running",
        startTime: this.now(),
      };
      this.tasks.set(key, rec);
    }
    // 覆盖式合并已知元数据字段（undefined 不清空既有值）。
    for (const key of Object.keys(seed) as (keyof TaskRecord)[]) {
      const value = seed[key];
      if (value !== undefined) (rec as Record<keyof TaskRecord, unknown>)[key] = value;
    }
    return rec;
  }

  /**
   * 应用一个 S1 归一化后台任务事件（同 taskId upsert + 状态机推进）。总是作用于
   * 【当前代际】——所以在 beginGeneration 之后到达的事件不会误入旧代记录。
   */
  applyEvent(event: ChatBackgroundTaskEvent): void {
    switch (event.kind) {
      case "started": {
        if (!event.taskId) return;
        this.ensure(event.taskId, {
          status: "running",
          toolUseId: event.toolUseId,
          taskType: event.taskType,
          description: event.description,
        });
        return;
      }

      case "updated": {
        if (!event.taskId) return;
        const rec = this.ensure(event.taskId, {
          taskType: event.taskType,
          description: event.description,
        });
        // status 透传覆盖（running/completed/killed…）；终态→终态的覆盖是 CLI 权威序列，允许。
        if (event.status) rec.status = event.status as BackgroundTaskStatus;
        if (event.endTime !== undefined) rec.endTime = event.endTime;
        return;
      }

      case "notification": {
        if (!event.taskId) return;
        const rec = this.ensure(event.taskId, {
          toolUseId: event.toolUseId,
          taskType: event.taskType,
          description: event.description,
          summary: event.summary,
          outputFile: event.outputFile,
          usage: event.usage,
        });
        if (event.status) rec.status = event.status as BackgroundTaskStatus;
        return;
      }

      case "list_changed": {
        this.reconcile(event.tasks ?? []);
        return;
      }
    }
  }

  /**
   * 用 background_tasks_changed 的全量快照对账当前代的任务集合：
   *   - 快照里出现、registry 尚未知的任务 → 建条（running）。
   *   - 快照里出现、已知的任务 → 补元数据（不动状态；避免把已落定的终态又拉回 running）。
   *   - registry 里【仍活】（running）但快照里【消失】的任务 → 标 pending-settle。
   * 关键纪律：消失即标 pending-settle，【绝不】抢跑标 orphaned——真实落定序是
   * changed(去掉) → updated(killed) → notification(stopped)（exp7），紧跟的终态帧会把它
   * 收敛到真终态；若进程先死，settleOnExit 兜底。已 pending-settle 的保持不变；已终态的不触碰。
   */
  private reconcile(snapshotTasks: NonNullable<ChatBackgroundTaskEvent["tasks"]>): void {
    const present = new Set<string>();
    for (const t of snapshotTasks) {
      if (!t.taskId) continue;
      present.add(t.taskId);
      const existing = this.current(t.taskId);
      if (!existing) {
        this.ensure(t.taskId, {
          status: "running",
          taskType: t.taskType,
          description: t.description,
        });
      } else {
        // 已知任务：只补元数据，不动状态。
        this.ensure(t.taskId, { taskType: t.taskType, description: t.description });
      }
    }
    // 当前代里仍 running 却从清单消失的任务 → pending-settle（不抢跑 orphaned）。
    for (const rec of this.tasks.values()) {
      if (rec.generation !== this.currentGeneration) continue;
      if (rec.status === "running" && !present.has(rec.taskId)) {
        rec.status = "pending-settle";
      }
    }
  }

  /**
   * 进程退出兜底：把【指定代际（默认当前代）】仍未落定（running / pending-settle）的任务
   * 合成 `stopped` 终态并标注 reason。已终态（completed/killed/stopped/orphaned）的任务
   * 绝不被覆盖（exp1 双 result：任务已 completed，退出不该把它误标终止）。
   * 返回被本次收尾的任务快照，供上层 logBridge / 广播。
   */
  settleOnExit(reason: string, generation: number = this.currentGeneration): BackgroundTaskSnapshot[] {
    const settled: BackgroundTaskSnapshot[] = [];
    const at = this.now();
    for (const rec of this.tasks.values()) {
      if (rec.generation !== generation) continue;
      if (isTerminalStatus(rec.status)) continue;
      rec.status = "stopped";
      rec.settleReason = reason;
      if (rec.endTime === undefined) rec.endTime = at;
      settled.push({ ...rec });
    }
    return settled;
  }

  /** 全量快照（拷贝；插入顺序）。供重连 snapshot 与查询。 */
  snapshot(): BackgroundTaskSnapshot[] {
    return [...this.tasks.values()].map((rec) => ({ ...rec }));
  }
}
