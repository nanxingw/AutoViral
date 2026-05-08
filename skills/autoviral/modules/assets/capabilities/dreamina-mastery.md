---
name: video-toolkit
description: Use as the operational manual for video generation in autoviral. Covers OpenRouter video API (PRIMARY — `POST /api/v1/videos` async job, 7 supported models including Seedance 2.0/Veo 3.1/Wan 2.7/Sora 2 Pro), Dreamina CLI (LEGACY FALLBACK only when OpenRouter is unavailable), and Jimeng (DEPRECATED). Skip and you write Dreamina CLI commands when the codebase wants HTTP fetches.
type: capability
priority: rigid
sources:
  - https://openrouter.ai/docs/guides/overview/multimodal/video-generation
  - https://openrouter.ai/announcements/video-generation
  - https://openrouter.ai/bytedance/seedance-2.0/api
last_updated: 2026-05-08
---

# Video Toolkit — autoviral 视频生成全栈手册

> **Historical note**：本文件原名 `dreamina-mastery.md`，覆盖 Dreamina CLI 单一通道。2026-05-08 升级为统一视频工具书——**主通道全量切换到 OpenRouter video API**，Dreamina CLI 降为 legacy fallback。文件名暂保留以避免 6 处引用断裂；内容已重构。

---

## 0. 通道选型（先决决策）

| 通道 | 状态 | 何时用 |
|---|---|---|
| **OpenRouter** `/api/v1/videos` | 🟢 **PRIMARY**（autoviral 主通道）| 默认所有视频生成 |
| **Dreamina CLI** | 🟡 Legacy fallback | OpenRouter 不可用 / 配额 / 网络故障；用户需要本地 CLI 工作流 |
| **Jimeng HTTP API** | ❌ DEPRECATED | 不再使用（2026-05-08 起）|

**铁律**：写代码 / 教 agent 时**永远先教 OpenRouter 路径**。Dreamina CLI 仅在 fallback 章节出现。

---

## 1. OpenRouter Video API — Quickstart（PRIMARY）

### 1.1 流程总览（async job）

```
1. POST /api/v1/videos        → 返回 jobId
2. GET  /api/v1/videos/{id}   → 轮询状态（每 5-10 秒一次，状态 pending → succeeded / failed）
3. GET  /api/v1/videos/{id}/content?index=0  → 下载视频
```

视频生成通常 30 秒 – 5 分钟，**一律 async**——同步等待会超时。

### 1.2 鉴权

```bash
Authorization: Bearer $OPENROUTER_API_KEY
```

`OPENROUTER_API_KEY` 从 `.env` 读取，autoviral 已统一这个 env 名。

### 1.3 三种请求形态

#### A. Text-to-Video（最简单）

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "[0s] Wide shot: A young Asian woman sits at a coffee shop window seat reading a leather-bound notebook. Camera is static. Warm tungsten light at 3200K. [4s] She looks up, eyes drifting to a far point. Cinematic 8s clip, Kodak Portra 400 emulation, fine grain, Morandi warm palette, contemplative mood, shot on Hasselblad medium format with 80mm at f/2. Negative: no distortion, no extra fingers, no subtitles.",
    "resolution": "1080p",
    "aspect_ratio": "9:16",
    "duration": 8
  }'
```

返回：
```json
{
  "id": "vid_abc123...",
  "status": "pending",
  "model": "bytedance/seedance-2.0",
  "created_at": "2026-05-08T12:00:00Z"
}
```

#### B. Image-to-Video（首帧 / 末帧 / 首尾帧驱动）

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "<timeline-prompt — 详见 video-prompt-narrative.md>",
    "frame_images": [
      {
        "type": "image_url",
        "image_url": { "url": "https://your-cdn.com/first-frame.png" },
        "frame_type": "first_frame"
      },
      {
        "type": "image_url",
        "image_url": { "url": "https://your-cdn.com/last-frame.png" },
        "frame_type": "last_frame"
      }
    ],
    "aspect_ratio": "9:16",
    "duration": 8
  }'
```

只给 `first_frame` = 首帧驱动（替代旧的 `image2video`）；
只给 `last_frame` = 末帧驱动；
两个都给 = 首尾帧插值（替代旧的 `frames2video`）。

