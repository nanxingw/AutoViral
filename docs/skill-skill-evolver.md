# Skill-Evolver Skill 工作原理详解

本文档详细阐述 `skill-evolver` 这个 meta-skill 的完整工作原理，包括其双重定位、经验积累机制、需求驱动的 skill 创建流程、以及与 skill-creator 和 task-planner 的协同关系。

---

## 目录

1. [概述](#1-概述)
2. [三大经验类型](#2-三大经验类型)
3. [需求驱动工作流](#3-需求驱动工作流)
4. [Skill 创建流程](#4-skill-创建流程)
5. [Skill 进化流程](#5-skill-进化流程)
6. [skill_needs.yaml — Task 到 Skill 的桥梁](#6-skill_needsyaml--task-到-skill-的桥梁)
7. [权限边界](#7-权限边界)
8. [经验维护](#8-经验维护)
9. [运行时用途](#9-运行时用途)
10. [进化时用途](#10-进化时用途)
11. [与 skill-creator 的集成](#11-与-skill-creator-的集成)
12. [与 task-planner 的协同](#12-与-task-planner-的协同)

---

## 1. 概述

### 定位：技术经验知识库 + 需求驱动的 Skill 工厂

`skill-evolver` 是 skill-evolver 系统安装的两个 meta-skill 之一（另一个是 `user-context`），安装位置为 `~/.claude/skills/skill-evolver/`。它承担两个核心职责：

**职责一：技术经验知识库**
持续从 Claude Code 的历史会话中提取成功模式、失败教训和实用技巧，以结构化 YAML 格式存储在 `tmp/` 目录下。这些经验在日常工作中为 Claude 提供决策参考——避免已知的坑，复用验证过的方案。

**职责二：需求驱动的 Skill 工厂**
在后台进化周期中，Skill Agent 主动从多个来源发现用户的未满足需求，然后搜索外部已有 skill 或使用 skill-creator 方法论从零创建新 skill。这不是被动等待经验积累到阈值的过程，而是主动寻找并填补能力缺口。

### 文件结构

```
~/.claude/skills/skill-evolver/
  SKILL.md                              # 路由文件：描述 + 数据位置 + 场景入口
  reference/
    permitted_skills.md                  # 已注册的可修改 skill 列表
    runtime_guide.md                     # 运行时使用指南
    evolution_guide.md                   # 进化周期完整操作手册
  tmp/                                   # 积累中的经验数据
    success_experience.yaml              # 成功经验
    failure_experience.yaml              # 失败经验
    useful_tips.yaml                     # 实用技巧
    skill_needs.yaml                     # Task 执行中产生的 skill 需求信号
```

### 设计理念：路由模式（Router Pattern）

SKILL.md 本身只是一个轻量级路由器（约 60 行），包含 YAML frontmatter 元数据、数据位置一览表、以及两个场景的入口指引。详细的操作手册分别放在 `reference/runtime_guide.md`（运行时）和 `reference/evolution_guide.md`（进化时）。

这种设计的核心优势：在普通 Claude Code 会话中，Claude 只需加载 SKILL.md 的描述和路由信息（约 100 词），不会把长达 200+ 行的进化操作手册也加载到上下文中。只有在进化周期中，Skill Agent 才会按指引读取完整的 evolution_guide.md。

---

## 2. 三大经验类型

### 2.1 成功经验（success_experience.yaml）

记录在过去会话中**被验证有效**的方法、模式和架构决策。

**典型内容举例**（来自实际数据）：

| 经验 | 信号次数 | 时间跨度 |
|------|----------|----------|
| 使用多 Agent 团队（researcher/architect/implementer）并行执行复杂任务 | 8 | 2026-02-24 ~ 03-07 |
| 实现 checkpoint/resume 防止长时间运行的 eval 丢失工作 | 7 | 2026-03-07 ~ 03-09 |
| 使用 /loop 结合结构化监控提示实现自主实验看护 | 6 | 2026-03-08 ~ 03-09 |
| 使用 Playwright 做自动化 E2E 视觉测试 | 4 | 2026-02-11 ~ 03-04 |
| 先写设计文档、迭代用户反馈后再实现 | 2 | 2026-03-06 ~ 03-07 |

**数据价值**：`times_seen` 越高、时间跨度越大的条目越可靠。当一个成功模式被 3+ 个不同会话在 2+ 天内验证时，它是 skill 化的强候选。

### 2.2 失败经验（failure_experience.yaml）

记录导致问题或失败的方法，是"反面教材"。

**典型内容举例**：

| 失败模式 | 信号次数 |
|----------|----------|
| httpx AsyncClient 没有设置连接级超时，导致 TCP 僵尸连接无法断开 | 8 |
| 每次实验运行创建一个新的 Qdrant collection 导致无限增长 | 2 |
| Agent 没有明确的路径边界约束，修改了不应该碰的项目源码目录 | 1 |
| 在 .mjs 文件中使用 TypeScript 语法导致运行时错误 | 1 |

**数据价值**：即使只有 1 次信号的失败经验也有价值——因为犯一次错就够了。失败经验的主要作用是在运行时防止 Claude 重蹈覆辙。信号次数多的失败模式是创建"预防性 skill"的强候选。

### 2.3 实用技巧（useful_tips.yaml）

记录非显而易见的快捷方式、变通方法和技术。

**典型内容举例**：

| 技巧 | 信号次数 |
|------|----------|
| 进程退化时杀掉重启（从 checkpoint 恢复）通常能恢复原始速度 | 6 |
| Node.js readline 处理 224MB JSONL 只需 ~1 秒 | 1 |
| npm 需要 Security Key 2FA 时用 Granular Access Token 绕过 | 1 |
| AI Agent 有延迟加载工具时，在提示中强制要求 read_skill() 为第一步 | 2 |
| 写文档规则用"prefer X"而非"never do Y" | 1 |

### YAML Schema

三个文件共享相同的 schema：

```yaml
entries:
  - content: "经验的一句话描述"        # 核心内容
    signals:                            # 证据列表
      - session: "会话ID前8位"
        date: "YYYY-MM-DD"
        detail: "具体发生了什么"
    first_seen: "YYYY-MM-DD"            # 首次观察日期
    last_seen: "YYYY-MM-DD"             # 最近观察日期
    times_seen: N                       # 信号总数
    applicable_to: ["标签1", "标签2"]   # 适用技术领域
```

字段设计的考量：
- `content` 是经验的本体，一句话概括，便于快速扫描
- `signals` 提供可追溯性——每一条经验都有具体的会话 ID 和细节佐证
- `first_seen` / `last_seen` + `times_seen` 构成时效性三元组：快速判断经验的可靠程度和新鲜度
- `applicable_to` 标签数组支持按技术栈过滤，避免把 Python 经验应用到 Node.js 场景

---

## 3. 需求驱动工作流

Skill Agent 在每个进化周期中的第一步（也是最重要的一步）是**需求发现**。它从 6 个来源识别用户的未满足需求，每个周期至少需要识别 3 个需求。

### Source A — 用户目标（User Objectives）

**数据路径**：`~/.claude/skills/user-context/context/objective.yaml`

对用户 context 中记录的每一个目标，Skill Agent 会问："什么样的 skill 能帮用户更高效地实现这个目标？"

例如：如果用户的目标是"构建生产级评测系统"，可能需要一个 `eval-pipeline-patterns` skill。

### Source B — 用户偏好（User Preferences）

**数据路径**：`~/.claude/skills/user-context/context/preference.yaml`

分析用户偏好是否暗示了一个可以标准化的工作流。

例如：如果用户偏好"所有 Python 项目使用 uv 而非 pip"，可以创建一个 `uv-workflow` skill。

### Source C — 积累的经验（Accumulated Experience）

**数据路径**：`~/.claude/skills/skill-evolver/tmp/*.yaml`

- 成功模式信号 3+ 次 → skill 化强候选
- 失败模式反复出现 → 预防性 skill 候选
- 广泛适用的技巧 → 编纂为 skill

这是经验从"决策参考"升级为"独立 skill"的通道。

### Source D — 会话日志（Session Logs）

**数据路径**：`~/.claude/projects/`（JSONL 格式）
**查询工具**：`~/.claude/skills/user-context/scripts/` 下的 5 个脚本

Skill Agent 使用脚本扫描近期会话，寻找：
- 用户反复手动执行的操作 → 自动化为 skill
- 用户反复向 Claude 解释的内容 → 应该写入 skill
- 反复出现的困难或摩擦点 → skill 可以提供预置方案

### Source E — Task 执行模式（Task Execution Patterns）

**数据路径**：
- `~/.skill-evolver/tasks/tasks.yaml`（任务清单）
- `~/.skill-evolver/tasks/*/reports/`（任务执行报告）

这是 task 系统和 skill 系统的协同进化接口（详见第 12 节）。Skill Agent 会：
- 浏览任务清单和执行报告
- 发现反复失败的任务 → 一个 skill 可能能预防该失败模式
- 发现 Agent 不得不临场发挥的任务 → 将那些知识编纂为 skill
- 发现多个任务共享相似模式 → 提取为通用 skill
- 检查 `tags: ["skill-building"]` 的已完成任务 → 验证目标 skill 是否已创建

### Source F — Skill 需求信号（Skill-Need Signals）[最高优先级]

**数据路径**：`~/.claude/skills/skill-evolver/tmp/skill_needs.yaml`

这是最高优先级的需求来源。当 task 执行后的 post-task review 发现任务执行困难或失败时，会向 `skill_needs.yaml` 写入一条需求信号。Skill Agent **必须首先处理这些未解决的信号**，处理完毕后将 `addressed` 字段设为 `true`。

关于 skill_needs.yaml 的详细工作原理，见第 6 节。

### 需求发现的工作流程

```
Source F (skill_needs.yaml) ──→ [最高优先级，首先处理]
       ↓
Source A-E ──→ [并行扫描，识别至少 3 个需求]
       ↓
对每个需求：
  ├─ 已有 skill 覆盖且工作良好 → 记录，跳过
  ├─ 已有 skill 但需改进 → 标记进化（Step 4）
  └─ 没有 skill 覆盖 → 进入外部搜索（Step 3）→ 创建（Step 4）
```

---

## 4. Skill 创建流程

当需求发现确认某个需求没有被任何现有 skill 覆盖时，Skill Agent 会按以下流程创建新 skill。

### 4.1 搜索外部 Skill（优先于从零创建）

在动手创建之前，先搜索已有资源：

1. **SkillHub**：搜索 `https://www.skillhub.club/`
2. **GitHub**：`gh search repos "claude code skill <keyword>" --limit 5`
3. **Anthropic 官方**：检查 `https://github.com/anthropics/`

如果找到合适的外部 skill：
- Clone 到临时目录：`git clone <repo> /tmp/skill-download-<name>`
- 审查 SKILL.md 的质量和安全性
- 复制到 `~/.claude/skills/<name>/`
- 根据用户需求进行适配修改
- 注册到 `permitted_skills.md`

### 4.2 使用 skill-creator 方法论从零创建

**前置条件**：必须先阅读 `~/.claude/skills/skill-creator/SKILL.md`。

**创建步骤**：

**Step 1 — 设计 SKILL.md**

遵循 skill-creator 定义的 skill 解剖结构：

```
<skill-name>/
├── SKILL.md          # 必需：YAML frontmatter + Markdown 指令
├── references/       # 可选：详细文档
├── scripts/          # 可选：确定性/重复性任务的脚本
├── evals/            # 可选：测试用例
│   └── evals.json
└── assets/           # 可选：模板、图标等
```

**Step 2 — 编写 YAML frontmatter**

`description` 字段是 skill 被触发的首要机制。要写得"pushy"——包含具体的使用场景和关键词：

```yaml
---
name: python-llm-resilience
description: "Best practices for resilient Python + LLM API applications.
  Covers httpx timeouts, checkpoint/resume patterns, process monitoring.
  Use this skill whenever building Python applications that call LLM APIs,
  implementing long-running evaluation pipelines, or dealing with API
  timeout and connection reliability issues."
---
```

**Step 3 — 编写正文**

- 使用祈使句（imperative form）
- 解释每条规则背后的"为什么"，而非死板的 MUST/NEVER
- SKILL.md 控制在 500 行以内；超出部分放到 `references/`
- 遵循渐进式披露：元数据 → SKILL.md 正文 → 捆绑资源

**Step 4 — 编写基础 Eval**

在 `~/.claude/skills/<skill-name>/evals/evals.json` 中写入 2-3 个真实的测试提示：

```json
{
  "skill_name": "python-llm-resilience",
  "evals": [
    {
      "id": 1,
      "prompt": "I'm building a Python pipeline that calls OpenRouter API for 200+ sequential LLM requests...",
      "expected_output": "Should recommend httpx connection-level timeouts, checkpoint/resume, retry with exponential backoff"
    }
  ]
}
```

**Step 5 — 注册到 permitted_skills.md**

将新 skill 名称添加到 `~/.claude/skills/skill-evolver/reference/permitted_skills.md`。

### 4.3 质量检查清单

每个新创建的 skill 必须通过以下检查：

- [ ] 指令清晰、可操作，使用祈使句
- [ ] 解释了"为什么"而非只有死板规则
- [ ] description 针对触发优化（pushy，包含关键词和使用场景）
- [ ] SKILL.md 不超过 500 行；详细内容在 references/ 中
- [ ] 聚焦于一个连贯主题，与现有 skill 无重复
- [ ] YAML frontmatter 有效，包含 name 和 description

### 4.4 什么值得做成 Skill

**好的 skill 候选**：
- `typescript-strict-mode` — 提交前强制执行严格 TS 编译检查
- `git-commit-hygiene` — 预提交验证模式
- `python-llm-resilience` — Python + LLM API 韧性最佳实践

**不应做成 skill 的**：
- 项目特定知识（属于 CLAUDE.md）
- 每个开发者都知道的常识
- 模糊的建议（"小心使用 TypeScript"）
- 一次性的 workaround

---

## 5. Skill 进化流程

对已经注册在 `permitted_skills.md` 中的 skill 进行更新和改进。

### 5.1 进化的触发条件

- 新的经验数据表明 skill 的某些指导已过时
- Task 执行报告显示 skill 的某些规则不够有效
- 用户偏好变化导致 skill 需要调整
- Skill-need 信号指向一个已有但不够好的 skill

### 5.2 进化规则

1. **只能修改已注册 skill**：仅限 `permitted_skills.md` 列出的 skill
2. **先读再改**：先阅读 skill 现有的 SKILL.md 和 evals
3. **使用 Edit 做定向修改**：不要重写整个文件，除非确实有必要
4. **基于证据**：每次修改都必须有积累的经验数据支撑
5. **更新 Eval**：如果 skill 有 `evals/evals.json`，为新行为添加测试场景

### 5.3 不可修改的文件

- `~/.claude/skills/user-context/`（任何文件）——由 Context Agent 负责
- `~/.claude/skills/skill-evolver/SKILL.md`——自身的路由文件
- 任何不在 permitted_skills.md 中的 skill

---

## 6. skill_needs.yaml — Task 到 Skill 的桥梁

`skill_needs.yaml` 是 task 系统和 skill 系统之间的核心桥梁机制，实现了"task 执行暴露问题 → skill 创建解决问题 → 未来 task 执行更顺畅"的闭环。

### 6.1 数据格式

```yaml
entries:
  - need: "Python async 错误处理模式"             # 需要什么 skill
    source_task: "t_20260309_1200_a3f"            # 哪个 task 暴露了这个需求
    task_name: "Debug async pipeline"             # task 的可读名称
    evidence: "Task 在相同的 async 模式上失败了 3 次"  # 为什么需要
    priority: "high"                              # high=任务失败, medium=任务困难
    date: "2026-03-09"                            # 信号产生日期
    addressed: false                              # 是否已处理
```

### 6.2 写入方——Post-Task Review

当一个 task 执行完毕后，系统会启动一个 post-task review 周期（由 `buildPostTaskPrompt` 生成提示）。Review agent 会：

1. **评估任务质量**——任务是否成功完成
2. **提取经验**——更新 success/failure/tips 到 tmp 文件
3. **发射 skill-need 信号**（关键步骤）——如果任务挣扎、失败或不得不临场发挥：
   - 写入 `skill_needs.yaml`
   - `priority: "high"` 表示任务失败，`"medium"` 表示任务困难
4. **验证 skill-building 任务**——如果该任务有 `skillTarget`，检查目标 skill 是否已创建

### 6.3 读取方——Skill Agent

在进化周期中，Skill Agent 将 `skill_needs.yaml` 中 `addressed: false` 的条目视为**最高优先级需求**，在所有其他来源之前处理。处理方式：
- 为该需求搜索或创建合适的 skill
- 处理完毕后设置 `addressed: true`

### 6.4 闭环示意

```
Task 执行 ──失败/困难──→ Post-Task Review
                              ↓
                     写入 skill_needs.yaml
                              ↓
              Skill Agent（下个进化周期）
                    ↓              ↓
            搜索外部 skill    创建新 skill
                    ↓              ↓
              安装/注册      创建/注册
                    ↓              ↓
              relatedSkills 关联到 task
                              ↓
                Task 再次执行时读取 skill
                    → 避免同样的问题
```

---

## 7. 权限边界

### 7.1 permitted_skills.md

位于 `~/.claude/skills/skill-evolver/reference/permitted_skills.md`，这是 Skill Agent 的权限注册表。

**当前注册示例**：

```markdown
## Registered Skills

- **frontend-design** — 从 Anthropics 官方插件库安装。创建独特的生产级前端界面。安装于 2026-03-09。
- **python-llm-resilience** — 从 20+ 经验信号中创建的自定义 skill。Python + LLM API 韧性最佳实践。创建于 2026-03-09。
```

### 7.2 权限规则

| 操作 | 允许？ | 备注 |
|------|--------|------|
| 创建新 skill（在 `~/.claude/skills/` 下） | 允许 | 必须同时注册到 permitted_skills.md |
| 修改已注册的 skill | 允许 | 仅限 permitted_skills.md 列出的 |
| 修改 user-context skill 的任何文件 | 禁止 | 由 Context Agent 专属管理 |
| 修改 skill-evolver 自身的 SKILL.md | 禁止 | 避免自我修改指令 |
| 修改未注册的第三方 skill | 禁止 | 包括 skill-creator |
| 读取任何 skill 的文件 | 允许 | 只读访问不受限制 |
| 读取 task 数据 | 允许 | 只读 tasks.yaml 和报告 |
| 写入 task 数据 | 禁止 | Task Agent 专属管理 |

### 7.3 路径边界约束

在 Skill Agent 的提示（`buildSkillAgentPrompt`）中有一条关键的安全约束：

> CRITICAL PATH CONSTRAINT: You must ONLY read and write skill files under ~/.claude/skills/ (the installed location). NEVER modify files inside any project source directory.

这来自一次真实的失败经验：Agent 曾因为没有路径限制而修改了项目源码中的 `skills/` 目录（而非安装目录 `~/.claude/skills/`）。加入此约束后问题消除。

---

## 8. 经验维护

### 8.1 添加信号（ADD SIGNAL）

当 Skill Agent 在会话日志中发现新的成功/失败/技巧模式时：

**如果匹配条目已存在**：
1. 在 `signals` 数组中追加新信号
2. 递增 `times_seen`
3. 更新 `last_seen` 日期

**如果是新条目**：
1. 创建新的 entry，包含 `content`、首个 `signal`
2. 设置 `first_seen` = `last_seen` = 当天日期
3. `times_seen` = 1
4. 设置合适的 `applicable_to` 标签

### 8.2 去重逻辑

匹配判断基于 `content` 的语义相似性——如果描述的是同一个技术现象或模式，即使措辞略有不同也应合并为同一条目，追加信号而非创建新条目。

### 8.3 过期清理（CLEAN STALE）

移除同时满足以下条件的条目：
- `last_seen` 距今超过 60 天
- 信号总数仅 1-2 个

这意味着：
- 信号多（3+）的老条目会保留——它们是经过多次验证的知识
- 信号少的新条目也会保留——它们还在积累阶段
- 只有又老又缺乏验证的条目才会被清理

### 8.4 经验不是毕业队列

与 user-context 的 tmp→context 毕业机制不同，skill-evolver 的 tmp 文件是**决策参考**，不是等待毕业的队列。经验数据永久保留在 tmp 中（除非过期清理），它们的"毕业"形式是触发 skill 创建——但原始经验仍然保留在 tmp 中作为参考。

---

## 9. 运行时用途

在普通的 Claude Code 会话中（非进化周期），skill-evolver 的经验数据为 Claude 提供被动决策支持。

### 9.1 什么时候查阅

- **尝试有风险或不熟悉的方法前** → 检查 `failure_experience.yaml`
- **规划实现方案时** → 检查 `success_experience.yaml` 寻找验证过的模式
- **遇到困难或寻找捷径时** → 检查 `useful_tips.yaml`
- **使用特定技术时** → 按 `applicable_to` 标签过滤相关经验

### 9.2 使用原则

1. **按证据强度加权**：`times_seen: 5` 跨多天的条目远比 `times_seen: 1` 可靠
2. **不要修改数据**：运行时只读，修改只在进化周期中进行
3. **用户指令优先**：如果用户明确要求使用某种方法（即使它与存储的经验矛盾），遵从用户
4. **自然运用，不过度引用**：不要说"根据我的失败经验数据库..."——直接避开坏方法，用好方法

### 9.3 查阅已进化的 Skill

检查 `reference/permitted_skills.md` 可以看到进化过程已经创建了哪些独立 skill。这些 skill 在 `~/.claude/skills/<skill-name>/` 有自己的 SKILL.md，包含详细的可操作指令。

---

## 10. 进化时用途

在后台进化周期中，Skill Agent 执行完整的需求驱动工作流。以下是 `buildSkillAgentPrompt`（定义在 `src/prompt.ts`）构建的 Skill Agent 的完整工作流程。

### 10.1 Skill Agent 的身份和权限

```
身份：skill-evolver 进化周期中三个并行 Agent 之一（另外两个是 Context Agent 和 Task Agent）
核心使命：发现用户需求，找到或创建最佳的 Claude Code skill 来满足它们
权限：bypassPermissions（可读写任何需要的文件）
```

### 10.2 完整工作流

```
Step 1: 需求发现 (MANDATORY)
  ├── 读取 skill_needs.yaml → 最高优先级
  ├── 读取 user-context/context/*.yaml → Source A, B
  ├── 读取 skill-evolver/tmp/*.yaml → Source C
  ├── 使用脚本扫描会话日志 → Source D
  └── 浏览 tasks.yaml 和任务报告 → Source E

  输出：至少 3 个已识别需求的列表

Step 2: 匹配现有 Skill
  └── ls ~/.claude/skills/ 检查每个需求的覆盖情况

Step 3: 搜索外部 Skill
  ├── SkillHub
  ├── GitHub
  └── Anthropic 官方

Step 4: 创建或进化 Skill
  ├── 读取 skill-creator/SKILL.md
  ├── 设计 SKILL.md（遵循 skill-creator 解剖结构）
  ├── 编写 evals
  └── 注册到 permitted_skills.md

Step 5: 经验维护
  ├── 从会话日志添加新信号
  └── 清理过期条目

Step 6: 撰写报告
  └── 包含 7 个必须的章节（见下文）
```

### 10.3 报告格式要求

每次进化周期，Skill Agent 必须输出包含以下 7 个章节的报告：

1. **Needs Discovered** — 至少 3 个需求，每个附带证据来源
2. **Existing Skill Coverage** — 哪些需求已被覆盖？有什么缺口？
3. **External Skill Search** — 搜索了什么？找到了什么？
4. **Skills Created or Evolved** — 创建或修改的 skill。如果没有，需要为每个未满足需求解释原因
5. **Task-Derived Needs** — 从 task 执行模式中识别的 skill 需求
6. **Experience Updates** — 各类别信号添加数、过期清理数
7. **Notes** — 下一个周期的观察和建议

### 10.4 三个并行 Agent 的分工

| Agent | 职责 | 写入权限 | 不可触碰 |
|-------|------|----------|----------|
| Context Agent | 维护用户画像（偏好/目标/认知） | user-context/* | skill-evolver/*, tasks/* |
| Skill Agent | 经验积累 + skill 创建进化 | skill-evolver/tmp/*, permitted_skills.md, 新 skill | user-context/*, tasks.yaml |
| Task Agent | 目标分解 + 任务创建管理 | tasks.yaml, ideas.yaml, _rejected.yaml | user-context/*, skill-evolver/tmp/* |

三个 Agent 通过读取彼此管理的数据实现协同（只读访问不受限制），但写入权限严格隔离，避免冲突。

---

## 11. 与 skill-creator 的集成

`skill-creator` 是 Anthropic 官方的 skill 创建工具，在 `npm install -g skill-evolver` 时通过 postinstall 脚本自动安装到 `~/.claude/skills/skill-creator/`。

### 11.1 集成点

skill-evolver 的 Skill Agent 在创建和进化 skill 时**必须使用** skill-creator 的方法论。具体体现在：

**Description 优化**：
skill-creator 强调 description 是 skill 的首要触发机制。描述要"pushy"——不只说 skill 做什么，还要包含应该触发它的具体场景和关键词。Claude 有"欠触发"（undertrigger）倾向，因此描述需要主动覆盖边缘情况。

**渐进式披露**：
三层加载机制：
1. 元数据（name + description）— 始终在 context 中（约 100 词）
2. SKILL.md 正文 — skill 被触发时加载（理想 < 500 行）
3. 捆绑资源 — 按需加载（脚本可以不加载直接执行）

**Eval 系统**：
创建 `evals/evals.json` 包含 2-3 个真实测试提示。skill-creator 提供完整的 eval 运行、评分、基准测试和查看器工具链，但 Skill Agent 在自动创建时通常只写基础的 eval 定义。

### 11.2 质量检查清单

来自 skill-creator 的检查清单，Skill Agent 在创建/进化 skill 时须遵循：

- 清晰、可操作的指令，使用祈使句
- 解释规则背后的"为什么"，而非死板的 MUST/NEVER
- Description 针对触发优化
- SKILL.md 不超过 500 行
- 聚焦一个连贯主题，无重复
- 有效的 YAML frontmatter

### 11.3 写作风格

skill-creator 倡导的写作原则对 Skill Agent 同样适用：
- 理解并解释"为什么"比堆砌 ALWAYS/NEVER 更有效
- 当代 LLM 足够聪明，理解动机后能灵活应用规则
- 优先使用"prefer X with fallback"而非"never do Y"

---

## 12. 与 task-planner 的协同

skill-evolver skill 和 task-planner skill 之间存在双向的协同进化关系。

### 12.1 Skill → Task 方向

**Task Agent 的 Skill 感知（Phase 4）**：

Task Agent 在创建任务时会：
1. 列出所有可用 skill：`ls ~/.claude/skills/`
2. 检查 `permitted_skills.md` 了解已进化的 skill
3. 为任务设置 `relatedSkills` 字段，关联相关 skill
4. 如果某个目标需要的 skill 不存在 → 创建 **skill-building task**

**Skill-Building Task** 是一种特殊任务类型：

```yaml
- id: "t_20260309_1400_abc"
  name: "Create git-workflow skill"
  prompt: |
    You are a skill builder. Your task is to create a Claude Code skill
    using the skill-creator methodology.
    TARGET SKILL: git-workflow
    GOAL: ...
    EVIDENCE: ...
    INSTRUCTIONS:
    1. Read ~/.claude/skills/skill-creator/SKILL.md THOROUGHLY
    2. Create the skill directory and write SKILL.md
    3. Write basic evals
    4. Register in permitted_skills.md
  tags: ["skill-building"]
  skillTarget: "git-workflow"
  schedule:
    type: one-shot
    at: "2026-03-09T14:00:00Z"
```

### 12.2 Task → Skill 方向

**Post-Task Review 发射 Skill 需求**：

当任务执行完毕，`buildPostTaskPrompt` 启动 review，review agent 检查：
- 任务是否成功？
- 过程中有哪些困难？
- 是否有领域知识缺口？

如果存在 skill 缺口，写入 `skill_needs.yaml`（详见第 6 节）。

**Skill Agent 处理 Task 报告（Source E）**：

Skill Agent 在需求发现阶段直接浏览 task 报告，寻找能力缺口。

### 12.3 闭环机制

```
                    Task Agent
                   ┌──────────┐
                   │ 创建任务   │
                   │ ↓         │
                   │ 发现 skill │
                   │ 缺口       │
                   │ ↓         │
                   │ 创建 skill-│
                   │ building  │
                   │ task      │
                   └─────┬─────┘
                         │
            ┌────────────┼────────────┐
            ↓            ↓            ↓
    Task 执行     Post-Task Review   Skill Agent
    ├─ 成功 →     ├─ 提取经验 →      ├─ 处理 skill_needs
    │  relatedSkills   写入 tmp/     ├─ 搜索/创建 skill
    │  提供指导   ├─ 发现缺口 →      ├─ 注册到 permitted_skills
    │            │  写入 skill_needs  ├─ 设置 addressed: true
    └─ 失败 →    └─ 验证 skill-      └─ 报告中记录
       学到教训       building 结果
```

这个闭环确保：
- Task 执行中暴露的问题会自动触发 skill 创建
- 新创建的 skill 会被关联到相关 task，提升后续执行质量
- Skill-building task 的完成状态会被追踪和验证
- 整个系统在运行中持续自我改进

---

## 附录：实际数据概览

截至文档编写时（2026-03-09），`tmp/` 中的真实数据量：

| 文件 | 条目数 | 最高信号数 | 涵盖技术领域 |
|------|--------|-----------|-------------|
| success_experience.yaml | 21 | 8（multi-agent 团队） | claude-cli, nodejs, python, playwright, css, npm... |
| failure_experience.yaml | 21 | 8（httpx 超时问题） | claude-cli, qdrant, python, svelte, docker... |
| useful_tips.yaml | 25 | 6（kill+restart 恢复速度） | nodejs, python, debugging, prompt-engineering... |
| skill_needs.yaml | 0（已清空） | - | - |

已注册的进化 skill（permitted_skills.md）：
- **frontend-design** — 来自 Anthropic 官方插件
- **python-llm-resilience** — 从 20+ 经验信号中创建
