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
5. **接入即梦API：** 文生图3.1 + 视频生成V3.0 Pro，Server端代理

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
| **research** | WebSearch调研平台热门趋势，分析爆款视频共性（节奏、话题、标签） | WebSearch调研热门图文话题、爆款笔记结构、标签趋势 |
| **plan** | 输出：主题、分镜表（每镜描述+画面+时长+文案）、整体风格、配乐建议、标签 | 输出：主题、标题、图文结构（每张图内容描述+配文）、标签 |
| **assets** | 逐镜确认后调用即梦V3.0 Pro生成视频片段，或用户上传素材 | 逐张确认后调用即梦文生图3.1生成图片，或用户上传 |
| **assembly** | 输出剪辑方案（镜头顺序+转场+字幕），可选ffmpeg自动合成 | 输出发布排版方案（图片顺序+文案），可选自动拼图 |

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
- 调研：使用WebSearch工具搜索平台热门趋势
- 生图：调用 curl http://localhost:3271/api/jimeng/image 生成图片
- 生视频：调用 curl http://localhost:3271/api/jimeng/video 生成视频
- 合成：使用ffmpeg命令合成成品（如需要）

## 记忆上下文（如有）
{memoryContext}

## 规则
- 每生成一个素材前，先描述计划，等用户确认
- 素材生成后展示预览链接，等用户反馈
- 只支持抖音和小红书平台
```

步骤切换由前端触发：用户在PipelineSteps中点击下一步 → 前端发消息告诉agent进入新阶段。

## 5. 即梦API代理层

### 新增路由

```
POST /api/jimeng/image    → 文生图3.1
POST /api/jimeng/video    → 视频生成V3.0 Pro
GET  /api/jimeng/task/:id → 查询任务状态/结果
```

### 工作流程

```
Skill(curl) → POST /api/jimeng/image {prompt, width, height}
  → Server: HMAC签名 → 火山引擎 CVSync2AsyncSubmitTask (req_key: jimeng_t2i_v31)
  → 获得task_id → 轮询 CVSync2AsyncGetResult (间隔2秒, 超时5分钟)
  → 轮询完成 → 下载图片到 work assets目录
  → 返回 {success, assetPath, previewUrl}
```

### 请求格式

**文生图：**
```json
{
  "workId": "xxx",
  "prompt": "一个年轻女性在咖啡厅使用笔记本电脑，温暖的光线",
  "width": 1088,
  "height": 1088,
  "filename": "scene-01.png"
}
```

**视频生成：**
```json
{
  "workId": "xxx",
  "prompt": "镜头缓缓推进，女生抬头微笑",
  "imageUrl": "http://localhost:3271/api/works/xxx/assets/scene-01.png",
  "resolution": "9:16",
  "filename": "shot-01.mp4"
}
```

### 签名模块 (`src/jimeng.ts`)

- `signRequest(action, body)` — 火山引擎HMAC-SHA256签名
- `submitTask(reqKey, params)` — 提交生成任务
- `pollResult(taskId, timeout)` — 轮询直到完成
- `generateImage(opts)` — 封装文生图全流程
- `generateVideo(opts)` — 封装视频生成全流程

### API参数

**火山引擎公共参数：**
- Base URL: `https://visual.volcengineapi.com`
- Action: `CVSync2AsyncSubmitTask` (提交) / `CVSync2AsyncGetResult` (查询)
- Version: `2022-08-31`
- Region: `cn-north-1`, Service: `cv`

**文生图 req_key:** `jimeng_t2i_v31`
- prompt (必填), width/height (可选, 默认1088x1088, 范围576-1728)

**视频生成 req_key:** V3.0 Pro对应的req_key
- prompt (必填), image_url (图生视频时必填), resolution (可选: 16:9, 9:16, 1:1等)

## 6. Claude Code Skills

4个skill安装在 `~/.claude/skills/` 下，WsBridge启动的Claude CLI进程自动使用。

### skill: trend-research

**用途：** research步骤，调研平台热门趋势

**核心能力：**
- 使用WebSearch搜索抖音/小红书当前热门话题、爆款内容
- 分析爆款共性（话题、标签、节奏、风格）
- 结合用户历史记忆（如有）给出方向建议

**输出格式：**
```markdown
## 调研报告
### 热门方向
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

**关键约束：** 分镜/图文描述要足够精确，可直接作为即梦API的prompt，保证风格一致性。

### skill: asset-generation

**用途：** assets步骤，调用即梦代理生成素材

**交互模式：**
1. 根据plan阶段的分镜表/图文结构，逐个生成素材
2. 每个素材生成前向用户描述计划，等用户确认
3. 调用 `curl http://localhost:3271/api/jimeng/image` 或 `/video`
4. 生成后告知用户预览链接，等待反馈
5. 支持"重新生成"或"用户自己上传替代"
6. 跟踪已生成素材列表，确保不遗漏

### skill: content-assembly

**用途：** assembly步骤，组合素材为成品

**短视频：** 输出剪辑方案（镜头顺序+转场+字幕时间轴），可选用ffmpeg拼接+添加字幕

**图文：** 输出发布排版方案（图片顺序+文案），可选用代码生成拼图/封面图

**最终产物：** 保存在work的assets目录下，前端AssetPanel可浏览。

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
  accessKey: "AK..."
  secretKey: "SK..."

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

### 数据目录

```
~/.skill-evolver/
├── config.yaml
├── works/
│   ├── works.yaml                    # 作品索引
│   └── {workId}/
│       ├── work.yaml                 # 作品定义
│       └── assets/                   # 素材和成品
└── trends/
    ├── douyin/{date}.yaml
    └── xiaohongshu/{date}.yaml
```

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
| POST | `/api/jimeng/image` | 即梦文生图代理 |
| POST | `/api/jimeng/video` | 即梦视频生成代理 |
| GET | `/api/jimeng/task/:id` | 查询生成任务 |

WebSocket:
| URL | 用途 |
|-----|------|
| `/ws/browser/:workId` | Studio页agent通信 |

## 10. 技术决策

1. **Server侧即梦代理** — 密钥安全（不暴露给CLI），异步封装为同步（skill调用更简单）
2. **单Agent per Work** — 通过 `--resume` 保持跨步骤上下文连贯
3. **去掉Playwright** — 大幅简化依赖，用户自己发布
4. **4个Claude Code Skill** — 每个创作环节有专业prompt指导
5. **混合调研模式** — 定时+手动，平衡信息时效性和API成本
6. **逐个确认素材** — 用户对每个素材有控制权，避免浪费API调用
