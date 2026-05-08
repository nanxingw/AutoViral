---
name: autoviral-assets
description: Use when the user wants generation — images, video clips, music, posters, fonts. Pick this directly when the user has a clear visual idea and a brief; you do not need a planning pass first. Do NOT use for editing already-generated material — go to assembly.
---

# Assets Module

## 定位

本模块是**生成引擎**：给定一份来自 `taste/` 和 `planning/` 的决策，用合适的工具产出素材。

**任何"什么风格好看"、"这个意境用什么镜头"类判断不在这里做**——参见 `taste/00-prime-directive.md`。本模块要做的是：

1. 把 brief 里的视觉 / 音频决策翻译成各工具可执行的 prompt 或参数
2. 选择合适的工具与降级路径
3. 批量执行 + 质量门槛把关 + 重生机制

## 工具矩阵

| 需求 | 首选 | 备选 | 适用情况 |
|---|---|---|---|
| **图片** | `openrouter_generate.py`（`openai/gpt-5.4-image-2`） | — | 所有静态画面、封面、图文笔记插图 |
| **视频** | `dreamina` CLI（Seedance 2.0） | `jimeng_generate.py`（火山 Visual API） | Dreamina 首选；未登录/额度不足降级到 Jimeng |
| **音乐** | `music_generate.py`（Google Lyria 3 Pro） | — | AI 原创音乐，~2 分钟完整曲目 |
| **图文排版** | `poster_render.py`（Playwright + HTML/CSS） | — | 图文卡片、封面、信息卡片 |
| **状态检查** | `check_providers.py` | — | 开工前或降级决策前 |

## 图片生成（OpenRouter → `openai/gpt-5.4-image-2`）

**这是唯一的图片生成通道。** Gemini 3.1 与 Jimeng 图片能力已下线。

```bash
# 基础用法
python3 scripts/openrouter_generate.py \
  --prompt "<视觉描述，结合 taste/02 的镜头语法术语>" \
  --aspect-ratio 9:16 \
  --image-size 2K \
  --output out.png

# 参考图（图生图）
python3 scripts/openrouter_generate.py \
  --prompt "<prompt>" \
  --ref-image reference.jpg \
  --aspect-ratio 3:4 \
  --image-size 2K \
  --output out.png

# 指定 seed 保证可复现
python3 scripts/openrouter_generate.py --prompt "..." --seed 42 --output out.png
```

**参数约束**：

- `--image-size`：只支持 `1K` 或 `2K`（`0.5K` 和 `4K` 会返回 400）
- `--aspect-ratio`：`1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `2:3` / `3:2`
- `--temperature`：默认 1.0，精确复现参考图用 0.3-0.5

**Prompt 写法** 详见 `capabilities/prompt-mastery.md`。核心原则：

- **指定镜头语法**（按 `taste/02` 术语：`wide shot / low angle / slow push-in / negative space`）
- **一帧一构图**，不要让 prompt 里的构图指令打架
- **显式对抗默认**（AI 倾向中景居中，需要明确覆盖）

## 视频生成（Dreamina 首选，Jimeng 备选）

### Dreamina CLI（首选）

命令行工具，支持 Seedance 2.0 模型。安装：

```bash
curl -fsSL https://jimeng.jianying.com/cli | bash
dreamina login   # 需手动扫码登录
dreamina user_credit   # 查看剩余积分
```

常用命令：

```bash
# 文生视频
dreamina text2video --prompt "..." --aspect-ratio 9:16 --output clip.mp4

# 图生视频（首帧驱动，推荐）
dreamina image2video --first-frame frame.png --prompt "镜头缓慢推进..." --output clip.mp4

# 首尾帧视频
dreamina frames2video --first-frame a.png --last-frame b.png --output clip.mp4

# 多帧驱动
dreamina multiframe2video --frames "a.png,b.png,c.png" --output clip.mp4

# 文字到图（补充能力）
dreamina text2image --prompt "..." --aspect-ratio 9:16 --output img.png

# 图生图
dreamina image2image --input img.png --prompt "..." --output out.png
```

详细 mastery 见 `capabilities/dreamina-mastery.md`。

### Jimeng（备选，HTTP API）

只在 Dreamina 不可用时使用。图片生成能力已禁用，**仅用于视频**。

```bash
python3 scripts/jimeng_generate.py video \
  --prompt "..." \
  --first-frame frame.png \
  --resolution 9:16 \
  --output clip.mp4
```

环境变量：`JIMENG_ACCESS_KEY` / `JIMENG_SECRET_KEY`（从 `.env` 读取）。

### 视频生成的首帧优先原则

**优先使用 image2video**（首帧驱动）而非 text2video：

- 首帧控制力强 → 风格一致
- 首帧用 `openrouter_generate.py` 先生精，再驱动视频
- text2video 只在首帧约束不重要时使用

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
python3 scripts/check_providers.py --format table
```

会输出 OpenRouter、Dreamina、Jimeng、Lyria 的可用状态与剩余积分（如有），并给出每个能力的推荐通道。

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
for i in {1..8}; do
  python3 scripts/openrouter_generate.py \
    --prompt "..." --aspect-ratio 9:16 --image-size 2K \
    --seed $i --output candidate_$i.png
done
# 然后对 8 张做 rubric 评分，留最高分
```

## 降级策略

工具不可用 / 配额耗尽时的优雅降级路径在 `capabilities/fallback-strategy.md`。核心原则：

1. **质量优先**：宁可告知用户不可行，不可静默降质
2. **最小让步**：逐级尝试（Dreamina → Jimeng → 高质量静帧 + 轻动效）
3. **透明决策**：任何降级必须告知用户并获得确认
4. **首帧驱动**：视频优先 image2video 保留首帧控制力

## 平台技术规格（非创作建议）

**本节只讲技术约束，不讲创作**。创作由 `taste/` 决定。

完整的宽高比 / 编码 / 码率 / 安全区 / 时长表统一查 `../assembly/references/platform-specs.md`——这是 frontend `PlatformPresetSection.tsx` 的同源真值表。

assets 模块只关心两个工具维度：

| 维度 | 取值范围 |
|---|---|
| 视频宽高比 | `9:16` / `3:4` / `1:1` / `16:9`（决定 dreamina/jimeng 参数） |
| 图片宽高比 | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `2:3` / `3:2`（OpenRouter 支持值） |

## Capabilities 索引

- `capabilities/prompt-mastery.md` — 图像 prompt 写法
- `capabilities/dreamina-mastery.md` — Dreamina CLI 深度用法
- `capabilities/music-generation.md` — 音乐 prompt 与参数
- `capabilities/poster-design.md` — 图文排版模板选择与自定义
- `capabilities/frame-gacha.md` — 多候选批量抽签机制
- `capabilities/quality-gate.md` — 质量门槛与自检流程
- `capabilities/fallback-strategy.md` — 工具不可用时的降级路径

## 自检

素材交付前：

- [ ] 所有视觉决策能回溯到 `taste/02 / 04 / 05` 的具体条目
- [ ] 单样已做 rubric 评分 ≥ 3.5，批量已抽检
- [ ] 关键镜头的候选已 gacha 多张，选了最优
- [ ] 任何降级已告知用户并获得确认
- [ ] 交付格式（尺寸、编码、命名）对下游 `assembly/` 友好
