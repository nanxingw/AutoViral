# Task Planner Skill — 工作原理详解

## 1. 概述

task-planner 是 skill-evolver 系统中的**主动式任务调度 skill**。它使 Claude Code 具备了自主规划和执行定时任务的能力，将用户的目标分解为可自动执行的后台任务。

与 user-context（管理用户画像）和 skill-evolver（管理技术经验）不同，task-planner 不处理"认知积累"，而是专注于**行动规划**——将积累的认知转化为实际的自动化工作流。

task-planner 在三种模式下工作：

| 模式 | 触发时机 | 作用 |
|------|----------|------|
| **Runtime** | 用户正常使用 Claude Code | 帮助用户交互式创建、编辑、查看任务 |
| **Evolution** | 后台演化周期（Task Agent） | 分析用户目标和经验，主动提议有价值的自动化任务 |
| **Post-task** | 任务执行完成后 | 回顾任务产出，提取经验教训，发射 skill-need 信号 |

数据存储分布在两个位置：

- `~/.skill-evolver/tasks/tasks.yaml` — 中心化任务存储（所有任务的单一数据源）
- `~/.claude/skills/task-planner/` — skill 元数据、创意缓冲区、拒绝追踪

---

## 2. Task 数据模型

所有任务存储在 `~/.skill-evolver/tasks/tasks.yaml` 中，以 YAML 数组形式组织。

### 完整字段定义

#### 必填字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | string | 唯一标识符。格式：`t_YYYYMMDD_HHmm_<3字符十六进制>`，如 `t_20260306_1530_abc`。程序生成时使用 `t-<base36时间戳>-<4字符随机串>` |
| `name` | string | 简短的人类可读名称，不超过 60 字符 |
| `prompt` | string | 任务触发时发送给 Claude 的完整 prompt。**必须完全自包含**——执行时的 Claude 没有任何演化上下文 |
| `schedule` | object | 调度配置（见下文） |
| `status` | enum | 任务状态：`pending`、`active`、`paused`、`running`、`completed`、`expired` |
| `approved` | boolean | 是否经用户批准。用户创建的默认 `true`，Agent 创建的取决于 auto-approve 配置 |
| `runCount` | integer | 累计执行次数，初始为 `0` |
| `createdAt` | string | ISO 8601 创建时间 |

#### Schedule 对象

```yaml
# 周期性任务（cron 调度）
schedule:
  type: cron
  cron: "0 8 * * *"       # 5 字段 cron 表达式

# 一次性任务
schedule:
  type: one-shot
  at: "2026-03-07T10:00:00Z"   # ISO 时间戳
```

#### 可选字段

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `description` | string | - | 任务的详细描述 |
| `model` | string | 系统配置值 | Claude 模型：`opus`、`sonnet`、`haiku` |
| `source` | string | `"user"` | 创建来源：`"user"`（用户创建）或 `"agent"`（Agent 自动创建） |
| `tags` | string[] | `[]` | 分类标签。`["skill-building"]` 为特殊标签，标记 skill 构建任务 |
| `relatedSkills` | string[] | `[]` | **技能关联**——该任务执行时应利用的 skill 列表。执行器会在 prompt 中注入这些 skill 的 SKILL.md 路径，引导 Claude 在执行任务前阅读相关技能的最佳实践 |
| `skillTarget` | string | - | **skill 构建目标**——仅用于 skill-building 任务，标明要创建或更新的 skill 名称。Post-task 回顾时会据此验证目标 skill 是否已创建 |
| `lastRun` | string | - | 最近一次执行的 ISO 时间戳 |
| `max_runs` | integer \| null | `null` | 最大执行次数。`null` 表示无限制 |

### 真实数据示例

以下是来自实际系统的任务数据片段：

