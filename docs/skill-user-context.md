# user-context skill 工作原理

## 1. 概述

user-context 是 skill-evolver 系统的两个元技能（meta-skill）之一，安装后位于 `~/.claude/skills/user-context/`。它的核心使命是：**构建并维护一个基于证据的、持续进化的用户画像**。

与传统的用户配置文件不同，user-context 不依赖用户手动填写个人信息，而是通过分析 Claude Code 的历史对话记录，自动提取关于用户的偏好、目标和认知模式的信号，经过严格的积累和验证机制后，将其转化为可靠的用户知识。

user-context 具有双重用途：

- **运行时（Runtime）**：在普通 Claude Code 会话中，Claude 读取已确认的用户画像来个性化响应——使用正确的语言、遵循用户的代码风格偏好、了解用户正在做什么项目。
- **进化时（Evolution）**：在后台进化周期中，Context Agent 扫描最近的对话日志，提取新信号，积累观察，并在证据充分时将其毕业为确认知识。

## 2. 三大支柱

user-context 围绕三个维度（支柱）组织用户信息，每个维度由一个 YAML 文件存储：

### 2.1 Preference（偏好）

**文件**：`context/preference.yaml`

记录用户在工具和工作流上的选择倾向。包括但不限于：

- 包管理器偏好（npm / bun / pnpm / yarn）
- 编程语言和框架选择
- 代码风格（命名规范、注释习惯、缩进方式）
- Git 工作流（commit message 风格、分支策略）
- 沟通偏好（详细 vs 简洁的回复、解释深度）
- 工具偏好（编辑器、终端、测试框架）
- 响应格式偏好（Markdown、代码优先、解释优先）

**作用**：Claude 直接将确认的偏好应用到自身行为上。例如，如果偏好中记录了"用户使用简体中文交流"，Claude 就会用中文回复；如果记录了"用户遵循 DDD 架构"，Claude 就会按领域组织代码。

### 2.2 Objective（目标）

**文件**：`context/objective.yaml`

记录用户正在追求的目标，从即时任务到长期方向：

- 当前任务目标（如"正在构建一个 CLI 工具"、"正在迁移到 TypeScript"）
- 项目级目标（如"Q2 前发布 v2.0"、"减小打包体积"）
- 职业/学习目标（如"正在学习 Rust"、"正在转向后端开发"）
- 反复出现的主题（如"用户非常关注性能"、"优先考虑开发者体验"）

**作用**：帮助 Claude 理解更大的背景。在讨论相关话题时引用用户的当前项目，将建议与用户声明的目标对齐，避免提出与用户方向冲突的方案。同时，Objective 数据也是 Task Agent 分解任务的核心输入源。

### 2.3 Cognition（认知）

**文件**：`context/cognition.yaml`

记录用户的思维和沟通方式：

- 人格特质（细节导向、大局观思考者、务实主义者、完美主义者）
- 沟通风格（直接、协作、探索性）
- 决策模式（数据驱动、直觉导向、寻求共识）
- 学习方式（边做边学、偏好文档、喜欢提问）
- 情绪模式（对慢构建感到沮丧、对新工具感到兴奋）
- 思维风格（如果可以明确观察到的 MBTI 指标）

**作用**：让 Claude 调整沟通方式。例如，如果认知记录了"用户发出简短的指令，对重复感到不耐烦"，Claude 就会简洁回复，直奔主题；如果记录了"系统架构级思考者"，Claude 就会在架构层面组织讨论。

## 3. 双层数据架构

user-context 采用 **tmp（积累层）+ context（确认层）** 的双层架构，这是整个进化机制的基石。

```
~/.claude/skills/user-context/
├── context/                    # 确认层 — 高置信度知识
│   ├── preference.yaml
│   ├── objective.yaml
│   └── cognition.yaml
├── tmp/                        # 积累层 — 新兴观察
│   ├── preference_tmp.yaml
│   ├── objective_tmp.yaml
│   └── cognition_tmp.yaml
```

### 3.1 tmp/（积累层）

存储正在被跟踪但尚未有足够证据的观察。每个条目携带完整的信号链——何时、在哪个会话中、观察到了什么。这些观察可能反映也可能不反映稳定的模式。

**使用原则**：作为软提示而非硬规则。例如，tmp 中有一条"用户偏好 Opus 模型"且仅有 1 个信号，不应假设这是永久偏好——但在相关时可以提及。

