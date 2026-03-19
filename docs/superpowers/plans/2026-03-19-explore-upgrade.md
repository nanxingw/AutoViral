# Explore 升级：兴趣驱动的智能趋势研究中心

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Explore 从"简单热搜刷新"升级为"兴趣驱动的智能研究中心"，集成脚本数据获取、用户兴趣配置、增强版卡片展示。

**Architecture:** 分三层——数据层（Python 脚本获取实时热搜）、分析层（AI 结合用户兴趣和平台知识做深度分析）、展示层（前端增强卡片 + 兴趣标签管理）。后端 `refresh-stream` 改为先跑脚本再 AI 分析，前端新增兴趣配置区和更丰富的卡片字段。

**Tech Stack:** TypeScript (Hono server), Svelte 5 (runes mode), Python 3 scripts, WebSocket streaming

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/config.ts` | 修改 | Config 接口新增 `interests` 字段 |
| `src/server/api.ts` | 修改 | 新增兴趣 CRUD 端点 + 升级 refresh-stream 研究逻辑 |
| `src/ws-bridge.ts` | 修改 | `createTrendSession` 支持预执行脚本 |
| `web/src/pages/Explore.svelte` | 修改 | 兴趣标签栏 + 增强版卡片 + 新数据模型 |
| `web/src/components/InterestTags.svelte` | 新建 | 可编辑的兴趣标签组件 |

---

### Task 1: Config 层 — 新增 interests 字段

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: 在 Config 接口中添加 interests 字段**

在 `src/config.ts` 的 `Config` 接口中，`research` 字段后面添加：

```typescript
interests?: string[]  // 用户关注的内容领域，如 ["美食", "科技", "穿搭"]
```

- [ ] **Step 2: 在 loadConfig 中设置默认值**

在 `loadConfig()` 函数的默认值合并逻辑中，确保 `interests` 有默认空数组：

```typescript
interests: raw.interests ?? [],
```

- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit
```
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add interests field for user topic preferences"
```

---

### Task 2: 后端 API — 兴趣 CRUD 端点

**Files:**
- Modify: `src/server/api.ts`
- Modify: `src/config.ts`（如需导出 saveConfig）

- [ ] **Step 1: 确认 config 有写入能力**

检查 `src/config.ts` 是否导出了 `saveConfig` 或类似函数。如果没有，添加一个：

```typescript
export async function saveConfig(config: Partial<Config>): Promise<void> {
  const configPath = join(dataDir, 'config.yaml')
  const existing = await loadConfig()
  const merged = { ...existing, ...config }
  await writeFile(configPath, yaml.dump(merged, { lineWidth: -1 }), 'utf-8')
}
```

- [ ] **Step 2: 添加 GET /api/interests 端点**

在 `src/server/api.ts` 的趋势相关路由附近添加：

```typescript
// GET /api/interests — 获取用户兴趣列表
apiRoutes.get("/api/interests", async (c) => {
  const config = await loadConfig()
  return c.json({ interests: config.interests ?? [] })
})
```

- [ ] **Step 3: 添加 PUT /api/interests 端点**

```typescript
// PUT /api/interests — 更新用户兴趣列表
apiRoutes.put("/api/interests", async (c) => {
  try {
    const body = await c.req.json<{ interests: string[] }>()
    const interests = body.interests ?? []
    await saveConfig({ interests })
    return c.json({ success: true, interests })
  } catch (err) {
    return c.json({ error: "Failed to save interests" }, 500)
  }
})
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 手动测试**

```bash
# 启动 dev server 后:
curl http://localhost:3271/api/interests
curl -X PUT http://localhost:3271/api/interests \
  -H "Content-Type: application/json" \
  -d '{"interests":["美食","科技","穿搭"]}'
curl http://localhost:3271/api/interests
```

