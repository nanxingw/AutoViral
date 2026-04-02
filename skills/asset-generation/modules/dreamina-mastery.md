---
name: dreamina-mastery
description: Dreamina CLI 高阶方法论——命令选择决策、模型策略、多模态工作流、批量生产、镜头串联、prompt 工程、异步任务管理、常见问题排查。
---

# Dreamina CLI 高阶指南

本模块覆盖 Dreamina CLI（`dreamina`）的高阶用法和生产级工作流。当你需要选择最佳命令、优化视频质量、批量生产、或排查问题时，加载本模块。

> **前置条件**：`dreamina` 已安装且已登录。未安装请执行 `curl -fsSL https://jimeng.jianying.com/cli | bash`，未登录请执行 `dreamina login`。

---

## 1. 命令选择决策树

面对一个视频生成需求时，按以下决策树选择最佳命令：

```
输入是什么？
├── 只有文字描述（无图片）
│   └── text2video
├── 1 张图片
│   ├── 需要精确控制结束画面？
│   │   ├── 是 → frames2video（再生成一张末帧图）
│   │   └── 否 → image2video
│   └── 还有音频/视频参考？
│       └── 是 → multimodal2video
├── 2 张图片
│   ├── 是首帧+末帧？ → frames2video
│   └── 是叙事序列？ → multiframe2video
├── 3-20 张图片
│   └── multiframe2video
└── 图片 + 音频/视频混合
    └── multimodal2video
```

### 命令能力对比

| 能力 | text2video | image2video | frames2video | multiframe2video | multimodal2video |
|------|-----------|-------------|-------------|-----------------|-----------------|
| 文字输入 | 必需 | 可选 | 可选 | 可选 | 可选 |
| 图片输入 | 不支持 | 1张 | 2张(首+尾) | 2-20张 | 最多9张 |
| 视频输入 | 不支持 | 不支持 | 不支持 | 不支持 | 最多3个 |
| 音频输入 | 不支持 | 不支持 | 不支持 | 不支持 | 最多3个 |
| 时长控制 | 4-15s | 3-15s | 3-15s | 每段0.5-8s | 4-15s |
| 比例控制 | 6种 | 自动(从图) | 自动(从图) | 自动(从图) | 6种 |
| Seedance 2.0 | 支持 | 支持 | 支持 | 不支持 | 支持 |

> **⚠️ 重要：`image2video` / `frames2video` / `multiframe2video` 不需要 `--ratio` 参数！** 比例自动从输入图片推断。加了 `--ratio` 会报错或被忽略。只有 `text2video` 和 `multimodal2video` 需要指定 `--ratio`。

---

## 2. 模型选择策略

### 视频模型

| 模型 | 质量 | 速度 | 适用场景 |
|------|------|------|---------|
| `seedance2.0` | 最高 | 较慢(1-3分钟) | **正式发布内容**、需要最高画质 |
| `seedance2.0fast` | 高 | 快(30-60秒) | 预览、测试、批量生产、对速度敏感 |
| `3.5pro` | 中高 | 中 | frames2video 需要 1080p 时 |
| `3.0` / `3.0pro` | 中 | 快 | 需要 1080p + 快速出结果 |

**默认策略：**
- 用户明确要求最高质量 → `seedance2.0`
- 用户没特殊要求 → `seedance2.0fast`（速度优先，质量已经很高）
- 需要 1080p 分辨率 → `3.5pro` 或 `3.0pro`（Seedance 2.0 目前仅支持 720p）
- 测试/预览 → `seedance2.0fast`

### 图片模型（text2image / image2image）

| 模型 | 质量 | 分辨率 | 适用场景 |
|------|------|--------|---------|
| `5.0` | 最高 | 2k/4k | 正式发布 |
| `4.6` / `4.5` | 高 | 2k/4k | 通用 |
| `lab` | 实验性(VIP) | 2k/4k | 探索新能力 |
| `3.0` / `3.1` | 中 | 1k/2k | 快速草图 |

---

## 3. 视频 Prompt 工程（Dreamina 专项）

### Seedance 2.0 prompt 最佳实践

Seedance 2.0 对 prompt 的理解能力远超旧版模型，遵循以下原则：

**结构模板：**
```
[镜头运动], [主体动作], [环境变化], [光影变化], [节奏/速度]
```

**示例（从弱到强）：**

❌ 弱 prompt：
```
一个女生在走路
```

✅ 强 prompt：
```
镜头跟随平移，一位穿着米色风衣的年轻女性沿着梧桐树大道悠闲行走，
微风吹起裙摆和发梢，落叶在她身边缓缓飘落，
温暖的黄昏逆光从树叶间隙洒下，营造出温暖的丁达尔效应
```

### 运镜关键词（中文直接生效）

