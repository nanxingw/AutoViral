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

/** 一次 journal 解析的计数结果（不含 runId/路径——那是 {@link harvestWorkflowJournal} 的活）。 */
export interface JournalCounts {
  completedAgents: number;
  startedAgents: number;
}

/**
 * 解析一份 journal.jsonl 的文本，按 `key` 去重计数。单行 JSON 解析失败 → 跳过该行（半写尾行
 * 常见）。**一行都没解析出 started/result → 返回 `null`**（空 / 全损坏，无可打捞）。
 */
export function parseJournalCounts(text: string): JournalCounts | null {
  const started = new Set<string>();
  const completed = new Set<string>();
  let anyValid = false;

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
    const record = obj as { type?: unknown; key?: unknown };
    const key = typeof record.key === "string" ? record.key : undefined;
    if (!key) continue;
    if (record.type === "result") {
      // 完成必然启动过 —— 也算进 started 集合（防某些行落在已轮转的旧 journal）。
      completed.add(key);
      started.add(key);
      anyValid = true;
    } else if (record.type === "started") {
      started.add(key);
      anyValid = true;
    }
  }

  if (!anyValid) return null;
  return { completedAgents: completed.size, startedAgents: started.size };
}

export interface HarvestWorkflowJournalOptions {
  /** claude 的 `--resume` UUID（session.cliSessionId）。 */
  cliSessionId: string;
  /** claude 后端 spawn 的工作目录（生产 = PACKAGE_ROOT）——用于推导 project-dir slug。 */
  cwd: string;
  /** home 目录覆盖（测试注入临时目录，避免 mock node:os）；默认 `os.homedir()`。 */
  homeDir?: string;
}

/**
 * 从 `<home>/.claude/projects/<slug(cwd)>/<cliSessionId>/subagents/workflows/` 下的 run 目录
 * 收割 journal。多个 run 时取 **journal.jsonl 最近修改** 的那个（宿主死时正在跑的 run）。
 * 任一环节缺失/损坏 → `null`（优雅降级）。异步、纯读，绝不阻塞调用方主路径。
 */
export async function harvestWorkflowJournal(
  options: HarvestWorkflowJournalOptions,
): Promise<WorkflowHarvest | null> {
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
    return null; // workflows 目录不存在 —— 没有任何 workflow 跑过，无从打捞。
  }

  let best:
    | { runId: string; journalPath: string; mtimeMs: number; counts: JournalCounts }
    | null = null;

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
      continue; // 该 run 无 journal（还没起帧 / 已清理）——跳过。
    }
    const counts = parseJournalCounts(text);
    if (!counts) continue; // 全损坏 —— 跳过这个 run。
    if (!best || mtimeMs > best.mtimeMs) {
      best = { runId: entry.name, journalPath, mtimeMs, counts };
    }
  }

  if (!best) return null;
  return {
    runId: best.runId,
    completedAgents: best.counts.completedAgents,
    startedAgents: best.counts.startedAgents,
    journalPath: best.journalPath,
  };
}