### 3.2 context/（确认层）

存储已经被多次、跨天观察到的高置信度知识。这些条目经过了严格的毕业机制验证，可以作为关于用户的可靠事实。

**使用原则**：直接驱动 Claude 的行为变化。`source_signals` 越高，置信度越强——一个有 14 个信号的条目是非常牢固的认知。

### 3.3 为什么需要双层？

这个设计防止了冲动性的知识变更。一次对话中的偶然偏好不会被永久固化，但跨多天多个会话持续出现的模式则会被确认。这体现了 skill-evolver 的核心哲学：**保守谨慎，宁可漏掉真实模式，也不要固化错误模式**。

## 4. 信号积累机制

### 4.1 信号的来源

信号从 Claude Code 的 JSONL 格式会话日志中提取。日志位于 `~/.claude/projects/` 目录下，按项目分组存储。单个会话文件可达 200MB+，其中 99% 是工具输出和进度消息等噪声。

Context Agent 从对话中寻找以下类型的信号：

- **直接偏好声明**："I always want..."、"use X not Y"、"我偏好..."
- **纠正行为**："no, do it this way"、"不是这样"
- **跨会话的重复模式**
- **情绪反应和沟通风格**
- **目标声明和项目上下文**

### 4.2 信号的存储格式（tmp YAML schema）

```yaml
entries:
  - content: "User prefers bun over npm for package management"
    signals:
      - session: "abc-123"
        date: "2026-03-01"
        detail: "User corrected: 'use bun install, not npm'"
      - session: "def-456"
        date: "2026-03-02"
        detail: "Project has bun.lockb, no package-lock.json"
    first_seen: "2026-03-01"
    last_seen: "2026-03-02"
    times_seen: 2
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | string | 一句清晰的描述性陈述，概括这个观察 |
| `signals` | array | 证据数组，每个信号记录了具体的观察 |
| `signals[].session` | string | 观察所在的会话 ID |
| `signals[].date` | string | 观察日期（YYYY-MM-DD） |
| `signals[].detail` | string | 对观察内容的简要描述（一句话） |
| `first_seen` | string | 最早信号的日期 |
| `last_seen` | string | 最近信号的日期 |
| `times_seen` | number | 信号总数（必须等于 signals 数组长度） |

### 4.3 ADD SIGNAL 操作

当在会话日志中发现与用户偏好、目标或认知模式相关的证据时：

1. 确定它属于哪个支柱：`preference`、`objective` 或 `cognition`
2. 读取对应的 `tmp/<pillar>_tmp.yaml` 文件
3. 搜索已有条目中是否有语义匹配的（不是精确字符串匹配）。例如"User likes dark mode"和"User prefers dark themes"是同一个观察
4. **如果匹配的条目已存在**：追加新信号到 `signals` 数组，更新 `last_seen`，递增 `times_seen`
5. **如果不存在匹配条目**：创建新条目
6. 写入更新后的 YAML 文件

**去重原则**：添加新 tmp 条目前，必须仔细检查是否已有语义相似的条目。将信号合并到已有条目中，而不是创建重复项。

## 5. 毕业机制

毕业是从 tmp 到 context 的晋升过程，需要满足严格的条件。

### 5.1 毕业条件

一个条目准备好毕业需要满足：

- **重复性**：在 **3 个或更多不同会话** 中被观察到
- **时间跨度**：信号跨越 **至少 2 个不同的日子**（防止单次会话过拟合）
- **一致性**：没有矛盾证据，或矛盾远少于支持性信号
- **显式性加权**：用户的单个显式声明（"I always want X"、"never do Y"）等同于多次隐式观察。如果用户明确声明了偏好，可以在较少的总信号数下毕业（最低 2 个会话，但如果声明是明确无歧义的，可以在同一天）

**核心原则**：当有疑问时，多等一个周期。漏报（遗漏真实模式）的危害远小于误报（固化错误模式）。进化引擎会再次运行——没有紧迫感。

### 5.2 毕业后的 context 条目格式

```yaml
entries:
  - content: "User prefers bun over npm for package management"
    graduated: "2026-03-05"
    source_signals: 4
    last_validated: "2026-03-05"
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | string | 确认的知识（一句清晰的描述性陈述） |
| `graduated` | string | 从 tmp 晋升的日期 |
| `source_signals` | number | 支持毕业的信号数量 |
| `last_validated` | string | 最后一次看到支持性证据的日期。即使已毕业，看到新的支持信号时也要更新此字段 |