| 运镜 | 中文关键词 | 英文关键词 |
|------|-----------|-----------|
| 推镜 | 镜头缓慢推进/推近 | camera slowly pushes in, dolly forward |
| 拉镜 | 镜头缓慢拉远/后退 | camera pulls back, dolly out |
| 横移 | 镜头从左向右平移 | camera pans left to right |
| 跟拍 | 镜头跟随主体移动 | camera follows the subject |
| 环绕 | 镜头绕主体旋转 | camera orbits around |
| 俯冲 | 镜头从高处俯冲而下 | camera dives down from above |
| 升镜 | 镜头从低处缓慢上升 | camera rises up slowly |
| 固定 | 固定镜头/静止机位 | static shot, locked camera |
| 手持 | 手持镜头/轻微晃动 | handheld camera, slight shake |

### 时长与内容密度匹配

| 时长 | 适合内容 | 不适合内容 |
|------|---------|-----------|
| 4-5s | 单一动作、情绪定格、产品展示 | 复杂叙事、多段动作 |
| 6-8s | 简单叙事、一个完整动作序列 | 太简单（会拖沓）或太复杂 |
| 9-12s | 中等复杂度的场景演绎 | 单一动作（会拖沓） |
| 13-15s | 完整的短片段、多层动作 | 静态场景（浪费时长） |

**核心原则：prompt 中描述的内容量要匹配时长。5 秒只写一个动作，15 秒可以写 2-3 个连续动作。**

---

## 4. 镜头串联技术

### 方法 A：多帧叙事（推荐）

最简单的方式——生成所有关键帧图片，用 `multiframe2video` 一次性生成连贯视频：

```bash
# 生成 4 个关键帧
for i in 01 02 03 04; do
  python3 skills/asset-generation/scripts/openrouter_generate.py \
    --prompt "{第${i}镜场景描述}" \
    --ref-image frames/frame-01.png --seed 42 \
    --ar 9:16 --size 2K \
    --output frames/frame-${i}.png
done

# 一次性生成连贯叙事视频
dreamina multiframe2video \
  --images frames/frame-01.png,frames/frame-02.png,frames/frame-03.png,frames/frame-04.png \
  --transition-prompt="人物从远景走近" \
  --transition-prompt="人物转身面对镜头" \
  --transition-prompt="镜头推到特写" \
  --transition-duration=4 --transition-duration=3 --transition-duration=3 \
  --poll=180
```

**优势**：模型自动处理镜头间的过渡，画面连贯性最好。
**限制**：不支持 Seedance 2.0 模型选择，每段最长 8 秒。

### 方法 B：逐镜生成 + 首帧串联

每个镜头单独生成，但通过共享首帧/参考图保持视觉一致性：

```bash
# 镜头 1
dreamina image2video \
  --image frames/frame-01.png \
  --prompt="第1镜动作描述" \
  --duration=5 --model_version=seedance2.0 --poll=120

# 镜头 2（使用同一角色参考图）
dreamina image2video \
  --image frames/frame-02.png \
  --prompt="第2镜动作描述" \
  --duration=5 --model_version=seedance2.0 --poll=120
```

**优势**：每个镜头可独立控制模型和时长，支持 Seedance 2.0。
**限制**：镜头间的过渡需要在 assembly 阶段用转场效果处理。

### 方法 C：首尾帧精确控制

当需要精确控制每个镜头的起止画面时：

```bash
# 镜头 1 的末帧 = 镜头 2 的首帧（物理连续性）
dreamina frames2video \
  --first=frames/frame-01.png --last=frames/frame-02.png \
  --prompt="人物慢慢站起身" \
  --duration=5 --model_version=seedance2.0 --poll=120
```

**优势**：起止画面完全可控，适合精确编排。
**限制**：需要为每个镜头准备两张图。

---

## 5. 批量生产工作流

### 串行批量（简单可靠）

```bash
# 逐个生成，每个等待结果
for i in 01 02 03 04 05; do
  echo "=== 生成镜头 $i ==="
  dreamina image2video \
    --image frames/frame-${i}.png \
    --prompt="$(cat prompts/prompt-${i}.txt)" \
    --duration=5 --model_version=seedance2.0fast \
    --poll=120
done
```

### 并行提交 + 批量查询（高效）

```bash
# 步骤 1：提交所有任务（不等待）
SUBMIT_IDS=()
for i in 01 02 03 04 05; do
  result=$(dreamina image2video \
    --image frames/frame-${i}.png \
    --prompt="$(cat prompts/prompt-${i}.txt)" \
    --duration=5 --model_version=seedance2.0fast)
  submit_id=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('submit_id',''))")
  SUBMIT_IDS+=("$submit_id")
  echo "镜头 $i 已提交: $submit_id"
done

# 步骤 2：等待一段时间后批量查询
sleep 60
for id in "${SUBMIT_IDS[@]}"; do
  dreamina query_result --submit_id="$id" --download_dir=./output/
done
```

### 任务追踪

```bash
# 查看所有成功的任务
dreamina list_task --gen_status=success --limit=20

# 查看所有失败的任务
dreamina list_task --gen_status=fail --limit=20
```

---

## 6. 多模态视频高阶技巧

### 音频驱动视频（卡点视频）

