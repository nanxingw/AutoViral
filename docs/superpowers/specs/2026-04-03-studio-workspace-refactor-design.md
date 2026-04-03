# Studio 工作空间重构设计

> 日期：2026-04-03
> 状态：approved
> 灵感来源：Pneuma 编辑器风格（编辑器主导 + Chat 辅助）

## 目标

将 Studio 从「Chat 为中心」重构为「编辑器为中心 + Chat 辅助」的专业创作工作空间。支持短视频和图文两种内容类型在统一布局下自适应切换。

## 核心决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 主次关系 | 编辑器主导 | 中央是预览+时间线，Chat 在右侧辅助 |
| 内容类型布局 | 统一布局自适应 | 同一框架，中央区根据类型切换内容 |
| 时间线深度 | 轻交互型 | 展示+基础操作（排序/删除/替换），复杂操作通过 Chat |
| 素材分类 | 按类型分+阶段标签 | 主分类按 IMAGES/CLIPS/AUDIO 等，每项标注来源阶段 |

## 整体布局

四区结构：左素材栏 + 中央预览与时间线 + 右 Chat + 底部 Pipeline 进度条。

```
┌──────────────────────────────────────────────────────────┐
│  Header: ← 返回 | 标题(可编辑) | 类型/分类 | 评审开关    │
├────────┬───────────────────────────────┬─────────────────┤
│        │                               │                 │
│ Asset  │       Preview Area            │   Chat Panel    │
│ Side-  │   (视频播放器 / 图片轮播)      │                 │
│ bar    │                               │   stream +      │
│        │                               │   tool cards +  │
│ 200px  ├───────────────────────────────┤   input area    │
│        │                               │                 │
│ IMAGES │   Timeline / ImageLayout      │   380px         │
│ CLIPS  │                               │   可拖拽调宽     │
│ AUDIO  │   视频: 片段轨+音轨+字幕轨    │                 │
│ BGM    │   图文: 图片网格+文案编辑      │                 │
│ REF    │                               │                 │
├────────┴───────────────────────────────┴─────────────────┤
│  PipelineBar: [① 调研 ✓] → [② 规划 ✓] → [③ 素材 ●] → [④ 合成]  │
└──────────────────────────────────────────────────────────┘
```

### 尺寸规格

- Asset Sidebar: 200px 固定
- Chat Panel: 默认 380px，可拖拽调整（范围 280-600px）
- Preview Area: flex:1 占满剩余，最小宽度 400px
- Timeline / ImageLayout: 高度默认 220px，可拖拽调整（范围 150-400px）
- PipelineBar: 48px 固定高度
- Header: 52px（沿用现有）

## 组件拆分

从当前 Studio.svelte 2018 行单文件拆分为以下组件：

### 新组件清单

| 组件 | 路径 | 职责 | 估计行数 |
|------|------|------|---------|
| `Studio.svelte` | `pages/` | 布局壳 + 全局状态 + WebSocket | ~400 |
| `PreviewArea.svelte` | `components/` | 视频播放器/图片轮播，自适应 contentType | ~300 |
| `Timeline.svelte` | `components/` | 短视频时间线容器（三轨道） | ~350 |
| `TrackRow.svelte` | `components/` | 单轨道行（复用于视频轨、音轨、字幕轨） | ~200 |
| `ImageLayout.svelte` | `components/` | 图文模式：图片网格排序 + 文案预览 | ~350 |
| `AssetSidebar.svelte` | `components/` | 左侧素材栏（按类型分组+阶段标签） | ~400 |
| `ChatPanel.svelte` | `components/` | 右侧 Chat 完整实现（替换现有空壳） | ~500 |
| `StreamBlock.svelte` | `components/` | 单条消息块渲染（8 种类型） | ~200 |
| `PipelineBar.svelte` | `components/` | 水平 pipeline 进度条 | ~150 |

### 删除/替换清单

| 现有组件 | 处理 | 原因 |
|---------|------|------|
| `CanvasWorkspace.svelte` (1485 行) | 删除 | 未使用的孤立组件 |
| `AssetPanel.svelte` (1304 行) | 删除 | 被 AssetSidebar + PreviewArea 替代 |
| `PipelineSteps.svelte` (439 行) | 删除 | 被 PipelineBar 替代（垂直→水平） |
| `ChatPanel.svelte` (221 行) | 重写 | 当前是空壳，需完整实现 |

## 各组件详细设计

### 1. Studio.svelte（布局壳）

职责缩减为：
- 四区 CSS Grid/Flex 布局
- 全局状态管理：`work`, `streaming`, `currentStep`, `contentType`
- WebSocket 连接和事件分发
- 面板间拖拽调宽（Chat 和 Timeline 高度）
- 将数据通过 props 传给子组件

不再包含：chat 渲染逻辑、素材展示逻辑、流式消息解析。

### 2. PreviewArea.svelte

根据 `contentType` 和当前选中素材自适应渲染：