### 5.3 GRADUATE 操作流程

1. 读取 tmp 条目，根据毕业指南评估
2. 如果符合条件：
   - 读取对应的 `context/<pillar>.yaml` 文件
   - 添加新的 context 条目：`content`（同 tmp）、`graduated`（今天的日期）、`source_signals`（tmp 条目的 `times_seen`）、`last_validated`（今天的日期）
   - 从 tmp 文件中删除该条目
   - 写入两个文件

### 5.4 矛盾处理

| 情况 | 处理方式 |
|------|---------|
| 单个矛盾对 context 条目 | 记录下来，不行动。一个信号不足以推翻已确认的知识 |
| 2+ 个来自不同会话的矛盾 | 将 context 条目降级回 tmp，用矛盾信号创建新 tmp 条目 |
| 用户显式反转（"I changed my mind about X"） | 快速通道：立即删除或更新 context 条目 |
| 两个竞争的 tmp 条目 | 保留两个。信号更多、更近的那个最终会毕业 |
| 模糊证据 | 不创建条目，等待更清晰的信号 |

### 5.5 UPDATE 操作

当 context 条目需要细化（不是矛盾，只是澄清或更精确）时：

1. 原地更新 `content` 字段使其更精确
2. 更新 `last_validated` 为今天的日期
3. 写入文件

## 6. 过期清理

在每个进化周期中，Context Agent 会扫描 tmp 条目的过期状况：

- **60 天规则**：如果一个 tmp 条目的 `last_seen` 距今超过 60 天，且 `times_seen` 很低（1-2 个），则删除它。这很可能是一次性的观察
- **项目过期**：如果 tmp 条目关于一个在最近会话中不再出现的特定项目，考虑删除它
- **条目合并**：如果一个 tmp 条目已被更具体或更准确的条目取代，将信号合并到更好的条目中，并删除旧的

这个清理机制确保 tmp 层不会无限膨胀，同时也淘汰了不再相关的短暂观察。

## 7. 运行时用途

在普通 Claude Code 会话中，user-context 以只读方式为 Claude 提供用户画像。详细规则定义在 `reference/runtime_guide.md` 中。

### 7.1 何时查阅

- **会话开始时**：读取 `context/` 文件以了解当前用户
- **做出选择时**：检查用户是否有确认的偏好（响应风格、工具使用、语言、方法）
- **用户困惑或沮丧时**：查看 cognition 条目以调整沟通方式
- **规划任务时**：查看 objective 条目了解当前项目上下文和目标

### 7.2 应用规则

**Preference 条目** — 直接应用：

| 偏好示例 | 应用方式 |
|---------|---------|
| "User communicates in Simplified Chinese" | 用中文回复 |
| "User expects documentation updated alongside code" | 改代码时同步更新文档 |
| "User prefers spawning multi-agent teams" | 对大型任务建议团队模式 |
| "User follows DDD architecture" | 按领域组织代码 |

**Objective 条目** — 理解背景：引用用户当前项目，将建议与目标对齐

**Cognition 条目** — 调整风格：

| 认知示例 | 调整方式 |
|---------|---------|
| "Short directives, impatient with repetition" | 简洁，不废话，直奔主题 |
| "Systems-architecture thinker" | 在架构层面组织讨论 |
| "Validates work visually with screenshots" | 提供截图或可视化结果 |

### 7.3 重要限制

- **不修改**：运行时不修改任何 context 或 tmp 文件，修改仅在进化周期中执行
- **不过度依赖 tmp**：tmp 条目是未确认的观察，只有 context 条目应该驱动行为变化
- **尊重当前指令**：如果用户当前的要求与存储的偏好矛盾，遵循用户当前指令。进化周期会在后续更新记录
- **不主动提及**：不向用户提及进化系统的存在，除非用户主动询问

## 8. 进化时用途 — Context Agent 完整工作流程

在 skill-evolver 的多 Agent 并行架构中，Context Agent 是专门负责 user-context 维护的 Agent。它在每个进化周期中运行，遵循以下完整流程：

