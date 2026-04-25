# 字幕美学模块

当需要制作专业级字幕样式、花字效果、动画字幕或自动语音转字幕时，加载此模块。涵盖各平台字幕规范、推荐中文字体、ASS 高级样式以及 Whisper 自动字幕流水线。

---

## 一、字幕美学规范

### 1.1 抖音字幕规范

抖音字幕需要在竖屏（1080×1920）中清晰可读，同时避开平台 UI 元素：

| 属性 | 推荐值 | 说明 |
|------|--------|------|
| 位置 | 居中底部 82%（`y=h*0.82`） | 避开底部点赞/评论按钮区域 |
| 单行字数 | 15-20 个中文字符 | 超出则换行或缩小字号 |
| 字体颜色 | 白色 `#FFFFFF` | 最强可读性 |
| 描边 | 黑色描边 2-4px | `borderw=3:bordercolor=black` |
| 字号 | 40-60px | 竖屏 1080p 标准 |
| 字体 | 苹方/思源黑体 | 简洁易读 |

```bash
# 标准抖音字幕
ffmpeg -i input.mp4 \
  -vf "drawtext=text='这是一条标准字幕':fontsize=52:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82:fontfile=/System/Library/Fonts/PingFang.ttc" \
  -c:v libx264 -crf 23 -c:a copy -y output.mp4
```

### 1.2 小红书文字叠加

小红书内容偏视觉设计感，文字叠加需要层次分明：

| 元素 | 推荐参数 | 说明 |
|------|---------|------|
| 大标题 | 72px，加粗，居中 | 吸引注意力 |
| 关键词高亮 | 黄色/粉色，比正文大 10-20% | 突出重点信息 |
| 底部小字 | 32-36px，浅灰色 | 补充信息/来源/价格 |

```bash
# 小红书风格：大标题 + 底部小字
ffmpeg -i input.png \
  -vf "drawtext=text='必买好物推荐':fontsize=72:fontcolor=white:borderw=4:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.35:fontfile=/System/Library/Fonts/PingFang.ttc,\
       drawtext=text='第3个真的绝了':fontsize=48:fontcolor=#FFD700:borderw=3:bordercolor=black@0.5:x=(w-text_w)/2:y=h*0.45:fontfile=/System/Library/Fonts/PingFang.ttc,\
       drawtext=text='图片来源：小红书':fontsize=32:fontcolor=#CCCCCC:x=(w-text_w)/2:y=h*0.92:fontfile=/System/Library/Fonts/PingFang.ttc" \
  -y output.png
```

### 1.3 花字要素

花字是短视频中增强表现力的重要手段，由多个视觉层叠加而成：

| 要素 | 实现方式 | 效果 |
|------|---------|------|
| 文字颜色+纹理 | `fontcolor` + 渐变底图叠加 | 基础视觉 |
| 多层描边+阴影 | `borderw` + `shadowx/shadowy` | 立体感 |
| 背景色块 | `drawbox` + `drawtext` 组合 | 标签/弹幕效果 |
| 发光效果 | 多层不同透明度描边叠加 | 霓虹感 |
| 入场/出场动画 | ASS `\fad` / `\move` / `\t` | 动态效果 |

```bash
# 多层描边立体花字效果
ffmpeg -i input.mp4 \
  -vf "drawtext=text='超级好吃':fontsize=64:fontcolor=#FF6B6B:borderw=6:bordercolor=white:shadowx=3:shadowy=3:shadowcolor=black@0.5:x=(w-text_w)/2:y=h*0.4:fontfile=/System/Library/Fonts/PingFang.ttc:enable='between(t,1,4)'" \
  -c:v libx264 -crf 23 -c:a copy -y output.mp4

# 带背景色块的标签字幕
ffmpeg -i input.mp4 \
  -vf "drawbox=x=(w-400)/2:y=h*0.78:w=400:h=60:color=black@0.6:t=fill:enable='between(t,0,3)',\
       drawtext=text='点击关注':fontsize=44:fontcolor=white:x=(w-text_w)/2:y=h*0.8:fontfile=/System/Library/Fonts/PingFang.ttc:enable='between(t,0,3)'" \
  -c:v libx264 -crf 23 -c:a copy -y output.mp4
```

---

## 二、推荐中文字体

### 2.1 macOS 内置字体

| 字体 | 路径 | 风格 | 适用场景 |
|------|------|------|---------|
| 苹方 | `/System/Library/Fonts/PingFang.ttc` | 简洁现代 | 通用，首选 |
| 黑体 | `/System/Library/Fonts/STHeiti Medium.ttc` | 粗体有力 | 标题、强调 |
| 冬青黑体 | `/System/Library/Fonts/Hiragino Sans GB.ttc` | 清晰中性 | 正文字幕 |

### 2.2 免费商用字体（需下载）