**短视频模式：**
- 视频播放器（`<video>` 元素 + 自定义控制条）
- 播放/暂停、进度条、时间显示、全屏
- 当前播放片段高亮同步到 Timeline
- 无选中片段时显示最终合成视频（如有）或占位提示

**图文模式：**
- 当前选中图片的大图预览
- 左右箭头切换图片
- 底部缩略图条快速跳转
- 支持缩放查看细节

**Props:**
```typescript
{
  contentType: "short-video" | "image-text"
  assets: AssetFile[]            // 所有素材列表
  selectedAsset: string | null   // 当前选中的素材路径
  workId: string                 // 用于构建 asset URL
}
```

**Events:**
- `on:select(assetPath)` — 用户点击切换素材
- `on:playbackTime(seconds)` — 视频播放位置变化（同步时间线）

### 3. Timeline.svelte（短视频模式）

三轨道布局：

```
┌─ 视频轨 ─────────────────────────────────────────┐
│ [缩略图:scene-001] [缩略图:scene-002] [scene-003] │  可拖拽排序
├─ 音频轨 ─────────────────────────────────────────┤
│ ~~~~ bgm.mp3 波形示意 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~ │  可替换
├─ 字幕轨 ─────────────────────────────────────────┤
│ |字幕段1 |  字幕段2  |    字幕段3    | 字幕段4 |  │  可点击编辑
└──────────────────────────────────────────────────┘
  ▶ 播放头指示器                              总时长
```

**轻交互操作：**
- 视频轨：拖拽排序片段、右键菜单（替换/删除/在 Chat 中编辑）
- 音频轨：显示 BGM 名称和波形示意、点击替换
- 字幕轨：显示字幕文本段、点击弹出编辑框修改文本
- 播放头：与 PreviewArea 播放位置同步
- 所有修改操作生成自然语言指令发送到 Chat

**不支持：** 精确帧裁剪、音量包络线编辑、多轨混合叠加。

**Props:**
```typescript
{
  clips: ClipInfo[]         // { id, path, duration, thumbnail }
  audio: AudioInfo | null   // { path, name, duration }
  subtitles: SubtitleEntry[] // { start, end, text }
  currentTime: number       // 从 PreviewArea 同步
  workId: string
}
```

**Events:**
- `on:reorder(newOrder)` — 片段排序变更
- `on:action({ type, target, payload })` — 删除/替换/编辑字幕等
- `on:seek(seconds)` — 用户点击时间线跳转

### 4. TrackRow.svelte

时间线中的单轨道行，Timeline 组件复用 3 次（视频轨、音轨、字幕轨）。

**Props:**
```typescript
{
  label: string              // "视频" / "音频" / "字幕"
  items: TrackItem[]         // 轨道上的元素
  totalDuration: number      // 总时长，用于计算比例
  currentTime: number        // 播放头位置
  draggable: boolean         // 是否支持拖拽排序
}
```

每个 `TrackItem` 根据轨道类型渲染不同内容：
- 视频轨 item → 缩略图 + 时长标签
- 音频轨 item → 波形示意条 + 文件名
- 字幕轨 item → 文本标签 + 时间范围

### 5. ImageLayout.svelte（图文模式）

替代 Timeline 位置，用于图文内容的排版管理：

```
┌──────────────────────────────────────────────┐
│  [1.png] [2.png] [3.png] [4.png] [+添加]     │  可拖拽排序
├──────────────────────────────────────────────┤
│  发布文案预览                                 │
│  标题：极简生活美学...                         │
│  正文：分享5个让家更舒适的小技巧...             │
│  标签：#极简生活 #家居美学                     │
└──────────────────────────────────────────────┘
```

**功能：**
- 图片网格，可拖拽排序
- 点击图片 → PreviewArea 显示大图
- 右键菜单：替换/删除/在 Chat 中重新生成
- 文案区：只读展示（从 output/ 下的 copytext.md 解析）
- 编辑文案通过 Chat 完成

**Props:**
```typescript
{
  images: ImageInfo[]        // { path, thumbnail, order }
  copytext: CopyText | null  // { title, body, tags, topics }
  workId: string
}
```

### 6. AssetSidebar.svelte（左侧素材栏）

按类型分组，每个素材附带阶段标签：

**分组规则：**
- **IMAGES** — `*.png, *.jpg, *.webp, *.gif`
- **CLIPS** — `*.mp4, *.mov, *.webm`
- **AUDIO** — `*.mp3, *.wav, *.aac`（排除 BGM）
- **BGM** — 文件名包含 `bgm` 或在 `bgm/` 目录下
- **REFERENCE** — 其他文件（`.md`, `.json`, `.txt` 等）

**阶段标签推断：**
- 路径含 `research/` 或 `trends/` → 🏷️调研
- 路径含 `output/` → 🏷️成品
- 路径含 `bgm/` → 🏷️配乐
- 其余 → 🏷️AI生成

