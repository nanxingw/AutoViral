---
name: assets-reference-directives
description: 用于多参考图/参考视频驱动生成时——例如 "用 image1 的人物替换 video1 中的角色"、"参考 image2 的环境作为目的地"、"用 video1 的运镜配 image1 的角色"、"以 audio1 作为背景音乐"。给出 @addressing 语法、role 词汇、合法槽位预算（≤9 图/≤3 视频/≤3 音频，总计 ≤12）。不用于：单图驱动（直接 image2video / frames2video 即可），也不用于纯文字生成（text2video）。
---

# Reference-driven 生成 — directive 语言

`dreamina multimodal2video`（以及未来 `dreamina_generate.py` 包装层）的 reference 模式不是"多张参考图当 identity anchor"，而是一个**编排式导演系统**：每张 ref 都是一个可寻址的资产，在 prompt 里被分配一个**结构化角色**——角色身份、首帧、目的地、运镜、风格、音频床。不同的 ref 可以同时控制不同维度。

最常见的失败 = 把 reference 模式当成 `from-image` 多塞几张图，期望模型自己挑出谁是主角、谁是环境。**别这样。** 真正的能力来自给每张 ref 命名，并在 prompt 里明确告诉模型"用它来做什么"。

> **当前实现：**video 多参考能力今天通过 `dreamina` CLI 的 `multimodal2video` 子命令暴露（见 `capabilities/dreamina-mastery.md`）。Python 包装 `modules/assets/scripts/dreamina_generate.py` 的 port 仍在 Phase 2.x 待补；envelope 协议层（dispatchGeneration.ts）已默认引用后者，运行时如脚本不存在请降级到直接调 `dreamina` CLI 或退到 `jimeng_generate.py`（仅支持单首帧 / 单末帧，不支持多 ref）。

## @addressing 语法

prompt 内部，参考资产用 `@` 寻址：

- `@image1`, `@image2`, …, 最多 `@image9`
- `@video1`, `@video2`, `@video3`
- `@audio1`, `@audio2`, `@audio3`

编号是命令行上对应 flag 的 **1-indexed 出现顺序**。第一个 `--image` 是 `@image1`，第二个是 `@image2`，依此类推。**图片、视频、音频独立编号**——`--image` 的顺序不影响 `@videoN`。

```bash
dreamina multimodal2video \
  --prompt "Replace the character in @video1 with @image1, ending in the environment of @image2." \
  --image assets/image/hero.png         `# @image1` \
  --image assets/image/destination.png  `# @image2` \
  --video assets/video/dolly-shot.mp4   `# @video1` \
  --duration=8 --ratio=16:9 --model_version=seedance2.0 \
  --output assets/video/shot.mp4
```

未被 `@` 引用的 ref（你传了但 prompt 里从没提）会被几乎忽略——只对 mood/style 有微弱推力。**不要靠未寻址的 ref 装饰**——浪费槽位还不如不传。

## Role 词汇表

下表是模型能稳定识别的 directive pattern。在同一 prompt 里可以**叠加多个 role**——角色越精确，模型猜的越少。

| Role | 中文模式 | English pattern | 它做什么 |
|---|---|---|---|
| **角色身份** | "@image1 中的人物"、"用 @image1 替换 @video1 的角色" | `the character from @image1` / `replace the character in @video1 with @image1` | 锁定主体外观 |
| **首帧锚定** | "以 @image1 作为开场画面" | `with @image1 as the first frame` / `open on @image1` | 视频开场即匹配该 ref |
| **目的环境** | "进入 @image2 所示的环境"、"结束在 @image2 的场景" | `travel to the environment of @image2` / `ending in @image2` | 视频结束位置 |
| **中景设置** | "在 @image2 所示的位置"、"事件发生在 @image2 内" | `in the location shown in @image2` / `set inside @image2` | 全程发生在该环境 |
| **运镜传递** | "参考 @video1 的运镜节奏"、"匹配 @video1 的 blocking" | `refer to the camera movement of @video1` / `match the pacing of @video1` | 借用 dolly/tracking/handheld |
| **风格迁移** | "用 @image3 的视觉风格"、"调色像 @video1" | `in the visual style of @image3` / `color-grade like @video1` | 借色彩/质感，不抄内容 |
| **道具/服装** | "角色应戴 sci-fi 眼镜" | `the character should wear ...` | 增加细节，不需要 ref |
| **视角切换** | "从第三人称切到第一视角"、"近景环绕" | `from third-person to subjective POV` / `close-up surround shot` | 镜头语言 |
| **音频床** | "以 @audio1 作为背景音乐"、"用 @audio1 underscore" | `background music from @audio1` / `underscore with @audio1` | 当 BGM 用；常因输出音频审核被拒，详见"常见错误" |

## Worked example — 角色穿越科幻序列

**目标**：把一个特定角色放进飞船驾驶舱，借用一段参考视频的运镜，从第三人称切到主观视角，最终落在深空全景里。

```bash
dreamina multimodal2video \
  --prompt "Replace the character in @video1 with @image1, with @image1 as the first frame. The character should wear virtual sci-fi glasses. Refer to the camera movement and close-up surround shots of @video1, changing from a third-person perspective to the character's subjective perspective. Travel through the glasses and arrive at the deep blue universe of @image2, where several spaceships are seen traveling into the distance." \
  --image assets/image/hero.png         `# @image1: 角色身份 + 首帧锁定` \
  --image assets/image/space-vista.png  `# @image2: 目的地环境` \
  --video assets/video/dolly-shot.mp4   `# @video1: 运镜模板（替代冗长 camera prose）` \
  --duration=8 --ratio=16:9 --model_version=seedance2.0 \
  --output assets/video/hero-intro.mp4
