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

/** 终态→终态覆盖白名单（`${from}->${to}`）。终态本是单调不可覆盖的，这里是**受控的**例外：
 *   - `killed->stopped` —— CLI 权威落定序（updated(killed) 后紧跟 notification(stopped)，exp7）。
 *   - `stopped->orphaned` / `killed->orphaned` —— S7 journal 打捞：宿主进程死后从 workflow
 *     journal 收割已完成 agent 计数，把已被 settle 的终态任务叠加成 `orphaned`（可见性 + 止损，
 *     带 completedAgents/runId 线索）。这是唯二能落 orphaned 的路径，绝不 speculative。
 *  其余终态→终态（如 completed→killed）一律拒。 */
const TERMINAL_OVERRIDE_ALLOWED: ReadonlySet<string> = new Set([
  "killed->stopped",
  "stopped->orphaned",
  "killed->orphaned",
]);

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

/** 所有合法的、可被状态机接受的状态词（含内部词）。M6：未识别词绝不 as-cast 写进状态机。 */
const KNOWN_STATUSES: ReadonlySet<string> = new Set<BackgroundTaskStatus>([
  "running",
  "pending-settle",
  "completed",
  "killed",
  "stopped",
  "failed",
  "orphaned",
]);

/**
 * CLI 上游状态词归一化。别名映射优先，其余若本就是合法状态词则原样返回；**未识别一律返回
 * `undefined`**（M6 收紧：不再 `as`-cast 未知词硬塞状态机——上游改口时忽略该次推进并留观测点，
 * 由 S5 探针在词汇表漂移时先红）。
 */
export function normalizeStatus(raw: string): BackgroundTaskStatus | undefined {
  const lower = raw.toLowerCase();
  const alias = STATUS_ALIASES[lower];
  if (alias) return alias;
  return KNOWN_STATUSES.has(lower) ? (lower as BackgroundTaskStatus) : undefined;
}

/** S7 journal 打捞结果——宿主进程死后从 workflow journal 收割的已完成 agent 计数与 resume
 *  线索（可见性 + 止损，不自动重跑）。仅 `orphaned` 终态携带。`journal-harvest.ts` 产出，
 *  经 {@link BackgroundTaskRegistry.markOrphaned} 挂到任务快照上广播。 */
export interface WorkflowHarvest {
  /** workflow run 目录名（如 `wf_296ee812-c04`）——resume 恢复的线索。 */
  runId: string;
  /** 已完成的 agent 数（按 journal `key` 去重；resume 重跑同 key 只计一次，不虚高）。 */
  completedAgents: number;
  /** 启动过的 agent 总数（唯一 key）。completedAgents/startedAgents = 打捞回收率。 */
  startedAgents: number;
  /** 收割来源 journal 的绝对路径（取证/审计用）。 */
  journalPath: string;
  /** L10 —— 最后一个 agent `result` 的截断摘要（≤120 字符）；卡片 tooltip 可见。缺省无。 */
  resultSummary?: string;
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
  /** S7 —— journal 打捞收割的已完成计数与 resume 线索；仅 `orphaned` 终态携带。 */
  harvest?: WorkflowHarvest;
}

/** 内部可变记录。 */
interface TaskRecord extends BackgroundTaskSnapshot {}

export interface RejectedTransition {
  taskId?: string;
  generation: number;
  /** 被拒的当前状态（settled_generation / unknown_status 场景可能无 from）。 */
  from?: BackgroundTaskStatus;
  /** 被拒的目标状态（unknown_status / settled_generation 场景可能无 to）。 */
  to?: BackgroundTaskStatus;
  /** 拒绝类别（供上层区分观测）：
   *   - `terminal_monotonicity` —— 终态→non-terminal（迟到帧想复活已终态任务）。
   *   - `terminal_to_terminal`  —— 终态→终态但非 killed→stopped（M6：唯一放行的终态覆盖）。
   *   - `settled_generation`    —— 已 settleOnExit 的死代际任何迟到帧（H4：死代际不重开）。
   *   - `unknown_status`        —— 词汇表未识别的状态词（M6：忽略该次推进，保留原状态）。
   *   - `orphaned_requires_harvest` —— 上游 CLI 帧携带 `status:"orphaned"`（M9：`orphaned`
   *     只能经内部 {@link BackgroundTaskRegistry.markOrphaned} 打捞路径产生，绝不接受上游直传）。 */
  kind?:
    | "terminal_monotonicity"
    | "terminal_to_terminal"
    | "settled_generation"
    | "unknown_status"
    | "orphaned_requires_harvest";
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
  /** H4：已被 settleOnExit 收尾（进程退出/被杀）的死代际集合。死代际的任何迟到帧
   *  （含全新 taskId 的 started / list_changed）一律拒绝——绝不凭空重开一条 running 记录。 */
  private readonly settledGenerations = new Set<number>();
  /** M9：`orphaned` 是打捞专属终态。仅 {@link markOrphaned} 在其内部 transition 前把此旗
   *  置 true，使 orphaned 目标合法；任何上游 CLI 帧（applyEvent 路径）此旗恒为 false，
   *  status:"orphaned" 一律被 transition 拒绝并记 `orphaned_requires_harvest`。 */
  private orphaningInternally = false;

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

