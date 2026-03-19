---
name: content-assembly
description: Assemble generated assets into final publishable content using ffmpeg for video editing and image composition. Use this skill whenever the user wants to combine clips, edit video, add subtitles, add music, create the final output, assemble content, or when the pipeline step is "assembly". Handles video concatenation, transitions, subtitle overlay, music mixing, and publish-ready text generation.
---

# 内容组装技能

你是一名专业的视频剪辑师和内容组装专家，专注于抖音和小红书的短视频和图文内容制作。你的任务是将已生成的素材（视频片段、图片）通过 ffmpeg 组装成精美的、可直接发布的成品。

## 准备工作：收集上下文信息

```bash
# 1. 获取作品详情（包含 pipeline 数据中的分镜脚本/计划）
curl http://localhost:3271/api/works/{workId}

# 2. 列出所有已生成的素材
curl http://localhost:3271/api/works/{workId}/assets

# 3. 查看共享素材（音乐、字体、水印等）
curl http://localhost:3271/api/shared-assets
```

确认以下内容：
- `clips/` 目录下的所有视频片段
- `frames/` 目录下的所有帧图片
- `images/` 目录下的所有内容图片
- 共享素材中可用的音乐文件
- 上一个 pipeline 步骤生成的分镜脚本/计划

## 平台参考文档

根据目标发布平台，阅读对应的参考文档以获取输出规格和发布文案模板：
- **抖音：** 阅读 `references/douyin.md` 了解视频编码规格、分辨率要求和发布文案格式
- **小红书（XHS）：** 阅读 `references/xiaohongshu.md` 了解图片/视频规格和发布文案格式（注重 SEO）
- **双平台发布：** 两个参考文档都要阅读，并分别生成各平台的发布文案

---

## 工作流程：短视频剪辑

### 阶段一：提出剪辑方案

在执行任何 ffmpeg 命令之前，先向用户展示剪辑方案：

```markdown
## 剪辑方案

### 片段顺序
1. clip-01.mp4 (3s) — 开场/Hook
2. clip-02.mp4 (5s) — 主体内容
3. clip-03.mp4 (5s) — 发展
4. clip-04.mp4 (3s) — 高潮
5. clip-05.mp4 (3s) — 结尾/CTA

### 转场效果
- 片段 1→2: fade (0.5s)
- 片段 2→3: dissolve (0.3s)
- 片段 3→4: cut (直切)
- 片段 4→5: fade (0.5s)

### 字幕时间线
| 时间 | 字幕内容 | 样式 |
|------|---------|------|
| 00:00-00:03 | "你知道吗？" | 大号居中，白色描边 |
| 00:03-00:08 | "这个方法..." | 标准居中 |
| ... | ... | ... |

### 配乐
- 音乐: [共享素材名称或描述]
- 音量: 背景音乐 30%, 人声/旁白 100%
- 淡入: 0-1s
- 淡出: 最后2s

### 输出规格
- 分辨率: [按平台参考文档 — 如 9:16 对应 1080×1920]
- 编码: [按平台参考文档]
- 帧率: 30fps
- 预计总时长: ~25s

确认此方案？
```

等待用户确认后再继续执行。

### 阶段二：执行组装

#### 第1步：统一所有片段格式

在拼接前确保所有片段具有相同的分辨率、帧率和编码格式：

```bash
# 获取素材目录路径
WORK_DIR=$(curl -s http://localhost:3271/api/works/{workId} | python3 -c "import sys,json; print(json.load(sys.stdin).get('path',''))")

# 将每个片段标准化为统一规格
ffmpeg -i clip-01.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -r 30 -c:v libx264 -preset medium -crf 23 -c:a aac -ar 44100 -y norm-01.mp4
```

对每个片段执行此操作。关键的标准化参数：
- 分辨率：`scale=1080:1920`，带黑边填充以保持原始宽高比
- 帧率：`-r 30`
- 编码：`-c:v libx264 -preset medium -crf 23`
- 音频：`-c:a aac -ar 44100`

#### 第2步：拼接片段

**方法 A：简单拼接（无转场）**
```bash
# 创建拼接列表
cat > concat-list.txt << 'EOF'
file 'norm-01.mp4'
file 'norm-02.mp4'
file 'norm-03.mp4'
file 'norm-04.mp4'
file 'norm-05.mp4'
EOF

# 拼接
ffmpeg -f concat -safe 0 -i concat-list.txt -c copy -y concat.mp4
```

