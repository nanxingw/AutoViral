# Lyria 音乐生成能力扩展设计

> **Goal:** 为 asset-generation skill 新增 Google Lyria 音乐生成能力，支持文生音乐和图生音乐，让 agent 在 assets 阶段自动生成 BGM。

## 背景

Google Lyria 3 已在 OpenRouter 上线（2026-03-30）。使用 `google/lyria-3-pro-preview` 模型，$0.08/首，生成 ~2 分钟完整音乐，支持风格/乐器/BPM 控制、图片输入生成匹配氛围的音乐。

API 走 OpenRouter `/api/v1/chat/completions`，`modalities: ["text", "audio"]`，返回 base64 MP3。

## 决策记录

| 决策 | 选项 | 理由 |
|------|------|------|
| 模型 | 仅 `google/lyria-3-pro-preview` | 最佳效果，不考虑成本 |
| 触发时机 | assets 阶段生成，assembly 阶段使用 | 与图片素材生产-使用模式一致 |
| 图生音乐 | 支持 `--ref-image` | 零成本，视觉-听觉自动匹配 |
| 默认行为 | 纯器乐，`--vocal` 可选开启人声 | 90% 场景需要纯器乐 BGM |

## 新增文件

### 1. `scripts/music_generate.py`

遵循 `openrouter_generate.py` 的结构模式。

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--prompt` | str (必填) | 音乐描述 | — |
| `--output` | str (必填) | 输出文件路径 | — |
| `--ref-image` | str (可多次) | 参考图路径/URL（图生音乐） | 无 |
| `--vocal` | flag | 启用人声（默认纯器乐） | False |
| `--seed` | int | 随机种子 | 无 |
| `--temperature` | float | 创意度 (0.0-2.0) | 无 |

**核心逻辑：**

```python
def generate_music(api_key, prompt, output_path, ref_images=None, vocal=False, seed=None, temperature=None):
    # 1. 构建 content_parts（可含参考图）
    content_parts = []
    if ref_images:
        for img in ref_images:
            # base64 编码图片或直接传 URL
            content_parts.append({"type": "image_url", "image_url": {"url": ...}})

    # 2. 默认注入纯器乐指令
    music_prompt = prompt
    if not vocal:
        music_prompt = "Instrumental only, no vocals. " + prompt

    content_parts.append({"type": "text", "text": music_prompt})

    # 3. 调用 OpenRouter API
    payload = {
        "model": "google/lyria-3-pro-preview",
        "modalities": ["text", "audio"],
        "messages": [{"role": "user", "content": content_parts}],
    }
    if seed: payload["seed"] = seed
    if temperature: payload["temperature"] = temperature

    # 4. 解析响应 — 遍历所有 parts 提取音频和歌词
    # 音频可能在 message.images[].image_url.url (data:audio/mp3;base64,...)
    # 或 message.content[].inline_data.data
    # 歌词在 text parts 中

    # 5. 保存 MP3 到 output_path
