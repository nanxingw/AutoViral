# 专业字幕模块（Pro Captions）

逐词高亮（karaoke）字幕是当前抖音/TikTok 短视频的标配风格——70% 的头部创作者都在使用。本模块说明何时加字幕、如何选样式、以及 `caption_generate.py` 脚本的完整用法。

---

## 一、何时需要字幕

| 场景 | 是否加字幕 | 模式选择 |
|------|-----------|---------|
| 即梦视频有人物说话但无字幕 | **必须加** | `--input`（auto 模式，自动语音识别） |
| Agent 规划的文案旁白，已有文本和时间节点 | **必须加** | `--timestamps`（手动模式，读取 JSON） |
| 纯 BGM 无人声的画面 | **不加** | — |
| 纯音乐配画面，无需文字解说 | **不加** | — |
| 画面已有烧录文字（如截图、字幕条） | **不加**，避免重叠 | — |

**判断原则：** 只要视频中有语音（人声/旁白/解说），就必须加字幕。没有语音就不加。

---

## 二、样式选择决策树

根据内容调性选择预设样式：

```
内容调性是什么？
├── 口播 / 教程 / 知识分享
│   └── douyin-highlight（白底黄色高亮，最通用）
├── 搞笑 / 吐槽 / 抽象
│   └── funny（彩色弹跳，夸张效果）
├── 文艺 / 情感 / 生活方式
│   └── xhs-soft（霞鹜文楷，柔和淡入淡出）
├── 极简 / 高级感 / 品牌
│   └── minimal（小号无描边，半透明阴影）
└── 纯粗体 / 不需要高亮变色
    └── douyin-bold（超大粗体白字，无 karaoke）
```

### 预设样式详情

| 样式 ID | 字体 | 字号 | 效果 | 适用场景 |
|---------|------|------|------|---------|
| `douyin-highlight` | 思源黑体 Bold | 52px | 白→黄逐词高亮，黑描边3px | 口播、教程、通用（**默认**） |
| `douyin-bold` | 思源黑体 Heavy | 64px | 纯白大粗体，无高亮，黑描边4px | 强调感、震撼感 |
| `xhs-soft` | 霞鹜文楷 | 48px | 白色，浅灰描边2px，淡入淡出 | 文艺、情感、小红书风格 |
| `funny` | 得意黑 | 60px | 黄/红交替，弹跳缩放动画 | 搞笑、吐槽、抽象 |
| `minimal` | Inter + 思源黑体 | 44px | 白色无描边，半透明阴影 | 极简、高级、品牌内容 |

---

## 三、auto vs timestamps 模式选择

### auto 模式（`--input`）

适用于已有视频/音频文件，需要自动识别语音内容的场景。

**工作流程：**
1. ffmpeg 从视频提取 16kHz 单声道 WAV
2. stable-ts（Whisper 增强版）识别词级时间戳
3. 生成 ASS karaoke 字幕文件

**优点：** 全自动，无需手动标注
**缺点：** 需要 stable-ts 依赖（含 torch），首次加载模型较慢

```bash
python3 skills/content-assembly/scripts/caption_generate.py \
  --input video.mp4 \
  --output subtitles.ass \
  --style douyin-highlight \
  --language zh
```

### timestamps 模式（`--timestamps`）

适用于 Agent 自行规划文案并标注时间点的场景。

**时间戳 JSON 格式：**
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

```bash
python3 skills/content-assembly/scripts/caption_generate.py \
  --timestamps captions.json \
  --output subtitles.ass \
  --style xhs-soft
```

---

## 四、字幕与画面的关系

### 位置安全区

不同平台有不同的 UI 遮挡区域，字幕必须避开：

| 平台 | 危险区域 | 推荐 `--position` |
|------|---------|------------------|
| 抖音 | 底部 ~20% 被点赞/评论按钮遮挡 | `center`（默认，MarginV=960） |
| 小红书视频 | 底部有交互栏 | `center` 或 `top` |
| 小红书图文视频 | 偏上方更美观 | `top`（MarginV=400） |

### 避免遮挡原则

- **不遮挡人物面部和关键主体**：如果画面主体在中央，考虑将字幕移到 `top` 或 `bottom`
- **不遮挡关键信息**：如果画面中有文字、产品展示等重要元素，字幕位置需要错开
- **字幕行数控制**：`--max-words 8` 默认每行最多 8 个词，避免字幕太长遮挡过多画面

---

## 五、与 beat-sync / BGM 的配合

当视频同时有字幕和 BGM 时：

1. **先生成字幕 ASS 文件**，再烧录到视频
2. **再叠加 BGM**（在字幕烧录后的视频上混入音乐）
3. 字幕换行节奏可配合 BGM 节拍点——`--max-words` 较小时换行更频繁，适合快节奏；较大时一行显示更多内容，适合慢节奏

**推荐处理顺序：**
```
原始视频 → 烧录字幕 → 混入 BGM → 最终输出
```

---

## 六、烧录命令参考

`caption_generate.py` 只生成 ASS 文件，不直接修改视频。烧录字幕需要用 ffmpeg：

```bash
# 标准烧录（推荐）
ffmpeg -i input.mp4 -vf "ass=subtitles.ass" -c:v libx264 -crf 18 -c:a copy output.mp4
```