> **重要**：当 `frame_images` 给定时，**不要**再传 `aspect_ratio`——比例自动从输入图片推断（跟 Dreamina CLI 行为一致）。传了会报错或被忽略。

#### C. Reference-to-Video（多 ref 编排式 prompt）

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "Replace the character in the second reference video with the person from the first reference image, ending in the environment of the second reference image. The character should wear sci-fi glasses. Match the camera movement and surround shots of the reference video.",
    "input_references": [
      { "type": "image_url", "image_url": { "url": "https://cdn.com/hero.png" } },
      { "type": "image_url", "image_url": { "url": "https://cdn.com/space-vista.png" } },
      { "type": "video_url", "video_url": { "url": "https://cdn.com/dolly-shot.mp4" } }
    ],
    "aspect_ratio": "16:9",
    "duration": 8
  }'
```

**多 ref 协议详见 `reference-directives.md`**——OpenRouter 用 `input_references` array index 而**不是** `@image1` CLI 语法。在 prompt 文本里用"the first reference image / the second reference video"等描述指代。

### 1.4 轮询状态

```bash
curl "https://openrouter.ai/api/v1/videos/{jobId}" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

返回字段：
```json
{
  "id": "vid_abc123...",
  "status": "pending | running | succeeded | failed",
  "progress": 45,           // running 时的百分比
  "outputs": [...],         // succeeded 后才有
  "error": "...",           // failed 时
  "completed_at": "..."
}
```

**轮询节奏**：每 5-10 秒一次。autoviral 的 backend `dispatchGeneration.ts` 应该用 backoff（5s → 10s → 20s 上限 30s）。

### 1.5 下载

```bash
curl "https://openrouter.ai/api/v1/videos/{jobId}/content?index=0" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  --output final.mp4
```

`index` 用于多输出（某些模型支持一次提交多个 variant），默认 0。

---

## 2. OpenRouter 7 视频模型选型表

```bash
# 查询当前所有可用模型 + 价格 + 比例 + 时长
curl https://openrouter.ai/api/v1/videos/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

| 模型 ID | 范式 | 强项 | 时长 | 比例 | autoviral 默认级 |
|---|---|---|---|---|---|
| **`bytedance/seedance-2.0`** | Timeline 导演 | 镜头语言精确 / lip-sync / 多 ref | 4-15s | 6 种 | ⭐⭐⭐⭐⭐ **PRIMARY** |
| `bytedance/seedance-2.0-fast` | Timeline 导演 | 速度快（30-60s 出）+ 同质量 | 4-15s | 6 种 | ⭐⭐⭐⭐ 测试/预览 |
| `bytedance/seedance-1.5-pro` | Timeline 导演 | 1080p 输出 | 4-15s | 6 种 | ⭐⭐⭐ 当 2.0 输出 720p 不够时 |
| `google/veo-3.1` | Rendering engine | 写实人像 / 商业广告 / JSON prompt | ≤8s | 16:9 / 9:16 | ⭐⭐⭐⭐ 商业级人像 |
| `alibaba/wan-2.7` | MoE diffusion | 最 cinematic / 长镜头 / 复杂场景 | 4-15s | 多种 | ⭐⭐⭐⭐ 电影感 |
| `alibaba/wan-2.6` | MoE diffusion | 同上稍旧 | — | — | ⭐⭐⭐ 备选 |
| `openai/sora-2-pro` | Physics simulator | 因果剧情 / 超现实 / 流体物理 | ≤10s | 多种 | ⭐⭐⭐⭐ 超现实/物理 |

### 2.1 默认选型策略

```
用户没特殊要求
  → bytedance/seedance-2.0-fast  （速度优先，质量已够）

用户要"最好"质量 / 正式发布
  → bytedance/seedance-2.0       （PRIMARY）

需要 1080p 分辨率
  → bytedance/seedance-1.5-pro   （Seedance 2.0 当前仅 720p）

写实人像、皮肤细节、商业广告
  → google/veo-3.1               （Veo 3 写实人像最强）

电影长镜头、cinematic 大场面
  → alibaba/wan-2.7              （MoE 最 cinematic）

