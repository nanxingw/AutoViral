# AutoViral 全面重构设计文档

**日期：** 2026-03-18
**状态：** Draft
**分支：** feat/full-product

---

## 1. 背景与目标

AutoViral 当前架构包含大量模块（evolution cycle、Playwright自动发布、data collector、scheduler等），复杂度高但核心价值未聚焦。本次重构目标：

1. **收窄范围：** 只支持抖音和小红书，只支持短视频和图文
2. **Skills化：** 每个创作环节由专业的Claude Code skill负责
3. **简化流程：** 一个作品 = 一个持久agent session，4步pipeline
4. **去掉Playwright：** 用户自己发布，去掉自动发布/登录/指标采集
5. **接入即梦API：** 文生图3.1 + 视频生成V3.0 Pro，Server端代理，底层可扩展多模型
6. **聚焦AI生成视频：** 通过精心设计的skill实现分镜→首尾帧→自动剪辑的完整流程
7. **公共素材库：** 支持跨项目复用人物、配乐等素材
8. **完整验证：** MVP必须跑通——至少完成一个小红书图文的完整创建流程

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Svelte 5)                                     │
│  ├── Explore页 (热门调研展示 + 一键创建作品)              │
│  ├── Works页 (作品画廊 + 新建作品)                        │
│  ├── Studio页 (作品创建: Pipeline + Chat + Assets)        │
│  ├── Analytics页 (作品数据统计)                           │
│  └── Settings (侧边栏配置)                                │
├──────────────────────────────────────────────────────────┤
│  Backend (Hono Server, port 3271)                        │
│  ├── REST API (works, trends, config, jimeng proxy)      │
│  ├── WsBridge (Claude CLI session ↔ Browser WebSocket)   │
│  └── Jimeng Proxy (HMAC签名 + 异步轮询 → 同步响应)       │
├──────────────────────────────────────────────────────────┤
│  Claude CLI (per-work persistent session)                │
│  ├── skill: trend-research (WebSearch调研热门)            │
│  ├── skill: content-planning (主题规划+分镜/图文结构)     │
│  ├── skill: asset-generation (调用本地jimeng proxy生成)   │
│  └── skill: content-assembly (ffmpeg/代码合成成品)        │
├──────────────────────────────────────────────────────────┤
│  External                                                │
│  ├── 火山引擎 (即梦文生图3.1 + V3.0 Pro视频)             │
│  └── EverMemOS (长期记忆, 可选)                           │
└──────────────────────────────────────────────────────────┘
```

## 3. 删除与保留

### 删除的模块

| 模块 | 原因 |
|------|------|
| `publish-engine.ts` | 用户自己发布，不需要Playwright |
| `src/platforms/` (xiaohongshu.ts, douyin.ts) | 不再自动发布/登录 |
| `data-collector.ts` | 依赖Playwright抓取指标 |
| `executor.ts` | evolution cycle机制不再需要 |
| `scheduler.ts` | 定时进化不再需要 |
| `prompt.ts` | evolution prompt模板不再需要 |
| `skills/user-context` | 不再需要 |
| `skills/task-planner` | 不再需要 |
| `skills/skill-evolver` | 不再需要，全部旧skill删除 |
| 前端Tasks/Reports/DataBrowser页面 | 属于evolution系统UI |

### 保留的核心模块

| 模块 | 调整 |
|------|------|
| `ws-bridge.ts` | 保留，作品创建的核心通信层 |
| `work-store.ts` | pipeline模板改为4步 |
| `memory.ts` | 保留，可选注入记忆上下文 |
| `config.ts` | 简化，去掉evolution相关配置 |
| `server/api.ts` | 精简 + 新增jimeng proxy路由 |

## 4. Pipeline设计

### 4步流程

所有作品类型统一为4步，区别在于每步skill的行为：

```
research → plan → assets → assembly
  调研      规划    素材     成品
