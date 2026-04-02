import { MemoryClient } from "./memory.js"
import { loadConfig } from "./config.js"

interface ConversationBlock {
  type: string
  text: string
  [key: string]: unknown
}

// Cached client — avoid loadConfig() on every message
let _cachedClient: MemoryClient | null | undefined = undefined

async function getClient(): Promise<MemoryClient | null> {
  if (_cachedClient !== undefined) return _cachedClient
  try {
    const config = await loadConfig()
    if (!config.memory?.apiKey) {
      _cachedClient = null
      return null
    }
    _cachedClient = new MemoryClient(config.memory.apiKey, config.memory.userId || "autoviral-user")
    return _cachedClient
  } catch {
    _cachedClient = null
    return null
  }
}

/** Reset cached client (call when config changes) */
export function resetMemoryClient() { _cachedClient = undefined }

/**
 * 实时同步单条消息到记忆系统。
 * 每条用户消息或 Agent 文本输出都立即发送，不等步骤完成。
 * 不包含工具调用、tool_result 等非文本消息。
 */
export async function syncMessage(
  workId: string,
  workTitle: string,
  stepKey: string,
  role: "user" | "assistant",
  text: string,
): Promise<void> {
  try {
    const client = await getClient()
    if (!client) return
    if (!text || text.trim().length === 0) return

    const label = role === "user" ? "用户" : "助手"
    const content = [
      `# ${workTitle} — ${stepKey}`,
      `日期: ${new Date().toISOString().slice(0, 10)}`,
      "",
      `${label}: ${text}`,
    ].join("\n")

    await client.addMemory({
      content,
      groupId: workId,
      groupName: `${workTitle} — ${stepKey}`,
      role,
    })
  } catch {
    // Non-blocking, silent fail
  }
}

/** 步骤完成时批量同步（保留兼容） */
export async function syncStepConversation(
  workId: string,
  workTitle: string,
  stepKey: string,
  stepName: string,
  blocks: ConversationBlock[],
): Promise<void> {
  try {
    const client = await getClient()
    if (!client) return

    const filtered = blocks.filter(b => b.type === "user" || b.type === "text")
    if (filtered.length === 0) return

    const lines = filtered.map(b => {
      const role = b.type === "user" ? "用户" : "助手"
      return `${role}: ${b.text}`
    })

    const content = [
      `# ${workTitle} — ${stepName}`,
      `日期: ${new Date().toISOString().slice(0, 10)}`,
      "",
      ...lines,
    ].join("\n")

    await client.addMemory({
      content,
      groupId: workId,
      groupName: `${workTitle} — ${stepName}`,
      role: "conversation",
    })

    console.log(`[memory-sync] Synced ${filtered.length} messages for ${workTitle}/${stepName}`)
  } catch (err) {
    console.error("[memory-sync] Sync failed (non-blocking):", err instanceof Error ? err.message : err)
  }
}
