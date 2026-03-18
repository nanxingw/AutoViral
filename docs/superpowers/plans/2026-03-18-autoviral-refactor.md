# AutoViral 全面重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将AutoViral从evolution-cycle架构重构为聚焦AI内容创作的产品，支持即梦+NanoBanana多模型生成，4步pipeline，完整跑通小红书图文MVP。

**Architecture:** Server侧多模型Provider代理（HMAC签名/OpenRouter） + 4个专家级Claude Code Skill + 单Agent per Work（--resume连贯上下文） + Svelte 5前端（impeccable设计）。每个作品有独立workspace，公共素材库跨项目复用。

**Tech Stack:** TypeScript, Hono, Svelte 5, Claude CLI, 火山引擎API (即梦), OpenRouter API (NanoBanana/Gemini), ffmpeg, node-cron, dotenv

**Spec:** `docs/superpowers/specs/2026-03-18-autoviral-refactor-design.md`

---

## File Structure Map

### 删除的文件
```
src/executor.ts
src/scheduler.ts
src/prompt.ts
src/publish-engine.ts
src/data-collector.ts
src/reports.ts
src/cron.ts
src/task-store.ts
src/platforms/base.ts
src/platforms/xiaohongshu.ts
src/platforms/douyin.ts
src/server/ws.ts
skills/skill-evolver/ (entire directory)
skills/user-context/ (entire directory)
skills/task-planner/ (entire directory)
web/src/pages/Dashboard.svelte
web/src/pages/DataBrowser.svelte
web/src/pages/Ideas.svelte
web/src/pages/Reports.svelte
web/src/pages/Tasks.svelte
web/src/pages/FeatureDetail.svelte
web/src/pages/Settings.svelte (重写为侧边栏)
```

### 新建的文件
```
# Backend - Provider层
src/providers/base.ts              # GenerateProvider接口定义
src/providers/jimeng.ts            # 即梦Provider（HMAC签名+轮询）
src/providers/nanobanana.ts        # NanoBanana Provider（OpenRouter chat completions）
src/providers/registry.ts          # Provider注册与路由

# Backend - 核心模块
src/shared-assets.ts               # 公共素材库管理
src/research-scheduler.ts          # 轻量定时调研（node-cron）

# Skills (安装到 ~/.claude/skills/)
skills/trend-research/SKILL.md     # 调研skill
skills/content-planning/SKILL.md   # 规划skill
skills/asset-generation/SKILL.md   # 素材生成skill
skills/content-assembly/SKILL.md   # 成品合成skill

# Frontend
web/src/pages/Works.svelte         # 作品画廊页
web/src/pages/SettingsPanel.svelte  # 设置侧边栏
web/src/components/SharedAssets.svelte # 公共素材面板

# Tests
tests/providers/jimeng.test.ts     # 即梦Provider测试
tests/providers/nanobanana.test.ts  # NanoBanana测试
tests/work-store.test.ts           # Work store测试
tests/shared-assets.test.ts        # 公共素材测试
tests/e2e/mvp-flow.test.ts         # MVP端到端验证
```

### 修改的文件
```
src/config.ts                      # 简化配置，新增jimeng/provider配置
src/work-store.ts                  # 4步pipeline，workspace目录结构
src/ws-bridge.ts                   # system prompt更新
src/memory.ts                      # 保留，微调
src/server/index.ts                # 精简，去掉旧模块
src/server/api.ts                  # 精简路由 + 新增generate/shared-assets路由
src/index.ts                       # 入口精简
src/cli.ts                         # CLI精简
web/src/App.svelte                 # 新导航结构
web/src/lib/api.ts                 # 新API client
web/src/lib/ws.ts                  # 保留
web/src/lib/i18n.ts                # 更新翻译
web/src/pages/Explore.svelte       # 重写
web/src/pages/Studio.svelte        # 重写（4步pipeline）
web/src/pages/Analytics.svelte     # 简化
web/src/pages/Memory.svelte        # 保留
web/src/components/ChatPanel.svelte     # 保留，微调
web/src/components/PipelineSteps.svelte # 4步
web/src/components/AssetPanel.svelte    # workspace结构
web/src/components/NewWorkModal.svelte  # 简化类型选择
web/src/components/MarkdownBlock.svelte # 保留
package.json                       # 更新依赖
```

---

## Task 1: 清理旧代码 + 更新依赖

