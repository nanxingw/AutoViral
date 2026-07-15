/**
 * PRD-0015 S7 —— Journal 打捞（orphaned）。
 *
 * 宿主 CLI 进程死亡（600s ceiling 强杀 / 我们的 kill 点 / crash）且 registry（S2）里还有
 * 未落终态的 `local_workflow` 任务时，从 claude CLI 写在磁盘上的 **workflow journal** 里
 * 收割「已经完成的 agent 有多少」——把损失变成**可见**、把花费变成**可查**（030/031 的止损）。
 * 只做可见性与止损，**不自动重跑**（自动 resume 涉及重复计费 + 幂等，Out of Scope）。
 *
 * 目录推导（对照本机事故现场 `-Users-nanjiayan-Desktop-AutoViral-autoviral-dist`）：
 *   `<home>/.claude/projects/<slug(cwd)>/<cliSessionId>/subagents/workflows/<runId>/journal.jsonl`
 *   - `cwd` = claude 后端 spawn 时的工作目录（生产 = `PACKAGE_ROOT`，即 `.../autoviral/dist`）。
 *   - `slug(cwd)` = 路径里每个非字母数字字符 → `-`（**无折叠**——实录目录名 `docs----OpenCut`
 *     里 4 个连续分隔符 = 4 个 dash 印证）。
 *   - `cliSessionId` = claude 的 `--resume` UUID（session 的 cliSessionId）。
 *
 * journal.jsonl 每行一个 JSON：`{ type: "started" | "result", key, agentId, result? }`。
 *   - `started` = 一个 agent 起跑；`result` = 一个 agent 交付。
 *   - **按 `key` 去重、绝不按行数**：resume 会用【新 agentId】把同一个 `key` 的 agent 重跑一遍
 *     （事故实证：已完成的 agent resume 后新 ID 重跑而非缓存命中）——若按行数计，那次重复计费
 *     会把完成数虚高。已完成 = 出现过 `result` 的唯一 `key` 数；已启动 = 出现过任一行的唯一 `key` 数。
 *
 * 优雅降级：workflows 目录 / run 目录 / journal 文件缺失、或 journal 全损坏（无一行可解析）
 * → 返回 `null`（settleOnExit 的 `stopped` 保持不变，不打捞）。单行损坏（进程死时半写的尾行）
 * 被跳过，不拖垮整次收割。
 */

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { WorkflowHarvest } from "./background-task-registry.js";

/** claude project-dir 目录名规则：路径里每个非字母数字字符 → 单个 `-`（无折叠）。 */
export function slugifyProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** 一次 journal 解析的计数结果（不含 runId/路径——那是 {@link harvestWorkflowRuns} 的活）。 */
export interface JournalCounts {
  completedAgents: number;
  startedAgents: number;
  /** L10 —— 最后一个 `result` 记录的截断摘要（≤120 字符），随 harvest 广播、卡片 tooltip 可见。 */
  resultSummary?: string;
}

/** L10 —— 把一个 `result` 记录的 `result` 字段压成一行 ≤120 字符的摘要（对象取 conclusion/
 *  summary，否则 JSON.stringify）。非字符串/对象 → undefined。 */
function summarizeResult(result: unknown): string | undefined {
  let s: string | undefined;
  if (typeof result === "string") {
    s = result;
  } else if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.conclusion === "string") s = r.conclusion;
    else if (typeof r.summary === "string") s = r.summary;
    else s = JSON.stringify(result);
  }
  if (s === undefined) return undefined;
  s = s.trim();
  if (!s) return undefined;
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

/**
 * 解析一份 journal.jsonl 的文本，按 `key` 去重计数。单行 JSON 解析失败 → 跳过该行（半写尾行
 * 常见）。**一行都没解析出 started/result → 返回 `null`**（空 / 全损坏，无可打捞）。L10：顺带
 * 记住最后一个 `result` 的摘要。
 */
export function parseJournalCounts(text: string): JournalCounts | null {
  const started = new Set<string>();
  const completed = new Set<string>();
  let anyValid = false;
  let resultSummary: string | undefined;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // 半写 / 损坏行 —— 跳过，不拖垮整次收割。
    }
    if (!obj || typeof obj !== "object") continue;
    const record = obj as { type?: unknown; key?: unknown; result?: unknown };
    const key = typeof record.key === "string" ? record.key : undefined;
    if (!key) continue;
    if (record.type === "result") {
      // 完成必然启动过 —— 也算进 started 集合（防某些行落在已轮转的旧 journal）。
      completed.add(key);
      started.add(key);
      anyValid = true;
      // 反映"最后一个" result 的摘要——无条件覆盖：若最后一个 result 无可摘要 payload
      // （summarizeResult 返回 undefined），resultSummary 就该是 undefined，绝不残留前一条
      // 摘要（否则卡片 tooltip 会挂上属于别的 agent 的过时摘要）。
      resultSummary = summarizeResult(record.result);
    } else if (record.type === "started") {
      started.add(key);
      anyValid = true;
    }
  }

  if (!anyValid) return null;
  return {
    completedAgents: completed.size,
    startedAgents: started.size,
    ...(resultSummary ? { resultSummary } : {}),
  };
}