```

### 每步职责

| 步骤 | 短视频 | 图文 |
|------|--------|------|
| **research** | 调研平台热门趋势 + 支持用户指定方向深入挖掘（如"深入调研美食探店类视频"） | 调研热门图文话题 + 支持用户指定方向深入挖掘 |
| **plan** | 输出：主题、分镜表（每镜描述+画面+时长+文案+首尾帧描述）、人物一致性方案、整体风格、配乐建议、标签 | 输出：主题、标题、图文结构（每张图内容描述+配文）、风格一致性方案、标签 |
| **assets** | 逐镜确认后调用生成API：先生首帧图→图生视频，可引用公共素材库中的人物/配乐 | 逐张确认后调用生图API，可引用公共素材库 |
| **assembly** | 用ffmpeg自动剪辑：拼接视频片段+添加字幕+配乐+转场，输出成品视频 | 输出发布排版方案（图片顺序+文案），可选自动拼图，输出成品 |

### 单Agent连贯上下文

一个作品 = 一个Claude CLI session，通过 `--resume` 跨步骤保持上下文：

```
创建作品 → WsBridge.createSession(workId, systemPrompt)
         → Claude CLI session (research阶段)
         → 用户确认进入下一步
         → WsBridge.sendMessage(workId, "进入规划阶段")
         → Claude CLI --resume (plan阶段，保留调研上下文)
         → ... 4步全部在同一个session中完成
```

### System Prompt

```
你是AutoViral创作助手，正在帮用户创建一个{type}作品。
目标平台：{platforms}
当前阶段：{currentStep}

## 你的能力
- 调研：使用WebSearch工具搜索平台热门趋势，支持用户指定方向深入挖掘
- 生图：调用 curl http://localhost:3271/api/generate/image 生成图片
- 生视频：调用 curl http://localhost:3271/api/generate/video 生成视频
- 合成：使用ffmpeg命令剪辑视频（拼接片段+字幕+配乐+转场）
- 公共素材：通过 curl http://localhost:3271/api/shared-assets 查看可用的公共素材（人物、配乐等）

## 当前项目workspace
{workspacePath}

## 公共素材库
{sharedAssetsInfo}

## 记忆上下文（如有）
{memoryContext}

## 规则
- 调研阶段：如果用户指定了方向，围绕该方向深入调研；否则广泛调研热门趋势
- 每生成一个素材前，先描述计划，等用户确认
- 素材生成后展示预览链接，等用户反馈
- 短视频制作：先生成首帧图片→用首帧图生成视频片段→ffmpeg剪辑合成
- 可随时引用公共素材库中的人物、配乐等素材
- 只支持抖音和小红书平台
- 当收到阶段切换指令（如"进入规划阶段"），立即确认切换并开始新阶段的工作
- 不要在未经用户确认的情况下自动跳转到下一阶段
```

步骤切换由前端触发：用户在PipelineSteps中点击下一步 → 前端发消息告诉agent进入新阶段。

## 5. 生成API代理层（多模型可扩展）

### 设计理念

底层采用 Provider 抽象，支持多种生成模型。MVP先实现即梦，架构预留扩展点。

```typescript
// src/providers/base.ts
interface GenerateProvider {
  name: string                                    // "jimeng" | "nanobanana" | "sora2"
  generateImage(opts: ImageOpts): Promise<GenerateResult>
  generateVideo(opts: VideoOpts): Promise<GenerateResult>
}

interface ImageOpts {
  prompt: string
  width?: number
  height?: number
  referenceImage?: string                         // 参考图URL/路径
}

interface VideoOpts {
  prompt: string
  firstFrame?: string                             // 首帧图片URL/路径
  lastFrame?: string                              // 尾帧图片URL/路径
  resolution?: string                             // "16:9" | "9:16" | "1:1" 等
}