```yaml
tasks:
  - id: t_20260306_1815_8f1
    name: 每日AI新闻摘要
    description: 每天早上自动收集最新AI新闻，聚焦LLM、Agent和记忆系统领域
    prompt: 'Search for the latest AI news...'
    schedule:
      type: cron
      cron: 0 8 * * *
    status: active
    approved: true
    tags: [ai, news, daily]
    runCount: 4
    createdAt: '2026-03-06T10:15:17.633Z'
    lastRun: '2026-03-09T01:49:58.621Z'

  - id: t_20260309_1245_a3c
    name: OMNE 005 评测结果检查
    schedule:
      type: one-shot
      at: '2026-03-09T05:30:00.000Z'
    status: completed
    relatedSkills: [python-llm-resilience]    # 关联了一个 skill
    runCount: 1
```

---

## 3. Task 生命周期

### 状态转换图

```
                    ┌─────────────┐
                    │   pending   │ ←── Agent 创建（auto-approve OFF）
                    └──────┬──────┘
                           │ 用户批准
                           ▼
  用户创建 ──────▶ ┌─────────────┐ ◀──── 任务执行完成（周期性任务恢复）
  Agent 创建 ─────▶│   active    │
  (auto-approve ON)└──┬───┬───┬──┘
                      │   │   │
              用户暂停│   │   │ 停用/拒绝
                      ▼   │   ▼
              ┌────────┐  │  ┌─────────┐
              │ paused │  │  │ expired │
              └───┬────┘  │  └─────────┘
                  │       │
            用户恢复      │ 调度器触发执行
                  │       ▼
                  │  ┌─────────────┐
                  └─▶│  running    │
                     └──┬──────┬──┘
                        │      │
            执行完成（周期性）  执行完成（一次性或达到 max_runs）
                        │      │
                        ▼      ▼
                   ┌────────┐ ┌───────────┐
                   │ active │ │ completed │
                   └────────┘ └───────────┘
```

### 各状态含义

| 状态 | 描述 | 是否执行 |
|------|------|----------|
| `pending` | Agent 提议的任务，等待用户批准 | 不执行 |
| `active` | 已批准并已调度，将按计划执行 | 是 |
| `paused` | 用户手动暂停，保留调度配置 | 不执行 |
| `running` | 正在被守护进程执行中 | 执行中 |
| `completed` | 一次性任务已完成执行，或周期性任务达到 `max_runs` | 不再执行 |
| `expired` | 已停用或被拒绝 | 不执行 |

### 关键转换逻辑

- **active -> running**：调度器 tick 检测到到期后触发（`scheduler.ts` 中 `runTaskJob`）
- **running -> active**：周期性任务执行完成后恢复
- **running -> completed**：一次性任务执行完成，或 `runCount >= taskMaxRunsPerTask`
- **running -> active（失败）**：执行过程中 Claude CLI 异常退出，状态回退为 active 以便重试

---

## 4. 调度机制

### 4.1 Cron 表达式解析

系统使用自实现的轻量级 5 字段 cron 解析器（`src/cron.ts`），无外部依赖。

**格式**：`分钟 小时 日 月 星期`

| 表达式 | 含义 |
|--------|------|
| `0 * * * *` | 每小时整点 |
| `0 9 * * *` | 每天 9:00 |
| `0 9 * * 1-5` | 工作日 9:00 |
| `*/30 * * * *` | 每 30 分钟 |
| `0 10 * * 1` | 每周一 10:00 |

**解析流程**：

1. `parseCron(expr)` 将表达式拆分为 5 个 token
2. 每个 token 通过 `parseField()` 解析，支持：通配符 `*`、范围 `1-5`、步长 `*/10`、枚举 `1,3,5`
3. 返回 `CronExpression` 对象，各字段包含展开后的合法值数组

**下一次运行计算**：`nextCronRun(expr, after)` 从 `after` 时间点开始，逐分钟向前推进（带跳跃优化），找到第一个满足所有字段的时间点。搜索上限为 1 年。

**人类可读描述**：`describeCron(expr)` 将常见 cron 模式转换为自然语言描述（如 `"0 8 * * *"` -> `"Every day at 08:00"`），用于前端展示。