```bash
# 先用 music_generate.py 生成节奏感强的 BGM
python3 skills/asset-generation/scripts/music_generate.py \
  --prompt "upbeat pop with strong beat drops every 2 seconds, 120 BPM" \
  --output bgm-beat.mp3

# 用音频驱动视频生成（Seedance 2.0 会自动匹配节奏）
dreamina multimodal2video \
  --image character-ref.png \
  --audio bgm-beat.mp3 \
  --prompt="人物随着音乐节拍做动作，每个鼓点换一个姿势" \
  --duration=15 --model_version=seedance2.0 \
  --poll=180
```

### 视频参考 + 角色替换

```bash
# 用参考视频的运动方式 + 角色图的外观
dreamina multimodal2video \
  --image my-character.png \
  --video reference-dance.mp4 \
  --prompt="保持角色图中的人物外观，模仿参考视频中的舞蹈动作" \
  --duration=10 --model_version=seedance2.0 \
  --poll=180
```

### 多图角色一致性

```bash
# 传入多张同一角色不同角度的照片
dreamina multimodal2video \
  --image character-front.png \
  --image character-side.png \
  --image character-back.png \
  --prompt="角色在房间里走动，展示不同角度" \
  --duration=10 --ratio=16:9 --model_version=seedance2.0 \
  --poll=180
```

---

## 7. 宽高比与平台适配

### 视频宽高比

| 比例 | 适用平台 | 命令参数 |
|------|---------|---------|
| `9:16` | **抖音/快手（首选）** | `--ratio=9:16` |
| `16:9` | 横屏视频/B站 | `--ratio=16:9` |
| `1:1` | 正方形/小红书视频 | `--ratio=1:1` |
| `3:4` | 小红书竖版视频 | `--ratio=3:4` |
| `4:3` | 传统横版 | `--ratio=4:3` |
| `21:9` | 超宽屏/电影感 | `--ratio=21:9` |

> **注意**：`image2video` 和 `frames2video` 的比例从输入图片推断，不需要设置 `--ratio`。

### 图片宽高比（text2image / image2image）

| 比例 | 适用场景 |
|------|---------|
| `3:4` | **小红书图文（推荐）** |
| `9:16` | 抖音封面/短视频首帧 |
| `1:1` | 头像/正方形 |
| `16:9` | 横屏封面 |
| `21:9` | 超宽 banner |

---

## 8. 常见问题与排查

### Q: 提交任务后一直 querying 没有结果？

```bash
# 用 --poll 等待更长时间
dreamina image2video ... --poll=180

# 或者记下 submit_id 稍后手动查询
dreamina query_result --submit_id=<id>
```

### Q: 返回 AigcComplianceConfirmationRequired？

某些模型（特别是 Seedance 2.0）首次使用需要在即梦网页端完成授权确认：
1. 打开 https://jimeng.jianying.com
2. 登录同一账号
3. 找到该模型并完成授权确认
4. 重试 CLI 命令

### Q: 积分不够了？

```bash
dreamina user_credit
```

各操作积分消耗参考（具体以平台实际扣费为准）：
- text2image：1 积分/次
- image2video (5s)：约 2-5 积分
- text2video (5s)：约 2-5 积分
- multimodal2video：约 3-8 积分

### Q: 如何切换账号？

```bash
dreamina relogin     # 清除现有登录态并重新登录
dreamina logout      # 仅清除登录态
```

### Q: poll 超时但任务可能还在跑？

```bash
# 保存返回的 submit_id，稍后查询
dreamina query_result --submit_id=<id> --download_dir=./output/
```

### Q: 如何知道哪些参数组合是合法的？

```bash
# 永远以 -h 的输出为准
dreamina <subcommand> -h
```

每个子命令的 `-h` 会列出所有合法的模型、分辨率、时长组合。CLI 更新后参数可能变化，不要硬编码。

---

## 9. 与 Pipeline 其他阶段的衔接

### 与 Assembly 阶段

Dreamina CLI 生成的视频通过 `query_result --download_dir` 下载到本地后，可直接用 ffmpeg 处理：

```bash
# 下载到作品的 clips 目录
dreamina query_result --submit_id=<id> \
  --download_dir={workDir}/assets/clips/

# 后续在 assembly 阶段用 ffmpeg 拼接、加字幕、混音等
```

### 与首帧生成的衔接

推荐工作流：OpenRouter 生成高清首帧 → Dreamina image2video 生成视频

```bash
# 1. OpenRouter 生成 2K 首帧（画质最高）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "{场景描述}" --ar 9:16 --size 2K \
  --output frames/frame-01.png

# 2. Dreamina 用首帧生成视频
dreamina image2video \
  --image frames/frame-01.png \
  --prompt="{运动描述}" \
  --duration=5 --model_version=seedance2.0 \
  --poll=120
```

### 与音乐生成的衔接

如果需要音频驱动的视频（卡点视频），先生成音乐，再用 multimodal2video：

```bash
# 1. 生成 BGM
python3 skills/asset-generation/scripts/music_generate.py \
  --prompt "energetic pop, 120 BPM, strong beat" \
  --output music/bgm.mp3

# 2. 用音频驱动视频生成
dreamina multimodal2video \
  --image frames/keyframe.png \
  --audio music/bgm.mp3 \
  --prompt="配合音乐节奏的动态画面" \
  --duration=10 --model_version=seedance2.0 \
  --poll=180
```