interface GenerateResult {
  success: boolean
  assetPath?: string
  previewUrl?: string
  error?: string
  code?: "TIMEOUT" | "API_ERROR" | "DOWNLOAD_FAILED" | "INVALID_PARAMS"
}
```

### 统一路由

```
POST /api/generate/image              → 生成图片（自动路由到配置的provider）
POST /api/generate/video              → 生成视频
GET  /api/generate/task/:id           → 查询任务状态
GET  /api/generate/providers           → 列出可用的provider及状态
```

### 请求格式

**生图：**
```json
{
  "workId": "xxx",
  "prompt": "一个年轻女性在咖啡厅使用笔记本电脑，温暖的光线",
  "width": 1088,
  "height": 1088,
  "filename": "scene-01.png",
  "provider": "jimeng"
}
```

**生视频（首帧图生视频，推荐流程）：**
```json
{
  "workId": "xxx",
  "prompt": "镜头缓缓推进，女生抬头微笑",
  "firstFrame": "http://localhost:3271/api/works/xxx/assets/scene-01.png",
  "lastFrame": null,
  "resolution": "9:16",
  "filename": "shot-01.mp4",
  "provider": "jimeng"
}
```

### Provider: 即梦 (`src/providers/jimeng.ts`)

**签名模块：**
- `signRequest(action, body)` — 火山引擎HMAC-SHA256签名
- `submitTask(reqKey, params)` — 提交生成任务
- `pollResult(taskId, timeout)` — 轮询直到完成（间隔2秒，超时5分钟）

**火山引擎公共参数：**
- Base URL: `https://visual.volcengineapi.com`
- Action: `CVSync2AsyncSubmitTask` (提交) / `CVSync2AsyncGetResult` (查询)
- Version: `2022-08-31`
- Region: `cn-north-1`, Service: `cv`

**文生图 req_key:** `jimeng_t2i_v31`
- prompt (必填), width/height (可选, 默认1088x1088, 范围576-1728)

**视频生成 req_key:** `jimeng_vgfm_t2v_l20` (文生视频), `jimeng_vgfm_i2v_l20` (图生视频)
- prompt (必填), firstFrame (图生视频时必填), resolution (可选)
- 输出：1080P视频，支持宽高比 16:9, 4:3, 1:1, 3:4, 9:16, 21:9

**认证密钥（已配置）：**
- AccessKeyId: `REDACTED`
- SecretAccessKey: 存储在 config.yaml 中

### Provider: NanoBanana 2 Pro (`src/providers/nanobanana.ts`)

通过OpenRouter API调用NanoBanana 2 Pro模型生成图片。

**API调用：**
- Base URL: `https://openrouter.ai/api/v1/images/generations`
- 认证: `Authorization: Bearer {OPENROUTER_API_KEY}`
- OpenRouter API Key: 从 `.env` 文件读取 `OPENROUTER_API_KEY`

**MVP也需实现此provider并验证跑通。**

### Provider扩展

| Provider | 能力 | 状态 |
|----------|------|------|
| jimeng | 文生图3.1 + V3.0 Pro视频 | MVP实现 |
| nanobanana | NanoBanana 2 Pro图片生成（via OpenRouter） | MVP实现 |
| sora2 | 视频生成 | 预留接口 |

新增provider只需实现 `GenerateProvider` 接口并注册到 `ProviderRegistry`。

### Skill质量要求

每个skill必须达到专家级别：
- **实现前调研：** 参考GitHub和SkillHub上已有的优秀skill，借鉴最佳实践
- **专业知识注入：** 每个skill应包含该领域的专业知识（如视频剪辑的专业术语、构图原则等）
- **边界清晰：** 每个skill职责明确，不越界
- **错误友好：** 遇到问题时给出清晰指导而非模糊报错

## 6. Claude Code Skills

4个skill安装在 `~/.claude/skills/` 下，WsBridge启动的Claude CLI进程自动使用。

### skill: trend-research

**用途：** research步骤，调研平台热门趋势或用户指定方向的深度挖掘

**核心能力：**
- 使用WebSearch搜索抖音/小红书当前热门话题、爆款内容
- **支持用户指定方向：** 如果用户给出了topicHint（如"美食探店"），围绕该方向深入调研，而非泛泛调研所有热点
- 分析爆款共性（话题、标签、节奏、风格）
- 结合用户历史记忆（如有）给出方向建议

**两种模式：**
1. **广度模式（无topicHint）：** 调研平台当前热门方向，输出多个可选方向
2. **深度模式（有topicHint）：** 围绕指定方向深入挖掘，分析该领域爆款规律、竞品、差异化机会

