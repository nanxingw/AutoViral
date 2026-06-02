# 创作者数据采集 + EverMemOS 记忆同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添加定时创作者数据采集、对话同步到 EverMemOS、以及 Agent 按需访问这些数据的能力。

**Architecture:** 三个独立模块——采集服务（cron + Python 脚本 + API）、记忆同步服务（步骤完成时写入 EverMem）、Skill 提示词更新（引导 Agent 按需调用）。模块间无硬依赖，任一失败不影响其他。

**Tech Stack:** TypeScript (Node.js, Hono), Svelte 5, Python 3, node-cron, EverMemOS API

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/config.ts` | 修改 | Config 接口新增 `analytics` 和 `memory.syncEnabled` |
| `src/analytics-collector.ts` | 新建 | 定时采集服务 (cron + 脚本调用 + 文件存储) |
| `src/memory-sync.ts` | 新建 | 对话同步到 EverMemOS (过滤 + addMemory) |
| `src/server/api.ts` | 修改 | 新增 creator analytics API 端点 |
| `src/server/index.ts` | 修改 | 启动时初始化采集服务 |
| `src/ws-bridge.ts` | 修改 | pipeline advance 时触发记忆同步 |
| `web/src/pages/Analytics.svelte` | 重写 | 真实数据仪表盘 |
| `web/src/pages/SettingsPanel.svelte` | 修改 | 新增抖音 URL + 记忆同步开关 |
| `skills/trend-research/SKILL.md` | 修改 | 添加可用数据源提示词 |
| `skills/content-planning/SKILL.md` | 修改 | 添加可用数据源提示词 |

---

### Task 1: Config 层扩展

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: 扩展 Config 接口**

在 `src/config.ts` 的 Config 接口中，`interests` 后面添加：

```typescript
analytics?: {
  douyinUrl: string
  collectInterval: number  // minutes, default 60
  enabled: boolean
}
memory?: { apiKey: string; userId: string; syncEnabled: boolean }
```

注意：`memory` 字段已存在但没有 `syncEnabled`，需要扩展。

- [ ] **Step 2: 更新 getDefaultConfig**

```typescript
analytics: { douyinUrl: "", collectInterval: 60, enabled: true },
```

- [ ] **Step 3: 更新 .env 覆盖逻辑**

在 loadConfig 的 .env overrides 部分，修改 EVERMEMOS_API_KEY 处理：

```typescript
if (process.env.EVERMEMOS_API_KEY) {
  if (!config.memory) {
    config.memory = { apiKey: "", userId: "autoviral-user", syncEnabled: false };
  }
  config.memory.apiKey = process.env.EVERMEMOS_API_KEY;
}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add analytics and memory.syncEnabled fields"
```

---

### Task 2: 创作者数据采集服务

**Files:**
- Create: `src/analytics-collector.ts`

- [ ] **Step 1: 创建采集服务**

```typescript
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
      scriptPath, "--url", douyinUrl, "--format", "json"
    ], { timeout: 120000 }) // 2 min timeout

    const data = JSON.parse(stdout.trim()) as CreatorData

    // Save latest
    await writeFile(LATEST_FILE, JSON.stringify(data, null, 2), "utf-8")

    // Save daily snapshot (one per day)
    const dateStr = new Date().toISOString().slice(0, 10)
    await writeFile(
      join(ANALYTICS_DIR, `${dateStr}.json`),
      JSON.stringify(data, null, 2),
      "utf-8"
    )

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
    const jsonFiles = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, days)

    const results = []
    for (const f of jsonFiles) {
      try {
        const raw = await readFile(join(ANALYTICS_DIR, f), "utf-8")
        results.push({ date: f.replace(".json", ""), data: JSON.parse(raw) })
      } catch { /* skip corrupted files */ }
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

  // Run once immediately on startup
  collectData(analytics.douyinUrl).catch(() => {})

  // Schedule recurring collection
  const intervalMinutes = analytics.collectInterval || 60
  const cronExpr = `*/${intervalMinutes} * * * *`
  task = cron.schedule(cronExpr, () => {
    loadConfig().then(cfg => {
      if (cfg.analytics?.douyinUrl) {
        collectData(cfg.analytics.douyinUrl).catch(() => {})
      }
    })
  })

  console.log(`[analytics] Scheduled every ${intervalMinutes} minutes for ${analytics.douyinUrl}`)
}