### 8.1 身份与权限

Context Agent 由 `buildContextAgentPrompt()` 函数构建提示词，具有以下权限：

- **写入权限**：`~/.claude/skills/user-context/context/` 和 `tmp/` 下的所有 YAML 文件
- **只读权限**：`~/.claude/projects/` 下的会话日志
- **禁止访问**：`~/.claude/skills/skill-evolver/`（由 Skill Agent 负责）和 `~/.skill-evolver/tasks/`（由 Task Agent 负责）

### 8.2 完整工作流

```
第1步：读取历史报告
    ↓ 了解上次处理到哪些会话
第2步：发现新会话
    ↓ list-sessions.mjs --since <last-run-date>
第3步：扫描会话提取信号
    ↓ session-digest.mjs → 获取对话文本
    ↓ search-messages.mjs → 关键词定向搜索
第4步：ADD SIGNAL
    ↓ 将信号写入对应的 tmp 文件
第5步：评估毕业条件
    ↓ 审查所有 tmp 条目，毕业符合条件的
第6步：检查矛盾
    ↓ 将新信号与 context 条目对比
第7步：清理过期条目
    ↓ 移除 60 天+ 的低信号 tmp 条目
第8步：写入进化报告
    ↓ 记录本次周期的所有操作
```

### 8.3 报告格式

Context Agent 在每次进化周期结束时写入一份 Markdown 报告到 `~/.skill-evolver/reports/`，格式如下：

```markdown
# Context Agent Report — {date}

## Sessions Analyzed
(列出会话 ID 和摘要)

## Signals Added
- preference: N 个新信号
- objective: N 个新信号
- cognition: N 个新信号

## Graduations
(列出从 tmp 毕业到 context 的条目)

## Stale Entries Cleaned
(列出被移除的过期条目)

## Notes
(下次周期的观察和建议)
```

### 8.4 关键路径约束

Context Agent 只能读写 `~/.claude/skills/` 下已安装的文件，**绝不能修改任何项目源代码目录中的文件**（如含 `/skill-evolver/skills/` 的路径）。项目的 `skills/` 目录包含源模板，不可触碰。

## 9. Session 搜索脚本

user-context 提供 5 个 Node.js 脚本用于高效查询 Claude Code 的会话历史。这些脚本位于 `~/.claude/skills/user-context/scripts/`，所有脚本输出 NDJSON 格式（每行一个 JSON 对象），便于管道处理。

共用模块 `_shared.mjs` 提供底层能力：项目目录遍历、JSONL 流式解析、用户消息识别、助手文本提取、工具调用提取等。

### 9.1 list-sessions.mjs — 会话列表

**功能**：按日期/项目查找可用的 Claude Code 会话，按修改时间倒序排列。

**参数**：
- `--since <date>` — 只返回该日期之后的会话
- `--project <pattern>` — 按项目名过滤
- `--limit <n>` — 限制返回数量

**输出字段**：`session_id`, `project`, `project_dir`, `path`, `modified`, `size_kb`, `user_msg_count`, `time_start`, `time_end`

**用法**：
```bash
node ~/.claude/skills/user-context/scripts/list-sessions.mjs --since 2026-03-04 --limit 10
```

**典型场景**：进化周期的第一步——发现自上次运行以来的新会话。

### 9.2 session-digest.mjs — 对话摘要提取

**功能**：从会话文件中仅提取用户文本消息和助手文本回复，过滤掉所有 `tool_result`、`thinking`、`progress` 和文件历史快照等噪声。一个 224MB 的会话文件在约 1 秒内产出约 500KB 的有用输出。

**参数**：
- `--file <path>` — 会话 JSONL 文件路径（必填）
- `--max-turns <n>` — 限制最大轮次数

**输出字段**：`role` ("user" | "assistant"), `timestamp`, `text`

**用法**：
```bash
node ~/.claude/skills/user-context/scripts/session-digest.mjs --file <path.jsonl>
```

**实现细节**：通过消息 ID 对助手回复进行去重（流式返回的多个 JSONL 行会被合并），确保输出干净完整。

### 9.3 search-messages.mjs — 跨会话关键词搜索

**功能**：使用正则表达式在所有会话的对话文本中搜索关键词匹配。