**输出格式：**
```markdown
## 调研报告
### 调研方向
{广度：平台热门趋势 / 深度：围绕"{topicHint}"的深入调研}
### 热门方向 / 领域洞察
1. xxx（热度：高，竞争：中）
2. ...
### 推荐标签
#tag1 #tag2 ...
### 爆款分析
- 视频A：xxx万播放，特点：...
### 建议方向
基于你的风格，建议选择方向1，因为...
```

### skill: content-planning

**用途：** plan步骤，输出详细创作规划

**短视频输出：** 主题与标题、分镜表（每镜编号+画面描述+时长+文案/旁白+镜头运动）、整体风格（色调、节奏、情绪）、配乐建议、平台标签和发布文案

**图文输出：** 主题与标题、图文结构（每张图内容描述+配文）、封面图描述、整体风格（色调、字体风格建议）、平台标签和发布文案

**关键约束：**
- 分镜/图文描述要足够精确，可直接作为生成API的prompt，保证风格一致性
- 每个分镜必须包含首帧描述（用于生成首帧图→图生视频）
- 如有公共素材库中的人物参考图，在分镜描述中引用以保持角色一致性
- 标注哪些镜头可引用公共素材库的配乐

### skill: asset-generation

**用途：** assets步骤，调用生成API创建素材

**短视频生成流程（核心）：**
1. 读取plan阶段的分镜表
2. 逐镜执行：描述计划 → 用户确认 → 生成首帧图片 → 用首帧图生成视频片段
3. 如公共素材库有可用人物参考图，传入保持一致性
4. 生成后展示预览链接，等待反馈
5. 支持"重新生成"、"调整prompt"、"用户上传替代"
6. 跟踪已生成素材列表，确保不遗漏

**图文生成流程：**
1. 读取plan阶段的图文结构
2. 逐张确认后调用生图API
3. 支持引用公共素材库

**API调用：**
- 生图：`curl http://localhost:3271/api/generate/image`
- 生视频：`curl http://localhost:3271/api/generate/video`
- 查看公共素材：`curl http://localhost:3271/api/shared-assets`

### skill: content-assembly

**用途：** assembly步骤，组合素材为成品

**短视频（自动剪辑）：**
1. 读取分镜表和已生成的视频片段列表
2. 制定剪辑方案（镜头顺序+转场方式+字幕时间轴+配乐）
3. 用户确认方案后，使用ffmpeg自动执行：
   - 拼接视频片段（`concat demuxer`）
   - 添加字幕（`drawtext` 或 ASS字幕）
   - 叠加配乐（从公共素材库引用或用户指定）
   - 添加转场效果（`xfade`）
4. 输出成品到 `{workspace}/output/final.mp4`
5. 生成发布文案到 `{workspace}/output/publish-text.md`

**图文：**
1. 输出发布排版方案（图片顺序+文案）
2. 可选自动拼图/封面图生成
3. 输出成品图片和发布文案到 `{workspace}/output/`

**最终产物：** 保存在workspace的 `output/` 目录下，前端AssetPanel可直接浏览和下载。

## 7. 前端重构

### 页面结构

```
侧边栏导航：
├── 探索 (Explore)     — 热门调研
├── 作品 (Works)       — 作品画廊 + 新建
├── 数据 (Analytics)   — 统计概览
└── 设置 (Settings)    — 配置
```

Studio页不在导航中，通过点击作品进入。

### Explore页

- **数据来源：** 混合模式 — 定时（每天2次，9:00和21:00）Claude CLI + WebSearch调研 + 用户手动刷新
- **展示：** 热门方向卡片（总结出的方向/话题，不是具体视频）
- **核心交互：** 每个方向卡片有"以此创建作品"按钮 → 跳转Studio，预填topicHint
- **平台切换：** 抖音/小红书 tab

### Works页

从App.svelte的works gallery逻辑抽出为独立页面：
- 作品卡片网格（封面图+标题+状态+平台标签）
- "新建作品"按钮 → NewWorkModal
- 点击作品 → 进入Studio