### 4.2 One-shot 调度

一次性任务通过 `schedule.at` 指定 ISO 时间戳。调度器在每次 tick 时检查当前时间是否 >= 计划时间，满足则执行。执行完成后自动标记 `status: completed`。

### 4.3 调度器实现（scheduler.ts）

调度器由两个独立的定时器组成：

**演化定时器（Evolution Timer）**：
- 使用 `setTimeout` 实现，间隔由用户配置的 `interval`（默认 1h）决定
- 采用"完成后重新计时"模式——上一次演化周期完成后，才开始下一轮计时
- 如果触发时已有演化任务在跑，延迟 60 秒后重试

**任务 Tick（Task Tick）**：
- 使用 `setInterval` 每 30 秒执行一次
- 每次 tick 执行以下检查：
  1. 检查并发限制（`taskMaxConcurrent`，来自配置）
  2. 优先处理 post-task 队列（经验提取优先于新任务执行）
  3. 遍历所有 `status: active` 的任务，检查是否到期
  4. 对 cron 任务：计算 `nextCronRun(lastRun)` 是否 <= 当前时间
  5. 对 one-shot 任务：检查 `schedule.at` 是否 <= 当前时间
  6. 到期则调用 `runTaskJob(task)` 启动执行

```
每 30 秒
    │
    ├─ 检查并发限制
    ├─ 处理 post-task 队列
    └─ 遍历 active 任务
         ├─ cron 任务: nextCronRun(lastRun) <= now? → 执行
         └─ one-shot 任务: schedule.at <= now? → 执行
```

---

## 5. Task Agent 工作流

Task Agent 是多智能体演化周期中的三个并行 Agent 之一（另外两个是 Context Agent 和 Skill Agent）。它的核心使命是**将用户目标分解为可执行的自动化任务**。

### Phase 1: 目标分解（Objective Decomposition） — 必须执行

这是 Task Agent 最重要的步骤。读取 `~/.claude/skills/user-context/context/objective.yaml`，对每个目标执行结构化分析：

```
Objective: "<目标描述>"
  Current status: <从会话日志推断的当前进展>
  Potential tasks:
    - <任务创意 1> (type: info-gathering / quality-check / monitoring / project-work)
    - <任务创意 2>
  Decision: <create / skip (附具体原因)>
```

即使决定跳过某个目标，也必须展示分析过程。这确保了决策的可追溯性。

### Phase 2: 经验驱动分析（Experience-Driven Tasks）

读取 `~/.claude/skills/skill-evolver/tmp/` 中的三个经验文件：

- `failure_experience.yaml` → 能否创建预防性检查任务，提前发现这些失败模式？
- `success_experience.yaml` → 能否创建任务系统性地应用已验证的成功方法？
- `useful_tips.yaml` → 是否有提示暗示了有用的监控任务？

### Phase 3: 会话模式分析（Session Pattern Analysis）

使用 `~/.claude/skills/user-context/scripts/` 中的脚本扫描近期会话：

- 用户反复手动执行的操作 → 自动化
- 用户反复查询的信息 → 定时报告
- 反复出现的错误 → 预防性检查

### Phase 4: Skill 感知（Skill Awareness）

Task Agent 具备对 skill 生态的感知能力（详见第 11 节）。在此阶段：

1. 列出所有可用 skill：`ls ~/.claude/skills/`
2. 检查已演化的 skill：读取 `permitted_skills.md`
3. 为每个计划创建的任务考虑：哪些现有 skill 可以帮助执行？→ 设置 `relatedSkills`
4. 检测 skill 缺口：如果某个目标需要的能力没有现有 skill 提供 → 创建 skill-building 任务

### Phase 5: 任务生命周期管理（Task Lifecycle Management）

审查 `~/.skill-evolver/tasks/tasks.yaml` 中的现有任务：

- 浏览 `~/.skill-evolver/tasks/<id>/artifacts/` 检查产出质量
- 评估调度频率是否仍然合适
- 判断是否需要调整、暂停或移除某些任务
- 对于 skill-building 任务：目标 skill 是否已创建？是 → 标记 `completed`

