---
name: autoviral-assets
description: Use when the user wants raw generation — images, video clips, music, posters. Pick directly when the user has a clear visual idea or brief; planning pass NOT required. Do NOT use for editing already-generated material (→ assembly). Quality gate is mandatory — single-sample first, rubric ≥ 3.5, then batch with frame-gacha; never deliver "AI default mediocre".
type: capability
priority: flexible
---

# Assets Module

## 定位

本模块是**生成引擎**：给定一份来自 `taste/` 和 `planning/` 的决策，用合适的工具产出素材。

**任何"什么风格好看"、"这个意境用什么镜头"类判断不在这里做**——参见 `taste/00-prime-directive.md`。本模块要做的是：

1. 把 brief 里的视觉 / 音频决策翻译成各工具可执行的 prompt 或参数
2. 选择合适的工具与降级路径
3. 批量执行 + 质量门槛把关 + 重生机制

## 工具矩阵（2026-05-08 起：图片 + 视频统一走 OpenRouter）

| 需求 | PRIMARY | LEGACY FALLBACK | 适用情况 |
|---|---|---|---|
| **图片** | OpenRouter `POST /api/v1/chat/completions` + `openai/gpt-5.4-image-2` | — | 所有静态画面、封面、图文笔记插图。备选模型见 `capabilities/image-prompt-narrative.md` §10 |
| **视频** | OpenRouter `POST /api/v1/videos` + `bytedance/seedance-2.0`（async job） | Dreamina CLI（仅 OpenRouter 故障时） | 7 模型可选见 `capabilities/dreamina-mastery.md` §2 |
| **音乐** | `music_generate.py`（Google Lyria 3 Pro，复用 `OPENROUTER_API_KEY`）| — | AI 原创音乐，~2 分钟完整曲目 |
| **图文排版** | `poster_render.py`（Playwright + HTML/CSS） | — | 图文卡片、封面、信息卡片（非 AI 通道）|
| **状态检查** | `curl https://openrouter.ai/api/v1/credits` | — | 开工前查配额 |

**统一鉴权**：所有 AI 调用复用 `OPENROUTER_API_KEY`（autoviral 已统一这个 env 名）。Dreamina CLI / Jimeng 的独立鉴权（`JIMENG_ACCESS_KEY` 等）已**DEPRECATED**，新代码不要引用。

## 图片生成（OpenRouter `/api/v1/chat/completions` · 同步）

**主模型**：`openai/gpt-5.4-image-2`（默认）。备选 5 模型（Nano Banana 2 / Seedream 4.5 / Flux.2 Pro / Recraft v3）见 `capabilities/image-prompt-narrative.md` §10。

### 基础调用

```bash
curl -X POST "https://openrouter.ai/api/v1/chat/completions" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5.4-image-2",
    "messages": [{ "role": "user", "content": "<完整 prompt 见 image-prompt-narrative.md>" }],
    "modalities": ["image", "text"],
    "image_config": { "aspect_ratio": "9:16", "image_size": "2K" }
  }'
```

返回的 `choices[0].message.images[0].image_url.url` 是结果 URL。

### 参考图（图生图）

```bash
curl -X POST "https://openrouter.ai/api/v1/chat/completions" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5.4-image-2",
    "messages": [{
      "role": "user",
      "content": [
        { "type": "text", "text": "Generate in same style as reference: ..." },
        { "type": "image_url", "image_url": { "url": "https://cdn.com/ref.jpg" } }
      ]
    }],
    "modalities": ["image", "text"],
    "image_config": { "aspect_ratio": "3:4", "image_size": "2K", "strength": 0.65 }
  }'
```

### 参数约束

- `image_config.image_size`：`1K` / `2K`（不支持 0.5K / 4K）
- `image_config.aspect_ratio`：`1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `2:3` / `3:2`
- `image_config.strength`：0.0-1.0，参考图引导强度（精确复现 0.3-0.5）

完整 API 调用 + 5 备选模型选型表 + Backend 实现代码见 **`capabilities/image-prompt-narrative.md` §9-§11**。

### Prompt 写法（rigid · 必读）

详见 `capabilities/image-prompt-narrative.md`。核心原则：

- **Camera/equipment 短语前置**（"Editorial portrait on Hasselblad X2D 100C with XCD 90V at f/4: ..."）
- **主体用方括号高亮**（`[a young Asian woman in her late twenties...]`）
- **Lighting 4 要素**（direction + color temp + quality + 1 个高级 phrase 如 subsurface scattering / halation）
- **Closing style line 必须**（cinematic + film stock + grain + color grade + mood）
- **显式对抗默认**（AI 倾向中景居中、平庸 stock photo 美学，需要明确覆盖）

## 视频生成（OpenRouter `/api/v1/videos` · async job）

**主模型**：`bytedance/seedance-2.0`（默认）。7 模型可选（Seedance 2.0 / 2.0-fast / 1.5-pro / Veo 3.1 / Wan 2.7/2.6 / Sora 2 Pro）见 `capabilities/dreamina-mastery.md` §2。

### Async job 流程

```
1. POST /api/v1/videos        → 返回 {id, status: "pending"}
2. GET  /api/v1/videos/{id}   → 轮询，5-10s 间隔；状态 pending/running/succeeded/failed
3. GET  /api/v1/videos/{id}/content?index=0  → 下载 .mp4
```

### Text-to-Video

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "<完整 timeline prompt 见 video-prompt-narrative.md>",
    "aspect_ratio": "9:16",
    "duration": 8
  }'
```