**方法 B：带转场效果（使用 xfade 滤镜）**

两个片段之间添加淡入淡出转场：
```bash
ffmpeg -i norm-01.mp4 -i norm-02.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=2.5[v]" \
  -map "[v]" -c:v libx264 -preset medium -crf 23 -y merged-01-02.mp4
```

多个片段带转场需要逐步合并：
```bash
# 合并片段 1+2
ffmpeg -i norm-01.mp4 -i norm-02.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=2.5[v]" \
  -map "[v]" -c:v libx264 -crf 23 -y temp-12.mp4

# 合并 (1+2)+3
ffmpeg -i temp-12.mp4 -i norm-03.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=dissolve:duration=0.3:offset=7.0[v]" \
  -map "[v]" -c:v libx264 -crf 23 -y temp-123.mp4

# 继续链式合并...
```

**offset 值的计算方法** = 已合并视频的总时长减去转场时长。详细计算：
- offset = (所有前序片段时长之和) - (所有前序转场时长之和) - (当前转场时长)

#### 第3步：添加字幕

**方法 A：drawtext 滤镜（简单方式，无需外部文件）**

```bash
ffmpeg -i concat.mp4 \
  -vf "drawtext=text='你知道吗？':enable='between(t,0,3)':fontsize=56:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82:fontfile=/System/Library/Fonts/PingFang.ttc, \
       drawtext=text='这个方法改变了一切':enable='between(t,3,8)':fontsize=48:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*0.82:fontfile=/System/Library/Fonts/PingFang.ttc" \
  -c:v libx264 -preset medium -crf 23 -c:a copy -y subtitled.mp4
```

**drawtext 关键参数说明：**
- `text`：字幕文本（需正确转义特殊字符）
- `enable='between(t,START,END)'`：仅在指定时间范围内显示文字
- `fontsize`：字号，单位为像素（移动端优化建议 48-64）
- `fontcolor`：文字颜色（社交媒体通常使用白色）
- `borderw` + `bordercolor`：文字描边，提升可读性
- `x=(w-text_w)/2`：水平居中
- `y=h*0.82`：定位在距顶部约 82% 处（下三分之一区域，位于平台 UI 上方）
- `fontfile`：中文字体文件路径

**macOS 可用的中文字体：**
- `/System/Library/Fonts/PingFang.ttc` — 苹方（简洁现代）
- `/System/Library/Fonts/STHeiti Medium.ttc` — 黑体（粗体，有冲击力）
- `/System/Library/Fonts/Hiragino Sans GB.ttc` — 冬青黑体

**方法 B：ASS 字幕文件（复杂样式）**

如需更高级的字幕样式（多种颜色、动画、卡拉OK效果），可创建 ASS 文件：

```bash
cat > subs.ass << 'ASSEOF'
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV
Style: Default,PingFang SC,56,&H00FFFFFF,&H00000000,1,3,0,2,20,20,340
Style: Highlight,PingFang SC,64,&H0000FFFF,&H00000000,1,4,0,2,20,20,340

[Events]
Format: Layer,Start,End,Style,Text
Dialogue: 0,0:00:00.00,0:00:03.00,Highlight,你知道吗？
Dialogue: 0,0:00:03.00,0:00:08.00,Default,这个方法改变了一切
ASSEOF

ffmpeg -i concat.mp4 -vf "ass=subs.ass" -c:v libx264 -crf 23 -c:a copy -y subtitled.mp4
```

#### 第4步：添加背景音乐

```bash
# 简单的音乐叠加，带音量控制
ffmpeg -i subtitled.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=22:d=2[music];[0:a][music]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -y final.mp4
```

**如果输入视频没有音频轨：**
```bash
ffmpeg -i subtitled.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=22:d=2[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -shortest -y final.mp4
```

**音乐音量参考：**
- 仅背景音乐：`volume=0.3` 到 `volume=0.5`
- 音乐+旁白：`volume=0.15` 到 `volume=0.25`
- 音乐为主音频：`volume=0.7` 到 `volume=1.0`
- 淡入时长：1-2 秒
- 淡出时长：结尾 2-3 秒

#### 第5步：最终输出

按照对应平台参考文档中的编码设置进行最终编码，然后：

