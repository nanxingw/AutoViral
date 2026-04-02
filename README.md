<div align="center">

# AutoViral

**AI-native 社交媒体内容创作平台**

从选题调研到成片发布，全程 AI Agent 驱动

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Powered-6C47FF?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![Svelte 5](https://img.shields.io/badge/Svelte_5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
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
| AI 图片生成 | Gemini 3.1 Flash (OpenRouter) | 支持 4K、自定义宽高比、图生图 |
| AI 视频生成 | Dreamina CLI (Seedance 2.0) | 文生视频、图生视频、首尾帧、多帧 |
| AI 音乐生成 | Google Lyria 3 Pro | 文生音乐、图生音乐 |
| 图文排版 | HTML/CSS + Playwright | 5 套小红书模板、专业字体 |
| 视频合成 | FFmpeg | 拼接、字幕、配乐、转场 |
| 趋势调研 | AI Web Search | 抖音/小红书实时热点 |
| 数据分析 | 定时采集 | 粉丝/播放/互动数据追踪 |
| 质量评审 | LLM-as-Judge | 每步可选质量门控 |

---

## 快速开始

### 前置要求

- **Node.js** >= 18
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** — 已安装并登录
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
# 图片生成（Gemini，推荐）
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx

# 视频生成备用（即梦 API，可选）
JIMENG_ACCESS_KEY=AKLTxxxxxxxx
JIMENG_SECRET_KEY=xxxxxxxx
```

**视频生成首选方案**：安装 [Dreamina CLI](https://jimeng.jianying.com/cli)（免费，浏览器登录即可）：

```bash
curl -fsSL https://jimeng.jianying.com/cli | bash
dreamina login    # 浏览器弹窗登录
```

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

### 2. 四步流水线

进入 Studio 工作台，AI Agent 按步骤推进：

| 步骤 | 短视频 | 图文 |
|------|--------|------|
| **调研** | 搜索热点趋势、分析竞品 | 搜索话题热度、参考爆款 |
| **规划** | 分镜脚本、画面描述、台词 | 每张图的内容规划、文案 |
| **素材** | 生首帧 → 生视频片段 → 生配乐 | 生配图 → HTML 排版渲染 |
| **合成** | FFmpeg 拼接 + 字幕 + 配乐 | 图片排序 + 发布文案 |

### 3. 预览与导出

成品在右侧素材面板预览，保存在 `~/.autoviral/works/<id>/output/`。

### 4. 数据追踪（可选）

在「数据」页面粘贴抖音主页链接，系统定时采集播放、点赞、评论数据，AI 在后续创作中参考。

---

## AI 生成服务

AutoViral 支持多个 AI 生成服务，按优先级自动选择：

### 图片生成

| 优先级 | 服务 | 密钥 | 说明 |
|--------|------|------|------|
| 1 | **OpenRouter (Gemini 3.1 Flash)** | `OPENROUTER_API_KEY` | 推荐，画质最好，支持 4K |
| 2 | 即梦 API | `JIMENG_ACCESS_KEY` + `SECRET_KEY` | 备用 |

### 视频生成

| 优先级 | 服务 | 配置方式 | 说明 |
|--------|------|---------|------|
| 1 | **Dreamina CLI (Seedance 2.0)** | `dreamina login` | 推荐，支持图生视频、多帧 |
| 2 | 即梦 API | `JIMENG_ACCESS_KEY` + `SECRET_KEY` | 备用 |

### 音乐生成

| 服务 | 密钥 | 说明 |
|------|------|------|
| **Google Lyria 3 Pro** | `OPENROUTER_API_KEY`（复用） | 文生音乐、图生音乐 |

检查当前环境可用服务：

```bash
python3 skills/asset-generation/scripts/check_providers.py --format table
```

---

## 项目架构

```
浏览器 (Svelte 5)  ──WebSocket──  Node.js (Hono)  ──stdin/stdout──  Claude Code CLI
                                       │
                              ┌────────┼────────┐
                              ▼        ▼        ▼
                          Dreamina   Gemini   Lyria
                          (视频)    (图片)   (音乐)
```

### 目录结构

```
src/                          # 后端 TypeScript
  cli.ts                      #   CLI 入口（start/stop/config）
  config.ts                   #   配置管理（.env + config.yaml）
  work-store.ts               #   作品存储（YAML 持久化）
  ws-bridge.ts                #   WebSocket 桥接（浏览器 ↔ Claude CLI）
  research-scheduler.ts       #   定时调研
  analytics-collector.ts      #   数据采集
  server/
    api.ts                    #   REST + WebSocket API
    index.ts                  #   Hono 服务启动

web/src/                      # 前端 Svelte 5
  pages/
    Studio.svelte             #   创作工作台（对话 + 流水线 + 素材）
    Explore.svelte            #   趋势探索
    Works.svelte              #   作品管理
    Analytics.svelte          #   数据仪表盘

skills/                       # AI Agent 技能定义
  trend-research/             #   话题调研（热搜脚本 + 方法论）
  content-planning/           #   内容规划（分镜/图文策划）
  asset-generation/           #   素材生成（Dreamina/Gemini/Lyria）
  content-assembly/           #   合成输出（FFmpeg/字幕/配乐）
  content-evaluator/          #   质量评审（LLM-as-Judge 评分）

~/.autoviral/                 # 运行时数据
  config.yaml                 #   配置
  fonts/                      #   下载的专业字体
  works/                      #   作品数据 + 素材 + 成品
  trends/                     #   趋势缓存
```

### 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Svelte 5 (runes), Vite, Glass Noir 深色主题 |
| 后端 | Node.js, Hono, TypeScript, WebSocket |
| AI Agent | Claude Code CLI (stream-json 子进程) |
| 图片生成 | OpenRouter → Gemini 3.1 Flash |
| 视频生成 | Dreamina CLI (Seedance 2.0) / 即梦 API |
| 音乐生成 | Google Lyria 3 Pro |
| 图文排版 | HTML/CSS + Playwright + Jinja2 模板 |
| 视频编辑 | FFmpeg |

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