Expected: 第二次 GET 返回 `{"interests":["美食","科技","穿搭"]}`

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/server/api.ts
git commit -m "feat(api): add interests CRUD endpoints"
```

---

### Task 3: 后端 — 升级 refresh-stream 研究逻辑

**Files:**
- Modify: `src/server/api.ts`（`refresh-stream` 路由和 `researchTrends` 函数）

这是核心改动：让研究流程先跑 Python 脚本获取实时数据，再让 AI 结合用户兴趣做深度分析。

- [ ] **Step 1: 创建脚本执行辅助函数**

在 `api.ts` 顶部（或独立的 `src/script-runner.ts`）添加：

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function runTrendScript(platform: string): Promise<string> {
  const scriptsDir = join(__dirname, '..', 'skills', 'trend-research', 'scripts')

  try {
    if (platform === 'douyin') {
      // 直接获取抖音热搜
      const { stdout } = await execFileAsync('python3', [
        join(scriptsDir, 'douyin_hot_search.py'), '--top', '30'
      ], { timeout: 30000 })
      return stdout
    }

    // 其他平台用 newsnow
    const { stdout } = await execFileAsync('python3', [
      join(scriptsDir, 'newsnow_trends.py'), platform, '--top', '20'
    ], { timeout: 30000 })
    return stdout
  } catch (err) {
    // 脚本失败不阻断流程，返回空让 AI 用 WebSearch 兜底
    console.error(`Script error for ${platform}:`, err)
    return ''
  }
}
```

- [ ] **Step 2: 升级 refresh-stream 的 prompt 构建**

替换 `refresh-stream` 路由中的 prompt 构建逻辑。新逻辑：先跑脚本获取数据，把数据注入 prompt，让 AI 做深度分析。

```typescript
apiRoutes.post("/api/trends/refresh-stream", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503)

  try {
    const body = await c.req.json<{ platform?: string }>().catch(() => ({}))
    const platform = (body as any).platform ?? "douyin"
    const platformLabel = platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : platform

    const sessionKey = `trends_${platform}_${Date.now()}`

    // 1. 获取用户兴趣
    const config = await loadConfig()
    const interests = config.interests ?? []
    const interestClause = interests.length > 0
      ? `\n用户特别关注以下领域：${interests.join("、")}。请优先覆盖这些领域的趋势，同时也包含其他热门方向。\n`
      : ''

    // 2. 跑脚本获取实时数据
    const scriptData = await runTrendScript(platform)
    const dataClause = scriptData
      ? `\n以下是通过 API 获取的 ${platformLabel} 实时热搜数据，请以此为基础进行分析：\n\`\`\`json\n${scriptData.slice(0, 4000)}\n\`\`\`\n`
      : `\n无法通过 API 获取实时数据，请使用 WebSearch 搜索最新热搜信息。\n`

    // 3. 构建增强版 prompt
    const prompt = [
      `你是一个专业的社交媒体趋势研究员。请分析 ${platformLabel} 平台当前最热门的内容趋势。`,
      dataClause,
      interestClause,
      `如果上面的 API 数据不够充分，请使用 WebSearch 补充搜索：`,
      `- "${platformLabel} 爆款内容 趋势 2026"`,
      `- "${platformLabel} 热门话题 最新"`,
      ``,
      `根据所有信息，输出以下 JSON 格式（只输出 JSON，不要其他文字）：`,
      `{"topics":[{`,
      `  "title":"话题标题",`,
      `  "heat":4,`,
      `  "competition":"中",`,
      `  "opportunity":"金矿",`,
      `  "description":"趋势描述和为什么值得做",`,
      `  "tags":["推荐标签1","推荐标签2","推荐标签3"],`,
      `  "contentAngles":["切入角度1","切入角度2"],`,
      `  "exampleHook":"爆款开头示例，如：你绝对想不到...",`,
      `  "category":"所属领域"`,
      `}]}`,
      ``,
      `要求：`,
      `- topics 至少 10 个`,
      `- heat 为 1-5 整数`,
      `- competition 为 "低"/"中"/"高"`,
      `- opportunity 为 "金矿"(高热低竞)/"蓝海"(低热低竞)/"红海"(高热高竞)`,
      `- tags 3-5 个平台推荐标签`,
      `- contentAngles 2-3 个具体的内容切入角度`,
      `- exampleHook 一句话的爆款开头示例`,
      `- category 为话题所属领域（如 美食/科技/穿搭/生活/情感/职场/健身/旅行/宠物/教育）`,
    ].join("\n")

    await wsBridge.createTrendSession(sessionKey, prompt)
    return c.json({ sessionKey, platform })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to start research" }, 500)
  }
})
```

- [ ] **Step 3: 同步升级非流式 researchTrends 函数**

用相同的逻辑升级 `researchTrends()` 函数（用于后台定时调研），确保它也使用脚本数据和新的 JSON 格式。

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts
git commit -m "feat(explore): upgrade research with scripts + interests + rich output"
```

