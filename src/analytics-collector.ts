import cron from "node-cron"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { loadConfig } from "./config.js"

const execFileAsync = promisify(execFile)
const ANALYTICS_DIR = join(homedir(), ".autoviral", "analytics", "douyin")
const LATEST_FILE = join(ANALYTICS_DIR, "latest.json")

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

async function collectData(douyinUrl: string): Promise<CreatorData | null> {
  const scriptPath = join(homedir(), ".claude", "skills", "creator-analytics", "scripts", "collect.py")
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