### Phase 6: 决策与创建（Decision and Creation）

综合 Phase 1-5 的分析，按安全分级（第 13 节）优先创建低风险任务。创建前必须：

- 检查 `_rejected.yaml` 防止重复提议
- 检查 `tasks.yaml` 避免重复任务
- 根据 auto-approve 配置设置 `status` 和 `approved`

### Phase 7: 报告撰写

输出结构化报告，必须包含以下必填章节：目标分解、经验驱动分析、会话模式、Skill 感知、现有任务审查、新建任务、修改记录、创意缓冲区更新、备注。

---

## 6. Skill-Building Task — 特殊的 skill 构建任务

Skill-building 任务是 task-planner 中一类特殊的任务类型，其目的是**创建或改进 Claude Code skill**。它是 task 系统与 skill 系统之间的桥梁。

### 识别标志

- `tags` 数组包含 `"skill-building"`
- 必须设置 `skillTarget` 字段，指定目标 skill 名称

### Prompt 模板

Skill-building 任务的 prompt 遵循固定结构：

```yaml
prompt: |
  You are a skill builder. Create (or improve) a Claude Code skill
  using the skill-creator methodology.

  TARGET SKILL: <skill-name>
  GOAL: <skill 的功能目标>
  EVIDENCE: <为什么需要这个 skill — 具体的模式、失败或用户需求>

  INSTRUCTIONS:
  1. Read ~/.claude/skills/skill-creator/SKILL.md — 遵循标准的 skill 创建流程
  2. 检查目标 skill 是否已存在
     - 存在：读取 SKILL.md，识别改进点，做定向编辑
     - 新建：创建目录、编写 SKILL.md（触发优化的 description）
  3. 编写基础 evals（2-3 个测试用例）
  4. 在 permitted_skills.md 中注册
  5. 撰写报告
```

### 触发条件

Task Agent 在以下情况创建 skill-building 任务：

- 某个用户目标需要的能力没有现有 skill 覆盖
- 多个任务共享相似模式，适合抽象为 skill
- 任务失败揭示了某个知识缺口
- 用户在某个领域反复需要指导

### 验证流程

Post-task 回顾（第 8 节）对 skill-building 任务执行额外验证：

1. 检查 `~/.claude/skills/<skillTarget>/SKILL.md` 是否已创建
2. 验证是否已在 `permitted_skills.md` 中注册
3. 如果创建成功 → 标记任务 `completed`
4. 如果创建失败 → 发射 skill-need 信号，由下一轮 Skill Agent 处理

---

## 7. Task 执行流程

### 7.1 执行触发

当调度器 tick 检测到某个任务到期（详见第 4.3 节），调用 `runTaskJob(task)` 启动执行流程。

### 7.2 buildTaskPrompt — 构建执行 prompt

`buildTaskPrompt(task, artifactsDir, reportPath)` 组装最终发送给 Claude CLI 的 prompt，由以下部分组成：

**身份声明**：
```
You are running as a background task executor for skill-evolver.
You have bypassPermissions — you can read and write any file needed.
```

**安全规则**：
- 不得直接修改用户源代码文件
- 代码变更需使用 git 分支
- 持久化产物写入指定的 artifacts 目录

**Related Skills 注入**（条件性）：

如果任务设置了 `relatedSkills`，prompt 中会自动注入关联 skill 的引导：

```
## Related Skills
The following skills are relevant to this task. Read their SKILL.md files for guidance before starting:
- ~/.claude/skills/<skill-name>/SKILL.md
```

这让执行 Claude 在开始任务前先阅读相关 skill 的最佳实践，提高执行质量。

**任务详情**：名称、描述、ID、skillTarget（如有）、完整 prompt。

**工件目录**：`~/.skill-evolver/tasks/<task-id>/artifacts/` — 跨运行共享。