超现实、因果叙事、复杂物理（流体/火/烟）
  → openai/sora-2-pro            （Sora 物理模拟器）
```

### 2.2 模型 prompt 范式 ≠ OpenRouter 调用方式

**关键认知**：OpenRouter 抽象的是**调用方式**（统一 endpoint），不是 prompt 语法。

| 模型 | OpenRouter 调用 | Prompt 范式 |
|---|---|---|
| Seedance 2.0 | 同 endpoint | `[Xs]` timeline（参 video-prompt-narrative.md）|
| Veo 3.1 | 同 endpoint | JSON schema（参 model-paradigms.md §1.2）|
| Wan 2.7 | 同 endpoint | 自然语言 + camera prose |
| Sora 2 Pro | 同 endpoint | 因果叙事段落（参 model-paradigms.md §1.1）|

**铁律**：写 prompt 前先确认你要用哪个模型，再来 `model-paradigms.md` 查对应范式——**不要把 Seedance prompt 直接给 Sora 跑**。

---

## 3. 命令选择决策树（OpenRouter 版）

```
输入是什么？
├── 只有文字描述（无参考媒体）
│   └── text-to-video（请求只含 prompt）
├── 1 张图片
│   ├── 想精确控制结束画面？
│   │   ├── 是 → image-to-video with first_frame + last_frame
│   │   └── 否 → image-to-video with first_frame only
│   └── 还想要参考额外视觉？
│       └── 用 reference-to-video（input_references 数组）
├── 2 张图片
│   ├── 是首帧 + 末帧？  → image-to-video with both frame_types
│   └── 是叙事序列 / 多角度？ → reference-to-video
├── 3-9 张图片
│   └── reference-to-video（数组上限 9 张）
└── 图片 + 视频混合 / 借运镜
    └── reference-to-video（image + video 混合 input_references）
```

---

## 4. Prompt 工程（链向专文）

视频 prompt 写法**不在本文件**——本文件只讲工具调用。Prompt 协议见：

- **`video-prompt-narrative.md`** — Seedance 2.0 timeline 协议（PRIMARY · rigid · 必读）
- **`reference-directives.md`** — 多 ref 编排式 prompt（OpenRouter `input_references` 语法）
- **`viral-archetypes.md`** — 4 大原型 + 真实可运行 prompt 范本
- **`keyword-library.md`** — 惊艳关键词分类索引
- **`model-paradigms.md`** — Sora / Veo / Kling / Seedance 范式分化（**跨模型必查**）

---

## 5. autoviral 集成层（Backend 实现）

`src/server/dispatchGeneration.ts` 是 envelope 协议层，向上对 frontend 暴露统一接口，向下 OpenRouter 调用。改动指南：

```typescript
// PRIMARY 路径
async function generateVideo(envelope: VideoEnvelope): Promise<JobHandle> {
  const res = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: envelope.model ?? "bytedance/seedance-2.0",
      prompt: envelope.prompt,
      ...(envelope.frameImages && { frame_images: envelope.frameImages }),
      ...(envelope.references && { input_references: envelope.references }),
      ...(envelope.aspectRatio && { aspect_ratio: envelope.aspectRatio }),
      ...(envelope.duration && { duration: envelope.duration }),
    }),
  });
  const job = await res.json();
  return { id: job.id, status: job.status, provider: "openrouter" };
}

async function pollJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`https://openrouter.ai/api/v1/videos/${jobId}`, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  });
  return res.json();
}

