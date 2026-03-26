# Skill 结构规范

本文档定义了 `skills/` 目录的组织规则。所有 skill 的新增、修改和扩展都必须遵循本规范。

---

## 核心原则

1. **4+1 Skill 模型**：4 个创作 skill 与 pipeline 一一对应，加 1 个跨阶段评审 skill
2. **SKILL.md 只包含通用方法论**：不在 SKILL.md 中写垂类专项内容
3. **垂类知识通过 genres/ 按需加载**：每种内容类型一个文件
4. **新能力通过 modules/ 插入**：不膨胀主文件
5. **平台规范在 references/ 中维护**：每个平台一个文件

---

## 目录结构

```
skills/
  <skill-name>/                    # 与 pipeline 步骤对应
    SKILL.md                       # 通用方法论（必须）
    references/                    # 平台规范（按需）
      douyin.md
      xiaohongshu.md
    scripts/                       # 脚本工具（按需）
    genres/                        # 垂类专项指南（按需）
      comedy.md
      food.md
      education.md
      ...
    modules/                       # 可插拔能力模块（按需）
      creator-analytics.md
      video-understanding.md
      ...
```

---

## 4+1 个 Skill

### 4 个创作 Skill（与 Pipeline 一一对应）

| Skill 目录 | Pipeline 步骤 | 职责 |
|------------|--------------|------|
| `trend-research` | Research（调研） | 趋势调研、选题发现、竞品分析 |
| `content-planning` | Plan（策划） | 分镜脚本、内容结构、创意策划 |
| `asset-generation` | Assets（素材） | 图片/视频生成、提示词工程 |
| `content-assembly` | Assembly（合成） | 剪辑、字幕、配乐、最终输出 |

### 1 个跨阶段评审 Skill

| Skill 目录 | 类型 | 职责 |
|------------|------|------|
| `content-evaluator` | 跨阶段质量门禁 | 对各阶段产出进行结构化评审，输出评分与改进建议 |

`content-evaluator` 不对应任何 pipeline 步骤，而是作为 quality gate 横跨所有阶段，可在任意步骤的产出上运行。

**不允许在 `skills/` 下新建第 6 个顶层目录。** 除上述 4+1 个 skill 外，所有新能力都必须归入已有 skill 之一。

---

## 扩展规则

### 规则一：新增内容垂类（Genre）

当需要支持新的内容类型（如美食、教育、情感、旅行等）时：

1. 在**每个** skill 的 `genres/` 下创建 `<genre-name>.md`
2. 文件名使用英文小写，用连字符分隔：`comedy.md`、`food.md`、`pet-life.md`
3. 每个文件只包含**该阶段**的专项指导，不要重复通用内容
4. 文件开头用一句话说明本文档的用途和覆盖范围

**内容拆分原则**：

| 阶段 | 垂类文件应包含 |
|------|--------------|
| research | 该品类的爆款模式识别、选题评估标准、调研关注点 |
| plan | 该品类的结构公式、Hook 设计、台词/文案规则、自检清单 |
| assets | 该品类的视觉风格、色调策略、构图规则、提示词调整 |
| assembly | 该品类的剪辑节奏、BGM 策略、音效使用、转场规则 |

**不需要为每个 genre 都创建全部 4 个文件**。如果某个 genre 在某个阶段没有特殊规则（与通用方法论一致），就不创建对应文件。

### 规则二：新增能力模块（Module）

当需要添加新能力（如视频理解、配乐生成、自动字幕等）时：

1. 确定该能力**主要服务于哪个 pipeline 阶段**
2. 在对应 skill 的 `modules/` 下创建 `<capability-name>.md`
3. 如果需要脚本，在该 skill 的 `scripts/<capability-name>/` 下放置
4. 文件名使用英文小写，用连字符分隔

**能力归属参考**：

| 能力 | 归属 Skill | 原因 |
|------|-----------|------|
| 达人数据采集 | trend-research | 数据采集是调研的一部分 |
| 视频理解/分析 | trend-research | 理解已有视频是调研的输入 |
| 配乐生成 | content-assembly | 配乐是后期制作的一部分 |
| 自动字幕 | content-assembly | 字幕是后期制作的一部分 |
| AI 配音/TTS | asset-generation | 音频素材是素材生成的一部分 |
| 封面设计 | asset-generation | 封面图是视觉素材 |

**如果一个能力横跨多个阶段**，在主要阶段放完整模块，在其他阶段的 SKILL.md 或 genres/ 文件中引用即可。

### 规则三：新增平台支持

当需要支持新平台（如 B站、视频号、快手等）时：

1. 在**每个** skill 的 `references/` 下创建 `<platform>.md`
2. 文件名使用英文小写：`bilibili.md`、`wechat-channels.md`
3. 包含该平台在该阶段的特定规范（算法规则、尺寸规格、编码要求、发布模板等）

---

## SKILL.md 编写规范

### 必须包含的段落

每个 SKILL.md 末尾必须包含以下两段动态加载指令：

```markdown
## 垂类专项指南

执行前检查 `genres/` 目录。如果当前作品的内容类型有对应的 `genres/<type>.md` 文件，
**必须读取并遵循其中的专项规则**——它们覆盖本文件中的通用指导。

## 扩展能力模块

检查 `modules/` 目录，根据当前任务需要加载相关能力模块。
```

### SKILL.md 不应包含

- 特定内容垂类的专项规则（应放在 `genres/` 中）
- 可插拔能力的详细说明（应放在 `modules/` 中）
- 其他 skill 的职责范围内的内容

### frontmatter 格式

```yaml
---
name: <skill-name>
description: <一行描述，用于触发匹配>
---
```

---

## 文件命名约定

| 类型 | 命名规则 | 示例 |
|------|---------|------|
| Skill 目录 | 英文小写，连字符分隔 | `trend-research` |
| Genre 文件 | `genres/<name>.md`，英文小写 | `genres/comedy.md` |
| Module 文件 | `modules/<name>.md`，英文小写 | `modules/creator-analytics.md` |
| Reference 文件 | `references/<platform>.md` | `references/douyin.md` |
| Script 目录 | `scripts/<name>/` | `scripts/creator-analytics/` |

---

## 当前结构快照

```
skills/
  trend-research/
    SKILL.md
    references/douyin.md, xiaohongshu.md
    scripts/douyin_hot_search.py, newsnow_trends.py, creator-analytics/
    genres/comedy.md
    modules/creator-analytics.md
  content-planning/
    SKILL.md
    references/douyin.md, xiaohongshu.md
    genres/comedy.md
    modules/
  asset-generation/
    SKILL.md
    references/douyin.md, xiaohongshu.md
    scripts/jimeng_generate.py, openrouter_generate.py, check_providers.py
    genres/comedy.md
    modules/
  content-assembly/
    SKILL.md
    references/douyin.md, xiaohongshu.md
    genres/comedy.md
    modules/
  content-evaluator/              # 跨阶段评审 skill
    SKILL.md
    modules/
```