export function stopAnalyticsCollector(): void {
  task?.stop()
  task = null
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/analytics-collector.ts
git commit -m "feat: add creator analytics collector service"
```

---

### Task 3: Analytics API 端点

**Files:**
- Modify: `src/server/api.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: 添加 API 端点**

在 `src/server/api.ts` 的 analytics 路由区域，替换现有的 `GET /api/analytics` 或在其后添加：

```typescript
import { getLatestCreatorData, getCreatorHistory } from "../analytics-collector.js"

// GET /api/analytics/creator — latest creator data + trend delta
apiRoutes.get("/api/analytics/creator", async (c) => {
  const latest = await getLatestCreatorData()
  if (!latest) return c.json({ configured: false, data: null })

  // Try to compute trend delta from yesterday's snapshot
  const history = await getCreatorHistory(7)
  const yesterday = history.find(h => h.date !== new Date().toISOString().slice(0, 10))

  let delta: Record<string, number> | null = null
  if (yesterday?.data?.account && latest.account) {
    delta = {
      followers: latest.account.follower_count - yesterday.data.account.follower_count,
      favorited: latest.account.total_favorited - yesterday.data.account.total_favorited,
    }
  }

  return c.json({ configured: true, data: latest, delta })
})

// GET /api/analytics/creator/history — daily snapshots for charts
apiRoutes.get("/api/analytics/creator/history", async (c) => {
  const history = await getCreatorHistory(30)
  return c.json({ history })
})
```

- [ ] **Step 2: 在 server/index.ts 中启动采集服务**

在 `startServer` 函数中，`startResearchScheduler()` 之后添加：

```typescript
import { startAnalyticsCollector } from "../analytics-collector.js"

// 8. Start analytics collector
await startAnalyticsCollector()
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/server/api.ts src/server/index.ts
git commit -m "feat(api): add creator analytics endpoints and startup init"
```

---

### Task 4: 记忆同步服务

**Files:**
- Create: `src/memory-sync.ts`

- [ ] **Step 1: 创建同步服务**

```typescript
import { MemoryClient } from "./memory.js"
import { loadConfig } from "./config.js"

interface ConversationBlock {
  type: string
  text: string
  [key: string]: unknown
}

/**
 * Sync a pipeline step's conversation to EverMemOS.
 * Only sends user + assistant text messages (no tools, thinking, etc).
 * Silently fails — never throws.
 */
export async function syncStepConversation(
  workId: string,
  workTitle: string,
  stepKey: string,
  stepName: string,
  blocks: ConversationBlock[],
): Promise<void> {
  try {
    const config = await loadConfig()
    if (!config.memory?.syncEnabled || !config.memory?.apiKey) return

    const client = new MemoryClient(config.memory.apiKey, config.memory.userId || "autoviral-user")

    // Filter to user + assistant text only
    const filtered = blocks.filter(b => b.type === "user" || b.type === "text")
    if (filtered.length === 0) return

    // Format as conversation
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
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/memory-sync.ts
git commit -m "feat: add memory sync service for step conversations"
```

---

### Task 5: ws-bridge 中触发记忆同步

**Files:**
- Modify: `src/ws-bridge.ts`

- [ ] **Step 1: 导入同步函数**

在 `ws-bridge.ts` 顶部添加：

```typescript
import { syncStepConversation } from "./memory-sync.js"
```

- [ ] **Step 2: 在 pipeline advance 时触发同步**

找到 `POST /api/works/:id/pipeline/advance` 的处理逻辑（在 `api.ts` 中），在标记步骤为 done 之后、广播 pipeline_updated 之前，添加同步调用。

或者更好的位置：在 `ws-bridge.ts` 的 `proc.on("exit")` 中，当非趋势 session 的 CLI 完成时，读取步骤历史并同步。

最简洁的方式是在 `api.ts` 的 `POST /pipeline/advance` 端点中添加：

```typescript
// After marking step as done, sync conversation to memory
if (completedStep) {
  const history = await loadStepHistory(id, completedStep)
  if (history?.blocks) {
    const work = await getWork(id)
    syncStepConversation(
      id,
      work?.title ?? "Untitled",
      completedStep,
      work?.pipeline?.[completedStep]?.name ?? completedStep,
      history.blocks,
    ).catch(() => {}) // fire and forget
  }
}
```

注意：`syncStepConversation` 已经内部 try-catch，但 `loadStepHistory` 可能失败，所以外层也 catch。

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/ws-bridge.ts src/server/api.ts
git commit -m "feat: trigger memory sync on pipeline step completion"
```

---

### Task 6: Settings 页面新增配置项

**Files:**
- Modify: `web/src/pages/SettingsPanel.svelte`

- [ ] **Step 1: 添加状态变量**

在 script 区域的状态变量中添加：

```typescript
let douyinUrl = $state("")
let analyticsEnabled = $state(true)
let memorySyncEnabled = $state(false)
```

- [ ] **Step 2: loadConfig 中读取新字段**

```typescript
douyinUrl = data.douyinUrl ?? ""
analyticsEnabled = data.analyticsEnabled ?? true
memorySyncEnabled = data.memorySyncEnabled ?? false
```

- [ ] **Step 3: saveConfig 中发送新字段**

在 save body 中添加 `douyinUrl`, `analyticsEnabled`, `memorySyncEnabled`。

- [ ] **Step 4: 添加 UI**

在设置面板中，API 密钥部分之后，添加两个新分组：

**创作者数据采集：**
- 抖音主页 URL 输入框
- 启用/禁用开关

**记忆同步：**
- EverMemOS 同步开关
- 说明文字："开启后，每次创作完成时自动将对话记录同步到 EverMemOS，让 AI 记住你的创作历史。需要配置 EVERMEMOS_API_KEY。"

- [ ] **Step 5: 更新后端 config API 以支持新字段**

在 `api.ts` 的 `GET /api/config` 和 `POST /api/config` 中确保 `douyinUrl`, `analyticsEnabled`, `memorySyncEnabled` 字段能读写。

- [ ] **Step 6: 编译验证**

```bash
npm run build:frontend
```

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/SettingsPanel.svelte src/server/api.ts
git commit -m "feat(settings): add douyin URL and memory sync toggle"
```

---

### Task 7: Analytics 页面重写

**Files:**
- Modify: `web/src/pages/Analytics.svelte`

- [ ] **Step 1: 重写 Analytics 页面**

整体替换为创作者数据仪表盘。分两种状态：

**未配置状态**（douyinUrl 为空）：
- 引导用户输入抖音主页 URL
- 输入框 + "开始采集"按钮
- 保存后触发首次采集

**已配置状态**：
- 顶部 4 个统计卡片：粉丝数（+变化）、总获赞、平均播放量、互动率
- 作品表现列表：最近 20 条作品的播放/点赞/评论/分享/收藏
- 底部标注：上次采集时间

**数据源**：
- `GET /api/analytics/creator` → 最新数据 + delta
- `GET /api/config` → 检查是否配置了 douyinUrl

- [ ] **Step 2: 编译验证**

```bash
npm run build:frontend
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Analytics.svelte
git commit -m "feat(analytics): rewrite with real creator data dashboard"
```

---

### Task 8: Skill 提示词更新

**Files:**
- Modify: `skills/trend-research/SKILL.md`
- Modify: `skills/content-planning/SKILL.md`

- [ ] **Step 1: 更新 trend-research SKILL.md**

在"研究流程"部分之前，添加：

```markdown
## 可用数据源

在调研过程中，你可以访问以下数据来了解用户的账号情况和历史经验：

- **创作者数据**：`curl http://localhost:3271/api/analytics/creator` 获取粉丝数、互动率、最近作品表现，据此推荐适合用户量级的内容策略
- **历史记忆**：`curl "http://localhost:3271/api/memory/search?q=关键词&method=hybrid&topK=5"` 搜索历史创作经验，避免重复选题
- **用户画像**：`curl http://localhost:3271/api/memory/profile` 获取创作风格档案

这些数据源是可选的。如果请求失败（返回空或 404），说明用户未配置相应服务，直接跳过即可。
```

- [ ] **Step 2: 更新 content-planning SKILL.md**

在"策划流程"部分之前，添加类似段落，但侧重于规划场景：

```markdown
## 可用数据源

在规划内容时，你可以参考用户的真实账号数据和历史经验：

- **创作者数据**：`curl http://localhost:3271/api/analytics/creator` 了解粉丝量级和内容表现，据此调整内容难度和定位
- **历史记忆**：`curl "http://localhost:3271/api/memory/search?q=相关主题&method=hybrid&topK=5"` 查看过去类似主题的创作经验
- **用户画像**：`curl http://localhost:3271/api/memory/profile` 了解用户的创作风格偏好

这些数据源是可选的。请求失败时直接跳过，不影响规划流程。
```

- [ ] **Step 3: Commit**

```bash
git add skills/trend-research/SKILL.md skills/content-planning/SKILL.md
git commit -m "feat(skills): add data source prompts for analytics and memory access"
```

---

### Task 9: 集成测试

- [ ] **Step 1: 编译全部**

```bash
npm run build:backend && npm run build:frontend
```

- [ ] **Step 2: 重启服务**

```bash
node dist/index.js stop; sleep 1; node dist/index.js start
```

- [ ] **Step 3: 测试 Analytics API**

```bash
# 应该返回 configured: false（未配置 URL）
curl http://localhost:3271/api/analytics/creator

# 配置 URL
curl -X POST http://localhost:3271/api/config \
  -H "Content-Type: application/json" \
  -d '{"douyinUrl":"https://www.douyin.com/user/xxx","analyticsEnabled":true}'

# 查看历史
curl http://localhost:3271/api/analytics/creator/history
```

- [ ] **Step 4: 测试记忆同步配置**

```bash
# 开启记忆同步
curl -X POST http://localhost:3271/api/config \
  -H "Content-Type: application/json" \
  -d '{"memorySyncEnabled":true}'
```

- [ ] **Step 5: 浏览器验证**

打开 http://localhost:3271 → 设置页面验证新配置项 → Analytics 页面验证仪表盘

- [ ] **Step 6: 更新 Skills 安装**

```bash
node dist/postinstall.js
```

- [ ] **Step 7: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete analytics + memory sync integration"
```