**报告路径**：`~/.skill-evolver/tasks/<task-id>/reports/YYYY-MM-DD_HH-mm_report.md`

### 7.3 执行过程

```
调度器 tick
    │
    ▼
runTaskJob(task)
    │
    ├─ 1. 检查 max_runs 限制
    ├─ 2. 创建 artifacts/ 和 reports/ 目录
    ├─ 3. 构建 prompt（buildTaskPrompt）
    ├─ 4. 更新任务状态 → running
    ├─ 5. 调用 executor.run() 启动 Claude CLI
    │      └─ spawn("claude", ["-p", prompt, "--model", model, ...])
    ├─ 6. 执行完成后更新状态：
    │      ├─ 一次性任务 → completed
    │      └─ 周期性任务 → active, runCount++
    └─ 7. 如果 taskAutoApprove 开启 → 触发 post-task 回顾
```

### 7.4 产物存储结构

```
~/.skill-evolver/tasks/<task-id>/
  artifacts/           # 持久化工件（跨运行共享）
  reports/             # 每次运行的报告
    2026-03-09_08-00_report.md
    2026-03-09_09-00_report.md
```

---

## 8. Post-task 回顾

### 8.1 触发机制

在 `taskAutoApprove` 开启的情况下，每次任务执行完成后自动触发 post-task 回顾。回顾通过 `triggerPostTaskCycle(task, taskReport)` 发起，内置去抖机制：

- 维护 `postTaskLastTrigger` Map 记录每个 task 最后一次触发时间
- 在 `postTaskDebounce`（配置项，秒为单位）窗口内的重复触发会被加入队列
- 队列在下一次 tick 时优先处理

### 8.2 buildPostTaskPrompt — 构建回顾 prompt

`buildPostTaskPrompt(task, taskReport, recentReports)` 生成回顾 Agent 的 prompt，指导其执行以下 7 项工作：

1. **质量评估**：评判任务是否成功完成，记录问题和改进方向

2. **经验更新**：基于任务产出更新 skill-evolver 的经验库：
   - 成功经验 → `success_experience.yaml`
   - 失败经验 → `failure_experience.yaml`
   - 非显而易见的技巧 → `useful_tips.yaml`

3. **Skill-need 信号发射**（核心机制）：当任务遭遇困难、失败或不得不即兴发挥时，向 `~/.claude/skills/skill-evolver/tmp/skill_needs.yaml` 写入信号：

   ```yaml
   entries:
     - need: "Python async error handling patterns"
       source_task: "t_20260309_1200_a3f"
       task_name: "Debug async pipeline"
       evidence: "Task failed 3 times on same async pattern"
       priority: "high"       # high = 任务失败, medium = 任务挣扎
       date: "2026-03-09"
       addressed: false
   ```

4. **Skill-building 任务验证**：对带有 `tags: ["skill-building"]` 或 `skillTarget` 的任务执行额外检查——验证目标 skill 是否已创建并注册

5. **后续行动评估**：判断是否需要创建新任务、更新用户上下文或修改 skill

6. **创意缓冲区更新**：将任务产出中发现的新创意写入 ideas buffer

7. **撰写回顾报告**：输出到 `~/.skill-evolver/reports/YYYY-MM-DD_HH-mm_post-task_report.md`

### 8.3 经验闭环

Post-task 回顾的核心价值在于形成"执行 → 反思 → 积累 → 进化"的闭环。每次任务执行的经验教训不会丢失，而是被结构化地写入经验库，供后续的 Skill Agent 和 Task Agent 在下一轮演化中使用。

---

## 9. Idea Buffer — 轻量级创意管理

### 数据位置

`~/.claude/skills/task-planner/buffer/ideas.yaml`

### 格式

```yaml
entries:
  - idea: "Run linting every morning"
    reason: "User corrected lint issues 4 times over 2 weeks"
    added: "2026-03-05"
    source_context: "preference: user cares about code quality"
```

### 设计哲学

Idea Buffer 是一个**非承诺性**的创意便签本：