**Files:**
- Delete: `src/executor.ts`, `src/scheduler.ts`, `src/prompt.ts`, `src/publish-engine.ts`, `src/data-collector.ts`, `src/reports.ts`, `src/cron.ts`, `src/task-store.ts`, `src/platforms/`, `src/server/ws.ts`, `skills/skill-evolver/`, `skills/user-context/`, `skills/task-planner/`, `web/src/pages/Dashboard.svelte`, `web/src/pages/DataBrowser.svelte`, `web/src/pages/Ideas.svelte`, `web/src/pages/Reports.svelte`, `web/src/pages/Tasks.svelte`, `web/src/pages/FeatureDetail.svelte`, `web/src/pages/Settings.svelte`
- Modify: `package.json`, `src/index.ts`, `src/cli.ts`, `src/server/index.ts`

- [ ] **Step 1: 删除后端旧模块**

```bash
rm -f src/executor.ts src/scheduler.ts src/prompt.ts src/publish-engine.ts src/data-collector.ts src/reports.ts src/cron.ts src/task-store.ts src/server/ws.ts
rm -rf src/platforms/
```

- [ ] **Step 2: 删除旧skills**

```bash
rm -rf skills/skill-evolver/ skills/user-context/ skills/task-planner/
```

- [ ] **Step 3: 删除旧前端页面**

```bash
rm -f web/src/pages/Dashboard.svelte web/src/pages/DataBrowser.svelte web/src/pages/Ideas.svelte web/src/pages/Reports.svelte web/src/pages/Tasks.svelte web/src/pages/FeatureDetail.svelte web/src/pages/Settings.svelte
```

- [ ] **Step 4: 更新 package.json 依赖**

移除 `playwright` optional dependency，新增 `dotenv`, `node-cron`。

```bash
npm uninstall playwright 2>/dev/null; npm install dotenv node-cron && npm install -D @types/node-cron
```

- [ ] **Step 5: 精简 src/index.ts**

移除对 executor, scheduler, data-collector, publish-engine, task-store, reports 的所有 import 和使用。只保留 config, server, ws-bridge, memory, work-store 的引用。

- [ ] **Step 6: 精简 src/cli.ts**

移除 evolution, task, report 相关的 CLI 子命令。只保留 `start` (启动server) 和 `config` 命令。

- [ ] **Step 7: 精简 src/server/index.ts**

移除对旧模块的 import（executor, scheduler, publishEngine, dataCollector, taskStore 等）。只保留 apiRoutes, WsBridge, 静态文件服务。

- [ ] **Step 8: 验证编译通过**

```bash
npx tsc --noEmit
```

修复所有编译错误（主要是删除了的模块的引用）。

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: remove legacy modules (executor, scheduler, playwright, platforms, old skills)"
```

---

## Task 2: 简化 Config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: 重写 Config 接口**

新的配置结构，移除所有 evolution 相关字段：

```typescript
export interface Config {
  port: number
  model: string
  jimeng: { accessKey: string; secretKey: string }
  openrouter?: { apiKey: string }
  research: { enabled: boolean; schedule: string; platforms: string[] }
  memory?: { apiKey: string; userId: string }
}
```

- [ ] **Step 2: 更新 loadConfig / saveConfig**

加载 `.env` 文件，环境变量覆盖 config.yaml：

```typescript
import dotenv from 'dotenv'
dotenv.config()
// .env overrides
if (process.env.OPENROUTER_API_KEY) config.openrouter = { apiKey: process.env.OPENROUTER_API_KEY }
if (process.env.EVERMEMOS_API_KEY && config.memory) config.memory.apiKey = process.env.EVERMEMOS_API_KEY
```

默认值：`port: 3271`, `model: 'opus'`, `research.enabled: true`, `research.schedule: '0 9,21 * * *'`, `research.platforms: ['douyin', 'xiaohongshu']`

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/config.ts .env && git commit -m "refactor: simplify config for content-creation focus"
```

---

## Task 3: 重写 Work Store（4步Pipeline + Workspace）

**Files:**
- Modify: `src/work-store.ts`

- [ ] **Step 1: 更新类型定义**

```typescript
export type WorkType = 'short-video' | 'image-text'
export type WorkStatus = 'draft' | 'creating' | 'ready' | 'failed'
export interface Work {
  id: string; title: string; type: WorkType; status: WorkStatus
  platforms: string[]; pipeline: Record<string, PipelineStep>
  cliSessionId?: string; coverImage?: string; topicHint?: string
  createdAt: string; updatedAt: string
}
export interface PipelineStep {
  name: string; status: 'pending' | 'active' | 'done' | 'skipped'
  startedAt?: string; completedAt?: string; note?: string
}
```

- [ ] **Step 2: 新的 defaultPipeline**

```typescript
function defaultPipeline(type: WorkType): Record<string, PipelineStep> {
  const names: Record<string, Record<string, string>> = {
    'short-video': { research: '话题调研', plan: '分镜规划', assets: '素材生成', assembly: '视频合成' },
    'image-text':  { research: '话题调研', plan: '内容规划', assets: '图片生成', assembly: '图文排版' },
  }
  const result: Record<string, PipelineStep> = {}
  for (const [key, name] of Object.entries(names[type])) {
    result[key] = { name, status: 'pending' }
  }
  return result
}
```