  /** 守卫式状态推进（终态单调性 + M6 收紧）：
   *   - 终态→non-terminal 一律拒绝（迟到帧想复活已终态任务）。
   *   - 终态→终态**仅**放行 {@link TERMINAL_OVERRIDE_ALLOWED} 白名单（CLI 权威 killed→stopped +
   *     S7 打捞 stopped→orphaned / killed→orphaned）；其余（如 completed→killed）拒绝。
   *  被拒都走观测钩子（带 kind），不改状态。 */
  private transition(rec: TaskRecord, next: BackgroundTaskStatus): void {
    if (rec.status === next) return;
    // M9：orphaned 是打捞专属终态——只有 markOrphaned 内部路径（orphaningInternally=true）
    // 能把任务推进到 orphaned。上游 CLI 帧直传 status:"orphaned" 一律拒（不接受 speculative
    // orphaned；避免绕过 journal 打捞凭空标中断）。
    if (next === "orphaned" && !this.orphaningInternally) {
      this.onRejectedTransition?.({
        taskId: rec.taskId,
        generation: rec.generation,
        from: rec.status,
        to: next,
        kind: "orphaned_requires_harvest",
      });
      return;
    }
    const fromTerminal = isTerminalStatus(rec.status);
    const toTerminal = isTerminalStatus(next);
    if (fromTerminal && !toTerminal) {
      this.onRejectedTransition?.({
        taskId: rec.taskId,
        generation: rec.generation,
        from: rec.status,
        to: next,
        kind: "terminal_monotonicity",
      });
      return;
    }
    if (fromTerminal && toTerminal && !TERMINAL_OVERRIDE_ALLOWED.has(`${rec.status}->${next}`)) {
      this.onRejectedTransition?.({
        taskId: rec.taskId,
        generation: rec.generation,
        from: rec.status,
        to: next,
        kind: "terminal_to_terminal",
      });
      return;
    }
    rec.status = next;
  }

  /** M6：归一化上游状态词后推进状态。未识别词→忽略该次推进（保留原状态）+ 观测钩子，
   *  绝不 as-cast 硬塞（上游词汇漂移不再静默污染状态机）。 */
  private applyStatus(rec: TaskRecord, rawStatus: string, generation: number): void {
    const next = normalizeStatus(rawStatus);
    if (next === undefined) {
      this.onRejectedTransition?.({
        taskId: rec.taskId,
        generation,
        from: rec.status,
        kind: "unknown_status",
      });
      return;
    }
    this.transition(rec, next);
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
    // H4：死代际不重开——settleOnExit 收尾后的代际，任何迟到帧（含全新 taskId 的
    // started / list_changed）一律拒绝，绝不凭空建一条 running 记录。
    if (this.settledGenerations.has(generation)) {
      this.onRejectedTransition?.({
        taskId: event.taskId,
        generation,
        kind: "settled_generation",
      });
      return;
    }
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
        if (event.status) this.applyStatus(rec, event.status, generation);
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
        if (event.status) this.applyStatus(rec, event.status, generation);
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
    // H4：该代际就此「关闭」——进程退出/被杀后，任何迟到帧（含全新 taskId）不得重开死代际。
    // 仅对已初始化代际记账（0/未初始化不进集合）。
    if (this.isLiveGeneration(generation)) this.settledGenerations.add(generation);
    return settled;
  }

  /**
   * S7 journal 打捞：把一条【已被 settle / killed 的终态任务】叠加成 `orphaned`，并挂上从
   * workflow journal 收割的 {@link WorkflowHarvest}（已完成 agent 计数 + runId + 路径）。
   *
   * 只作用于 {@link TERMINAL_OVERRIDE_ALLOWED} 白名单里的来源终态（`stopped` / `killed`）——
   * 已 `completed` 的任务**绝不**被打捞降级（transition 拒绝，返回 `undefined`，状态与
   * harvest 都不动，且走观测钩子记一次 terminal_to_terminal 拒绝）。settle 合成的
   * `settleReason` 保留（可见性叠加，非替换）。未知 taskId → `undefined`，绝不凭空建条。
   *
   * 返回被打捞的任务快照（供上层再广播一次 `ui-workflow`），或 `undefined`（未命中/被拒）。
   */
  markOrphaned(
    taskId: string,
    generation: number,
    harvest: WorkflowHarvest,
  ): BackgroundTaskSnapshot | undefined {
    const rec = this.tasks.get(this.keyFor(taskId, generation));
    if (!rec) return undefined;
    // W4.5 幂等：已 orphaned 的任务再次打捞是彻底 no-op——返回 undefined（上层据此不再广播一次
    // ui-workflow → 客户端不双 toast），且绝不用后到的 harvest 覆盖首个打捞结果。破坏性 settle
    // 路径与进程 exit 路径会各触发一次打捞，此判定消除两者间的重复广播窗口。
    if (rec.status === "orphaned") return undefined;
    // M9：唯一放行 orphaned 目标的地方——置内部旗，transition 内的 orphaned 守卫因此放行；
    // 白名单（stopped/killed→orphaned）仍生效，completed→orphaned 照旧被 terminal_to_terminal 拒。
    this.orphaningInternally = true;
    try {
      this.transition(rec, "orphaned");
    } finally {
      this.orphaningInternally = false;
    }
    // transition 被白名单拒绝（如 completed→orphaned）→ 状态没变，不挂 harvest、不广播。
    if (rec.status !== "orphaned") return undefined;
    rec.harvest = { ...harvest };
    return cloneSnapshot(rec);
  }

  /** 全量快照（深拷贝；插入顺序）。供重连 snapshot 与查询。 */
  snapshot(): BackgroundTaskSnapshot[] {
    return [...this.tasks.values()].map(cloneSnapshot);
  }
}

/** 对外快照的深拷贝：`usage` / `harvest` 是嵌套对象，浅拷贝会让外部突变污染内部状态。 */
function cloneSnapshot(rec: TaskRecord): BackgroundTaskSnapshot {
  return {
    ...rec,
    usage: rec.usage ? { ...rec.usage } : undefined,
    harvest: rec.harvest ? { ...rec.harvest } : undefined,
  };
}
