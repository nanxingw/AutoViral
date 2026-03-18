import cron from 'node-cron'
import { loadConfig } from './config.js'

let task: cron.ScheduledTask | null = null

export async function startResearchScheduler() {
  const config = await loadConfig()
  if (!config.research.enabled) return
  task = cron.schedule(config.research.schedule, () => {
    console.log('[research-scheduler] Triggering trend research...')
  })
  console.log(`[research-scheduler] Scheduled: ${config.research.schedule}`)
}

export function stopResearchScheduler() {
  task?.stop()
  task = null
}