### Studio页

三栏布局：
```
┌─────────────┬──────────────────────┬──────────────┐
│ Pipeline    │     Chat Panel       │  Asset Panel │
│ (左侧)      │     (中间)            │  (右侧)      │
│             │                      │              │
│ ● 调研      │  Agent对话流          │  生成的素材   │
│ ○ 规划      │  用户输入框           │  图片/视频    │
│ ○ 素材      │                      │  预览        │
│ ○ 成品      │                      │  最终成品    │
│             │                      │              │
│ [作品信息]   │                      │  [下载全部]  │
└─────────────┴──────────────────────┴──────────────┘
```

**改动：**
- Pipeline从6步改为4步
- 步骤切换：点击Pipeline步骤 → 发消息给agent切换阶段
- AssetPanel实时刷新：agent生成素材后自动出现
- 新增"下载全部"按钮：打包所有成品+文案供用户自行发布

### Analytics页

去掉平台连接功能，简化为：
- 作品数量统计（总数、按类型、按平台）
- 最近作品列表（卡片形式，点击进入Studio查看）
- 记忆摘要（风格标签、常用标签等，来自EverMemOS）

### 创建新作品的入口

1. **Explore页：** 热门方向卡片 → "以此创建" → 预填topicHint+平台 → Studio
2. **Works页：** "新建作品"按钮 → NewWorkModal（类型+平台+可选主题） → Studio

## 8. 数据模型

### Config (`~/.skill-evolver/config.yaml`)

```yaml
port: 3271
model: opus

jimeng:
  accessKey: "REDACTED"
  secretKey: "T0dSalpHSmxOall6..."    # 从config读取

research:
  enabled: true
  schedule: "0 9,21 * * *"
  platforms:
    - douyin
    - xiaohongshu

memory:
  apiKey: "sk_..."
  userId: "autoviral-user"
```

### 环境变量 (`.env`)

```
EVERMEMOS_API_KEY=...          # EverMemOS记忆API
OPENROUTER_API_KEY=...         # OpenRouter API（NanoBanana等模型）
```

Server启动时加载 `.env` 文件（使用 `dotenv`），环境变量优先级高于config.yaml。

### Work

```typescript
interface Work {
  id: string
  title: string
  type: "short-video" | "image-text"      // 只保留两种
  status: "draft" | "creating" | "ready" | "failed"
  platforms: string[]                      // ["douyin", "xiaohongshu"]
  pipeline: Record<string, PipelineStep>   // research, plan, assets, assembly
  cliSessionId?: string
  coverImage?: string
  topicHint?: string
  createdAt: string
  updatedAt: string
}

interface PipelineStep {
  name: string
  status: "pending" | "active" | "done" | "skipped"
  startedAt?: string
  completedAt?: string
  note?: string
}
```

### 数据目录（Workspace结构）

每个作品有独立的workspace文件夹，包含完整的项目上下文：

```
~/.skill-evolver/
├── config.yaml
├── shared-assets/                    # 公共素材库（跨项目复用）
│   ├── characters/                   # 人物素材（一致性参考图等）
│   │   └── girl-01.png
│   ├── music/                        # 配乐素材
│   │   └── upbeat-01.mp3
│   └── templates/                    # 模板素材（字幕样式、转场等）
├── works/
│   ├── works.yaml                    # 作品索引
│   └── {workId}/                     # 作品专属workspace
│       ├── work.yaml                 # 作品定义（pipeline状态等）
│       ├── research/                 # 调研阶段产出
│       │   └── report.md
│       ├── plan/                     # 规划阶段产出
│       │   └── storyboard.md         # 分镜表/图文结构
│       ├── assets/                   # 生成的素材
│       │   ├── frames/               # 首帧/尾帧图片
│       │   ├── clips/                # 视频片段
│       │   └── images/               # 图文图片
│       └── output/                   # 最终成品
│           ├── final.mp4             # 成品视频
│           └── publish-text.md       # 发布文案（标题+正文+标签）
└── trends/
    ├── douyin/{date}.yaml
    └── xiaohongshu/{date}.yaml
```