```

每张 ref 做一件**互不重叠**的事：

| Ref | Role | 替代了什么 |
|---|---|---|
| `@image1` | 角色身份 + 首帧 | "一个戴眼镜的科技少年" 这类含糊描写 |
| `@image2` | 目的地环境 | "深蓝色宇宙、远处有飞船" 这类长描写 |
| `@video1` | 运镜模板 | "推镜、环绕、第三切第一人称" 这类 camera prose |

正因为各 role 不撞车，模型能**干净 follow**。如果你让两张 `@image` 都标成"角色"，输出会糊掉——见下文。

## 槽位预算

`multimodal2video` 接受：

| 类型 | 上限 | 备注 |
|---|---|---|
| `--image` | **9** | 1-indexed 为 `@image1..@image9` |
| `--video` | **3** | 1-indexed 为 `@video1..@video3` |
| `--audio` | **3** | 1-indexed 为 `@audio1..@audio3`，需要至少一个 image 或 video ref 才能用 |
| 总计 | **≤ 12** | 跨所有模态求和 |

槽位策划建议：

- **角色 ref（image）**：只要有特定人物出场就放一张。需要多角度（前/侧/背）才用多张同人物，否则一张就够。
- **视频 ref**：当**运镜/blocking/节奏**比"看"更重要时使用。一段 5 秒的运镜参考胜过三段 camera prose。
- **音频 ref**：稀有用。output-audio 分类器对生成视频的音轨经常打回（content-policy reject），默认安全调用是**不传 audio ref + 后期混音**。
- **不要塞装饰 ref**——任何 prompt 里不出现 `@N` 的 ref 都几乎是浪费。

## reference vs image2video vs text2video — 决策表

| 情境 | 命令 |
|---|---|
| 仅 prompt，从零生成 | `text2video` |
| 单张静图驱动 → 动起来 | `image2video` |
| 必须出现某个特定角色 | `multimodal2video` + 角色 `@image` |
| 在两个不同环境间转场 | `multimodal2video` + 目的地 `@image` |
| 借用其他片段的运镜语言 | `multimodal2video` + 运镜 `@video` |
| 首帧 + 末帧插值 | `frames2video` |

凡是有**多于一个**视觉意图需要钉死的，立刻切到 `multimodal2video` 并分配 role。**不要**指望"一张图 + 一长段 prose"能精确控制复杂调度——prose 的约束力远不如结构化 ref。

## 常见错误

- ❌ **把 reference 当 from-image 多塞图**：传 4 张参考却没在 prompt 里 `@` 引用任何一张——模型只把它们当微弱风格信号，浪费槽位。
- ❌ **两张 ref 抢同一个 role**：例如让 `@image1` 和 `@image2` 都当"角色"，模型在两套面孔间漂移，输出脸糊。一个 role 只许一张 ref。
- ❌ **指望 audio ref 总能成功**：output-audio 分类器对生成视频的音轨经常 reject（包括没什么风险的纯音乐）。默认走"不传 audio ref + 视频静音 + 后期 ffmpeg 混音"路径；audio ref 只在你愿意接受重试和降级时才用。
- ❌ **一张图同时承担"角色"和"目的地"两个 role**：例如让 `@image1` 既是"主角"又是"目的地的房间"——身份和环境耦合在一张图里，模型在"角色 vs 场景"间撕扯，结果不稳定。拆成两张专职 ref。
- ❌ **未寻址 ref + 期待 mood**：未被 `@` 引用的 ref 几乎被忽略。要它做事，就在 prompt 里明确点名。

## See also

- `capabilities/dreamina-mastery.md` — `multimodal2video` 完整命令矩阵、模型选型、ratio 规则
- `capabilities/character-consistency.md` — 真人角色 ref 的特殊处理（Phase 2.9 待补）
- `capabilities/filter-retries.md` — content-policy 拒绝（含 audio-output reject）的恢复路径（Phase 2.8 待补）
- `capabilities/structured-generation.md` — variant 模式自动注入 `--image-url` 的 envelope 协议
- `modules/assets/scripts/jimeng_generate.py` — 当前可用的 video 生成脚本（仅支持 first-frame / last-frame，不支持多 ref；多 ref 走 `dreamina` CLI）
- `skills/autoviral/SKILL.md` — Content-policy 重试模式与"默认静音 + 后期混音"约定
