<div align="center">

# AutoViral

**AI-native 社交媒体内容创作平台**

从选题调研到成片发布，全程 AI Agent 驱动 —— 任何 CLI agent（claude / codex / kimi / gemini / aider）都能驱动

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Agent-agnostic](https://img.shields.io/badge/Agent-agnostic-6C47FF)](#)
[![React 19](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

<div align="center">
<table>
  <tr>
    <td align="center" width="50%">
      <video src="https://github.com/user-attachments/assets/2a14f0b4-08e4-4367-b11e-5d128daf5974" controls width="100%"></video>
      <br><em>成品样本</em>
    </td>
    <td align="center" width="50%">
      <video src="https://github.com/user-attachments/assets/3be005df-d8e2-4dab-8f32-9a8bd84a1d34" controls width="100%"></video>
      <br><em>人脸适应功能</em>
    </td>
  </tr>
</table>

*AI 全自动创作的健身短视频 — 从选题到成片，零人工干预，支持一键换人物形象*

</div>

---

## 它能做什么

AutoViral 是一个本地运行的 AI 内容工作台，你描述一个选题，AI Agent 完成从调研到成片的全部工作：

```
 你："做一个月球战争的科幻短片"
  │
  ▼
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 话题调研  │───▶│ 内容规划  │───▶│ 素材生成  │───▶│ 合成输出  │
│          │    │          │    │          │    │          │
│ AI 搜索   │    │ 分镜脚本  │    │ AI 生图   │    │ 视频拼接  │
│ 趋势分析  │    │ 文案策划  │    │ AI 生视频  │    │ 字幕配乐  │
│ 竞品参考  │    │ 配乐规划  │    │ AI 配乐   │    │ 转场特效  │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
```

每个步骤 AI 会先和你确认方案，等你同意后再执行。你随时可以在对话中给反馈、调整方向。

### 支持的内容类型

| 类型 | 目标平台 | 产出 |
|------|---------|------|
| **短视频** | 抖音 | 带字幕、配乐的完整视频 |
| **图文** | 小红书 | 专业排版的多图 + 发布文案 |

### 核心能力

| 能力 | 技术方案 | 说明 |
|------|---------|------|
| AI 图片生成 | OpenRouter · `openai/gpt-5.4-image-2`（NanoBanana） | 支持 4K、自定义宽高比、图生图 |
| AI 视频生成 | OpenRouter · `bytedance/seedance-2.0`（Seedance） | 图生视频，时长 {3,5,10}s |
| 配音 (TTS) | edge-tts → OpenAI 兜底 | 中/英旁白音轨 |
| 图文排版 | HTML/CSS + Playwright | 5 套小红书模板、专业字体 |
| 视频合成 | Remotion + FFmpeg | 合成、字幕、配乐、转场 |
| 趋势调研 | AI Web Search | 抖音/小红书实时热点 |
| 数据分析 | 定时采集 | 粉丝/播放/互动数据追踪 |
| 质量评审 | LLM-as-Judge | 每步可选质量门控 |

### 个性化创作：记忆系统 + 数据驱动

AutoViral 不只是一个工具——它会**记住你**，并**用数据优化**每一次创作。

**🧠 长期记忆（EverMemOS）**

集成 [EverMemOS](https://evermemos.com) 长期记忆系统，AI Agent 在创作时自动检索：

- **风格画像** — 你偏好的表达方式、视觉风格、人设定位
- **创作历史** — 过去做过什么、哪些选题效果好
- **平台规则** — 各平台的算法偏好和内容规范
- **竞品动态** — 同领域热门内容的趋势变化

每次创作完成后，对话内容自动同步回 EverMemOS，形成越用越懂你的正向循环。

**📊 平台数据反馈**

通过定时采集抖音创作者数据（粉丝、播放、点赞、评论），AI 在后续创作中参考真实表现：

- 哪类视频播放量高？AI 会倾向类似选题
- 哪些时段发布效果好？AI 会建议最佳发布时间
- 评论区在聊什么？AI 会捕捉受众兴趣点

```
创作 → 发布 → 数据采集 → 记忆沉淀 → 下次创作更精准
  └───────────────── 闭环优化 ─────────────────┘
```

---

## 快速开始

### 前置要求

- **Node.js** >= 20
- **任意 CLI agent** — 任何 CLI agent（claude / codex / kimi / gemini / aider）都能驱动 AutoViral，安装并登录其一即可
- **FFmpeg** — `brew install ffmpeg`

### 安装

```bash
git clone https://github.com/nanxingw/AutoViral.git
cd AutoViral
npm install && npm run build
```

### 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# OpenRouter 是唯一的外部生成网关 —— 图片 / 视频 / 翻译都走它
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
```

一把 OpenRouter Key 即可解锁图片（`openai/gpt-5.4-image-2`）、视频（`bytedance/seedance-2.0`）与翻译。TTS（edge-tts）无需额外 Key；只有用 OpenAI 作为 TTS 兜底时才需配 `OPENAI_API_KEY`（可选）。

### 启动

```bash
autoviral start                # 后台启动
autoviral start --foreground   # 前台启动（看日志）
```

打开 **http://localhost:3271** 开始创作。

---

## 使用流程

### 1. 创建作品

点击「新建作品」，输入标题和创作方向（如"科幻短片，月球大战"），选择类型和平台。

### 2. 在工位里和 agent 协作（无强制顺序）

进入 **Studio**（短视频，`composition.yaml`）或 **Editor**（图文，`carousel.yaml`），在右侧 agent 面板里描述你想要的东西。agent 加载操作手册 skill（`skills/autoviral/`）并通过 `autoviral` CLI 驱动工位——它不强迫线性流程，按你的意图直接动手：

| 你想做 | 短视频 | 图文 |
|------|--------|------|
| 找选题 | 搜索热点趋势、分析竞品 | 搜索话题热度、参考爆款 |
| 定方案 | 分镜脚本、画面描述、台词 | 每张图的内容规划、文案 |
| 出素材 | 生首帧 → 生视频片段 → 配音 | 生配图 → 排版渲染 |
| 成片 | Remotion 合成 + 字幕 + 配乐 | Konva 多图层 + 排序 + 发布文案 |

任意一步都能做起点：给完整 brief 就直接出素材、成片；只想看趋势就单独调研。agent 不会反问"我们应该先做哪一步"。

> 工位本身对"什么是好视频"不持立场——审美交给你挂载的 sibling taste skill（`editorial-pro` 等），`skills/autoviral/` 只教 agent **如何操作这个工位**。

### 3. 预览与导出

成品在右侧素材面板预览，保存在 `~/.autoviral/works/<id>/output/`。

### 4. 数据追踪（可选）

在「数据」页面粘贴抖音主页链接，系统定时采集播放、点赞、评论数据，AI 在后续创作中参考。

---

## AI 生成服务

**OpenRouter 是唯一的外部生成网关**——图片、视频、翻译全部通过它，统一一把 Key、统一密钥管理（架构不变量 #2，不存在直连各家厂商的旁路）。

| 能力 | 模型 | 密钥 | 说明 |
|------|------|------|------|
| 图片生成 | `openai/gpt-5.4-image-2`（NanoBanana，~$0.04/张） | `OPENROUTER_API_KEY` | 支持 4K / 宽高比 / 图生图 |
| 视频生成 | `bytedance/seedance-2.0`（Seedance，~$0.76/3s） | `OPENROUTER_API_KEY`（复用） | 图生视频，时长仅 {3,5,10}s，输出固定 720×1280@24 |
| 翻译 | `anthropic/claude-sonnet-4.5` | `OPENROUTER_API_KEY`（复用） | YouTube ingest 等流程的字幕翻译 |

> 配音 (TTS) 不走 OpenRouter：默认本地 edge-tts，可选用 OpenAI 作兜底（需 `OPENAI_API_KEY`）。

检查当前工位上下文与环境接线是否就绪（在 Studio 终端面板里运行）：

```bash
autoviral whoami    # 打印当前 work / 端口 / 版本；env 未接线时非零退出，是安全 smoke test
autoviral docs      # 打印操作手册；autoviral docs <topic> 看单节
```

---

## 项目架构

Studio 前端与后端之间是一条 **bridge（HTTP + WebSocket）** 协议；CLI agent 不直连后端进程，而是通过 `autoviral` CLI 调 bridge 的 `/api/bridge/v1/*` 端点——React UI 和 `autoviral` CLI 共用同一条 bridge，所以任何 CLI agent 都能用同一套命令驱动工位。

```
浏览器 (React 19 + Vite)
        │  HTTP / WebSocket（bridge）
        ▼
Node.js daemon (Express + Hono, :3271)
        │  bridge /api/bridge/v1/*
        ▼
CLI agent (claude / codex / kimi / gemini / aider)
        │  调 `autoviral` CLI（协议层），不直接读 src/
        ▼
OpenRouter（唯一外部网关）—— 图片 NanoBanana / 视频 Seedance / 翻译
```

> 终端面板里的 agent 通过 `autoviral whoami` / `docs` / `context` 等命令操作工位；这是一条稳定的协议层，不是早期的 `/invoke` RPC 端点。

### 目录结构

```
src/                          # 后端 TypeScript
  index.ts                    #   daemon 入口
  cli.ts                      #   autoviral CLI 入口（start/stop/config …）
  infra/                      #   跨切面基础设施（config / logger / paths）
  domain/                     #   核心领域（work-store / memory / analytics-collector / audio-tools）
  server/                     #   Express + WS bridge
    api.ts                    #     REST 端点（config / works / assets …）
    bridge/                   #     /api/bridge/v1/* —— 终端面向的协议（routes、ingest-youtube）
    render-pipeline.ts        #     Remotion 驱动的 mp4 导出
  providers/                  #   OpenRouter 适配器（image / video）
  tts-providers/              #   edge-tts → OpenAI 兜底
  shared/                     #   composition.ts / carousel.ts（zod schema）
  ws-bridge.ts                #   chat-agent WS 桥接（claude -p 子进程）

web/src/                      # 前端 React 19 + Vite + Zustand + TanStack Query
  pages/
    Works.tsx                 #   作品 hub（pick up where you left off）
    Studio.tsx                #   视频创作（Remotion Player + 多轨 Timeline + Tweaks）
    Editor.tsx                #   图文创作（Konva 多图层 + Inspector + Filmstrip）
    Explore.tsx               #   趋势探索
    Analytics.tsx             #   数据仪表盘
  features/
    studio/                   #   视频合成数据模型 / Remotion composition / Tweaks
    editor/                   #   图文 carousel / Konva canvas / Inspector
    terminal/                 #   xterm.js 面板（承载任意 CLI agent）
    chat/                     #   WS 客户端 + StreamBlock

cli/autoviral/                # `autoviral` CLI（协议层，独立分发）
  src/commands/               #   whoami / docs / context / clip / check / ingest / export …

skills/autoviral/             # 操作手册 skill（agent-agnostic markdown，不教审美）
  SKILL.md                    #   入口：你在 AutoViral 工位里
  manual/                     #   编号阅读顺序（00-quickstart … 05-conventions）
  recipes/                    #   常见任务的 step-by-step pattern
  contracts/                  #   错误码 / 事件流 schema

~/.autoviral/                 # 运行时数据
  config.yaml                 #   配置
  fonts/                      #   下载的专业字体
  works/                      #   作品数据 + 素材 + 成品
  trends/                     #   趋势缓存
```

### 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19, Vite, Zustand, TanStack Query, editorial·cool·glass 主题 |
| 后端 | Node.js, Express + Hono, TypeScript, WebSocket（bridge） |
| AI Agent | agent-agnostic CLI（claude / codex / kimi / gemini / aider）经 `autoviral` CLI 驱动 |
| 图片生成 | OpenRouter · `openai/gpt-5.4-image-2`（NanoBanana） |
| 视频生成 | OpenRouter · `bytedance/seedance-2.0`（Seedance） |
| 配音 (TTS) | edge-tts → OpenAI 兜底 |
| 图文排版 | HTML/CSS + Playwright + 模板 |
| 视频合成 | Remotion + FFmpeg |

---

## 配置项

配置优先级：`.env` > `~/.autoviral/config.yaml`

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `port` | `3271` | 仪表盘端口 |
| `model` | `opus` | Claude 模型（opus / sonnet / haiku） |
| `research.schedule` | `0 9,21 * * *` | 定时调研（每天 9:00 和 21:00） |
| `analytics.collectInterval` | `60` | 数据采集间隔（分钟） |
| `interests` | `[]` | 关注领域（在探索页面配置） |

### CLI 命令

```bash
autoviral start [--foreground]     # 启动服务
autoviral stop                     # 停止服务
autoviral dashboard                # 打开浏览器
autoviral config get [key]         # 查看配置
autoviral config set <key> <value> # 修改配置
```

---

## License

MIT