- Task Agent 在发现模式时自由添加创意
- 陈旧的创意可以自由删除
- 创意不是严格的提案——它们只是备忘
- 当 Task Agent 决定基于某个创意创建任务时，同时从 buffer 中移除该创意
- 用户也可以通过前端 Dashboard 添加创意

Idea Buffer 的存在让 Task Agent 可以在"还不确定是否值得创建任务"时先记录下来，在后续周期中积累更多证据后再做决定。

---

## 10. _rejected.yaml — 拒绝追踪

### 数据位置

`~/.claude/skills/task-planner/tasks/_rejected.yaml`

### 格式

```yaml
entries:
  - name: "Auto-format on save"
    reason: "User prefers manual formatting control"
    rejected_at: "2026-03-06"
    original_source: "agent"
```

### 作用

防止 Task Agent 反复提议已被用户拒绝的任务。这是一个**语义级**的检查——Task Agent 在创建任何新任务前，必须读取此文件并判断新提案是否与已拒绝的条目语义相似。

### 写入时机

- 用户在 Dashboard 中拒绝一个 `pending` 任务时
- Task Agent 在生命周期管理中将无用任务标记为 `expired` 时
- 程序通过 `task-store.ts` 中的 `addRejected()` 函数写入

`addRejected()` 自动附加时间戳，并支持任意的 key-value 扩展。

---

## 11. Skill 感知能力

Task Agent 不是孤立工作的——它对整个 skill 生态具有感知能力，这种感知体现在两个方向上：

### 11.1 利用现有 Skill（relatedSkills）

Task Agent 在创建任务时，可以为任务设置 `relatedSkills` 字段。这让任务执行时的 Claude 知道应该参考哪些 skill 的最佳实践。

**流程**：
1. Task Agent 列出 `~/.claude/skills/` 中的所有 skill
2. 对计划创建的每个任务，判断哪些 skill 与之相关
3. 设置 `relatedSkills: ["skill-a", "skill-b"]`
4. 执行时 `buildTaskPrompt` 自动将这些 skill 路径注入 prompt

**实际效果**：例如上文真实数据中的"OMNE 005 评测结果检查"任务，设置了 `relatedSkills: [python-llm-resilience]`，执行时 Claude 会先阅读该 skill 的 SKILL.md，获得 Python LLM 弹性处理的最佳实践，再执行评测检查。

### 11.2 识别 Skill 缺口（skill-building tasks）

Task Agent 通过以下方式检测 skill 缺口：

1. **目标驱动**：某个用户目标需要的能力没有现有 skill 覆盖
2. **模式驱动**：多个任务共享相似的执行模式，适合抽象为通用 skill
3. **失败驱动**：任务失败暴露了某个知识领域的缺口

检测到缺口后，Task Agent 创建 skill-building 任务（第 6 节），由 skill-creator 方法论指导实际的 skill 创建。

### 11.3 与 Skill Agent 的分工

| 职责 | Task Agent | Skill Agent |
|------|-----------|-------------|
| 创建任务 | 是 | 否（只读 tasks.yaml） |
| 创建 skill | 否（通过 skill-building 任务间接创建） | 是（直接创建） |
| 检测 skill 缺口 | 是（在 Phase 4） | 是（在 Need Discovery） |
| 修改 skill 文件 | 否 | 是 |
| 设置 relatedSkills | 是 | 否 |

---

## 12. 与 skill-evolver 的协同

task-planner 与 skill-evolver 的核心 skill 之间存在精心设计的协同关系，形成闭环进化机制。

### 12.1 信息流向

```
┌──────────────────┐
│   user-context   │ ─── 目标、偏好 ──────▶ Task Agent (Phase 1, 2)
│  (Context Agent) │
└──────────────────┘

┌──────────────────┐
│  skill-evolver   │ ─── 成功/失败经验 ──▶ Task Agent (Phase 2)
│  (Skill Agent)   │ ◀── skill-need 信号 ── Post-task 回顾
└──────────────────┘

┌──────────────────┐
│  task-planner    │ ─── 任务执行报告 ──▶ Skill Agent (Source E)
│  (Task Agent)    │ ◀── 已有 skill 列表 ─ Skill Agent
└──────────────────┘
```