- [ ] **Step 3: Workspace 目录创建**

`createWork` 创建完整workspace：

```typescript
const workDir = path.join(dataDir, 'works', id)
await fs.mkdir(path.join(workDir, 'research'), { recursive: true })
await fs.mkdir(path.join(workDir, 'plan'), { recursive: true })
await fs.mkdir(path.join(workDir, 'assets', 'frames'), { recursive: true })
await fs.mkdir(path.join(workDir, 'assets', 'clips'), { recursive: true })
await fs.mkdir(path.join(workDir, 'assets', 'images'), { recursive: true })
await fs.mkdir(path.join(workDir, 'output'), { recursive: true })
```

- [ ] **Step 4: 更新 listAssets**

递归列出 assets/ 和 output/ 下所有文件，返回带子目录的相对路径。

- [ ] **Step 5: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/work-store.ts && git commit -m "refactor: work-store with 4-step pipeline and workspace dirs"
```

---

## Task 4: Provider 基础架构 + 即梦 Provider

**Files:**
- Create: `src/providers/base.ts`, `src/providers/jimeng.ts`, `src/providers/registry.ts`

- [ ] **Step 1: 创建 Provider 接口 (`src/providers/base.ts`)**

```typescript
export interface ImageOpts {
  prompt: string
  width?: number
  height?: number
  referenceImage?: string
  workId: string
  filename: string
}

export interface VideoOpts {
  prompt: string
  firstFrame?: string
  lastFrame?: string
  resolution?: string
  workId: string
  filename: string
}

export interface GenerateResult {
  success: boolean
  assetPath?: string
  previewUrl?: string
  error?: string
  code?: 'TIMEOUT' | 'API_ERROR' | 'DOWNLOAD_FAILED' | 'INVALID_PARAMS'
}

export interface GenerateProvider {
  name: string
  supportsImage: boolean
  supportsVideo: boolean
  generateImage(opts: ImageOpts): Promise<GenerateResult>
  generateVideo(opts: VideoOpts): Promise<GenerateResult>
}
```

- [ ] **Step 2: 创建即梦 Provider (`src/providers/jimeng.ts`)**

实现火山引擎 HMAC-SHA256 签名 + 异步轮询逻辑：

关键函数：
- `signRequest(method, path, body, timestamp)` — HMAC-SHA256 签名，Region: cn-north-1, Service: cv
- `submitTask(reqKey, params)` — POST CVSync2AsyncSubmitTask
- `pollResult(taskId)` — 轮询 CVSync2AsyncGetResult，间隔2秒，超时5分钟
- `downloadAsset(url, destPath)` — 下载生成结果到本地
- `generateImage(opts)` — req_key: `jimeng_t2i_v31`
- `generateVideo(opts)` — req_key: `jimeng_vgfm_i2v_l20` (图生视频) / `jimeng_vgfm_t2v_l20` (文生视频)

使用 config 中的 accessKey/secretKey。参考火山引擎签名文档。

- [ ] **Step 3: 创建 Provider Registry (`src/providers/registry.ts`)**

```typescript
import { GenerateProvider } from './base.js'
import { JimengProvider } from './jimeng.js'

const providers = new Map<string, GenerateProvider>()

export function registerProvider(p: GenerateProvider) { providers.set(p.name, p) }
export function getProvider(name: string): GenerateProvider | undefined { return providers.get(name) }
export function getDefaultProvider(type: 'image' | 'video'): GenerateProvider | undefined {
  for (const p of providers.values()) {
    if (type === 'image' && p.supportsImage) return p
    if (type === 'video' && p.supportsVideo) return p
  }
  return undefined
}
export function listProviders(): { name: string; image: boolean; video: boolean }[] {
  return [...providers.values()].map(p => ({ name: p.name, image: p.supportsImage, video: p.supportsVideo }))
}