### 公共素材库

公共素材库 `~/.skill-evolver/shared-assets/` 用于跨项目复用素材：

- **characters/**: 人物参考图，用于保持角色一致性。生图时可作为参考图传入。
- **music/**: 配乐文件，视频合成时可引用。
- **templates/**: 字幕样式、转场模板等。

Agent在任何阶段都可以通过 `GET /api/shared-assets` 查看可用素材，通过素材路径引用到当前作品中。

**API路由：**

| 方法 | 路由 | 用途 |
|------|------|------|
| GET | `/api/shared-assets` | 列出公共素材目录结构 |
| GET | `/api/shared-assets/:category/:file` | 获取素材文件 |
| POST | `/api/shared-assets/:category` | 上传素材到公共库（multipart） |
| DELETE | `/api/shared-assets/:category/:file` | 删除公共素材 |

## 9. API路由

| 方法 | 路由 | 用途 |
|------|------|------|
| GET | `/api/status` | 服务状态 |
| GET/PUT | `/api/config` | 配置读写 |
| GET | `/api/works` | 作品列表 |
| POST | `/api/works` | 创建作品 |
| GET | `/api/works/:id` | 作品详情 |
| PUT | `/api/works/:id` | 更新作品 |
| DELETE | `/api/works/:id` | 删除作品 |
| POST | `/api/works/:id/session` | 启动agent session |
| POST | `/api/works/:id/step/:key` | 切换pipeline步骤 |
| GET | `/api/works/:id/assets` | 资产列表 |
| GET | `/api/works/:id/assets/:file` | 资产文件 |
| GET | `/api/trends/:platform` | 调研缓存 |
| POST | `/api/trends/refresh` | 手动触发调研 |
| POST | `/api/generate/image` | 生成图片（多模型） |
| POST | `/api/generate/video` | 生成视频（多模型） |
| GET | `/api/generate/task/:id` | 查询生成任务 |
| GET | `/api/generate/providers` | 列出可用provider |
| GET | `/api/shared-assets` | 公共素材目录 |
| GET | `/api/shared-assets/:cat/:file` | 获取公共素材 |
| POST | `/api/shared-assets/:cat` | 上传公共素材 |
| DELETE | `/api/shared-assets/:cat/:file` | 删除公共素材 |

WebSocket:
| URL | 用途 |
|-----|------|
| `/ws/browser/:workId` | Studio页agent通信 |

## 10. 迁移与清理

### 数据迁移

- 现有 `WorkType` 包含 `long-video` 和 `livestream`，重构后只保留 `short-video` 和 `image-text`。已有的 long-video/livestream 类型作品标记为 `failed` 状态，不做自动迁移。
- 现有 `platforms` 字段从 `PlatformEntry[]`（含 publishedUrl、metrics 等）简化为 `string[]`。重构时只保留 `.platform` 值，丢弃发布和指标数据。
- 现有 `WorkStatus` 去掉 `publishing` 和 `published`（用户自行发布，系统不追踪发布状态）。

### Pipeline步骤映射

新的 `defaultPipeline` 按类型：

| Key | short-video显示名 | image-text显示名 |
|-----|-------------------|------------------|
| research | 话题调研 | 话题调研 |
| plan | 分镜规划 | 内容规划 |
| assets | 素材生成 | 图片生成 |
| assembly | 视频合成 | 图文排版 |

### 代码清理

- 删除所有 Section 3 中列出的模块文件
- `api.ts` 中所有未在 Section 9 路由表中列出的路由全部删除
- `package.json` 中移除 `playwright` optional dependency
- 前端移除 `publishing`/`published` 状态相关的UI代码

## 11. 定时调研机制

删除 `scheduler.ts`（面向evolution cycle的复杂调度器），用轻量的 `node-cron` 替代：

- 新建 `src/research-scheduler.ts`，使用 `node-cron` 库
- 读取 `config.yaml` 的 `research.schedule` 字段（cron表达式）
- 到点时通过 WsBridge 启动一个临时 Claude CLI session 执行调研（使用 trend-research skill）
- 调研结果保存到 `~/.skill-evolver/trends/{platform}/{date}.yaml`
- 用户手动刷新走 `POST /api/trends/refresh` 路由，复用相同逻辑

## 12. 错误处理

### 即梦API错误响应格式

```typescript
interface JimengResult {
  success: boolean
  assetPath?: string           // 成功时：本地文件路径
  previewUrl?: string          // 成功时：可访问的URL
  error?: string               // 失败时：错误描述
  code?: "TIMEOUT" | "API_ERROR" | "DOWNLOAD_FAILED" | "INVALID_PARAMS"
}
```

- 轮询超时（5分钟）：返回 `code: "TIMEOUT"`，skill向用户说明并建议重试
- API报错：返回 `code: "API_ERROR"` + 火山引擎原始错误信息
- 下载失败：返回 `code: "DOWNLOAD_FAILED"`，skill建议重试
- 不做自动重试，由skill决定是否重新生成

### 资产文件服务

`GET /api/works/:id/assets/:file` 根据文件扩展名设置 Content-Type：
- `.png` → `image/png`, `.jpg/.jpeg` → `image/jpeg`
- `.mp4` → `video/mp4`, `.webm` → `video/webm`
- 其他 → `application/octet-stream`

## 13. 安全考量

WsBridge使用 `--dangerously-skip-permissions` 启动Claude CLI，agent拥有完整的bash和文件系统访问权。这是产品运行在本地环境的必要条件。

**风险缓解：**
- 服务只监听 localhost（不暴露到公网）
- 即梦API密钥存储在server端config中，不传递给CLI环境变量
- Agent通过curl调用本地HTTP API而非直接持有密钥
- System prompt明确限制agent的行为范围
- WebSearch结果可能包含非预期内容，但agent主要用于调研而非执行外部指令

## 14. MVP验证计划

MVP目标：完整跑通一个小红书图文作品的创建流程，且即梦和NanoBanana两个provider都能生成图片。

### 验证步骤

1. **启动服务** — `npm run build && npm start`，确认dashboard加载正常
2. **创建作品** — 在Works页新建一个"小红书图文"作品
3. **调研阶段** — Agent通过WebSearch调研热门话题，输出调研报告
4. **规划阶段** — Agent输出图文结构（如5张图+每图配文+标签）
5. **素材阶段** — Agent逐张确认后调用即梦文生图3.1 API生成图片，图片出现在AssetPanel
6. **成品阶段** — Agent输出发布排版方案+文案，成品保存在output/
7. **验证产物** — 确认output/目录有完整的图片+发布文案，可直接用于小红书发布

### 验证通过标准

- [ ] 4步pipeline全部走通，每步状态正确更新
- [ ] 即梦API调用成功，图片正确下载到workspace
- [ ] NanoBanana 2 Pro（via OpenRouter）调用成功，图片正确生成
- [ ] AssetPanel实时展示生成的素材
- [ ] 最终成品包含：多张图片 + publish-text.md（标题+正文+标签）
- [ ] 前端交互流畅，无报错

## 15. 技术决策

1. **多模型Provider架构** — 统一接口，MVP实现即梦，预留nanobanana/sora2扩展点
2. **Server侧API代理** — 密钥安全（不暴露给CLI），异步封装为同步
3. **单Agent per Work** — 通过 `--resume` 保持跨步骤上下文连贯
4. **独立Workspace** — 每个作品有完整的workspace目录结构，隔离清晰
5. **公共素材库** — 跨项目复用人物、配乐等素材，保持角色一致性
6. **去掉Playwright** — 大幅简化依赖，用户自己发布
7. **4个Claude Code Skill** — 每个创作环节有专业prompt指导
8. **聚焦AI视频生成** — 首帧图→图生视频→ffmpeg剪辑的完整自动化流程
9. **用户可指定调研方向** — 不局限于热门趋势，支持深度挖掘
10. **不兼容旧代码** — 这是重构分支，全新架构，确保可扩展性和鲁棒性
11. **前端精心设计** — 使用impeccable skill确保高质量UI/UX