async function downloadVideo(jobId: string, index = 0): Promise<Buffer> {
  const res = await fetch(
    `https://openrouter.ai/api/v1/videos/${jobId}/content?index=${index}`,
    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } }
  );
  return Buffer.from(await res.arrayBuffer());
}
```

> autoviral 后端 `dispatchGeneration.ts` 当前仍调用 Dreamina CLI（`script: "dreamina multimodal2video"` / `executable_kind: "shell"`）。**待迁移到 OpenRouter HTTP**——这是单独的代码任务，不在本文档范围。文档先对齐，代码逐步迁。

---

## 6. 常见错误与排查

| 错误 | 含义 | 修法 |
|---|---|---|
| `401 Unauthorized` | API key 缺失或失效 | 检查 `.env` 中 `OPENROUTER_API_KEY` |
| `429 Too Many Requests` | 配额耗尽或速率超限 | 退避重试；检查 https://openrouter.ai/settings/credits |
| `422 Validation Error` | 请求参数不合法 | 看 response body 的 `error.detail` |
| Job stuck on `pending` > 5 min | 模型负载高 | 切到 `seedance-2.0-fast` 或换时段重试 |
| `failed` with content-policy reason | 提示词或参考图被审核拒 | 走 `filter-retries.md` 的恢复路径（清洗 prompt / 重描参考图） |
| `frame_images` + `aspect_ratio` 同传报错 | 比例自动从图推断 | 删除 `aspect_ratio` 字段 |
| 视频音频被 reject | output-audio 分类器特别严 | 默认走"不传 audio ref + 视频静音 + 后期 ffmpeg 混音"|

---

## 7. Dreamina CLI（LEGACY FALLBACK）

仅当 OpenRouter 不可用时使用。**不要**在新代码 / agent 教学里推荐 CLI。

### 7.1 安装与登录

```bash
curl -fsSL https://jimeng.jianying.com/cli | bash
dreamina login   # 手动扫码
dreamina user_credit
```

### 7.2 命令矩阵（旧）

| OpenRouter | Dreamina CLI 等价 |
|---|---|
| text-to-video | `dreamina text2video --prompt "..." --aspect-ratio 9:16 --output clip.mp4` |
| image-to-video（first_frame）| `dreamina image2video --first-frame frame.png --prompt "..." --output clip.mp4` |
| frame_images（first + last）| `dreamina frames2video --first-frame a.png --last-frame b.png --output clip.mp4` |
| reference-to-video（≤9 image, ≤3 video, ≤3 audio）| `dreamina multimodal2video --image a.png --video b.mp4 --prompt "..."` |

> **重要差异**：CLI 用 `@image1` 寻址，OpenRouter 用 `input_references` array index + 自然语言指代（"the first reference image"）。**协议层不能简单 1:1 翻译**——参 `reference-directives.md`。

### 7.3 何时回退到 CLI

- OpenRouter 整站故障（Status page: https://openrouter.statuspage.io/）
- 用户需要本地工作流（无网 / 离线开发）
- 配额耗尽且无信用卡补充

---

## 8. Jimeng HTTP API（DEPRECATED）

2026-05-08 起停用。原因：
- OpenRouter 已包含 Seedance 2.0（同模型，更稳定通道）
- Jimeng 接口仅支持单首帧/末帧，不支持多 ref，能力受限
- 维护两条 backend 通道增加 envelope 协议复杂度

**不要在新代码引用** `JIMENG_ACCESS_KEY` / `JIMENG_SECRET_KEY` env vars。如果遇到老代码使用 Jimeng，标记为 TODO 迁移到 OpenRouter。

---

## 9. 自检（agent 写代码 / 写 prompt 前必扫）

- ☐ 走 OpenRouter `/api/v1/videos`，不是 Dreamina CLI
- ☐ 模型 ID 用 `provider/model-name` 格式（默认 `bytedance/seedance-2.0`）
- ☐ Async：提交 → poll → 下载，不要同步等
- ☐ 多 ref 用 `input_references` 数组 + prompt 文本指代，不用 `@image1`
- ☐ `frame_images` 模式不传 `aspect_ratio`
- ☐ Prompt 写法链向 `video-prompt-narrative.md`，不在本文件重复
- ☐ 失败处理走 `filter-retries.md` 决策树

---

## See also

- `video-prompt-narrative.md` — Seedance 2.0 timeline prompt 协议（rigid · 必读）
- `reference-directives.md` — 多 ref 编排（OpenRouter `input_references`）
- `model-paradigms.md` — Sora / Veo / Kling / Seedance 范式分化
- `viral-archetypes.md` — 4 大 viral 原型
- `keyword-library.md` — 惊艳关键词索引
- `frame-gacha.md` — 多候选批量抽签
- `quality-gate.md` — 质量门槛与自检
- `fallback-strategy.md` — 工具不可用时的降级路径
- `filter-retries.md` — content-policy 拒绝恢复路径
- `structured-generation.md` — variant 模式 envelope 协议
