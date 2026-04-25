# 热门音乐搜索与下载模块

当需要为视频寻找合适的背景音乐时，加载此模块。支持搜索抖音热门 BGM、YouTube/B站下载、以及按情绪/BPM 匹配。

---

## 音乐来源优先级

1. **用户共享素材库** — 先检查 `curl http://localhost:3271/api/shared-assets`，用户可能已上传音乐
2. **抖音热门 BGM** — 平台流量加成，优先使用
3. **YouTube/B站搜索** — 曲库最大，用 yt-dlp 下载
4. **免版权音乐库** — Freesound 等 CC 授权音源

---

## 方法一：从 YouTube/B站搜索下载

```bash
# 搜索并列出结果（不下载）
yt-dlp "ytsearch5:upbeat electronic BGM no copyright 30s" --get-title --get-url --get-duration

# 下载为 MP3（最佳音质）
yt-dlp -x --audio-format mp3 --audio-quality 0 \
  -o "bgm.%(ext)s" "VIDEO_URL"

# 从 B站下载
yt-dlp -x --audio-format mp3 --audio-quality 0 \
  -o "bgm.%(ext)s" "https://www.bilibili.com/video/BVxxxx"
```

### 搜索关键词构造

根据视频内容分析结果，构造搜索关键词：

| 视频类型 | 搜索关键词示例 |
|---------|-------------|
| 搞笑/反转 | `funny meme BGM sound effect`, `搞笑 BGM 无版权` |
| 抽象/过度认真 | `epic orchestral BGM short`, `史诗 BGM 纯音乐` |
| 生活方式 | `chill lofi BGM no copyright`, `轻松 日常 背景音乐` |
| 美食 | `warm acoustic BGM cooking`, `美食 温馨 背景音乐` |
| 科技 | `electronic tech BGM`, `科技感 背景音乐` |

---

## 方法二：从抖音官方 MV 提取

当用户指定了具体歌名时：

```bash
# 1. 搜索官方 MV
yt-dlp "ytsearch1:[歌名] official MV" --get-url --get-title

# 2. 下载音频
yt-dlp -x --audio-format mp3 --audio-quality 0 -o "song.%(ext)s" "MV_URL"

# 3. 裁切高潮段落（大多数歌曲高潮在 50-70% 位置）
ffmpeg -i song.mp3 -ss 120 -to 150 -c copy -y chorus.mp3
```

---

## 方法三：BPM 匹配搜索

当视频分析得出了目标 BPM 时：

```bash
# 搜索特定 BPM 范围的音乐
yt-dlp "ytsearch5:[BPM] bpm BGM no copyright instrumental" --get-title --get-url

# 例如：120 BPM 的电子风格
yt-dlp "ytsearch5:120 bpm electronic BGM no copyright" --get-title --get-url
```

---

## 下载后处理

### 裁切到目标时长

```bash
# 裁切前 30 秒
ffmpeg -i bgm.mp3 -t 30 -c copy -y bgm-trimmed.mp3

# 从高潮开始裁切
ffmpeg -i bgm.mp3 -ss 60 -t 30 -c copy -y bgm-chorus.mp3
```

### 淡入淡出

```bash
ffmpeg -i bgm.mp3 -af "afade=t=in:st=0:d=1,afade=t=out:st=28:d=2" -y bgm-fade.mp3
```

### 验证 BPM 是否匹配

```bash
python3 skills/autoviral/modules/assembly/scripts/beat-sync/detect_beats.py bgm.mp3
```

---

## 音乐选择准则

### 搞笑类（Comedy）

参考 `genres/comedy.md` 中的 BGM 四种战术用法：
- **情绪铺垫-反转**：先下载一段史诗/煽情音乐（铺垫用），再下载一段沙雕/梗音乐（反转用）
- **反差配乐**：画面内容越正经，BGM 越不正经（反之亦然）
- **经典梗音乐**：搜索当下抖音流行的搞笑 BGM

### 抽象类（Abstract）

参考 `genres/comedy.md` 中的 BGM 三种策略：
- **BGM 作为错位的一端**：画面和 BGM 必须来自两个不同世界
- **BGM 纯度要求**：选一首真的很 XX 的歌，不要选"有点 XX"的

---

## 依赖

```bash
pip3 install yt-dlp
# 或 brew install yt-dlp
```
