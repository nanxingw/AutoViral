import cron from "node-cron"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { dataDir, loadConfig, repoRoot } from "../infra/config.js"
import {
  collectorVenvPythonPath,
  collectorVenvReady,
} from "../infra/collector-env.js"
import {
  parseCollectorResult,
  isCollectorError,
  type CollectorError,
} from "./collector-parse.js"

export { isCollectorError, type CollectorError } from "./collector-parse.js"

const execFileAsync = promisify(execFile)
// Honour AUTOVIRAL_DATA_DIR (via dataDir) so tests stay isolated — the old
// hard-coded homedir() path ignored the override.
const ANALYTICS_DIR = join(dataDir, "analytics", "douyin")
const LATEST_FILE = join(ANALYTICS_DIR, "latest.json")

// PRD-0006 §D4 / slice S5 — the Douyin collector is RESTORED. The pre-refactor
// f2 + browser_cookie3 scraper (#72, deleted in commit 29b9e96) now ships as
// bundled workstation infrastructure at <packageRoot>/python/collector/collect.py
// and runs under the MANAGED venv (~/.autoviral/collector-venv) that slice S4
// provisions — NOT the host python3 (which almost never has f2).
//
// PATH NOTE: `repoRoot` points at the dir holding this module's build output —
// `dist/` in prod, `src/` in dev — NOT the package root. `python/` ships as a
// SIBLING of dist/ (per package.json `files`), so we go up ONE level from
// repoRoot, exactly like skill-sync resolves `join(PACKAGE_ROOT, "..", "skills")`.
function collectorScriptPath(): string {
  return join(repoRoot, "..", "python", "collector", "collect.py")
}

/** True when the collector can actually run: BOTH the bundled script exists AND
 *  the managed venv (f2 + browser_cookie3) is provisioned (S4). When false the
 *  refresh path returns a structured "run setup" error instead of spawning a
 *  doomed python3 — no more silent ENOENT (#72). */
export function isCollectorAvailable(): boolean {
  return existsSync(collectorScriptPath()) && collectorVenvReady()
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

/** Throwable wrapper around a structured CollectorError so async callers (the
 *  refresh route) can `try/catch` and map `.detail.code` → HTTP status + an
 *  actionable, localized "re-login" prompt. Carries the pure CollectorError as
 *  `.detail` rather than flattening, so no field is lost across the boundary. */
export class CollectorRunError extends Error {
  readonly detail: CollectorError
  constructor(detail: CollectorError) {
    super(detail.message)
    this.name = "CollectorRunError"
    this.detail = detail
  }
}

/**
 * Run the managed-venv Douyin collector once and persist the result.
 *
 * Resolves to the typed CreatorData on success. THROWS a `CollectorRunError`
 * (carrying a structured CollectorError) on any failure — expired cookie,
 * not-logged-in, invalid URL, crash, unprovisioned venv — so the caller can
 * surface an actionable message instead of a silent empty page. The cron path
 * still calls this with `.catch(() => {})`, so a background failure stays quiet.
 *
 * The browser cookie (sessionid) is read by the Python script directly from the
 * user's own browser via browser_cookie3 and never leaves the machine; this
 * function only sees the script's JSON stdout.
 */
export async function collectData(douyinUrl: string): Promise<CreatorData> {
  const scriptPath = collectorScriptPath()
  // Honest pre-flight: if the bundled script or the managed venv is missing,
  // tell the caller to run `autoviral setup` rather than spawning a doomed
  // python3 (the #72 silent-ENOENT trap).
  if (!existsSync(scriptPath)) {
    throw new CollectorRunError({
      kind: "collector_error",
      code: "DEPENDENCY_ERROR",
      message:
        "Collector script not found. Reinstall AutoViral or run `autoviral setup`.",
      needsRelogin: false,
    })
  }
  if (!collectorVenvReady()) {
    throw new CollectorRunError({
      kind: "collector_error",
      code: "DEPENDENCY_ERROR",
      message:
        "Collector dependencies (f2 + browser_cookie3) are not installed. Run `autoviral setup`.",
      needsRelogin: false,
    })
  }

  await mkdir(ANALYTICS_DIR, { recursive: true })

  let stdout: string
  try {
    // Run under the MANAGED venv interpreter (f2 + browser_cookie3 live there),
    // never the host python3.
    const res = await execFileAsync(
      collectorVenvPythonPath(),
      [scriptPath, "--url", douyinUrl],
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    )
    stdout = res.stdout
  } catch (err) {
    // The script emits errors as a structured envelope on stdout + exit 0, so a
    // non-zero exit here means an unexpected crash (timeout, OOM, segfault).
    throw new CollectorRunError({
      kind: "collector_error",
      code: "API_ERROR",
      message: `Collector process failed: ${err instanceof Error ? err.message : String(err)}`,
      needsRelogin: false,
    })
  }

  // D4 parse boundary: raw f2 JSON → CreatorData | CollectorError.
  const parsed = parseCollectorResult(stdout)
  if (isCollectorError(parsed)) {
    console.warn(`[analytics] Collection failed (${parsed.code}): ${parsed.message}`)
    throw new CollectorRunError(parsed)
  }

  await writeFile(LATEST_FILE, JSON.stringify(parsed, null, 2), "utf-8")
  const dateStr = new Date().toISOString().slice(0, 10)
  await writeFile(join(ANALYTICS_DIR, `${dateStr}.json`), JSON.stringify(parsed, null, 2), "utf-8")

  console.log(
    `[analytics] Collected data for ${parsed.account?.nickname ?? "unknown"}: ${parsed.summary?.total_works_collected ?? 0} works`,
  )
  return parsed
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
  // Don't schedule a recurring spawn unless the collector can actually run
  // (bundled script present AND managed venv provisioned). Otherwise every cron
  // tick would fail — the #72 silent-ENOENT trap. The user still triggers the
  // first real scrape via the Settings "refresh" button (which surfaces a
  // structured error if the venv isn't ready yet).
  if (!isCollectorAvailable()) {
    console.log("[analytics] Collector not ready (script or managed venv missing) — not scheduling background collection")
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