export interface HarvestWorkflowJournalOptions {
  /** claude 的 `--resume` UUID（session.cliSessionId）。 */
  cliSessionId: string;
  /** claude 后端 spawn 的工作目录（生产 = PACKAGE_ROOT）——用于推导 project-dir slug。 */
  cwd: string;
  /** home 目录覆盖（测试注入临时目录，避免 mock node:os）；默认 `os.homedir()`。 */
  homeDir?: string;
}

/** 磁盘上一个 workflow run 目录的收割结果。`counts=null` 表示 journal 存在但全损坏（M7 据此
 *  区分"最新 run 坏了"与"没有 run"）。`mtimeMs` 用于按进程生命周期窗口 per-task 归属（M6）。 */
export interface WorkflowRun {
  runId: string;
  journalPath: string;
  mtimeMs: number;
  /** 解析计数；journal 全损坏 → `null`。 */
  counts: JournalCounts | null;
}

/** M6 → {@link WorkflowHarvest} 的投影（一个已确定归属的 run 的对外形状）。 */
export function runToHarvest(run: WorkflowRun): WorkflowHarvest | null {
  if (!run.counts) return null;
  return {
    runId: run.runId,
    completedAgents: run.counts.completedAgents,
    startedAgents: run.counts.startedAgents,
    journalPath: run.journalPath,
    ...(run.counts.resultSummary ? { resultSummary: run.counts.resultSummary } : {}),
  };
}

/**
 * 枚举 `<home>/.claude/projects/<slug(cwd)>/<cliSessionId>/subagents/workflows/` 下**所有** run
 * 目录（有 journal 文件的），各带 mtime + 解析计数（损坏 run 计数为 `null` 但仍在列——保留其
 * mtime 供 M7 判"最新是否损坏"与 M6 per-task 归属）。按 journal.jsonl 修改时间**降序**返回。
 * 无 workflows 目录 / 无任何带 journal 的 run → 空数组。异步、纯读，绝不阻塞调用方主路径。
 */
export async function harvestWorkflowRuns(
  options: HarvestWorkflowJournalOptions,
): Promise<WorkflowRun[]> {
  const home = options.homeDir ?? homedir();
  const slug = slugifyProjectPath(options.cwd);
  const workflowsDir = join(
    home,
    ".claude",
    "projects",
    slug,
    options.cliSessionId,
    "subagents",
    "workflows",
  );

  let entries: Dirent[];
  try {
    entries = await readdir(workflowsDir, { withFileTypes: true });
  } catch {
    return []; // workflows 目录不存在 —— 没有任何 workflow 跑过，无从打捞。
  }

  const runs: WorkflowRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const journalPath = join(workflowsDir, entry.name, "journal.jsonl");
    let mtimeMs: number;
    let text: string;
    try {
      const info = await stat(journalPath);
      mtimeMs = info.mtimeMs;
      text = await readFile(journalPath, "utf8");
    } catch {
      continue; // 该 run 无 journal 文件（还没起帧 / 已清理）——无 mtime，跳过。
    }
    // 损坏 journal 仍入列（counts=null），保留 mtime——M7 需要它来判"最新 run 是否损坏"。
    runs.push({ runId: entry.name, journalPath, mtimeMs, counts: parseJournalCounts(text) });
  }

  runs.sort((a, b) => b.mtimeMs - a.mtimeMs); // mtime 降序：runs[0] = 最新
  return runs;
}

/**
 * M6 —— 从候选 runs 里挑一个 journal mtime 落在任务进程生命周期窗口 `[startTime, endTime]`
 * 内、且计数可用的 run。**唯一命中**才返回（可确定归属）；零命中 / 多命中（无法唯一归属，两个
 * run 并存都落窗内）→ `null`，调用方保守不 enrich、记观测点，绝不把别的 run 的号串到这个任务上。
 */
export function selectRunForWindow(
  runs: WorkflowRun[],
  startTime: number | undefined,
  endTime: number | undefined,
): WorkflowRun | null {
  if (startTime === undefined) return null;
  const hi = endTime ?? Number.POSITIVE_INFINITY;
  // 唯一性判定在【剔除损坏 run 之前】：损坏 run（counts=null）落在窗口内同样占一个"歧义位"，
  // 使这个任务无法唯一归属到某个 run（先剔除再判唯一会把"有效 run + 损坏 run 并存"误判成唯一，
  // 把有效 run 的号错串到本任务上）。窗口内不唯一 → 保守不 enrich。
  const inWindow = runs.filter((r) => r.mtimeMs >= startTime && r.mtimeMs <= hi);
  if (inWindow.length !== 1) return null;
  // 唯一命中：但若这条自身损坏（counts=null）则无可 enrich 的计数 → 仍不选中。
  return inWindow[0].counts ? inWindow[0] : null;
}

/**
 * 单 run 收割便捷入口（回归锚 + "不需要 per-task 归属"的场景）。M7：取 journal mtime **最新**
 * 的 run；**若最新 run 的 journal 损坏即返回 `null`（绝不回退旧 run）**——最新 run 才是宿主崩溃
 * 那一刻的真相，旧 run 的号回退过来会把过时计数错记到这次崩溃上。无任何带 journal 的 run → `null`。
 */
export async function harvestWorkflowJournal(
  options: HarvestWorkflowJournalOptions,
): Promise<WorkflowHarvest | null> {
  const runs = await harvestWorkflowRuns(options);
  if (runs.length === 0) return null;
  return runToHarvest(runs[0]); // runs[0] = 最新；损坏（counts=null）→ runToHarvest 返回 null
}
