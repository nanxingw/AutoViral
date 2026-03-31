# 专业字幕能力设计

> **Goal:** 为 content-assembly skill 新增逐词高亮（karaoke）字幕能力，支持自动语音识别和外部时间戳两种模式，内置多种平台预设样式。

## 背景

当前 `subtitle-aesthetics.md` 模块覆盖了基础 ffmpeg drawtext 和 ASS 字幕，但缺少现代短视频的核心字幕风格——**逐词高亮**。70% 的头部创作者使用这种风格，它已成为抖音/TikTok 的标配。

技术关键：需要**词级别时间戳**（每个词的起止时间），然后用 ASS `\kf` karaoke 标签渲染逐词变色效果。

## 决策记录

| 决策 | 选项 | 理由 |
|------|------|------|
| 渲染方案 | stable-ts + ASS karaoke + ffmpeg | 依赖少、速度快、质量高，覆盖 90% 需求 |
| STT 引擎 | stable-ts（Whisper 增强版） | 直接输出词级时间戳 + ASS karaoke，一步到位 |
| 双模式 | auto（自动 STT）+ timestamps（外部传入） | 灵活适配：即梦视频用 auto，规划文案用 timestamps |
| 字体 | 通过 font_manager.py 管理 | 统一字体管理，自动下载，与图文排版共享 |
| 烧录 | 脚本只生成 ASS，agent 自己 ffmpeg 烧录 | 职责单一，agent 可灵活控制后续流程 |

## 新增/修改文件

### 1. `skills/asset-generation/scripts/font_manager.py`（新建，共享组件）

字体管理器，供字幕和图文排版共同使用。

**功能：**
- `get_font_path(font_id, weight="regular")` → 返回字体文件绝对路径
- 首次调用时自动从 GitHub 下载字体到 `~/.autoviral/fonts/`
- CLI 模式：`python3 font_manager.py --font source-han-sans --weight bold`
- 列表模式：`python3 font_manager.py --list`

**字体清单：**

| ID | 字体名 | 可用 weight | 来源 |
|----|--------|------------|------|
| `source-han-sans` | 思源黑体 | Regular, Bold, Heavy, Light | Google Fonts noto-cjk |
| `source-han-serif` | 思源宋体 | Regular, Bold, Light | Google Fonts noto-cjk |
| `lxgw-wenkai` | 霞鹜文楷 | Regular, Bold, Light | GitHub lxgw/LxgwWenKai |
| `smiley-sans` | 得意黑 | Regular | GitHub atelier-anchor |
| `montserrat` | Montserrat | Regular, Bold | Google Fonts |
| `inter` | Inter | Regular, Bold | Google Fonts |

**输出格式（stdout JSON）：**
```json
{"path": "/Users/xxx/.autoviral/fonts/SourceHanSansSC-Regular.otf", "family": "Source Han Sans SC"}
```

**错误处理：**
```json
{"success": false, "error": "下载失败: 网络超时"}
```

### 2. `skills/content-assembly/scripts/caption_generate.py`（新建）

逐词高亮字幕生成脚本。

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--input` | str | 视频/音频路径（auto 模式必填） | — |
| `--timestamps` | str | 时间戳 JSON 路径（手动模式） | — |
| `--output` | str (必填) | 输出 ASS 文件路径 | — |
| `--style` | str | 预设样式名 | `douyin-highlight` |
| `--language` | str | 语言代码（auto 模式） | `zh` |
| `--model` | str | Whisper 模型（auto 模式） | `medium` |
| `--font` | str | 字体 ID（font_manager） | `source-han-sans` |
| `--font-size` | int | 基础字号 | `52` |
| `--highlight-color` | str | 高亮颜色（hex） | `#FFFF00` |
| `--base-color` | str | 基础颜色（hex） | `#FFFFFF` |
| `--stroke-width` | int | 描边宽度 | `3` |
| `--position` | str | `center`/`top`/`bottom` | `center` |
| `--max-words` | int | 每行最大词数 | `8` |
| `--lead-time` | int | 字幕提前出现毫秒数 | `80` |

**模式 1 — 自动识别（`--input`）：**
```bash
python3 caption_generate.py \
  --input video.mp4 \
  --output subtitles.ass \
  --style douyin-highlight \
  --language zh
```
流程：ffmpeg 提取音频 → stable-ts 词级时间戳 → 生成 ASS karaoke

**模式 2 — 外部时间戳（`--timestamps`）：**
```bash
python3 caption_generate.py \
  --timestamps captions.json \
  --output subtitles.ass \
  --style xhs-soft
```

时间戳 JSON 格式：
```json
{
  "segments": [
    {
      "text": "今天分享三个穿搭技巧",
      "words": [
        {"word": "今天", "start": 0.5, "end": 0.9},
        {"word": "分享", "start": 0.9, "end": 1.3},
        {"word": "三个", "start": 1.3, "end": 1.7},
        {"word": "穿搭", "start": 1.7, "end": 2.1},
        {"word": "技巧", "start": 2.1, "end": 2.5}
      ]
    }
  ]
}
```