### 12.2 Skill-need 信号桥梁

这是连接 task 执行与 skill 创建的关键机制：

1. **信号生成**：Post-task 回顾（`buildPostTaskPrompt`）在任务挣扎或失败时，向 `skill_needs.yaml` 写入信号
2. **信号存储**：`task-store.ts` 中的 `addSkillNeed()` 函数负责写入，自动按 `need` 字段去重（相同 need 追加 evidence）
3. **信号消费**：Skill Agent 在 Need Discovery 的 Source F 中优先读取 `skill_needs.yaml`，处理后将 `addressed` 设为 `true`
4. **信号优先级**：`high`（任务失败）优先于 `medium`（任务挣扎），Skill Agent 被指示 FIRST 处理这些信号

### 12.3 闭环演化

```
用户目标 ──▶ Task Agent 创建任务 ──▶ 任务执行
                                        │
                                        ▼
                                   Post-task 回顾
                                        │
                              ┌─────────┴──────────┐
                              ▼                    ▼
                         经验更新             skill-need 信号
                              │                    │
                              ▼                    ▼
                    下轮 Task Agent         下轮 Skill Agent
                    (Phase 2 使用)         (创建/改进 skill)
                              │                    │
                              ▼                    ▼
                       创建更好的任务        新 skill 可用
                              │                    │
                              └───────┬────────────┘
                                      ▼
                              任务通过 relatedSkills
                              利用新 skill 执行得更好
```

### 12.4 多智能体并行

在多智能体演化模式下，Context Agent、Skill Agent、Task Agent 三个 Agent **并行运行**（`Promise.allSettled`），各自独立工作但共享数据：

- Context Agent 更新用户画像（Task Agent 下一轮读取）
- Skill Agent 创建/改进 skill（Task Agent 下一轮通过 relatedSkills 利用）
- Task Agent 创建/管理任务（Skill Agent 下一轮通过 task 报告发现需求）

并行执行提高了效率，但也意味着同一轮周期内三个 Agent 看到的数据不包含本轮其他 Agent 的更新。跨 Agent 的协同效果在下一轮演化周期体现。

---

## 13. 安全分级

Task Agent 在创建任务时遵循四级安全分类，**优先创建风险更低的任务**：

### 第一级：信息收集（Information Gathering） — 始终安全

- 新闻聚合、趋势追踪、摘要生成、监控报告
- 仅读取外部信息，不修改任何用户文件
- 示例：每日 AI 新闻摘要、每周论文 Digest

### 第二级：质量检查（Quality Checks） — 低风险

- 代码检查（lint）、类型检查、依赖审计、安全扫描
- 只读取项目代码并生成报告，不做修改
- 示例：每日 ESLint 检查、依赖漏洞扫描

### 第三级：项目监控（Monitoring） — 低风险

- 进度追踪、状态报告、评测结果检查
- 读取项目状态信息，生成结构化报告
- 示例：OMNE 评测状态检查、项目进度周报

### 第四级：项目工作（Project Work） — 中等风险

- 代码生成、文档编写、配置修改
- 可能修改用户项目中的文件
- 安全约束：必须使用 git 分支，不得直接修改源文件，产物写入 artifacts 目录
- 示例：skill-building 任务（创建新 skill）

### 安全规则执行

`buildTaskPrompt` 中注入了硬编码的安全规则：

```
CRITICAL SAFETY RULES:
- NEVER modify user source files directly.
- Use git branches for any code changes.
- All persistent artifacts should be written to the artifacts directory below.
```

此外，`buildTaskAgentPrompt` 中的 `CRITICAL PATH CONSTRAINT` 禁止修改项目源码目录中的 skill 模板文件，确保只能操作 `~/.claude/skills/` 下的已安装 skill。