### Image-to-Video（首帧 / 末帧 / 首尾帧驱动）

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "<timeline prompt>",
    "frame_images": [
      { "type": "image_url", "image_url": { "url": "..." }, "frame_type": "first_frame" }
    ],
    "duration": 8
  }'
```

> **关键**：`frame_images` 给定时不要再传 `aspect_ratio`，比例自动从图推断。

### Multimodal Reference-to-Video

多 ref 编排（替换角色 / 切换环境 / 借运镜），用 `input_references` 数组——详见 **`capabilities/reference-directives.md`**（OpenRouter `input_references` 协议 + role 词汇）。

### 首帧优先原则

**永远先生首帧再 image-to-video**：

- 首帧用 `openai/gpt-5.4-image-2` 生精
- `frame_images.first_frame` 驱动视频
- text-to-video 只在首帧约束不重要时使用

完整 API 矩阵 + 7 模型选型 + Backend 实现代码见 **`capabilities/dreamina-mastery.md`**。

## 音乐生成（Lyria 3 Pro）

复用 `OPENROUTER_API_KEY`：

```bash
# 文生音乐
python3 scripts/music_generate.py \
  --prompt "lo-fi hip-hop with warm synths, 90 bpm" \
  --duration 60 \
  --output bgm.mp3

# 图生音乐（基于参考图的情绪）
python3 scripts/music_generate.py \
  --prompt "..." \
  --ref-image mood.jpg \
  --output bgm.mp3
```

详见 `capabilities/music-generation.md`。

## 图文排版（Playwright + HTML 模板）

用于图文卡片、封面、信息卡片——**不是** AI 画出来的图，是用 HTML/CSS 精确渲染。

```bash
# 内置模板
python3 scripts/poster_render.py \
  --template xhs-fresh \
  --data '{"title":"...","body":"...","tags":["..."]}' \
  --output poster.png

# AI 图 + 文字叠加
python3 scripts/poster_render.py \
  --template xhs-photo-title \
  --bg-image ai_photo.png \
  --data '{"title":"..."}' \
  --output cover.png

# 自定义模板
python3 scripts/poster_render.py \
  --template /path/to/index.html \
  --data data.json \
  --output out.png
```

内置模板（命名以"用途"为轴，与平台无关）：`xhs-fresh` / `xhs-premium` / `xhs-infocard` / `xhs-photo-title` / `xhs-cover`。
> 注：模板前缀 `xhs-` 是历史遗留命名（曾来自小红书风格采样），现在表达**通用图文卡片设计语言**——`fresh = 浅色干净`、`premium = 高级深色`、`infocard = 信息密集`、`photo-title = 摄影 + 主标题`、`cover = 封面型`。下一轮重命名为 `card-*` 时同步更新 `poster_render.py`。

详见 `capabilities/poster-design.md` 和 `templates/` 目录。

字体由 `scripts/font_manager.py` 自动管理（缺失自动下载）。

## 状态检查

开工前或降级决策前：

```bash
# 查询配额
curl https://openrouter.ai/api/v1/credits \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"

# 查询当前可用视频模型 + 价格 + 比例
curl https://openrouter.ai/api/v1/videos/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"

# 查询当前可用图像模型
curl https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" | jq '.data[] | select(.architecture.modality | contains("image"))'
```

返回字段含 `total_credits` / `total_usage` / `is_blocked`——批量前必查。

## 质量门槛（必读）

批量生成前**必须**先做小样测试。详见 `capabilities/quality-gate.md`。核心：

1. **单样本先生成 1 张/1 段**，对照 `taste/06-rubric.md` 打分
2. 达到 3.5+ 才进入批量
3. 批量中途抽检 3 张，不合格回退参数再生
4. 批量完成后对关键帧逐张过 rubric

**不要把 AI 生成的"大概像"结果直接交付**。AI 的默认输出是平庸合格品——我们不做合格品。

### 批量 + Frame Gacha（多候选抽签）

一张关键画面经常需要生 5-10 张候选挑选。使用 `capabilities/frame-gacha.md` 里的批量循环：

```bash
# OpenRouter 不暴露 seed 参数（DALL-E 系），靠多次 sampling 拿候选
for i in {1..8}; do
  curl -X POST "https://openrouter.ai/api/v1/chat/completions" \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"openai/gpt-5.4-image-2\",\"messages\":[{\"role\":\"user\",\"content\":\"...\"}],\"modalities\":[\"image\",\"text\"],\"image_config\":{\"aspect_ratio\":\"9:16\",\"image_size\":\"2K\"}}" \
    | jq -r '.choices[0].message.images[0].image_url.url' \
    | xargs -I{} curl -o "candidate_$i.png" "{}"