---

### Task 4: 前端 — InterestTags 组件

**Files:**
- Create: `web/src/components/InterestTags.svelte`

- [ ] **Step 1: 创建可编辑的兴趣标签组件**

```svelte
<script lang="ts">
  let { interests = $bindable([]), onUpdate }: {
    interests: string[]
    onUpdate: (interests: string[]) => void
  } = $props()

  let editing = $state(false)
  let inputValue = $state("")

  const PRESET_TOPICS = [
    "美食", "科技", "穿搭", "美妆", "生活",
    "情感", "职场", "健身", "旅行", "宠物",
    "教育", "游戏", "音乐", "家居", "育儿",
  ]

  let suggestions = $derived(
    PRESET_TOPICS.filter(t => !interests.includes(t) && t.includes(inputValue))
  )

  function addInterest(topic: string) {
    if (topic && !interests.includes(topic)) {
      interests = [...interests, topic]
      onUpdate(interests)
    }
    inputValue = ""
  }

  function removeInterest(topic: string) {
    interests = interests.filter(t => t !== topic)
    onUpdate(interests)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault()
      addInterest(inputValue.trim())
    }
    if (e.key === "Escape") {
      editing = false
      inputValue = ""
    }
  }
</script>

<div class="interest-section">
  <div class="interest-header">
    <span class="interest-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      我的关注领域
    </span>
    {#if !editing}
      <button class="edit-btn" onclick={() => editing = true}>编辑</button>
    {:else}
      <button class="edit-btn done" onclick={() => { editing = false; inputValue = "" }}>完成</button>
    {/if}
  </div>

  <div class="tags-row">
    {#each interests as topic}
      <span class="interest-tag">
        {topic}
        {#if editing}
          <button class="remove-btn" onclick={() => removeInterest(topic)}>&times;</button>
        {/if}
      </span>
    {/each}

    {#if editing}
      <div class="input-wrapper">
        <input
          type="text"
          class="tag-input"
          placeholder="输入领域..."
          bind:value={inputValue}
          onkeydown={handleKeydown}
        />
        {#if inputValue && suggestions.length > 0}
          <div class="suggestions">
            {#each suggestions.slice(0, 5) as s}
              <button class="suggestion-item" onclick={() => addInterest(s)}>{s}</button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if interests.length === 0}
      <span class="empty-hint">点击编辑添加关注领域，获取更精准的趋势推荐</span>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: 添加样式**

在组件底部添加 `<style>` 块，使用项目现有的设计语言（glass card 风格、accent 色调、圆角标签）。关键样式要点：
- `.interest-tag`: 胶囊形标签，accent 半透明背景
- `.tag-input`: 内联输入框，无边框，融入标签行
- `.suggestions`: 绝对定位下拉，glass 背景
- `.empty-hint`: 柔和提示文字

- [ ] **Step 3: Commit**

```bash
git add web/src/components/InterestTags.svelte
git commit -m "feat(ui): add InterestTags component for user topic preferences"
```

---

### Task 5: 前端 — Explore 页面升级

**Files:**
- Modify: `web/src/pages/Explore.svelte`

- [ ] **Step 1: 更新数据模型**

在 `Explore.svelte` 的 `<script>` 中，更新 `TrendDirection` 接口：

```typescript
interface TrendDirection {
  title: string
  heat: number
  competition: string
  opportunity?: string       // 金矿/蓝海/红海
  description: string
  tags?: string[]            // 推荐标签
  contentAngles?: string[]   // 内容切入角度
  exampleHook?: string       // 爆款钩子示例
  category?: string          // 所属领域
}
```

- [ ] **Step 2: 添加兴趣状态管理**

```typescript
import InterestTags from "../components/InterestTags.svelte"