| 字体 | 来源 | 风格 | 授权 |
|------|------|------|------|
| 思源黑体 (Noto Sans CJK SC) | https://github.com/googlefonts/noto-cjk | 中性通用 | SIL OFL，免费商用 |
| 思源宋体 (Noto Serif CJK SC) | https://github.com/googlefonts/noto-cjk | 优雅文艺 | SIL OFL，免费商用 |
| 霞鹜文楷 (LXGW WenKai) | https://github.com/lxgw/LxgwWenKai | 手写楷书感 | SIL OFL，免费商用 |
| 得意黑 (Smiley Sans) | https://github.com/atelier-anchor/smiley-sans | 潮流个性 | SIL OFL，免费商用 |

```bash
# 下载思源黑体示例
curl -L -o NotoSansCJKsc-Regular.otf "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"

# 使用下载的字体
ffmpeg -i input.mp4 \
  -vf "drawtext=text='使用思源黑体':fontsize=52:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82:fontfile=NotoSansCJKsc-Regular.otf" \
  -c:v libx264 -crf 23 -c:a copy -y output.mp4
```

> **重要：** 商用内容（带货、广告）务必使用有明确免费商用授权的字体，避免版权风险。

---

## 三、ASS 字幕高级样式

ASS（Advanced SubStation Alpha）格式支持丰富的字幕效果，远超 drawtext 的能力。

### 3.1 多样式定义

```bash
cat > styles.ass << 'ASSEOF'
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV
Style: Title,PingFang SC,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,4,2,5,20,20,200
Style: Default,PingFang SC,52,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,3,0,2,20,20,340
Style: Highlight,PingFang SC,60,&H0000FFFF,&H000000FF,&H00000000,&H00000000,1,4,0,2,20,20,340
Style: Note,PingFang SC,36,&H80FFFFFF,&H000000FF,&H00333333,&H00000000,1,2,0,2,20,20,100

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:00.00,0:00:03.00,Title,,0,0,0,,这是标题文字
Dialogue: 0,0:00:03.00,0:00:08.00,Default,,0,0,0,,这是正文字幕
Dialogue: 0,0:00:05.00,0:00:08.00,Highlight,,0,0,0,,重点内容高亮
Dialogue: 0,0:00:00.00,0:00:03.00,Note,,0,0,0,,左下角注释文字
ASSEOF

ffmpeg -i input.mp4 -vf "ass=styles.ass" -c:v libx264 -crf 23 -c:a copy -y output.mp4
```

### 3.2 ASS 动画效果

ASS 支持多种内联动画标签，写在 `Dialogue` 的 `Text` 字段中：

**淡入淡出：**
```
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\fad(300,200)}这段文字淡入300ms，淡出200ms
```

**移动动画：**
```
# 从屏幕右侧滑入到居中位置
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\move(1200,960,540,960)}从右滑入的文字

# 从下方上升到指定位置
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\move(540,2000,540,1600)}从底部升起的文字
```

**渐变变换（\t 标签）：**
```
# 字号从 40 渐变到 72
Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,{\fs40\t(\fs72)}逐渐放大的文字

# 颜色从白色渐变到绿色
Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,{\c&HFFFFFF&\t(\c&H00FF00&)}颜色渐变文字

# 透明度渐变（从完全透明到不透明）
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\alpha&HFF&\t(\alpha&H00&)}渐显文字

# 组合动画：同时变大+变色
Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,{\fs40\c&HFFFFFF&\t(\fs72\c&H00FFFF&)}放大并变色
```

**旋转动画：**
```
# 绕 Z 轴旋转
Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,{\frz0\t(\frz360)}旋转一圈的文字
```

### 3.3 ASS 颜色格式说明

ASS 使用 `&HAABBGGRR` 格式（注意是 BGR 不是 RGB）：

| 颜色 | ASS 代码 | 说明 |
|------|---------|------|
| 白色 | `&H00FFFFFF` | 最常用 |
| 黄色 | `&H0000FFFF` | 高亮/强调 |
| 红色 | `&H000000FF` | 警告/重点 |
| 绿色 | `&H0000FF00` | 正面/确认 |
| 粉色 | `&H008080FF` | 少女/美妆 |
| 天蓝 | `&H00FFCC00` | 清新/科技 |

---

## 四、Whisper 自动字幕流水线

当视频有人声需要自动生成字幕时，使用 OpenAI Whisper 进行语音识别。

### 4.1 完整流水线

```
视频 → ffmpeg 提取音频 → Whisper 语音识别 → SRT → 转 ASS（加样式）→ ffmpeg 烧录
```

### 4.2 逐步操作

**第一步：提取音频**
```bash
ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 -y audio.wav
```

**第二步：Whisper 语音识别**
```bash
# 安装 Whisper（首次使用）
pip install openai-whisper

# 中文语音识别，输出 SRT 格式
whisper audio.wav --language zh --output_format srt --model medium

# 输出文件: audio.srt
```