**参数**：
- `--query <regex>` — 搜索模式（必填，支持正则）
- `--since <date>` — 时间过滤
- `--project <pattern>` — 项目过滤
- `--role user|assistant|all` — 角色过滤（默认 all）
- `--context <n>` — 包含匹配前的 N 条消息作为上下文
- `--limit <n>` — 限制匹配数量（默认 50）

**输出字段**：`session_id`, `project`, `timestamp`, `role`, `text`（超过 500 字符截断）, `context_before`（可选）

**用法**：
```bash
# 搜索用户的偏好声明
node ~/.claude/skills/user-context/scripts/search-messages.mjs --query "prefer|always|偏好" --role user

# 搜索包含错误的对话
node ~/.claude/skills/user-context/scripts/search-messages.mjs --query "error|failed" --limit 10
```

### 9.4 extract-tool-flow.mjs — 工具使用序列提取

**功能**：提取会话中的工具调用序列，包括每个工具调用的简要输入摘要和错误检测。

**参数**：
- `--file <path>` — 会话 JSONL 文件路径（必填）
- `--compact` — 输出单行工具序列

**输出格式**：
- 默认：NDJSON，每行包含 `timestamp`, `tool`, `input_summary`, `success`, `error_hint?`
- `--compact` 模式：单行序列如 `Bash→Read→Edit→Bash(err)→Bash`

**用法**：
```bash
# 详细模式
node ~/.claude/skills/user-context/scripts/extract-tool-flow.mjs --file <path.jsonl>

# 紧凑模式
node ~/.claude/skills/user-context/scripts/extract-tool-flow.mjs --file <path.jsonl> --compact
```

**错误检测**：通过匹配 `error`, `ENOENT`, `EPERM`, `failed`, `SyntaxError`, `TypeError` 等模式来识别工具调用中的错误。主要用于 skill-evolver（技术经验积累），对 user-context 的用途较少。

### 9.5 session-stats.mjs — 会话统计

**功能**：快速获取一个会话的概览统计信息，无需读取完整内容。

**参数**：
- `--file <path>` — 会话 JSONL 文件路径（必填）

**输出**：单个 JSON 对象，包含：

| 字段 | 说明 |
|------|------|
| `session_id` | 会话标识符 |
| `cwd` | 工作目录 |
| `git_branch` | Git 分支 |
| `time_range` | 开始和结束时间 |
| `duration_minutes` | 持续时间（分钟） |
| `size_kb` | 文件大小 |
| `user_messages` | 用户消息数 |
| `assistant_turns` | 助手轮次数（按消息 ID 去重） |
| `tool_calls` | 工具调用统计（按工具名分组计数） |
| `total_tool_calls` | 工具调用总数 |
| `errors_detected` | 检测到的错误数 |

**用法**：
```bash
node ~/.claude/skills/user-context/scripts/session-stats.mjs --file <path.jsonl>
```

### 9.6 推荐的脚本使用流程

1. **发现会话**：`list-sessions.mjs --since <上次运行日期>` — 获取未处理的会话路径
2. **快速概览**：`session-stats.mjs --file <path>` — 查看消息数量、工具使用、持续时间
3. **阅读对话**：`session-digest.mjs --file <path>` — 获取纯对话文本
4. **定向搜索**：`search-messages.mjs --query <pattern>` — 在所有会话中查找特定偏好声明、纠正或模式
5. **工具模式**：`extract-tool-flow.mjs --file <path>` — 查看工具使用成功/失败序列

## 10. 数据示例

以下是从真实运行的 user-context 中提取的实际数据示例。

### 10.1 context/preference.yaml（确认的偏好）

```yaml
entries:
  - content: "User communicates with Claude exclusively in Simplified Chinese (简体中文)"
    graduated: "2026-03-04"
    source_signals: 7
    last_validated: "2026-03-06"

  - content: "User prefers spawning multi-agent teams (team mode) for complex tasks rather than single-agent approaches"
    graduated: "2026-03-04"
    source_signals: 4
    last_validated: "2026-03-06"

  - content: "User rejects unnecessary abstraction layers and prefers direct inline configuration"
    graduated: "2026-03-06"
    source_signals: 4
    last_validated: "2026-03-06"

  - content: "User trusts Claude Code to work autonomously for extended periods — prefers no artificial timeout or turn limits"
    graduated: "2026-03-07"
    source_signals: 3
    last_validated: "2026-03-07"
```

