---
name: autoviral-planning
description: Use when the user wants a brief, shot list, layout plan, or wants you to translate an emotional intent into something executable. Do NOT use when the user already has a brief and just wants generation — go to assets directly. Do NOT use when the user only wants references — research is the right call.
---

# Planning Module

## 定位

本模块做**翻译**：

```
用户想要的情感 + 事实素材  →  下游模块可以直接生产的结构化 brief
```

**这里不讨论"某平台喜欢什么"**——参见 `taste/00-prime-directive.md`。所有"镜头该用什么大小"、"节奏该多快"这类决定，**完全依赖 `taste/` 的 schema 与原则**。planning 只是把 taste 的决定落成一份表格式的、可供 `assets/` 和 `assembly/` 直接执行的 brief。

## 什么时候进这个模块

- 用户已有情感意图或模糊想法，需要落成具体执行表
- 上游 `research/` 已出事实清单，需要转为 brief
- 用户跳过 research 但提供了素材/想法

**不进这个模块的场景**：用户只要单张图、单段视频 → 直接 `assets/`；用户只要评审已有成片 → 直接用 `taste/06-rubric.md`。

## Brief 的核心字段

每一份 brief 必须能回答这些问题。填不出的字段 = 创作决策还没做完。

```json
{
  "work_type": "short_video | image_text_carousel | single_poster",
  "format_spec": {
    "aspect_ratio": "9:16 | 1:1 | 16:9 | 3:4",
    "duration_sec": <数字或段区间>,
    "max_size_mb": <可选；用于压缩约束>,
    "safe_zone_pct": <可选；底部安全区占比，如 0.18>
  },
  "creative_schema": {
    "emotional_intent": "<单一情感词，参 taste/01 词表>",
    "creative_goal": "<参 taste/05 枚举>",
    "hook_type": "<参 taste/05 枚举>",
    "arc_type": "<参 taste/05 枚举>"
  },
  "narrative_outline": {
    "hook_beat": "前 3 秒画面 + 文案",
    "context_beat": "语境建立方式",
    "escalation": "主体如何发展",
    "payoff": "高潮瞬间的具体描述",
    "landing": "收尾方式"
  }
}
```

Brief 写完后第一件事：**对着 `taste/06-rubric.md` 自检**。预判这个 brief 执行出来能过几分。低于 3.5 就重想，不交付。

## 按工作类型展开

### short-video（短视频）

Brief 除核心字段外，补充**镜头表**：

```markdown
| # | 时长 | 镜头大小 | 机位 | 运动 | 画面描述 | 文字叠加 | 音乐 |
|---|------|---------|------|------|---------|---------|------|
| 1 | 0-3s | 特写    | 低角 | 缓推 | ...     | ...     | ... |
| 2 | 3-7s | ...     | ...  | ...  | ...     | ...     | ... |
```

**每一个镜头字段必须从 taste/02-visual-grammar 的情感映射表来。** 不要凭感觉填。

文案骨架（口播 / 字幕）：

- 钩子句（前 3 秒）
- 主体 3-5 句
- 落点句（不用机械 CTA）

### image-text（图文卡片）

Brief 补充**每张图的结构**：

```markdown
| # | 图片类型 | 尺寸 | 主体 | 构图 | 文字内容 | 视觉风格 |
|---|---------|------|------|------|---------|---------|
| 1 | 封面     | 3:4  | ...  | ...  | 主标题   | ...     |
| 2 | 正文-1   | 3:4  | ...  | ...  | 要点     | ...     |
```

所有视觉风格字段对齐 `taste/02` 与 `taste/04` 的术语。**不要**用"国风"、"赛博"这种一词多义的风格标签，更**不要**用"小红书风"、"抖音感"这种平台集体人格——用具体的视觉语法描述（"对称构图 + 低饱和中性色 + 衬线字体"）。

### single-poster（单图海报）

最小 brief：

- 一句话核心信息
- 主焦点 / 次焦点 / 尾焦点 明确指定
- 尺寸 + 平台 + 配色主方向

具体设计原则全部由 `taste/04-design-and-text.md` 决定。

## 获取上下文

开工前必读的本地状态（失败跳过）：

```bash
curl http://localhost:${port}/api/works/{workId}
curl http://localhost:${port}/api/memory/profile
curl http://localhost:${port}/api/memory/search?q=相关主题&method=hybrid&topK=5
curl http://localhost:${port}/api/shared-assets
curl http://localhost:${port}/api/analytics/creator
```

这些数据用来做**个性化调整**（用户风格偏好、粉丝量级、可用素材），不用来做创作判断。

## 输出保存

Brief 完成后：

```bash
# 保存为结构化资产
curl -X POST http://localhost:${port}/api/works/{workId}/assets \
  -H "Content-Type: application/json" \
  -d '{"type": "brief", "content": <brief_json>}'
```

## Capabilities（扩展能力）

- `capabilities/` 下按需加载（保留原有能力文档）
- 平台技术规格（封面比例、安全区、时长上限等）统一查 `../assembly/references/platform-specs.md`——这是工具约束，不是创作判断

## 与其他模块的边界

| 属于这里 | 属于上游 `research/` | 属于下游 `assets/` `assembly/` |
|---|---|---|
| 镜头表 / 图文结构 | 事实数据 / 已有作品解构 | 实际生成 / 剪辑 |
| 文案骨架 | 用户账号背景 | 文案具体措辞打磨（可 loop 回 planning） |
| 视觉风格描述（用 taste 术语） | 竞品视觉参考图收集 | prompt 落地、风格控制参数 |

## 自检

brief 提交前：

- [ ] 每个字段都有值，没有 TODO / TBD
- [ ] 情感意图是**一个**词，不是模糊短语
- [ ] 镜头/图片每一个元素都能说出为什么是它（对照 taste/05 决策 schema）
- [ ] 想象自己直接拿 brief 去执行，会不会卡在"这里没说清"
- [ ] 对着 `taste/06-rubric.md` 预评，总分不低于 28