**Whisper 模型选择：**
| 模型 | 大小 | 速度 | 精度 | 推荐场景 |
|------|------|------|------|---------|
| `tiny` | 39M | 极快 | 一般 | 快速预览 |
| `base` | 74M | 快 | 较好 | 日常字幕 |
| `small` | 244M | 中 | 好 | 多数场景 |
| `medium` | 769M | 慢 | 很好 | 推荐默认 |
| `large-v3` | 1.5G | 很慢 | 最佳 | 高精度需求 |

**第三步：SRT 转 ASS（添加样式）**
```bash
# 用 ffmpeg 自动转换（基础样式）
ffmpeg -i audio.srt audio.ass

# 或用 Python 脚本自定义样式转换
python3 -c "
import re

# 读取 SRT
with open('audio.srt', 'r', encoding='utf-8') as f:
    srt_content = f.read()

# ASS 头部（自定义样式）
ass_header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV
Style: Default,PingFang SC,52,&H00FFFFFF,&H00000000,1,3,0,2,20,20,340

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
'''

# 解析 SRT 并转换
blocks = re.split(r'\n\n+', srt_content.strip())
dialogues = []
for block in blocks:
    lines = block.strip().split('\n')
    if len(lines) >= 3:
        time_match = re.match(r'(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})', lines[1])
        if time_match:
            g = time_match.groups()
            start = f'{g[0]}:{g[1]}:{g[2]}.{g[3][:2]}'
            end = f'{g[4]}:{g[5]}:{g[6]}.{g[7][:2]}'
            text = ' '.join(lines[2:]).replace('\n', '\\\\N')
            dialogues.append(f'Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\\\fad(150,100)}}{text}')

with open('styled.ass', 'w', encoding='utf-8') as f:
    f.write(ass_header)
    f.write('\n'.join(dialogues))

print(f'转换完成: {len(dialogues)} 条字幕')
"
```

**第四步：烧录字幕**
```bash
ffmpeg -i input.mp4 -vf "ass=styled.ass" -c:v libx264 -crf 23 -c:a copy -y subtitled.mp4
```

### 4.3 一键命令（快速版）

```bash
# 提取音频 + Whisper 识别 + 基础 ASS 转换 + 烧录
ffmpeg -i input.mp4 -vn -ar 16000 -ac 1 -y _temp_audio.wav && \
whisper _temp_audio.wav --language zh --output_format srt --model medium && \
ffmpeg -i _temp_audio.srt _temp_audio.ass && \
ffmpeg -i input.mp4 -vf "ass=_temp_audio.ass" -c:v libx264 -crf 23 -c:a copy -y subtitled.mp4 && \
rm _temp_audio.wav _temp_audio.srt _temp_audio.ass
```

---

## 五、pyJianYingDraft 集成

当需要复杂的花字效果、气泡字幕或动画预设时，可通过 Python 直接生成剪映（CapCut）工程文件。

- **GitHub:** https://github.com/GuanYixuan/pyJianYingDraft
- **适用场景：** 需要剪映内置的花字模板、气泡效果、弹幕动画等 ffmpeg 难以实现的效果

```bash
# 安装
pip install pyJianYingDraft

# 基本用法示例
python3 -c "
from pyJianYingDraft import JianYingDraft, Track, TextSegment

# 创建剪映工程
draft = JianYingDraft()

# 添加文字轨道
text_track = Track('text')
text_track.add_segment(TextSegment(
    text='花字标题',
    start=0,
    duration=3000,  # 毫秒
    font='系统字体',
    style='bubble_01'  # 使用剪映气泡预设
))

draft.add_track(text_track)
draft.save('/path/to/JianYing/drafts/my_project')
print('剪映工程已生成')
"
```

> **使用建议：** 对于简单字幕，优先使用 ffmpeg drawtext 或 ASS 方案（全自动化）。仅在需要剪映特有的花字/气泡/特效模板时，才使用 pyJianYingDraft 生成工程文件后在剪映中导出。

---

## 六、字幕样式速查表

### 按场景推荐

| 场景 | 字体 | 字号 | 颜色 | 特殊效果 |
|------|------|------|------|---------|
| 日常 Vlog | 苹方 | 48-52px | 白色+黑色描边 | 无 |
| 搞笑/吐槽 | 黑体/得意黑 | 56-64px | 黄色/红色+白色描边 | 抖动/放大 |
| 美食 | 苹方 | 52px | 暖白色+棕色描边 | 淡入淡出 |
| 知识/教程 | 思源黑体 | 48px | 白色+深蓝描边 | 底部色块背景 |
| 情感/文艺 | 思源宋体/霞鹜文楷 | 44-48px | 浅灰白色 | 慢淡入 |
| 旅行/风景 | 苹方 | 44px | 白色+半透明阴影 | 位置偏上（不遮挡风景） |