let interests: string[] = $state([])

async function loadInterests() {
  try {
    const res = await fetch("/api/interests")
    if (res.ok) {
      const data = await res.json()
      interests = data.interests ?? []
    }
  } catch {}
}

async function saveInterests(updated: string[]) {
  interests = updated
  await fetch("/api/interests", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interests: updated }),
  }).catch(() => {})
}

onMount(() => {
  loadTrends()
  loadInterests()
})
```

- [ ] **Step 3: 在模板中加入 InterestTags**

在 `<ResearchProgress>` 组件之前插入：

```svelte
<InterestTags {interests} onUpdate={saveInterests} />
```

- [ ] **Step 4: 升级 parseTrends 兼容新字段**

更新 `parseTrends` 中的 map 逻辑，解析新字段：

```typescript
directions = arr.map((item: any) => ({
  title: item.title ?? item.name ?? "未知方向",
  heat: Math.min(5, Math.max(1, Number(item.heat ?? 3))),
  competition: item.competition ?? "中",
  opportunity: item.opportunity ?? "",
  description: item.description ?? "",
  tags: Array.isArray(item.tags) ? item.tags : [],
  contentAngles: Array.isArray(item.contentAngles) ? item.contentAngles : [],
  exampleHook: item.exampleHook ?? "",
  category: item.category ?? "",
}))
```

- [ ] **Step 5: 升级卡片模板**

替换 `.trend-grid` 内的卡片渲染。新增：机会评级徽标、标签 chips、切入角度列表、钩子预览。

```svelte
<div class="trend-card" style="animation-delay: {i * 0.05}s">
  <div class="card-header">
    <div class="title-row">
      {#if dir.category}
        <span class="category-badge">{dir.category}</span>
      {/if}
      <h3 class="card-title">{dir.title}</h3>
    </div>
    <div class="badges">
      {#if dir.opportunity}
        <span class="opportunity-badge"
          class:opp-gold={dir.opportunity === "金矿"}
          class:opp-blue={dir.opportunity === "蓝海"}
          class:opp-red={dir.opportunity === "红海"}
        >{dir.opportunity}</span>
      {/if}
      <span class="competition-badge"
        class:comp-low={dir.competition === "低"}
        class:comp-mid={dir.competition === "中"}
        class:comp-high={dir.competition === "高"}
      >竞争{dir.competition}</span>
    </div>
  </div>

  <div class="heat-row">
    <span class="heat-label">热度</span>
    <span class="heat-dots">{heatDots(dir.heat)}</span>
  </div>

  {#if dir.description}
    <p class="card-desc">{dir.description}</p>
  {/if}

  {#if dir.contentAngles && dir.contentAngles.length > 0}
    <div class="angles-section">
      <span class="section-label">切入角度</span>
      <ul class="angles-list">
        {#each dir.contentAngles as angle}
          <li>{angle}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if dir.exampleHook}
    <div class="hook-preview">
      <span class="section-label">爆款钩子</span>
      <p class="hook-text">"{dir.exampleHook}"</p>
    </div>
  {/if}

  {#if dir.tags && dir.tags.length > 0}
    <div class="tags-row-card">
      {#each dir.tags as tag}
        <span class="tag-chip">#{tag}</span>
      {/each}
    </div>
  {/if}

  <button class="create-btn" onclick={() => dispatchCreate(dir)}>
    以此创建作品
  </button>
</div>
```

- [ ] **Step 6: 升级 dispatchCreate 传递完整数据**

```typescript
function dispatchCreate(dir: TrendDirection) {
  const hint = [
    dir.title,
    dir.description,
    dir.contentAngles?.length ? `切入角度: ${dir.contentAngles.join("; ")}` : "",
    dir.tags?.length ? `推荐标签: ${dir.tags.map(t => "#" + t).join(" ")}` : "",
  ].filter(Boolean).join("\n")

  const event = new CustomEvent("createWork", {
    bubbles: true,
    detail: { topicHint: hint, platform: activePlatform },
  })
  document.dispatchEvent(event)
}
```

- [ ] **Step 7: 添加新增字段的样式**

为新增的 UI 元素添加样式：
- `.opportunity-badge` + `.opp-gold`(绿色) / `.opp-blue`(蓝色) / `.opp-red`(红色)
- `.category-badge`: 小号淡色分类标签
- `.angles-section` + `.angles-list`: 紧凑的切入角度列表
- `.hook-preview` + `.hook-text`: 引号包裹的钩子示例，斜体
- `.tags-row-card` + `.tag-chip`: 行内小标签 chips
- `.section-label`: 统一的小节标签样式

- [ ] **Step 8: 验证**

```bash
npm run build:frontend
```
Expected: 无编译错误

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/Explore.svelte
git commit -m "feat(explore): upgrade with interests, rich cards, content angles"
```

---

### Task 6: Skill 文档更新

**Files:**
- Modify: `skills/trend-research/SKILL.md`

- [ ] **Step 1: 在 SKILL.md 中添加 Explore 模式说明**

在"研究流程"部分之前，添加：

```markdown
## Explore 集成

本 skill 的脚本工具同时为 Explore 页面提供数据支撑。Explore 页面会：
1. 调用 `scripts/douyin_hot_search.py` 或 `scripts/newsnow_trends.py` 获取实时热搜
2. 结合用户设置的兴趣领域，让 AI 做深度分析
3. 输出增强版 JSON（含机会评级、内容角度、爆款钩子、推荐标签）

当用户从 Explore 选择话题创建作品后，Pipeline 的 research 阶段可以读取已有的趋势数据，避免重复调研：

\```bash
# 读取 Explore 缓存的趋势数据
curl http://localhost:3271/api/trends/douyin
curl http://localhost:3271/api/trends/xiaohongshu
\```
```

- [ ] **Step 2: Commit**

```bash
git add skills/trend-research/SKILL.md
git commit -m "docs(skill): add Explore integration notes to trend-research"
```

---

### Task 7: 集成测试

- [ ] **Step 1: 编译后端**

```bash
npm run build:backend
```

- [ ] **Step 2: 编译前端**

```bash
npm run build:frontend
```

- [ ] **Step 3: 启动应用并手动验证**

```bash
npm run dev &
sleep 3

# 测试兴趣 API
curl http://localhost:3271/api/interests
curl -X PUT http://localhost:3271/api/interests \
  -H "Content-Type: application/json" \
  -d '{"interests":["美食","科技"]}'

# 测试增强版趋势刷新（非流式）
curl -X POST http://localhost:3271/api/trends/refresh \
  -H "Content-Type: application/json" \
  -d '{"platforms":["douyin"]}'

# 查看结果是否包含新字段
curl http://localhost:3271/api/trends/douyin | python3 -m json.tool
```

Expected: 趋势数据包含 `opportunity`、`tags`、`contentAngles`、`exampleHook`、`category` 字段

- [ ] **Step 4: 浏览器测试**

打开 `http://localhost:3271`，进入 Explore 页面：
1. 验证兴趣标签栏显示正常，可以添加/删除标签
2. 点击"刷新趋势"，验证进度条正常显示
3. 结果卡片应显示：机会评级徽标、切入角度、爆款钩子、标签 chips
4. 点击"以此创建作品"，验证传递了完整的 topicHint

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat(explore): complete upgrade with interests + scripts + rich cards"
```
