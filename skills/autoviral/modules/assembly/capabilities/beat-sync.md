# 卡点剪辑模块（Beat-Sync Editing）

当需要将视频剪辑与音乐节拍对齐（卡点）时，加载此模块。

---

## 核心原理

卡点 = 视频的画面切换精确对齐在音乐的节拍/重音上。观众会感觉画面和音乐"融为一体"。

---

## 一键卡点脚本

### 快速使用

```bash
python3 skills/autoviral/modules/assembly/scripts/beat-sync/beat_sync_edit.py \
  --video source.mp4 \
  --music bgm.mp3 \
  --output final.mp4 \
  --style fast
```

### 三种卡点风格

| Style | 切点频率 | 适用场景 |
|-------|---------|---------|
| `fast` | 每个强拍都切 | 搞笑/抽象/炫技，节奏感强 |
| `smooth` | 仅在下拍（每4拍）切 | 生活方式/美食/旅行，节奏舒缓 |
| `dramatic` | 长短交替 | 故事型/悬疑型，有张力 |

### 参数

```bash
--music-volume 0.6    # BGM 音量 (0.0-1.0，默认 0.6)
--strong-ratio 0.3    # 强拍比例 (0.0-1.0，默认 0.3 = 前30%能量的拍子)
```

---

## 手动卡点流程

当需要更精细的控制时，分步执行：

### 第一步：分析节拍

```bash
python3 skills/autoviral/modules/assembly/scripts/beat-sync/detect_beats.py bgm.mp3 -o beats.json
```

输出包含：
- `bpm` — 节拍速度
- `beat_times` — 所有节拍时间点
- `strong_beats` — 强拍时间点（推荐的切点）
- `downbeats` — 下拍时间点（每小节第一拍）
- `energy_curve` — 能量曲线

### 第二步：选择切点策略

根据内容类型选择：

```python
# 读取 beats.json
import json
beats = json.load(open("beats.json"))

# 搞笑类：在每个强拍切
cut_points = beats["strong_beats"]

# 抽象类（过度认真型）：在下拍切，保持长镜头
cut_points = beats["downbeats"]

# 自定义：结合场景边界和节拍
# 用 analyze_video.py 获取场景边界，然后将切点对齐到最近的节拍
```

### 第三步：用 ffmpeg 执行切割

```bash
# 在节拍点切割视频并拼接
ffmpeg -i source.mp4 -ss 0 -t 1.2 -an -c:v libx264 -crf 23 -y seg01.mp4
ffmpeg -i source.mp4 -ss 3.5 -t 0.8 -an -c:v libx264 -crf 23 -y seg02.mp4
# ...

# 拼接
cat > concat.txt << 'EOF'
file 'seg01.mp4'
file 'seg02.mp4'
EOF
ffmpeg -f concat -safe 0 -i concat.txt -c copy -y assembled.mp4

# 叠加 BGM
ffmpeg -i assembled.mp4 -i bgm.mp3 \
  -filter_complex "[1:a]volume=0.6,afade=t=in:d=0.5,afade=t=out:st=28:d=1.5[bgm]" \
  -map 0:v -map "[bgm]" -c:v copy -c:a aac -shortest -y final.mp4
```

---

## 搞笑/抽象类的卡点特殊规则

参考 `genres/comedy.md`：

### 搞笑类
- **反转点必须有声音标记**：在反转瞬间的切点，BGM 应该突然静音 0.3-0.5 秒或切换
- **铺垫阶段不要频繁切**：铺垫用正常节奏，反转瞬间加速
- **点睛定格**：反转后可以在强拍位置插入 0.5-1 秒定格

### 抽象类
- **长镜头优先**：不要每拍都切，让荒诞场景持续存在
- **沉默比音效更有力**：最荒诞的瞬间不加音效
- **循环强化**：同一个动作在节拍上循环，强化"认真"感

---

## 依赖

```bash
pip3 install librosa numpy
# ffmpeg 需要系统安装
```