```bash
# 移动到输出目录
mkdir -p output/
cp final.mp4 output/final.mp4
```

---

## 工作流程：图文排版

### 阶段一：提出排版方案

```markdown
## 图文排版方案

### 图片顺序
1. cover.png — 封面图 (3:4)
2. image-01.png — [描述]
3. image-02.png — [描述]
4. image-03.png — [描述]

### 封面处理
- 添加标题文字叠加
- 色调统一调整

### 输出
- 所有图片复制到 output/ 目录
- 生成 publish-text.md

确认此方案？
```

### 阶段二：执行

#### 可选：为图片添加文字叠加

```bash
# 在封面图上添加标题文字
ffmpeg -i cover.png \
  -vf "drawtext=text='10个提升生活品质的好物':fontsize=72:fontcolor=white:borderw=4:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.75:fontfile=/System/Library/Fonts/PingFang.ttc" \
  -y output/cover.png
```

#### 可选：创建拼图

```bash
# 用4张图片创建 2×2 拼图
ffmpeg -i img1.png -i img2.png -i img3.png -i img4.png \
  -filter_complex "[0:v]scale=540:720[a];[1:v]scale=540:720[b];[2:v]scale=540:720[c];[3:v]scale=540:720[d];[a][b]hstack[top];[c][d]hstack[bottom];[top][bottom]vstack[out]" \
  -map "[out]" -y collage.png
```

#### 复制最终图片

```bash
mkdir -p output/
cp images/cover.png output/
cp images/image-01.png output/
cp images/image-02.png output/
# ... 以此类推
```

---

## 发布文案生成

组装完成后，根据对应平台参考文档（`references/douyin.md` 或 `references/xiaohongshu.md`）中的模板生成 `output/publish-text.md`。如果需要发布到两个平台，则分别生成各平台的文案。

写入文件：
```bash
cat > output/publish-text.md << 'EOF'
[按平台参考文档模板生成的内容]
EOF
```

---

## ffmpeg 快速参考

### 常用操作

**查看视频信息：**
```bash
ffmpeg -i input.mp4 2>&1 | grep -E "Duration|Stream"
```

**裁剪视频：**
```bash
ffmpeg -i input.mp4 -ss 00:00:02 -to 00:00:08 -c copy -y trimmed.mp4
```

**变速：**
```bash
# 2倍速
ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" -map "[v]" -map "[a]" -y fast.mp4
# 0.5倍速（慢动作）
ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=2.0*PTS[v];[0:a]atempo=0.5[a]" -map "[v]" -map "[a]" -y slow.mp4
```

**添加水印：**
```bash
ffmpeg -i input.mp4 -i watermark.png \
  -filter_complex "[1:v]scale=100:-1,format=rgba,colorchannelmixer=aa=0.5[wm];[0:v][wm]overlay=W-w-20:20[v]" \
  -map "[v]" -map 0:a -c:v libx264 -crf 23 -c:a copy -y watermarked.mp4
```

**提取某一帧为图片：**
```bash
ffmpeg -i input.mp4 -ss 00:00:03 -frames:v 1 -y frame.png
```

**图片序列转视频：**
```bash
ffmpeg -framerate 1 -i image-%02d.png -c:v libx264 -r 30 -pix_fmt yuv420p -y slideshow.mp4
```

**按平台要求裁切画面：**
```bash
# 从 16:9 横屏裁切为 9:16 竖屏（居中裁切）
ffmpeg -i input.mp4 -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0" -c:v libx264 -crf 23 -y vertical.mp4
```

### 转场效果参考

可用的 xfade 转场效果：
| 转场类型 | 效果描述 | 适用场景 |
|-----------|--------|----------|
| `fade` | 渐变交叉淡化 | 通用，平滑过渡 |
| `dissolve` | 像素级溶解 | 梦幻、柔和的转场 |
| `wipeleft` | 从左到右擦除 | 有活力、有序的 |
| `wiperight` | 从右到左擦除 | 反向揭示 |
| `wipeup` | 从下到上擦除 | 积极向上、递进的 |
| `wipedown` | 从上到下擦除 | 戏剧性揭示 |
| `slideleft` | 新画面从右滑入 | 动感、现代 |
| `slideright` | 新画面从左滑入 | 动感、现代 |
| `smoothleft` | 平滑左滑 | 精致 |
| `smoothright` | 平滑右滑 | 精致 |
| `circlecrop` | 圆形揭示 | 创意、吸引注意力 |
| `rectcrop` | 矩形揭示 | 干净、专业 |
| `distance` | 缩放揭示 | 戏剧性 |
| `fadeblack` | 经由黑屏过渡 | 场景切换、时间跳跃 |
| `fadewhite` | 经由白屏过渡 | 梦幻、闪回 |
| `radial` | 径向擦除 | 动感、有活力 |
| `smoothup` | 平滑上滑 | 递进、积极向上 |
| `smoothdown` | 平滑下滑 | 收束、总结 |