**内置预设样式：**

| 样式 ID | 效果 | 字体 | 颜色 |
|---------|------|------|------|
| `douyin-highlight` | 白底黄色逐词高亮，黑描边 | 思源黑体 Bold | 白→黄 |
| `douyin-bold` | 大号粗体，无高亮，纯白 | 思源黑体 Heavy | 纯白 |
| `xhs-soft` | 柔和细体，浅描边，淡入淡出 | 霞鹜文楷 | 白色+浅灰描边 |
| `funny` | 大号彩色，弹跳缩放动画 | 得意黑 | 黄/红交替 |
| `minimal` | 小号无描边，半透明阴影 | Inter + 思源黑体 | 白色+阴影 |

**核心逻辑：**

```python
def generate_captions(input_path=None, timestamps_path=None, output_path=None,
                      style="douyin-highlight", language="zh", model="medium", **kwargs):
    # 1. 获取词级时间戳
    if input_path:
        # auto 模式：stable-ts 识别
        import stable_whisper
        model = stable_whisper.load_model(model)
        result = model.transcribe(audio_path, language=language)
        word_segments = extract_word_segments(result)
    else:
        # timestamps 模式：读取 JSON
        word_segments = parse_timestamps_json(timestamps_path)

    # 2. 分行（每行不超过 max_words 个词）
    lines = group_words_into_lines(word_segments, max_words)

    # 3. 应用 lead_time（字幕提前出现）
    lines = apply_lead_time(lines, lead_time_ms)

    # 4. 加载预设样式
    style_config = load_style(style, font, font_size, highlight_color, ...)

    # 5. 生成 ASS 文件
    #    - 头部：PlayResX/Y、Style 定义（字体通过 font_manager 获取路径）
    #    - 每行一个 Dialogue，用 \kf 标签标注每个词的持续时间
    ass_content = build_ass(lines, style_config)

    # 6. 写入文件
    write_file(output_path, ass_content)
```

**ASS karaoke 输出示例：**
```ass
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Style: Default,Source Han Sans SC,52,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,2,2,20,20,960

[Events]
Dialogue: 0,0:00:00.42,0:00:02.50,Default,,0,0,0,,{\kf40}今天 {\kf40}分享 {\kf40}三个 {\kf40}穿搭 {\kf40}技巧
```

**输出格式（stdout JSON）：**
```json
{
  "success": true,
  "output": "/absolute/path/to/subtitles.ass",
  "segments": 12,
  "words": 87,
  "duration_sec": 45.2,
  "style": "douyin-highlight",
  "mode": "auto",
  "model": "medium"
}
```

### 3. `skills/content-assembly/modules/pro-captions.md`（新建）

Agent 阅读的专业字幕方法论指南。

**内容结构：**

1. **何时需要字幕**
   - 即梦视频有语音但无字幕 → 必须加（用 auto 模式）
   - 纯 BGM 视频 → 不需要语音字幕
   - Agent 规划的文案旁白 → 用 timestamps 模式

2. **样式选择决策树**
   - 口播/教程 → `douyin-highlight`
   - 搞笑/吐槽 → `funny`
   - 文艺/情感 → `xhs-soft`
   - 极简/高级 → `minimal`
   - 纯粗体无高亮 → `douyin-bold`

3. **auto vs timestamps 模式选择**
   - 有视频/音频文件 → auto
   - Agent 自己规划的文案 + 时间节点 → timestamps

4. **字幕与画面的关系**
   - 不遮挡人物面部和关键主体
   - 抖音底部 20% 被 UI 遮挡，用 `--position center`
   - 小红书偏上方或居中

5. **与 beat-sync / BGM 的配合**
   - 字幕换行节奏可配合 BGM 节拍点

6. **烧录命令参考**
   ```bash
   ffmpeg -i input.mp4 -vf "ass=subtitles.ass" -c:v libx264 -crf 18 -c:a copy output.mp4
   ```

### 4. `skills/content-assembly/SKILL.md` 更新

在"合成脚本"章节新增 `caption_generate.py` 的用法文档和示例命令。

在 modules 表格中新增 `pro-captions` 模块。

## 不改动的部分

- **subtitle-aesthetics.md** — 保留，它覆盖基础 drawtext 和手动 ASS，pro-captions 是进阶补充
- **check_providers.py** — 不需要改，stable-ts 是本地运行
- **前端** — 无 UI 改动
- **evaluator** — 现有评审标准不涉及字幕质量

## 依赖

| 依赖 | 用途 | 安装 |
|------|------|------|
| `stable-ts` | Whisper 增强，词级时间戳 | `pip install stable-ts` |
| `torch` | stable-ts 底层依赖 | 随 stable-ts 安装 |
| `ffmpeg` | 提取音频、烧录字幕 | 系统已有 |

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `skills/asset-generation/scripts/font_manager.py` |
| 新建 | `skills/content-assembly/scripts/caption_generate.py` |
| 新建 | `skills/content-assembly/modules/pro-captions.md` |
| 修改 | `skills/content-assembly/SKILL.md` |
