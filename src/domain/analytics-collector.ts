import cron from "node-cron"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { loadConfig } from "../infra/config.js"

const execFileAsync = promisify(execFile)
const ANALYTICS_DIR = join(homedir(), ".autoviral", "analytics", "douyin")
const LATEST_FILE = join(ANALYTICS_DIR, "latest.json")

// #72 — the Douyin collector is a Python script that lived under
// skills/autoviral/modules/research/scripts/. That whole `modules/` tree was
// deleted in the agentic-terminal refactor (commit 29b9e96, archived in git
// tag pre-skill-rewrite-snapshot). Without this guard, collectData spawned
// python3 against a non-existent path on EVERY cron tick — a silent ENOENT
// loop that froze the analytics page with no explanation and spammed a doomed
// child process every N minutes. Treat a missing script as "collection
// retired" and degrade honestly instead.
function collectorScriptPath(): string {
  return join(
    homedir(),
    ".claude",
    "skills",
    "autoviral",
    "modules",
    "research",
    "scripts",
    "creator-analytics",
    "collect.py",
  )
}

/** True only when the collector script is actually present on disk. */
export function isCollectorAvailable(): boolean {
  return existsSync(collectorScriptPath())
}

let task: cron.ScheduledTask | null = null

export interface CreatorData {
  platform: string
  collected_at: string
  account: {
    nickname: string
    follower_count: number
    following_count: number
    total_favorited: number
    aweme_count: number
    [key: string]: unknown
  }
  works: Array<{
    aweme_id: string
    desc: string
    create_time: number
    play_count: number
    digg_count: number
    comment_count: number
    share_count: number
    collect_count: number
    [key: string]: unknown
  }>
  summary: {
    total_works_collected: number
    avg_play: number
    avg_digg: number
    avg_comment: number
    avg_share: number
    avg_collect: number
    engagement_rate: number
  }
}

export async function collectData(douyinUrl: string): Promise<CreatorData | null> {
  const scriptPath = collectorScriptPath()
  // #72 — bail before spawning python3 if the collector was removed in the
  // refactor. Returning null here is the same shape callers already handle,
  // but without the doomed child process + ENOENT log line.
  if (!existsSync(scriptPath)) {
    console.warn("[analytics] Collector script not found (retired in refactor) — skipping collection")
    return null
  }
  try {
    await mkdir(ANALYTICS_DIR, { recursive: true })
    const { stdout } = await execFileAsync("python3", [
      scriptPath, "--platform", "douyin", "--url", douyinUrl
    ], { timeout: 120000 })

    const data = JSON.parse(stdout.trim()) as CreatorData
    await writeFile(LATEST_FILE, JSON.stringify(data, null, 2), "utf-8")

    const dateStr = new Date().toISOString().slice(0, 10)
    await writeFile(join(ANALYTICS_DIR, `${dateStr}.json`), JSON.stringify(data, null, 2), "utf-8")

    console.log(`[analytics] Collected data for ${data.account?.nickname ?? "unknown"}: ${data.summary?.total_works_collected ?? 0} works`)
    return data
  } catch (err) {
    console.error("[analytics] Collection failed:", err instanceof Error ? err.message : err)
    return null
  }
}

export async function getLatestCreatorData(): Promise<CreatorData | null> {
  try {
    const raw = await readFile(LATEST_FILE, "utf-8")
    return JSON.parse(raw) as CreatorData
  } catch {
    return null
  }
}

export async function getCreatorHistory(days: number = 30): Promise<Array<{ date: string; data: CreatorData }>> {
  try {
    const files = await readdir(ANALYTICS_DIR)
    const jsonFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, days)
    const results = []
    for (const f of jsonFiles) {
      try {
        const raw = await readFile(join(ANALYTICS_DIR, f), "utf-8")
        results.push({ date: f.replace(".json", ""), data: JSON.parse(raw) })
      } catch { /* skip */ }
    }
    return results
  } catch {
    return []
  }
}

export async function startAnalyticsCollector(): Promise<void> {
  // #72 — don't schedule a recurring python3 spawn for a script that no
  // longer exists. This is the core of the silent-failure fix: previously
  // the cron fired every N minutes, each tick ENOENT-failing invisibly.
  if (!isCollectorAvailable()) {
    console.log("[analytics] Collector script retired in refactor — collection disabled, not scheduling")
    return
  }
  const config = await loadConfig()
  const analytics = config.analytics
  if (!analytics?.enabled || !analytics?.douyinUrl) {
    console.log("[analytics] Disabled or no URL configured, skipping")
    return
  }
  collectData(analytics.douyinUrl).catch(() => {})
  const intervalMinutes = analytics.collectInterval || 60
  const cronExpr = `*/${intervalMinutes} * * * *`
  task = cron.schedule(cronExpr, () => {
    loadConfig().then(cfg => {
      if (cfg.analytics?.douyinUrl) collectData(cfg.analytics.douyinUrl).catch(() => {})
    })
  })
  console.log(`[analytics] Scheduled every ${intervalMinutes} minutes for ${analytics.douyinUrl}`)
}

export function stopAnalyticsCollector(): void {
  task?.stop()
  task = null
}