**参数说明：**
- `-vf "ass=subtitles.ass"`：使用 ASS 字幕滤镜
- `-c:v libx264 -crf 18`：视频重新编码（CRF 18 高画质）
- `-c:a copy`：音频直接复制，不重新编码

**注意：** 烧录字幕后必须验证音频流未丢失：
```bash
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 output.mp4 | grep audio
```

---

## 七、完整调用示例

### 场景 1：口播教程视频（最常见）

```bash
# 1. 自动识别语音并生成字幕
python3 skills/content-assembly/scripts/caption_generate.py \
  --input tutorial.mp4 \
  --output tutorial-subs.ass \
  --style douyin-highlight \
  --language zh \
  --model medium

# 2. 烧录到视频
ffmpeg -i tutorial.mp4 -vf "ass=tutorial-subs.ass" \
  -c:v libx264 -crf 18 -c:a copy -y tutorial-captioned.mp4
```

### 场景 2：小红书文艺风短视频

```bash
python3 skills/content-assembly/scripts/caption_generate.py \
  --input lifestyle.mp4 \
  --output lifestyle-subs.ass \
  --style xhs-soft \
  --position top \
  --language zh

ffmpeg -i lifestyle.mp4 -vf "ass=lifestyle-subs.ass" \
  -c:v libx264 -crf 18 -c:a copy -y lifestyle-captioned.mp4
```

### 场景 3：搞笑/抽象内容

```bash
python3 skills/content-assembly/scripts/caption_generate.py \
  --input funny-clip.mp4 \
  --output funny-subs.ass \
  --style funny \
  --language zh \
  --max-words 5

ffmpeg -i funny-clip.mp4 -vf "ass=funny-subs.ass" \
  -c:v libx264 -crf 18 -c:a copy -y funny-captioned.mp4
```

### 场景 4：Agent 规划文案（timestamps 模式）

```bash
# 先构造时间戳 JSON
cat > captions.json << 'EOF'
{
  "segments": [
    {
      "text": "春天来了万物复苏",
      "words": [
        {"word": "春天", "start": 0.5, "end": 1.0},
        {"word": "来了", "start": 1.0, "end": 1.4},
        {"word": "万物", "start": 1.5, "end": 2.0},
        {"word": "复苏", "start": 2.0, "end": 2.5}
      ]
    },
    {
      "text": "今天教你三个穿搭技巧",
      "words": [
        {"word": "今天", "start": 3.0, "end": 3.4},
        {"word": "教你", "start": 3.4, "end": 3.8},
        {"word": "三个", "start": 3.8, "end": 4.2},
        {"word": "穿搭", "start": 4.2, "end": 4.6},
        {"word": "技巧", "start": 4.6, "end": 5.0}
      ]
    }
  ]
}
EOF

python3 skills/content-assembly/scripts/caption_generate.py \
  --timestamps captions.json \
  --output planned-subs.ass \
  --style douyin-highlight

ffmpeg -i video.mp4 -vf "ass=planned-subs.ass" \
  -c:v libx264 -crf 18 -c:a copy -y captioned.mp4
```

### 场景 5：自定义颜色和字号

```bash
python3 skills/content-assembly/scripts/caption_generate.py \
  --input video.mp4 \
  --output custom-subs.ass \
  --style douyin-highlight \
  --highlight-color "#FF6699" \
  --base-color "#FFFFFF" \
  --font-size 56 \
  --stroke-width 4 \
  --language zh
```

### 场景 6：英文内容

```bash
python3 skills/content-assembly/scripts/caption_generate.py \
  --input english-video.mp4 \
  --output en-subs.ass \
  --style minimal \
  --language en \
  --model medium
```

---

## 八、脚本参数速查

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--input` | str | 视频/音频路径（auto 模式，与 --timestamps 互斥） | — |
| `--timestamps` | str | 时间戳 JSON 路径（手动模式，与 --input 互斥） | — |
| `--output` | str（必填） | 输出 ASS 文件路径 | — |
| `--style` | str | 预设样式名 | `douyin-highlight` |
| `--language` | str | 语言代码（auto 模式） | `zh` |
| `--model` | str | Whisper 模型名（auto 模式） | `medium` |
| `--font` | str | 字体 ID，覆盖预设 | 由样式决定 |
| `--font-size` | int | 字号，覆盖预设 | 由样式决定 |
| `--highlight-color` | str | 高亮颜色 hex，如 `#FFFF00` | 由样式决定 |
| `--base-color` | str | 基础颜色 hex，如 `#FFFFFF` | 由样式决定 |
| `--stroke-width` | int | 描边宽度，覆盖预设 | 由样式决定 |
| `--position` | str | `center` / `top` / `bottom` | 由样式决定 |
| `--max-words` | int | 每行最大词数 | `8` |
| `--lead-time` | int | 字幕提前出现毫秒数 | `80` |

### 输出格式（stdout JSON）

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

### 依赖

| 依赖 | 安装命令 | 说明 |
|------|---------|------|
| `stable-ts` | `pip install stable-ts` | auto 模式必须，Whisper 增强版 |
| `ffmpeg` | 系统已有 | 提取音频 + 烧录字幕 |
| `font_manager.py` | 无需安装 | 自动下载管理字体 |
