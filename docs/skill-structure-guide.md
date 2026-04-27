# Skill 结构规范（v2 — 统一模型）

本文档定义 `skills/` 目录的组织规则。整个 AutoViral 的创作能力封装为**一个** skill，作为正交能力词典而非顺序流程。

---

## 核心原则

1. **单一 skill 模型**：所有创作能力都在 `skills/autoviral/` 下
2. **taste 是灵魂，modules 是术**：taste 负责品味与判断，modules 负责工具与机制
3. **任意起点**：用户可从任意 module 切入，不强制流程顺序
4. **内容 > 平台**：平台只作为技术约束存在，不进 taste 作为创作建议
5. **evaluator 已融入 taste**：最终评审 = `taste/06-rubric.md` 对照执行

---

## 目录结构

```
skills/autoviral/
  SKILL.md                         # 主入口（prime directive 引用 + 模块地图 + 任意起点原则）
  taste/                           # 品味与判断。内化读物，非查询
    00-prime-directive.md          # 内容 > 平台 宣言
    01-emotional-storytelling.md   # 叙事与情感弧
    02-visual-grammar.md           # 镜头 / 机位 / 运动 / 构图
    03-rhythm-and-editing.md       # 剪辑节奏 / Kuleshov / Murch 六原则
    04-design-and-text.md          # 视觉层级 / 排版 / 色彩
    05-creative-schema.md          # 情感意图 → 生产参数决策 schema
    06-rubric.md                   # 最终评审标尺（8 维度，1-5 分）
    evaluator-criteria/            # 各模块补充的评审细则（由 /api/works/:id/rubric/:module 按需读取）
      research.md  plan.md  assets.md  assembly.md
  modules/                         # 正交能力（research/planning/assets/assembly），任意起点切入
    research/
      SKILL.md                     # 本模块入口
      scripts/                     # 可执行脚本
      capabilities/                # 扩展能力文档（按需加载）
      references/                  # 平台技术规格（忽略其中的创作建议）
      genres/                      # 历史遗留，如仍有价值保留
    planning/
      SKILL.md
      capabilities/                # 扩展能力
      references/                  # 平台技术规格
      genres/                      # 历史遗留
    assets/
      SKILL.md
      scripts/                     # openrouter / jimeng / music / poster / font_manager
      capabilities/                # dreamina-mastery / prompt-mastery / quality-gate / fallback-strategy / ...
      references/  genres/  templates/
    assembly/
      SKILL.md
      scripts/                     # ffmpeg 片段 / subtitle_burn / caption_generate / beat-sync/
      capabilities/                # pro-captions / audio-mixing / color-grading / ...
      references/  genres/
  references/
    module-contracts.md            # 模块间输入输出契约
```

---

## 扩展规则

### 添加新的生成工具 / 脚本

放到对应 module 的 `scripts/`：
- 生图/视频/音乐/海报 → `modules/assets/scripts/`
- 剪辑/字幕/混音/调色 → `modules/assembly/scripts/`
- 数据采集 / 爬虫 / 视频解构 → `modules/research/scripts/`

脚本本身的使用方法**可以**简短写在该 module 的 `SKILL.md` 里；复杂用法写成独立 `capabilities/<name>.md`。

### 添加新的扩展能力文档

放 `capabilities/<name>.md`，然后在对应 module 的 `SKILL.md` 底部 "Capabilities 索引" 列表里加一行。

**不要**新建 module 顶层目录。只能在 research / planning / assets / assembly 四个之一下扩展。

### 添加新的平台技术规格

放 `modules/<相关 module>/references/<platform>.md`。**只写技术规格**（aspect ratio / duration / encoding / API / safe zone），**不写创作建议**（"XX 平台喜欢..."）。创作建议的位置在 `taste/`。

### 添加新的 taste 内容

谨慎。taste 是稳定的品味根，不是更新日志。新增 taste 文件需要满足：

- **普世**：不绑定任何平台或潮流
- **可内化**：能被 agent 作为默认语言使用，不是每次查询
- **有操作指向**：能被 creative schema 引用或产生自检清单

---

## SKILL.md 编写规范

### frontmatter

```yaml
---
name: <skill-or-module-name>
description: <一行描述，用于 agent 判断何时展开>
---
```

### 主 SKILL.md 应包含

- 入口宣言（一句话定位）
- 必读起手（指向 taste/00, 05, 06）
- 模块地图（是能力列表，不是顺序流程）
- 任意起点原则（举例）
- 工具入口（scripts 简表）
- 服务端交互（常用 API endpoint）
- 禁止项与自检

### 模块 SKILL.md 应包含

- 定位（本模块的边界 + 哪些判断不属于这里）
- 什么时候进 / 什么时候跳过
- 工具矩阵（脚本 / 命令 / API）
- 输入输出契约（引用 `references/module-contracts.md`）
- Capabilities 索引
- 与 `taste/` 的边界（哪些是术，哪些属于品味）
- 自检清单

### SKILL.md **不应**包含

- 特定平台的**创作建议**（只写技术规格）
- 复制 taste 里已有的内容（应该引用，不是复述）
- 把 modules 描述成必须按顺序走的流程框架

---

## 命名约定

| 类型 | 规则 | 示例 |
|---|---|---|
| Module 目录 | 英文短单词 | `research` / `planning` / `assets` / `assembly` |
| Capability 文件 | `capabilities/<name>.md`，连字符分隔 | `capabilities/prompt-mastery.md` |
| Script 目录 | `scripts/<name>/` 或单文件 `scripts/<name>.py` | `scripts/beat-sync/` |
| Reference 文件 | `references/<platform>.md` | `references/douyin.md` |
| Taste 文件 | `NN-<slug>.md`（按 00-06 编号） | `taste/02-visual-grammar.md` |

---

## 历史结构清理

v1 的 4+1 模型（trend-research / content-planning / asset-generation / content-assembly / content-evaluator 五个并列 skill）已全部合并进 `skills/autoviral/`：

- 旧 `trend-research/` → `autoviral/modules/research/`
- 旧 `content-planning/` → `autoviral/modules/planning/`
- 旧 `asset-generation/` → `autoviral/modules/assets/`
- 旧 `content-assembly/` → `autoviral/modules/assembly/`
- 旧 `content-evaluator/` → **吸收进 `autoviral/taste/06-rubric.md`**；原 criteria/ 文件作为各模块评审细则保留在 `autoviral/taste/evaluator-criteria/`

各 module 原先的 `modules/` 子目录已重命名为 `capabilities/`，避免与新结构的 `autoviral/modules/` 嵌套混淆。

原 `short-video-guide/` 7 份品味资料已全部重写（剥离平台建议、统一语气）并吸收进 `autoviral/taste/`。