done
# 然后对 8 张做 rubric 评分，留最高分
```

## 降级策略

工具不可用 / 配额耗尽时的优雅降级路径在 `capabilities/fallback-strategy.md`。核心原则：

1. **质量优先**：宁可告知用户不可行，不可静默降质
2. **最小让步**：OpenRouter PRIMARY → 切换备选模型（Nano Banana 2 / Wan 2.7 等）→ Dreamina CLI legacy fallback → 高质量静帧 + 轻动效
3. **透明决策**：任何降级必须告知用户并获得确认
4. **首帧驱动**：视频永远先 OpenRouter 生精首帧，再 image-to-video 保留控制力

## 平台技术规格（非创作建议）

**本节只讲技术约束，不讲创作**。创作由 `taste/` 决定。

完整的宽高比 / 编码 / 码率 / 安全区 / 时长表统一查 `../assembly/references/platform-specs.md`——这是 frontend `PlatformPresetSection.tsx` 的同源真值表。

assets 模块只关心两个工具维度：

| 维度 | 取值范围 |
|---|---|
| 视频宽高比 | `9:16` / `3:4` / `1:1` / `16:9`（OpenRouter videos API `aspect_ratio`） |
| 图片宽高比 | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `2:3` / `3:2`（OpenRouter `image_config.aspect_ratio`） |

## Capabilities 索引

### Prompt 工程（**rigid · 必读**——基于 2026 年业界 OSS 范式 + 官方文档调研）

- `capabilities/video-prompt-narrative.md` — **视频 prompt 叙事层**（Seedance 2.0 timeline 协议：`[Xs]` 方括号 + 4-component beat + closing style line + subject 一致性 + lip-sync + 相机型号 + 反向引导，含 5 个完整可运行 prompt 示例）
- `capabilities/image-prompt-narrative.md` — **图像 prompt 叙事层**（OpenRouter `gpt-5.4-image-2` 主通道：camera-first paragraph + 主体方括号 + lighting 4 要素 + closing style line，含 5 个完整可运行 prompt 示例）
- `capabilities/viral-archetypes.md` — **4 大 viral 原型**（满足感转化 / 情感叙事钩子 / 高能量动作 / 喜剧荒诞，每原型 3+ 真实可运行 prompt 范本）
- `capabilities/keyword-library.md` — **惊艳关键词分类索引**（subsurface scattering / halation / solarpunk / Black Pro-Mist 1/4 等，按光线/调色/质感/镜头/运镜/美学/构图/防御性 negative 分类）
- `capabilities/model-paradigms.md` — **模型范式分化**（Sora 2=physics / Veo 3=rendering / Kling 3=choreographer / Seedance 2=timeline，跨模型 prompt 转换表）

### 工具与命令

- `capabilities/dreamina-mastery.md` — **Video toolkit**（OpenRouter `/api/v1/videos` PRIMARY · 7 模型选型 · Dreamina CLI legacy fallback · backend 实现代码）
- `capabilities/reference-directives.md` — 多 ref 编排式 prompt（OpenRouter `input_references` 数组 + role 词汇 + 槽位预算 ≤9 image/3 video/3 audio）
- `capabilities/music-generation.md` — 音乐 prompt 与参数（Lyria 3 Pro）
- `capabilities/poster-design.md` — 图文排版模板（Playwright + HTML）

### 质量与降级

- `capabilities/frame-gacha.md` — 多候选批量抽签机制
- `capabilities/quality-gate.md` — 质量门槛与自检流程
- `capabilities/fallback-strategy.md` — 工具不可用时的降级路径
- `capabilities/filter-retries.md` — content-policy 拒绝的恢复路径
- `capabilities/structured-generation.md` — variant 模式 envelope 协议

## 自检

素材交付前：

- [ ] 所有视觉决策能回溯到 `taste/02 / 04 / 05` 的具体条目
- [ ] 单样已做 rubric 评分 ≥ 3.5，批量已抽检
- [ ] 关键镜头的候选已 gacha 多张，选了最优
- [ ] 任何降级已告知用户并获得确认
- [ ] 交付格式（尺寸、编码、命名）对下游 `assembly/` 友好
