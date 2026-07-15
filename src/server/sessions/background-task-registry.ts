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
 *  completed/killed/stopped/failed/orphaned 为「终态」（不可被合成终态覆盖，也不可回退到活）。 */
export type BackgroundTaskStatus =
  | "running"
  | "pending-settle"
  | "completed"
  | "killed"
  | "stopped"
  | "failed"
  | "orphaned";

/** 终态集合——一旦落入，settleOnExit 的合成终态不再覆盖它，且任何 non-terminal 覆盖被拒
 *  （终态单调性）。注意 CLI 权威帧仍可做终态→终态的覆盖（killed→stopped）。`failed` 也算
 *  终态（否则退出兜底会把它误标 stopped）。 */
const TERMINAL_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  "completed",
  "killed",
  "stopped",
  "failed",
  "orphaned",
]);

export function isTerminalStatus(status: BackgroundTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** CLI 上游状态词的同义归一化（集中一处，避免各分支各自 as-cast）。未识别的原样透传
 *  （type 注释明说「透传不穷举」，S5 探针负责在上游改口时先红）。 */
const STATUS_ALIASES: Readonly<Record<string, BackgroundTaskStatus>> = {
  done: "completed",
  complete: "completed",
  completed: "completed",
  success: "completed",
  succeeded: "completed",
  cancelled: "killed",
  canceled: "killed",
  error: "failed",
  errored: "failed",
  failure: "failed",
};

export function normalizeStatus(raw: string): BackgroundTaskStatus {
  const alias = STATUS_ALIASES[raw.toLowerCase()];
  return alias ?? (raw as BackgroundTaskStatus);
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

export interface RejectedTransition {
  taskId?: string;
  generation: number;
  /** 被拒的当前（终态）状态。 */
  from: BackgroundTaskStatus;
  /** 被拒的目标（non-terminal）状态。 */
  to: BackgroundTaskStatus;
}

export interface BackgroundTaskRegistryOptions {
  /** 注入时钟——生产传 `() => Date.now()`，测试传固定值。 */
  now?: () => number;
  /** 终态→non-terminal 的转换被拒时的观测钩子（生产接 logBridge，保持模块零 I/O）。 */
  onRejectedTransition?: (info: RejectedTransition) => void;
}

export class BackgroundTaskRegistry {
  private readonly now: () => number;
  private readonly onRejectedTransition?: (info: RejectedTransition) => void;
  /** 键 = `${generation}::${taskId}`，值 = 可变记录。插入顺序即 snapshot 顺序。 */
  private readonly tasks = new Map<string, TaskRecord>();
  private currentGeneration = 0;

  constructor(options: BackgroundTaskRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onRejectedTransition = options.onRejectedTransition;
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

  /** 合法的、已初始化的代际：`[1, currentGeneration]`。0（未 begin）与未来代都拒。 */
  private isLiveGeneration(generation: number): boolean {
    return generation >= 1 && generation <= this.currentGeneration;
  }

  private keyFor(taskId: string, generation: number): string {
    return `${generation}::${taskId}`;
  }

  /** 守卫式状态推进（终态单调性）：终态→non-terminal 一律拒绝并走观测钩子；其余照写
   *  （含 CLI 权威的终态→终态 killed→stopped）。 */
  private transition(rec: TaskRecord, next: BackgroundTaskStatus): void {
    if (rec.status === next) return;
    if (isTerminalStatus(rec.status) && !isTerminalStatus(next)) {
      this.onRejectedTransition?.({
        taskId: rec.taskId,
        generation: rec.generation,
        from: rec.status,
        to: next,
      });
      return;
    }
    rec.status = next;
  }

  /** upsert 【指定代】的记录：不存在则以 running 起点建条并注入 startTime。只合并元数据，
   *  状态推进一律走 {@link transition}（保持终态单调性）。 */
  private ensure(
    taskId: string,
    generation: number,
    seed: Partial<Omit<TaskRecord, "status">>,
  ): TaskRecord {
    const key = this.keyFor(taskId, generation);
    let rec = this.tasks.get(key);
    if (!rec) {
      rec = {
        taskId,
        generation,
        status: "running",
        startTime: this.now(),
      };
      this.tasks.set(key, rec);
    }
    // 覆盖式合并已知元数据字段（undefined 不清空既有值）。status 不走这里——见 transition。
    const target = rec as unknown as Record<string, unknown>;
    for (const k of Object.keys(seed) as (keyof typeof seed)[]) {
      const value = seed[k];
      if (value !== undefined) target[k as string] = value;
    }
    return rec;
  }

  /**
   * 应用一个 S1 归一化后台任务事件（同 taskId upsert + 状态机推进）。作用于【显式传入的
   * 代际】（默认当前代）——ws-bridge 在 onBackgroundTask 闭包里捕获 spawn 时的 generation
   * 并传入，使旧进程 parser 冲刷出的迟到帧显式落回旧代、绝不污染新代同名 taskId。未初始化
   * 代际（0 / 未来代）直接拒绝，不凭空建代。
   */
  applyEvent(
    event: ChatBackgroundTaskEvent,
    generation: number = this.currentGeneration,
  ): void {
    if (!this.isLiveGeneration(generation)) return;
    switch (event.kind) {
      case "started": {
        if (!event.taskId) return;
        const rec = this.ensure(event.taskId, generation, {
          toolUseId: event.toolUseId,
          taskType: event.taskType,
          description: event.description,
        });
        // started 想把任务置 running——但终态单调性下，已终态的不被复活。
        this.transition(rec, "running");
        return;
      }

      case "updated": {
        if (!event.taskId) return;
        const rec = this.ensure(event.taskId, generation, {
          taskType: event.taskType,
          description: event.description,
        });
        // status 归一化后守卫式覆盖；终态→终态是 CLI 权威序列（killed→stopped），允许。
        if (event.status) this.transition(rec, normalizeStatus(event.status));
        if (event.endTime !== undefined) rec.endTime = event.endTime;
        return;
      }

      case "notification": {
        if (!event.taskId) return;
        const rec = this.ensure(event.taskId, generation, {
          toolUseId: event.toolUseId,
          taskType: event.taskType,
          description: event.description,
          summary: event.summary,
          outputFile: event.outputFile,
          usage: event.usage,
        });
        if (event.status) this.transition(rec, normalizeStatus(event.status));
        return;
      }

      case "list_changed": {
        this.reconcile(event.tasks ?? [], generation);
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
  private reconcile(
    snapshotTasks: NonNullable<ChatBackgroundTaskEvent["tasks"]>,
    generation: number,
  ): void {
    const present = new Set<string>();
    for (const t of snapshotTasks) {
      if (!t.taskId) continue;
      present.add(t.taskId);
      // 新建的以 ensure 默认 running 起点；已知的只补元数据（ensure 不动 status）。
      this.ensure(t.taskId, generation, {
        taskType: t.taskType,
        description: t.description,
      });
    }
    // 指定代里仍 running 却从清单消失的任务 → pending-settle（不抢跑 orphaned）。
    for (const rec of this.tasks.values()) {
      if (rec.generation !== generation) continue;
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
      settled.push(cloneSnapshot(rec));
    }
    return settled;
  }

  /** 全量快照（深拷贝；插入顺序）。供重连 snapshot 与查询。 */
  snapshot(): BackgroundTaskSnapshot[] {
    return [...this.tasks.values()].map(cloneSnapshot);
  }
}

/** 对外快照的深拷贝：`usage` 是嵌套对象，浅拷贝会让外部突变污染内部状态。 */
function cloneSnapshot(rec: TaskRecord): BackgroundTaskSnapshot {
  return {
    ...rec,
    usage: rec.usage ? { ...rec.usage } : undefined,
  };
}