export function initProviders(config: any) {
  if (config.jimeng?.accessKey) {
    registerProvider(new JimengProvider(config.jimeng))
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/ && git commit -m "feat: add provider architecture with Jimeng implementation"
```

---

## Task 5: NanoBanana Provider (OpenRouter)

**Files:**
- Create: `src/providers/nanobanana.ts`
- Modify: `src/providers/registry.ts`

- [ ] **Step 1: 创建 NanoBanana Provider (`src/providers/nanobanana.ts`)**

通过 OpenRouter chat completions API 调用 Gemini 图片生成模型：

```typescript
import { GenerateProvider, ImageOpts, VideoOpts, GenerateResult } from './base.js'

export class NanoBananaProvider implements GenerateProvider {
  name = 'nanobanana'
  supportsImage = true
  supportsVideo = false  // NanoBanana只支持图片
  private apiKey: string

  constructor(apiKey: string) { this.apiKey = apiKey }

  async generateImage(opts: ImageOpts): Promise<GenerateResult> {
    // POST https://openrouter.ai/api/v1/chat/completions
    // model: "google/gemini-3-pro-image-preview" (Nano Banana Pro)
    // modalities: ["text", "image"]
    // messages: [{ role: "user", content: [{ type: "text", text: opts.prompt }] }]
    // 响应中的 base64 图片数据写入文件
  }

  async generateVideo(_opts: VideoOpts): Promise<GenerateResult> {
    return { success: false, error: 'NanoBanana does not support video generation', code: 'INVALID_PARAMS' }
  }
}
```

关键实现细节：
- Headers: `Authorization: Bearer ${apiKey}`, `Content-Type: application/json`, `HTTP-Referer: http://localhost:3271`
- 模型ID: `google/gemini-3-pro-image-preview`
- 响应解析：从 `choices[0].message.content` 中提取 base64 图片（`data:image/png;base64,...`）
- 将 base64 解码写入 `~/.skill-evolver/works/{workId}/assets/images/{filename}`

- [ ] **Step 2: 注册到 Registry**

`src/providers/registry.ts` 的 `initProviders` 中新增：

```typescript
if (config.openrouter?.apiKey) {
  registerProvider(new NanoBananaProvider(config.openrouter.apiKey))
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/providers/nanobanana.ts src/providers/registry.ts && git commit -m "feat: add NanoBanana provider via OpenRouter"
```

---

## Task 6: 公共素材库 + Research Scheduler

**Files:**
- Create: `src/shared-assets.ts`, `src/research-scheduler.ts`

- [ ] **Step 1: 创建公共素材库模块 (`src/shared-assets.ts`)**

```typescript
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataDir } from './config.js'

const SHARED_DIR = path.join(dataDir, 'shared-assets')
const CATEGORIES = ['characters', 'music', 'templates'] as const

export async function ensureSharedDirs() {
  for (const cat of CATEGORIES) {
    await fs.mkdir(path.join(SHARED_DIR, cat), { recursive: true })
  }
}

export async function listSharedAssets(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {}
  for (const cat of CATEGORIES) {
    const dir = path.join(SHARED_DIR, cat)
    try {
      result[cat] = await fs.readdir(dir)
    } catch { result[cat] = [] }
  }
  return result
}

export function getSharedAssetPath(category: string, filename: string): string {
  return path.join(SHARED_DIR, category, filename)
}
```

- [ ] **Step 2: 创建调研调度器 (`src/research-scheduler.ts`)**

```typescript
import cron from 'node-cron'
import { loadConfig } from './config.js'

let task: cron.ScheduledTask | null = null

export function startResearchScheduler() {
  const config = loadConfig()
  if (!config.research.enabled) return
  task = cron.schedule(config.research.schedule, async () => {
    // 触发调研逻辑（通过WsBridge启动临时CLI session或直接调用API）
    console.log('[research-scheduler] Triggering trend research...')
    // 实现在 API 路由层，这里只触发事件
  })
}

export function stopResearchScheduler() {
  task?.stop()
  task = null
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/shared-assets.ts src/research-scheduler.ts && git commit -m "feat: add shared assets library and research scheduler"
```

---

## Task 7: 精简 API 路由 + 新增 Generate/SharedAssets 路由

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: 删除所有旧路由**

从 `api.ts` 中移除所有以下路由及其handler：
- `/api/trigger`, `/api/platforms/*`, `/api/collector/*`, `/api/tasks/*`, `/api/reports/*`, `/api/skills/*`
- 移除对已删除模块的 import

- [ ] **Step 2: 新增 Generate 路由**

```typescript
// POST /api/generate/image
app.post('/api/generate/image', async (c) => {
  const { workId, prompt, width, height, filename, provider: providerName } = await c.req.json()
  const provider = providerName ? getProvider(providerName) : getDefaultProvider('image')
  if (!provider) return c.json({ success: false, error: 'No image provider available', code: 'INVALID_PARAMS' }, 400)
  const result = await provider.generateImage({ prompt, width, height, workId, filename })
  return c.json(result)
})

// POST /api/generate/video
app.post('/api/generate/video', async (c) => {
  const { workId, prompt, firstFrame, lastFrame, resolution, filename, provider: providerName } = await c.req.json()
  const provider = providerName ? getProvider(providerName) : getDefaultProvider('video')
  if (!provider) return c.json({ success: false, error: 'No video provider available', code: 'INVALID_PARAMS' }, 400)
  const result = await provider.generateVideo({ prompt, firstFrame, lastFrame, resolution, workId, filename })
  return c.json(result)
})

// GET /api/generate/providers
app.get('/api/generate/providers', (c) => c.json(listProviders()))
```

- [ ] **Step 3: 新增 Shared Assets 路由**

```typescript
// GET /api/shared-assets
app.get('/api/shared-assets', async (c) => c.json(await listSharedAssets()))

// GET /api/shared-assets/:category/:file
app.get('/api/shared-assets/:category/:file', async (c) => {
  const filePath = getSharedAssetPath(c.req.param('category'), c.req.param('file'))
  // 检测MIME类型，返回文件
})

// POST /api/shared-assets/:category (multipart upload)
// DELETE /api/shared-assets/:category/:file
```

- [ ] **Step 4: 新增 Trends 路由**

```typescript
// GET /api/trends/:platform — 返回缓存的调研数据
// POST /api/trends/refresh — 手动触发调研
```

- [ ] **Step 5: 更新资产文件服务**

`GET /api/works/:id/assets/:file` 和 `GET /api/works/:id/assets/*` — 支持workspace子目录，正确设置 Content-Type。

- [ ] **Step 6: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/server/api.ts && git commit -m "refactor: clean API routes, add generate and shared-assets endpoints"
```

---

## Task 8: 更新 WsBridge System Prompt

**Files:**
- Modify: `src/ws-bridge.ts`

- [ ] **Step 1: 更新 system prompt 模板**

替换 `createSession` 中的 system prompt 为新模板，包含：
- 作品类型、平台、当前阶段
- API能力（generate/image, generate/video, shared-assets）
- workspace路径
- 公共素材信息
- 记忆上下文（可选）
- 规则（逐个确认、阶段切换、方向指定等）

参考 spec Section 4 的 System Prompt 模板。

- [ ] **Step 2: 注入公共素材信息**

在创建session时，调用 `listSharedAssets()` 获取公共素材列表，注入到 system prompt 中。

- [ ] **Step 3: 注入记忆上下文**

如果 memory 配置存在，调用 `memory.buildContext(topicHint, platforms)` 获取记忆上下文。

- [ ] **Step 4: 移除旧 prompt 逻辑**

删除对 `prompt.ts` 的引用和旧的 evolution prompt 逻辑。

- [ ] **Step 5: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/ws-bridge.ts && git commit -m "feat: update WsBridge system prompt for content creation workflow"
```

---

## Task 9: Server 入口整合

**Files:**
- Modify: `src/server/index.ts`, `src/index.ts`

- [ ] **Step 1: 更新 server/index.ts**

启动流程：
1. loadConfig
2. initProviders(config)
3. ensureSharedDirs()
4. 创建 WsBridge
5. 挂载 apiRoutes
6. 启动 HTTP server + WebSocket upgrade
7. startResearchScheduler()
8. 服务静态前端文件

- [ ] **Step 2: 精简 index.ts 入口**

CLI入口简化为只有 `start` 命令（启动server）和 `config` 命令（查看/编辑配置）。

- [ ] **Step 3: 验证 server 启动**

```bash
npm run build && node dist/index.js start
```

确认服务启动无错误，能访问 http://localhost:3271。

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts src/index.ts src/cli.ts && git commit -m "refactor: integrate new modules into server startup"
```

---

## Task 10: Skill — trend-research

**Files:**
- Create: `skills/trend-research/SKILL.md`

- [ ] **Step 1: 调研优秀 skill 作为参考**

在 GitHub 搜索优秀的 Claude Code skill 示例（特别是调研/分析类skill），提取最佳实践：
- 输出结构化程度
- 指令清晰度
- 错误处理指导

- [ ] **Step 2: 编写 trend-research skill**

`skills/trend-research/SKILL.md` 核心内容：
- 两种模式：广度（无topicHint时调研热门趋势）和深度（有topicHint时围绕方向深挖）
- 使用 WebSearch 搜索抖音/小红书当前热门
- 分析爆款共性（节奏、话题、标签、风格）
- 输出结构化调研报告（热门方向、推荐标签、爆款分析、建议方向）
- 注入该领域的专业知识（社交媒体算法、热度评估方法等）

- [ ] **Step 3: 安装 skill**

```bash
mkdir -p ~/.claude/skills/trend-research
cp skills/trend-research/SKILL.md ~/.claude/skills/trend-research/SKILL.md
```

- [ ] **Step 4: Commit**

```bash
git add skills/trend-research/ && git commit -m "feat: add trend-research skill"
```

---

## Task 11: Skill — content-planning

**Files:**
- Create: `skills/content-planning/SKILL.md`

- [ ] **Step 1: 编写 content-planning skill**

核心内容：
- 短视频：输出分镜表，每镜包含编号、画面描述、首帧描述（直接可用于生图prompt）、时长、文案/旁白、镜头运动、尾帧描述（可选）
- 图文：输出图文结构，每张图包含内容描述（直接可用于生图prompt）、配文
- 人物一致性方案：如果公共素材库有人物参考图，说明如何在每镜保持一致
- 风格定义：色调、节奏、情绪
- 配乐建议：引用公共素材库中的配乐或描述所需配乐风格
- 平台标签和发布文案
- 注入专业知识：短视频构图原则、叙事节奏、镜头语言（推拉摇移跟）、小红书/抖音内容策略

- [ ] **Step 2: 安装 skill**

```bash
mkdir -p ~/.claude/skills/content-planning
cp skills/content-planning/SKILL.md ~/.claude/skills/content-planning/SKILL.md
```

- [ ] **Step 3: Commit**

```bash
git add skills/content-planning/ && git commit -m "feat: add content-planning skill"
```

---

## Task 12: Skill — asset-generation

**Files:**
- Create: `skills/asset-generation/SKILL.md`

- [ ] **Step 1: 编写 asset-generation skill**

核心内容：
- 读取上一阶段的分镜表/图文结构
- 逐个素材：描述计划 → 等用户确认 → 调用API → 展示预览 → 等反馈
- 短视频流程：先用 `curl localhost:3271/api/generate/image` 生成首帧 → 再用 `curl localhost:3271/api/generate/video` 首帧图生视频
- 图文流程：直接用 `curl localhost:3271/api/generate/image` 生成
- 引用公共素材：`curl localhost:3271/api/shared-assets` 查看可用素材
- 支持：重新生成、调整prompt、用户上传替代
- 跟踪进度：维护已生成素材清单
- 注入专业知识：AI生图prompt工程（正向/负向提示词、风格控制）、分辨率选择

- [ ] **Step 2: 安装 skill**

```bash
mkdir -p ~/.claude/skills/asset-generation
cp skills/asset-generation/SKILL.md ~/.claude/skills/asset-generation/SKILL.md
```

- [ ] **Step 3: Commit**

```bash
git add skills/asset-generation/ && git commit -m "feat: add asset-generation skill"
```

---

## Task 13: Skill — content-assembly

**Files:**
- Create: `skills/content-assembly/SKILL.md`

- [ ] **Step 1: 编写 content-assembly skill**

核心内容：
- 短视频合成：
  - 读取分镜表和已生成的视频片段列表
  - 制定剪辑方案（镜头顺序+转场+字幕时间轴+配乐）
  - 用户确认后用ffmpeg执行：
    - `ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4` 拼接
    - 添加字幕（drawtext或ASS）
    - 叠加配乐（-filter_complex amerge）
    - 转场效果（xfade）
  - 输出到 workspace/output/final.mp4
- 图文排版：
  - 输出图片顺序+文案方案
  - 可选自动拼图
  - 输出到 workspace/output/
- 生成 publish-text.md（标题+正文+标签）
- 注入专业知识：ffmpeg命令参数、视频编码最佳实践、转场效果选择

- [ ] **Step 2: 安装 skill**

```bash
mkdir -p ~/.claude/skills/content-assembly
cp skills/content-assembly/SKILL.md ~/.claude/skills/content-assembly/SKILL.md
```

- [ ] **Step 3: Commit**

```bash
git add skills/content-assembly/ && git commit -m "feat: add content-assembly skill"
```

---

## Task 14: 前端 — App.svelte 导航重构 + API Client

**Files:**
- Modify: `web/src/App.svelte`, `web/src/lib/api.ts`, `web/src/lib/i18n.ts`

- [ ] **Step 1: 重写 App.svelte 导航**

使用 @impeccable:frontend-design skill 设计导航。

新导航结构（侧边栏）：
- 探索 (Explore)
- 作品 (Works) — 默认页
- 数据 (Analytics)
- 设置 (Settings) — 弹出侧边栏面板

移除对已删除页面的所有引用（Dashboard, Tasks, Reports, DataBrowser, Ideas, FeatureDetail）。

- [ ] **Step 2: 重写 API Client (`web/src/lib/api.ts`)**

移除所有旧API调用（platforms, collector, trigger, tasks, reports, skills）。新增：

```typescript
// Generate
export async function generateImage(opts: any) { return post('/api/generate/image', opts) }
export async function generateVideo(opts: any) { return post('/api/generate/video', opts) }
export async function fetchProviders() { return get('/api/generate/providers') }

// Shared Assets
export async function fetchSharedAssets() { return get('/api/shared-assets') }

// Trends
export async function fetchTrends(platform: string) { return get(`/api/trends/${platform}`) }
export async function refreshTrends() { return post('/api/trends/refresh') }
```

更新 Work 和 PipelineStep 类型定义匹配新的后端接口。

- [ ] **Step 3: 更新 i18n 翻译**

新增/更新：探索、作品、数据、设置 等导航项的中英文翻译。移除旧翻译。

- [ ] **Step 4: 验证前端编译**

```bash
cd web && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add web/src/App.svelte web/src/lib/api.ts web/src/lib/i18n.ts && git commit -m "refactor: new navigation structure and API client"
```

---

## Task 15: 前端 — Works 画廊页

**Files:**
- Create: `web/src/pages/Works.svelte`
- Modify: `web/src/components/NewWorkModal.svelte`

- [ ] **Step 1: 创建 Works.svelte**

使用 @impeccable:frontend-design skill 设计。

功能：
- 作品卡片网格（封面图+标题+状态+平台标签+类型标签）
- 右上角"新建作品"按钮 → 打开 NewWorkModal
- 点击卡片 → 事件派发 openStudio(workId)
- 空状态：引导用户创建第一个作品
- 状态筛选：全部/创建中/已完成

- [ ] **Step 2: 简化 NewWorkModal**

类型选择只保留两种：短视频、图文
平台选择只保留：抖音、小红书
新增：topicHint（可选主题/方向输入框）

- [ ] **Step 3: 验证前端编译**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Works.svelte web/src/components/NewWorkModal.svelte && git commit -m "feat: add Works gallery page with simplified NewWorkModal"
```

---

## Task 16: 前端 — Studio 页重写

**Files:**
- Modify: `web/src/pages/Studio.svelte`, `web/src/components/PipelineSteps.svelte`, `web/src/components/AssetPanel.svelte`, `web/src/components/ChatPanel.svelte`

- [ ] **Step 1: 重写 PipelineSteps**

使用 @impeccable:frontend-design skill。

4步：调研→规划→素材→成品。每步显示：
- 状态图标（pending/active/done/skipped）
- 步骤名称
- 时间戳（开始/完成）
- 点击切换步骤 → 发消息给 agent

- [ ] **Step 2: 重写 AssetPanel**

适配workspace目录结构：
- 分组显示：frames/, clips/, images/, output/
- 图片预览（lightbox）
- 视频播放器
- "下载全部"按钮（打包output/目录）
- 自动刷新（轮询或WebSocket通知）

- [ ] **Step 3: 更新 Studio.svelte**

三栏布局保持不变，更新：
- Pipeline从6步改为4步
- 步骤切换：点击步骤 → `sendMessage(workId, "进入{stepName}阶段")`
- 作品信息面板显示：类型、平台、topicHint
- 移除 auto-run pipeline 功能（改为用户手动推进）

- [ ] **Step 4: 微调 ChatPanel**

保持核心功能不变，微调样式使其与新导航一致。

- [ ] **Step 5: 验证前端编译**

```bash
cd web && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Studio.svelte web/src/components/ && git commit -m "refactor: Studio page with 4-step pipeline and workspace asset panel"
```

---

## Task 17: 前端 — Explore + Analytics 重写

**Files:**
- Modify: `web/src/pages/Explore.svelte`, `web/src/pages/Analytics.svelte`

- [ ] **Step 1: 重写 Explore**

使用 @impeccable:frontend-design skill。

- 平台切换 tab（抖音/小红书）
- 热门方向卡片（从 trends API 获取）
- 每个卡片有"以此创建作品"按钮 → 派发事件（预填topicHint+platform）
- "刷新趋势"按钮 → POST /api/trends/refresh
- 空状态：提示用户手动刷新或等待定时调研

- [ ] **Step 2: 简化 Analytics**

- 作品数量统计（总数、按类型饼图、按平台柱状图）
- 最近作品列表（卡片，点击进入Studio）
- 记忆摘要（如果memory配置存在）
- 移除平台连接功能

- [ ] **Step 3: 验证前端编译**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Explore.svelte web/src/pages/Analytics.svelte && git commit -m "refactor: Explore with trend cards, simplified Analytics"
```

---

## Task 18: 前端 — 设置面板 + 公共素材

**Files:**
- Create: `web/src/pages/SettingsPanel.svelte`, `web/src/components/SharedAssets.svelte`

- [ ] **Step 1: 创建 SettingsPanel**

侧边栏滑出面板，包含：
- 即梦API密钥配置
- OpenRouter API密钥配置
- 调研开关和频率
- 模型选择
- 保存 → PUT /api/config

- [ ] **Step 2: 创建 SharedAssets 组件**

在 Studio 的 AssetPanel 中新增"公共素材"tab：
- 分类浏览（characters, music, templates）
- 文件预览
- 上传按钮（拖拽或选择文件）
- 删除按钮

也可以作为独立面板在设置中管理。

- [ ] **Step 3: 验证前端编译**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/SettingsPanel.svelte web/src/components/SharedAssets.svelte && git commit -m "feat: add settings panel and shared assets browser"
```

---

## Task 19: 全栈集成测试

**Files:**
- Modify: 各模块根据集成测试结果修复

- [ ] **Step 1: 构建全栈**

```bash
npm run build && cd web && npm run build && cd ..
```

- [ ] **Step 2: 启动服务**

```bash
node dist/index.js start
```

验证：
- 服务启动无报错
- http://localhost:3271 加载前端
- 导航切换正常（Explore, Works, Analytics, Settings）

- [ ] **Step 3: 测试创建作品流程**

1. 在 Works 页点击"新建作品"
2. 选择"图文"类型，平台"小红书"，输入主题
3. 确认创建，跳转到 Studio
4. 验证 Pipeline 显示4步
5. 验证 Agent session 启动（ChatPanel有输出）

- [ ] **Step 4: 测试即梦 API**

手动调用验证：

```bash
curl -X POST http://localhost:3271/api/generate/image \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","prompt":"一只可爱的猫咪","width":1088,"height":1088,"filename":"test.png","provider":"jimeng"}'
```

确认返回 success: true，图片下载到本地。

- [ ] **Step 5: 测试 NanoBanana API**

```bash
curl -X POST http://localhost:3271/api/generate/image \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","prompt":"A cute cat in watercolor style","width":1024,"height":1024,"filename":"test-nb.png","provider":"nanobanana"}'
```

确认返回 success: true，图片生成成功。

- [ ] **Step 6: 修复发现的问题**

根据测试结果修复编译错误、运行时错误、前端交互问题。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "fix: integration issues found during testing"
```

---

## Task 20: MVP端到端验证 — 小红书图文

**Files:**
- 无新建，验证现有功能

- [ ] **Step 1: 完整流程验证**

从头到尾完成一个小红书图文作品：

1. **创建作品：** Works页 → 新建 → 类型：图文，平台：小红书，主题：自选
2. **调研阶段：** Agent 使用 WebSearch 调研热门，输出调研报告
3. **规划阶段：** 切换到规划步骤，Agent 输出图文结构（5张图+配文+标签）
4. **素材阶段：** 切换到素材步骤，Agent 逐张确认后调用即梦API生成图片
5. **成品阶段：** 切换到成品步骤，Agent 输出排版方案+发布文案

- [ ] **Step 2: 验证产物**

检查 workspace 目录：

```bash
ls ~/.skill-evolver/works/{workId}/output/
# 应有：多张图片 + publish-text.md
cat ~/.skill-evolver/works/{workId}/output/publish-text.md
# 应有：标题 + 正文 + 标签
```

- [ ] **Step 3: 验证 AssetPanel**

在 Studio 页的 AssetPanel 中：
- 所有生成的图片都能预览
- output/ 目录的成品文件能浏览
- "下载全部"按钮可用

- [ ] **Step 4: MVP通过标准检查**

- [ ] 4步pipeline全部走通，每步状态正确更新
- [ ] 即梦API调用成功，图片正确下载到workspace
- [ ] NanoBanana API调用成功，图片正确生成
- [ ] AssetPanel实时展示生成的素材
- [ ] 最终成品包含：多张图片 + publish-text.md
- [ ] 前端交互流畅，无报错

- [ ] **Step 5: 最终 Commit**

```bash
git add -A && git commit -m "feat: MVP complete - XHS image-text creation flow verified"
```

---

## 执行顺序总结

| Phase | Tasks | 描述 |
|-------|-------|------|
| **Phase 1: 清理** | 1-3 | 删除旧代码、简化配置、重写WorkStore |
| **Phase 2: 后端核心** | 4-7 | Provider层、公共素材、API路由 |
| **Phase 3: Agent集成** | 8-9 | WsBridge更新、Server整合 |
| **Phase 4: Skills** | 10-13 | 4个专家级Claude Code Skill |
| **Phase 5: 前端** | 14-18 | 导航、Works、Studio、Explore、Analytics、Settings |
| **Phase 6: 验证** | 19-20 | 集成测试 + MVP端到端验证 |

**依赖关系：**
- Phase 1 → Phase 2 → Phase 3（后端依赖链）
- Phase 4 可与 Phase 2-3 并行
- Phase 5 依赖 Phase 3 完成（需要API可用）
- Phase 6 依赖所有前置任务
