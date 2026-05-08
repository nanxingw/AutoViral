---
name: autoviral-research
description: Use when the user wants references — viral patterns, competitor analysis, audience signals, hot topics on a specific platform. Do NOT use as a "first step"; if the user already has a brief, skip directly to planning or assets.
---

# Research Module

## 定位

这是**术**的层面：怎么采数据、怎么读数据、怎么从已有内容里提取结构化信息。

**创作判断（哪个方向值得做、哪条情感线合适）由 `taste/` 决定。** 本模块不产出创作结论，只产出可被下游模块使用的**事实**。

## 什么时候进这个模块

- 用户要了解某个话题/达人的真实数据
- 要分析某一条爆款视频的结构（镜头、节奏、文案）
- 要拉取平台实时热搜做参考素材
- 需要查看用户自己的账号数据与历史作品

**不进这个模块的场景**：用户已经有清晰方向 → 直接进 `planning/`；只需要生几张图 → 直接进 `assets/`。

## 可用工具

### 趋势采集脚本（按需调用，不强制）

> 这些脚本是**可选采集工具**——只有用户明确需要某个平台当下话题/数据时才调，本身不带平台偏见。**不要**主动用某平台数据反推创作方向；创作方向永远从 `taste/` 出发。

```bash
# 单平台实时热搜（按平台脚本封装）
python3 scripts/douyin_hot_search.py --limit 20 --output trends.json

# newsnow 多平台聚合（抖音 / 微博 / 知乎 / B 站等）
python3 scripts/newsnow_trends.py --platforms douyin,weibo --limit 30
```

### 达人数据采集

```bash
# 详见 capabilities/creator-analytics.md
python3 scripts/creator-analytics/collect.py --username <douyin_uid>
```

### 视频理解（已有视频结构化分析）

```bash
# 详见 capabilities/video-understanding.md
python3 scripts/video-understanding/analyze_video.py <video_url_or_path>
# 输出：镜头切点、文案 OCR、音乐识别、节奏曲线
```

## 可用 API 端点

这些 endpoint 由 AutoViral 本地服务提供，调用失败就跳过（不阻断流程）：

```bash
# 用户自己的账号数据
curl http://localhost:${port}/api/analytics/creator

# 用户历史作品记忆（语义搜索）
curl "http://localhost:${port}/api/memory/search?q=关键词&method=hybrid&topK=5"

# 用户创作风格档案
curl http://localhost:${port}/api/memory/profile

# 共享素材库
curl http://localhost:${port}/api/shared-assets

# Explore 页面已经缓存的趋势数据（Pipeline 研究可复用，避免重复调研）
curl http://localhost:${port}/api/trends/douyin
curl http://localhost:${port}/api/trends/xiaohongshu

# 当前作品上下文
curl http://localhost:${port}/api/works/{workId}
curl http://localhost:${port}/api/memory/context/{workId}
```

## 平台参考资料

平台**技术规格**（宽高比 / 编码 / 时长 / 安全区）统一查 `../assembly/references/platform-specs.md`——这是 frontend `PlatformPresetSection.tsx` 的同源真值表，不混任何创作建议。

历史上这里曾有过 `references/{douyin,xiaohongshu}.md`，里面混入了"3 秒定律 / 钩子模板 / 标签金字塔"之类的**创作 SOP**——这跟 `taste/00-prime-directive.md` 的第一原则**直接冲突**，已于 2026-05-08 删除。所有创作判断只走 `taste/`。

## 输出结构（给下游模块用）

Research 完成后，产出一份结构化事实清单。**不要产出"推荐方向"这种创作判断**——把原料给下游，让 `planning/` 在读过 `taste/` 之后做判断。

```markdown
# Research Facts — {topic}

## 平台数据
- 热度指标（播放量、互动、增长率）
- 头部作品样本（5-10 条，含链接/描述/数据）

## 头部作品结构解构
对每个样本：
- 钩子（前 3 秒画面/文案）
- 主体结构（镜头数、主要切点位置）
- Payoff 位置
- 音乐/节奏
- 视觉风格关键词
- 文字叠加策略

## 可复用素材线索
- 相似场景的公开素材
- 可借鉴的镜头语言
- 可借鉴的剪辑节奏

## 用户账号上下文
- 粉丝量级
- 历史作品风格
- 已验证效果好的方向
```

## Capabilities（扩展能力）

按需阅读：

- `capabilities/creator-analytics.md` — 达人数据采集的详细接入与字段说明
- `capabilities/video-understanding.md` — 视频抽帧、OCR、音频指纹的详细用法

## 与 taste/ 的边界

| 属于这里（术） | 属于 taste/（道） |
|---|---|
| "这条视频平均镜头 1.8 秒" | "这个情感意图应该用什么节奏" |
| "头部话题包含 X、Y、Z 标签" | "这个话题值不值得做" |
| "这条视频 payoff 在第 11 秒" | "我们的 payoff 应该在哪" |
| "竞品用了低机位 + push-in" | "我们该用什么机位" |

越界 = 错位。发现自己在本模块里做 taste 判断 → 停下，把问题交给 `taste/` 再返。

## 交互准则

1. **不要捏造数据**。搜不到就说搜不到。
2. **具体 > 泛泛**。"美食视频很火"是废话；"一人食 + 打工人午餐 近 30 天日均播放同比 +180%"是 research。
3. **小创作者视角**。不要推荐"先涨粉到 10W 再考虑"这种闭环建议——推测用户量级后给可执行路径。
4. **时效性**。搜索 query 里始终带当前年月。