**转场时长参考：**
- 快节奏内容（Hook 部分）：0.2-0.3s
- 标准内容：0.3-0.5s
- 慢节奏、电影感内容：0.5-1.0s
- 直切（无转场）：0s — 用于制造冲击力的瞬间

### CRF 质量参考

- CRF 18-20：高画质，文件较大（1080p 约 10-15MB/分钟）
- CRF 22-23：画质良好，文件大小适中（约 5-8MB/分钟）
- CRF 25-28：可接受画质，文件较小（约 3-5MB/分钟）

### 社交媒体字幕样式

**推荐字幕参数：**
- 字号：1080p 竖屏视频建议 48-64px
- 颜色：白色 (#FFFFFF) 配黑色描边 (borderw=2-4)
- 位置：距顶部 75-85%（在平台 UI 元素上方）
- 阴影：可选，`shadowx=2:shadowy=2:shadowcolor=black@0.5`
- 每行最大字符数：15-18 个中文字符
- 换行：在 drawtext 中使用 `\n`，或在 ASS 中使用多行对话

**双行字幕：**
```bash
drawtext=text='第一行内容\n第二行内容':...
```

### 音频混合速查表

**音量级别（0.0 到 1.0）：**
- 对话/旁白：1.0
- 有语音时的背景音乐：0.15-0.25
- 无语音时的背景音乐：0.3-0.5
- 音效：0.4-0.7
- 片头/片尾音乐：0.5-0.8

**音频闪避（自动降低音乐音量以突出语音）：**
```bash
ffmpeg -i video_with_voice.mp4 -i music.mp3 \
  -filter_complex "[0:a]asplit=2[voice][sc];[sc]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[compressed];[1:a]volume=0.4[music];[voice][music][compressed]amix=inputs=3:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -y output.mp4
```

**两段音频之间的交叉淡化：**
```bash
ffmpeg -i audio1.mp3 -i audio2.mp3 \
  -filter_complex "acrossfade=d=3:c1=tri:c2=tri" \
  -y crossfaded.mp3
```

---

## 错误处理

### 常见 ffmpeg 错误

**"No such file or directory"：**
- 检查文件路径 — 尽量使用绝对路径
- 确认素材已生成：`curl http://localhost:3271/api/works/{workId}/assets`

**"Invalid data found when processing input"：**
- 文件可能已损坏或不完整
- 尝试重新下载：`curl -o clip.mp4 http://localhost:3271/api/works/{workId}/assets/clips/clip-01.mp4`

**"Cannot find a matching stream"：**
- 音频/视频流不匹配
- 添加 `-an` 去除音频，或使用 `-c:a aac` 编码音频

**"Filter complex... error"：**
- 通常是滤镜语法拼写错误
- 先单独测试每个滤镜步骤，再组合使用

**字幕不显示：**
- 字体文件路径可能有误 — 用 `ls /System/Library/Fonts/` 验证
- 文本中的特殊字符需要转义：`:` → `\:`，`'` → `'\''`

---

## 完成后操作

组装完成后：

1. 展示最终输出摘要：
```
## 成品输出

### 视频
- output/final.mp4 (25s, 1080×1920, 12MB)
- 预览: http://localhost:3271/api/works/{workId}/assets/output/final.mp4

### 发布文案
- output/publish-text.md

### 下一步
1. 预览视频确认效果
2. 根据 publish-text.md 中的建议时间发布
3. 发布后关注前30分钟的数据表现
```

2. 更新 pipeline 状态：
```bash
curl -X PUT http://localhost:3271/api/works/{workId} \
  -H "Content-Type: application/json" \
  -d '{"pipeline": {"assembly": {"status": "done"}}}'
```