### 10.2 context/cognition.yaml（确认的认知模式）

```yaml
entries:
  - content: "User communicates with very short, directive messages and becomes visibly impatient when Claude stalls"
    graduated: "2026-03-04"
    source_signals: 5
    last_validated: "2026-03-06"

  - content: "User thinks and works at a systems-architecture level, designing multi-component AI systems"
    graduated: "2026-03-04"
    source_signals: 5
    last_validated: "2026-03-07"

  - content: "User expects Claude to autonomously self-debug and self-fix errors without being told to do so"
    graduated: "2026-03-04"
    source_signals: 8
    last_validated: "2026-03-07"
```

### 10.3 tmp/preference_tmp.yaml（积累中的偏好观察）

```yaml
entries:
  - content: "User prefers the Claude Opus model over other models"
    signals:
      - session: "cad1c7e9"
        date: "2026-03-04"
        detail: "Explicitly stated '模型应该优先使用opus' (model should prioritize using opus)"
    first_seen: "2026-03-04"
    last_seen: "2026-03-04"
    times_seen: 1

  - content: "User prefers need-driven skill creation over passive signal accumulation with graduation thresholds"
    signals:
      - session: "c3a0aac3"
        date: "2026-03-09"
        detail: "Complained '已经两天了，但现在仍然没有积累任何一条有用的skill'"
      - session: "3a1982e5"
        date: "2026-03-09"
        detail: "Explicitly decided '取消缓冲区这个概念' — skills should come from user need insights"
      - session: "3a1982e5"
        date: "2026-03-09"
        detail: "Extended to bidirectional skill-task linkage"
    first_seen: "2026-03-09"
    last_seen: "2026-03-09"
    times_seen: 3
```

注意对比：第一个条目只有 1 个信号，远未达到毕业条件；第三个条目有 3 个信号但都来自同一天，需要跨天确认后才能毕业（除非是明确无歧义的显式声明）。

### 10.4 context/objective.yaml（确认的目标）

```yaml
entries:
  - content: "User is building skill-evolver — an npm-distributed tool that automatically creates and evolves Claude Code skills by launching background agents to review session history."
    graduated: "2026-03-05"
    source_signals: 28
    last_validated: "2026-03-09"
```

这个条目有 28 个支持信号，是整个数据集中置信度最高的条目，反映了用户的核心项目活动。

## 11. 与其他 Skill / Agent 的关系

在 skill-evolver 的多 Agent 并行架构中，三个 Agent 在每个进化周期中同时运行：

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Context Agent   │   │   Skill Agent   │   │   Task Agent    │
│  (维护用户画像)  │   │  (演化技能)      │   │  (规划任务)      │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
    写入 user-context     读取 user-context      读取 user-context
                          (只读)                 (只读)
```

### 11.1 为 Skill Agent 提供上下文

Skill Agent 在需求发现阶段会读取 user-context 的数据：

- 读取 `context/objective.yaml`：针对每个目标问"什么 skill 能帮助用户更有效地实现这个目标？"
- 读取 `context/preference.yaml`：分析偏好中是否隐含了可以被编码为 skill 的标准化工作流
- 这些都是**只读访问**，Skill Agent 不能修改 user-context 的任何文件

### 11.2 为 Task Agent 提供上下文

Task Agent 在任务分解阶段依赖 user-context 的数据：

- 读取 `context/objective.yaml`：对每个目标进行任务分解，识别可自动化的检查、监控和信息收集
- 读取 `context/preference.yaml` 和 `tmp/` 文件：理解用户偏好以确保规划的任务与用户习惯一致
- 同样是**只读访问**

### 11.3 单向数据流原则

user-context 的数据只由 Context Agent 写入，其他 Agent 只能读取。这保证了数据的一致性——不存在多个 Agent 同时修改同一文件的竞争条件。

### 11.4 运行时的跨 skill 协作

在普通 Claude Code 会话中，user-context 和 skill-evolver 的确认数据共同为 Claude 提供个性化的上下文：

- user-context 告诉 Claude **用户是谁**（偏好、目标、认知）
- skill-evolver 告诉 Claude **什么技术有效**（成功经验、失败经验、有用技巧）
- 两者结合使 Claude 能够避免已知陷阱、应用已验证的方法、用正确的方式与用户沟通