**功能：**
- 折叠/展开每个分组
- 缩略图网格（图片/视频）或列表（音频/参考）
- 点击 → PreviewArea 预览 + Timeline 高亮
- 拖拽到 Timeline → 添加到对应轨道
- 5 秒轮询刷新（沿用现有逻辑）

### 7. ChatPanel.svelte

从 Studio.svelte 中提取的完整 Chat 面板，包含：

**组成部分：**
- Stream 区域：滚动消息列表，使用 StreamBlock 子组件渲染
- 输入区域：textarea + 附件栏 + 发送/中止按钮 + 素材选择器
- 评审阻断面板（evalBlocked 时显示）

**Props:**
```typescript
{
  streamBlocks: StreamBlock[]
  streaming: boolean
  evalBlocked: boolean
  activeToolName: string
  workId: string
  assets: string[]          // 用于素材选择器
}
```

**Events:**
- `on:send({ text, attachments })` — 用户发送消息
- `on:abort()` — 中止当前生成
- `on:evalAction({ action, guidance? })` — 评审操作（force-pass / retry）

### 8. StreamBlock.svelte

单条消息块渲染，支持 8 种类型：

| 类型 | 渲染方式 |
|------|---------|
| `text` | MarkdownBlock 渲染 |
| `user` | 用户气泡 + 附件预览 |
| `thinking` | 可折叠思考卡片 |
| `tool_use` | 可折叠工具调用卡片（显示工具名+参数） |
| `tool_result` | 可折叠结果卡片 |
| `ask_question` | 交互按钮组 |
| `step_divider` | Pipeline 阶段分隔线 |
| `eval_divider` | 评审结果分隔线 |

### 9. PipelineBar.svelte

水平进度条，替代现有垂直 PipelineSteps：

```
[① 调研 ✓] ──→ [② 规划 ✓] ──→ [③ 素材 ●] ──→ [④ 合成 ○]
```

- 已完成步骤：实心圆 + 绿色 ✓
- 当前步骤：脉冲动画 + 高亮
- 待执行：空心圆 + 灰色
- 点击已完成步骤 → 可重新执行
- 紧凑设计，48px 高

## 数据流

```
Studio.svelte (状态中心)
  │
  ├── WebSocket 事件 → 更新 streamBlocks, pipeline, assets
  │
  ├──→ AssetSidebar    (assets[], selectedAsset)
  ├──→ PreviewArea     (contentType, assets, selectedAsset)
  ├──→ Timeline        (clips, audio, subtitles, currentTime)
  ├──→ ImageLayout     (images, copytext)
  ├──→ ChatPanel       (streamBlocks, streaming, evalBlocked)
  └──→ PipelineBar     (pipeline, currentStep)

用户操作回流:
  AssetSidebar  →  on:select     →  Studio 更新 selectedAsset
  PreviewArea   →  on:playbackTime → Studio 更新 currentTime
  Timeline      →  on:action     →  Studio 构建指令 → ChatPanel 发送
  ChatPanel     →  on:send       →  Studio 通过 WS 发送到 Agent
  PipelineBar   →  on:selectStep →  Studio 切换步骤
```

## 时间线操作 → Chat 指令映射

用户在 Timeline 上的操作转化为自然语言指令发送到 Chat：

| 操作 | 生成的 Chat 指令 |
|------|-----------------|
| 拖拽排序片段 | `请把视频片段重新排列为: scene-003, scene-001, scene-002` |
| 删除片段 | `请删除视频片段 scene-002` |
| 替换片段 | `请重新生成第2个视频片段` |
| 替换 BGM | `请更换背景音乐，当前是 bgm-energetic.mp3` |
| 编辑字幕文本 | `请把第3段字幕从"原文本"改为"新文本"` |
| 图片排序 | `请把图片重新排列为: 3.png, 1.png, 2.png, 4.png` |

这保持了 AI 驱动的核心逻辑——用户通过可视化界面表达意图，实际执行仍由 Agent 完成。

## 样式规范

沿用 Editorial Noir 设计系统：

- 背景：`--bg-primary: #0A0A0F`（深色）
- 面板背景：`--bg-secondary: #12121A`
- 边框：`--border-subtle: rgba(255,255,255,0.06)`
- 强调色：`--spark-red: #FE2C55`（操作按钮）、`--spark-cyan: #25F4EE`（进度指示）
- 字体：Space Grotesk（标题）、DM Sans（正文）
- 面板分割：1px border + 可拖拽 resize handle
- 时间线轨道：`--bg-tertiary` 背景，片段块带圆角和 hover 高亮
- 阶段标签：小型 pill badge，半透明背景

## 实现约束

1. **纯 Svelte 5 runes** — 不引入新的状态管理库
2. **不引入新依赖** — 时间线用原生 DOM + CSS 实现，不用第三方时间线库
3. **渐进式重构** — 先搭骨架再填充，保证每步都可运行
4. **保持 WS 协议不变** — 后端 API 和 WebSocket 消息格式不改动
5. **素材轮询复用** — AssetSidebar 继续使用 5 秒间隔 GET /api/works/:id/assets
