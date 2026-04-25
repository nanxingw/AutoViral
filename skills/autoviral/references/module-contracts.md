# Module Contracts

四个模块之间的**输入输出契约**。实际工作中用户可以跳过任何一步，但只要走一个模块，它对输入/输出的约定就是这份表。

---

## `modules/research/`

**输入（可选任一）**：
- 话题关键词 / 品类
- 目标达人 ID 或 URL
- 要解构的视频 URL
- 目标平台（抖音 / 小红书 / 两者）

**输出（结构化事实清单）**：
```json
{
  "topic": "...",
  "platform_data": { "hot_score": 8, "engagement": {...}, "growth_30d": "+120%" },
  "top_samples": [
    { "url":"...", "hook":"...", "arc":"...", "payoff_timestamp_sec": 11, "shot_count": 14, "avg_shot_sec": 1.8 }
  ],
  "visual_patterns": ["low angle", "push-in + match cut", "high-saturation warm palette"],
  "user_context": { "follower_band": "1K-10K", "style_history": ["..."] }
}
```

**下游可直接吃**：`planning/` 读 `top_samples` + `visual_patterns` 作为参考。

---

## `modules/planning/`

**输入**：
- 情感意图（单词，必填；参 `taste/05`）
- 格式（aspect_ratio, duration, target_platforms）
- Research 输出（可选）
- 用户画像 + 记忆（从 API 自动拉取）

**输出（brief JSON）**：
```json
{
  "work_type": "short_video | image_text_carousel | single_poster",
  "format_spec": { "aspect_ratio": "9:16", "duration_sec": 22, "target_platforms": ["抖音"] },
  "creative_schema": {
    "emotional_intent": "curiosity",
    "creative_goal": "stop_scroll",
    "hook_type": "counter_intuitive",
    "arc_type": "reversal"
  },
  "narrative_outline": {
    "hook_beat": "...",
    "context_beat": "...",
    "escalation": "...",
    "payoff": "...",
    "landing": "..."
  },
  "shot_list": [
    { "idx":1, "duration_sec":2.5, "shot_size":"close_up", "angle":"low", "movement":"slow_push",
      "composition":"negative_space", "visual_desc":"...", "text_overlay":"...", "audio":"..." }
  ],
  "text_script": { "hook": "...", "body": ["..."], "landing": "..." }
}
```

**下游可直接吃**：`assets/` 读 `shot_list` 每一条生图/生视频；`assembly/` 读 `shot_list` + `text_script` 拼片。

---

## `modules/assets/`

**输入**：
- brief 的单个 shot（或完整 shot_list）
- 或直接的视觉描述 + 格式参数

**输出**：
```json
{
  "assets": [
    { "role": "shot_1_frame", "path": "work-123/assets/shot_1.png", "mime": "image/png", "seed": 42, "prompt": "..." },
    { "role": "shot_1_clip",  "path": "work-123/assets/shot_1.mp4", "mime": "video/mp4", "duration_sec": 3.2 },
    { "role": "bgm",          "path": "work-123/assets/bgm.mp3",   "mime": "audio/mpeg", "duration_sec": 65 }
  ]
}
```

每个资产都记录：生成参数（prompt, seed, model）、对应的 brief shot idx、通过质量门槛的评分。

**下游可直接吃**：`assembly/` 读 `assets[]` 按 `role` 装配。

---

## `modules/assembly/`

**输入**：
- `brief` (shot_list + text_script)
- `assets` 列表

**输出**：
```json
{
  "final_video": {
    "path": "work-123/outputs/final.mp4",
    "duration_sec": 22.4,
    "resolution": "1080x1920",
    "codec": "h264",
    "bitrate_kbps": 8000,
    "safe_zone_ok": true,
    "subtitle_burned": true
  },
  "rubric_self_score": { "total": 32, "breakdown": { "hook":4, "emotion":4, "narrative":4, "visual":4, "rhythm":4, "design":4, "audio":4, "shareability":4 } }
}
```

---

## 跳步与降级

**跳过上游**是合法的，但跳过必须补足上游输出的**最小必要信息**：

| 跳过 | 必须提供 |
|---|---|
| 跳过 research | 用户已有明确方向 + 情感意图 |
| 跳过 planning | 已有完整 brief 或 shot 级描述 |
| 跳过 assets | 已有可用素材文件 |
| 跳过 assembly | 仅需素材不需成片 |

**跳步后发现信息不够** → 回到缺失的上游模块补足。不要在当前模块里硬撑。

---

## 契约违反示例

- ❌ `research/` 输出"推荐做 X 方向" — 这是创作判断，不是事实。应该输出事实让 `planning/` + `taste/` 判断。
- ❌ `planning/` 输出没有 `emotional_intent` 的 brief — 缺失核心字段，下游没法对齐。
- ❌ `assets/` 输出没有 seed / prompt 记录 — 不可复现，也无法根据反馈微调。
- ❌ `assembly/` 输出未对照 rubric 打分就交付 — 违反质量门槛。