```

**输出格式（stdout JSON）：**

```json
{
  "success": true,
  "output": "/absolute/path/to/bgm.mp3",
  "duration_sec": 120,
  "model": "google/lyria-3-pro-preview",
  "has_vocals": false,
  "size_kb": 2400.5,
  "lyrics": null
}
```

**错误处理：**

```json
{
  "success": false,
  "error": "API 错误 429: Rate limited"
}
```

### 2. `modules/music-generation.md`

Agent 阅读的音乐生成方法论指南。

**内容结构：**

1. **何时生成 BGM**
   - 短视频：必须生成（方案中标注了 BGM 需求的镜头）
   - 图文：可选（用于轮播展示视频或背景氛围）

2. **Prompt 工程**
   - 风格关键词库（按情绪分类，与 emotional-hooks.md 呼应）
     - 焦虑/紧迫：tense strings, minor key, 120+ BPM, suspenseful
     - 愤怒/冲突：heavy drums, distorted guitar, aggressive, powerful
     - 搞笑/抽象：quirky, playful, ukulele, comedic timing, bouncy
     - 羡慕/向往：dreamy, soft piano, warm strings, ethereal, inspiring
   - BPM 指定：`tempo 90 BPM` / `slow tempo` / `upbeat`
   - 调性指定：`in C major` / `in A minor`
   - 乐器指定：`acoustic guitar, soft piano, light percussion`
   - Section 标签：`[Intro] soft piano → [Verse] add guitar → [Chorus] full band`

3. **图生音乐用法**
   - 传入封面图或关键帧 → Lyria 自动分析视觉氛围生成匹配音乐
   - 适合：不确定该用什么风格时，让图片决定音乐风格
   - 命令：`--ref-image cover.png --prompt "background music for this scene"`

4. **平台适配**
   - 抖音：节奏感强，hook 在前 3 秒，BPM 100-130 适合卡点
   - 小红书：氛围感优先，轻柔舒缓，acoustic/lo-fi 风格

5. **与 assembly 衔接**
   - 生成的 BGM 存到 `assets/music/bgm.mp3`
   - assembly 阶段 ffmpeg 混音：`-filter_complex "[1:a]volume=0.2[bg];[0:a][bg]amix=inputs=2"`
   - 如需节拍同步剪辑，配合 `modules/beat-sync.md` 使用

### 3. SKILL.md 更新

在"生成脚本"章节新增：

```markdown
#### 4. `music_generate.py` — Lyria 音乐生成（BGM/配乐）
需要 `OPENROUTER_API_KEY`。默认模型 `google/lyria-3-pro-preview`。

| 参数 | 说明 | 示例值 |
|------|------|--------|
| `--prompt` | 音乐描述（必填） | `"cheerful acoustic folk, 100 BPM"` |
| `--output` | 输出文件路径（必填） | `bgm.mp3` |
| `--ref-image` | 参考图（可多次，图生音乐） | `cover.png` |
| `--vocal` | 启用人声（默认纯器乐） | — |
| `--seed` | 随机种子 | `42` |
| `--temperature` | 创意度 | `0.8` |

示例：
​```bash
# 纯器乐 BGM（默认）
python3 ~/.claude/skills/asset-generation/scripts/music_generate.py \
  --prompt "soft acoustic guitar, warm and cozy, lo-fi vibes, 85 BPM" \
  --output {workDir}/assets/music/bgm.mp3

# 图生音乐：用封面图引导风格
python3 ~/.claude/skills/asset-generation/scripts/music_generate.py \
  --prompt "background music matching this image mood" \
  --ref-image {workDir}/assets/images/cover.png \
  --output {workDir}/assets/music/bgm.mp3

# 带人声
python3 ~/.claude/skills/asset-generation/scripts/music_generate.py \
  --prompt "catchy pop song about spring fashion, female vocal, 110 BPM" \
  --vocal --output {workDir}/assets/music/bgm-vocal.mp3
​```
```

在"工作流程：短视频"章节的分步流程末尾追加 BGM 生成步骤。

在"文件命名规范"中追加：

```
assets/music/
  bgm.mp3         （主 BGM）
  bgm-alt.mp3     （备选）
```

### 4. `check_providers.py` 更新

在 providers 列表中追加 Lyria 检测（复用 `OPENROUTER_API_KEY`）：

```python
providers.append({
    "name": "lyria",
    "display_name": "Google Lyria 3 Pro (Music)",
    "available": openrouter_ready,  # 复用 OpenRouter key
    "supports_image": False,
    "supports_video": False,
    "supports_music": True,
    "missing_keys": ["OPENROUTER_API_KEY"] if not openrouter_key else [],
    "script": "music_generate.py",
    "note": "AI 音乐生成，支持文生音乐/图生音乐，~2分钟完整曲目",
})
```

在 capabilities 中新增 `music_generation`。

## 不改动的部分

- **服务端 API** — 不新增 `/api/generate/music` 端点，音乐生成直接走脚本
- **content-assembly skill** — 已有 `music-search.md` 和 `beat-sync.md`，不需要改动
- **evaluator** — 现有评审标准不涉及音乐质量
- **前端** — 无 UI 改动

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `skills/asset-generation/scripts/music_generate.py` |
| 新建 | `skills/asset-generation/modules/music-generation.md` |
| 修改 | `skills/asset-generation/SKILL.md` |
| 修改 | `skills/asset-generation/scripts/check_providers.py` |
