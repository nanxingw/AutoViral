# Multi-Agent Evolution Architecture — Development Plan

> **Status**: Proposed
> **Branch**: `feature/multi-agent-evolution`
> **Created**: 2026-03-09
> **Priority**: P0 — Core architecture upgrade

---

## 1. Problem Statement

### 1.1 Current Architecture

每次 evolution cycle 启动 **单个 Claude agent**，用一个巨大的 prompt 同时完成三件事：
1. 扫描 session logs → 更新 user-context（preference/objective/cognition）
2. 提取技术经验 → 积累到 skill-evolver tmp → 创建/更新 skill
3. 管理 task-planner（ideas buffer → 创建 task）

### 1.2 产出数据（60+ cycles，3天运行）

| 维度 | 产出 | 评价 |
|------|------|------|
| user-context | 19 条 graduated entries | 正常 |
| skill 创建 | **0 个** | 严重不足 |
| task 创建 | **1 个**（每日AI新闻） | 严重不足 |

### 1.3 根因分析

1. **注意力稀释**：单个 agent 处理三项职责，在 context window 中互相竞争注意力。user-context 是最"机械化"的任务（扫 log → 提取 signal → 写 YAML），占据了大量工作量，skill 创建和 task 规划被挤压为 "最后附带检查一下" 的步骤。
2. **缺乏专注推理空间**：Skill 创建需要**深度理解用户需求 + 搜索已有 skill + 创造性设计**；Task 规划需要**基于 objectives 的目标分解推理**。这些都不适合作为一个大任务的末尾附带步骤。
3. **保守逃逸**：当 agent 工作量已经很大时，对于不确定的决策（是否创建 skill？是否创建 task？）本能选择 "None"，因为不创建不会出错。
4. **信息茧房**：session logs 被一个 agent 全部消耗，但它只从"技术经验"角度提取信号，忽略了 session 中可能暗示的**用户隐性需求**和**可自动化的重复模式**。

---

## 2. Target Architecture

### 2.1 Three Parallel Agents

```
Evolution Cycle Trigger
        │
        ├──────────────────────┬──────────────────────┐
        ▼                      ▼                      ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Context     │    │  Skill           │    │  Task            │
│  Agent       │    │  Agent           │    │  Agent           │
│              │    │                  │    │                  │
│ 职责:        │    │ 职责:             │    │ 职责:             │
│ user-context │    │ 需求洞察          │    │ 目标分解          │
│ 维护与演化    │    │ skill搜索/创建    │    │ task规划/编排     │
│              │    │ skill演化/改进     │    │                  │
│ 写权限:       │    │ 写权限:           │    │ 写权限:           │
│ user-context/│    │ skill-evolver/   │    │ task-planner/    │
│ context/     │    │ tmp/             │    │ buffer/          │
│ tmp/         │    │ permitted_skills │    │ tasks.yaml       │
│              │    │ ~/.claude/skills/│    │ _rejected.yaml   │
│ 读权限:       │    │ (new skills)     │    │                  │
│ session logs │    │                  │    │ 读权限:           │
│              │    │ 读权限:           │    │ user-context/    │
│              │    │ user-context/    │    │   context/       │
│              │    │   context/ + tmp/│    │   tmp/           │
│              │    │ session logs     │    │ skill-evolver/   │
│              │    │ skill-evolver/   │    │   tmp/           │
│              │    │   tmp/           │    │ session logs     │
│              │    │ skillhub等平台    │    │                  │
└──────┬───────┘    └──────┬───────────┘    └──────┬───────────┘
       │                   │                       │
       ▼                   ▼                       ▼
  context_report.md   skill_report.md        task_report.md
       │                   │                       │
       └───────────────────┴───────────────────────┘
                           │
                    合并为最终 report
```

### 2.2 Agent 间的数据隔离与共享原则

| 数据 | Context Agent | Skill Agent | Task Agent |
|------|:---:|:---:|:---:|
| `user-context/context/` | **R/W** | R | R |
| `user-context/tmp/` | **R/W** | R | R |
| `skill-evolver/tmp/` | — | **R/W** | R |
| `skill-evolver/reference/` | — | **R/W** | R |
| `~/.claude/skills/*` (new) | — | **R/W** | — |
| `tasks.yaml` | — | — | **R/W** |
| `buffer/ideas.yaml` | — | — | **R/W** |
| `_rejected.yaml` | — | — | **R/W** |
| session logs | R | R | R |

**关键原则**：
- 每个 agent **只写自己负责的数据**，避免冲突
- 每个 agent **可以读其他 agent 负责的数据**，获取跨领域上下文
- 三个 agent **并行执行**，互不等待

### 2.3 执行时序

```
t=0    ┌─ Context Agent starts ─────────────────────────┐
       │  Skill Agent starts ───────────────────────────┤
       │  Task Agent starts ────────────────────────────┤
       │                                                 │
t=N    └─ All agents complete ──────────────────────────┘
                      │
                      ▼
              Merge 3 reports → final report
              Cleanup old reports
              Schedule next cycle
```

---

## 3. Agent 设计详案

### 3.1 Context Agent（用户上下文维护）

**职责不变**，继承当前 evolution prompt 中 user-context 相关的全部逻辑。

**Prompt 结构**：
```
Identity: 你是 user-context 演化 agent。
你的唯一职责是维护用户画像：preference, objective, cognition。

## 数据路径
- 写: ~/.claude/skills/user-context/context/ 和 tmp/
- 读: session logs

## 脚本工具
(list-sessions, session-digest, search-messages 等，同现有)

## 操作流程
1. 查找未分析的 session
2. 提取用户偏好/目标/认知信号
3. ADD SIGNAL 到 tmp
4. 检查 graduation 条件
5. 清理 stale entries
6. 写 report

## 近期 reports（连续性上下文）
{recent_reports}
```

**变更点**：
- 移除 skill 和 task 相关的所有指令
- Prompt 更短、更聚焦
- Agent 只需关注 "用户是谁" 这一个问题

---

### 3.2 Skill Agent（技能进化）— 核心重设计

这是本次改动最大的 agent。彻底重新设计其目标和工作流。

#### 3.2.1 设计理念转变

| | 旧设计 | 新设计 |
|--|--------|--------|
| 核心目标 | 积累技术经验 → 够了就创建 skill | **洞察用户需求 → 为需求寻找/创建 skill** |
| 触发条件 | 3+ signals, 2+ days, cross-context | **识别到用户的一个未被满足的需求** |
| 信息源 | 仅 session logs 中的技术模式 | session logs + user-context + 外部 skill 平台 |
| 缓冲区 | tmp/ 中的 success/failure/tips | **取消缓冲区的"毕业"概念**，tmp 只作为经验参考 |
| 创建方式 | 从头手写 SKILL.md | **优先搜索已有 skill → 下载适配 → 不存在再创建** |

#### 3.2.2 新工作流：Need-Driven Skill Evolution

```
┌─────────────────────────────────────────────────────────┐
│                  Skill Agent 工作流                       │
│                                                          │
│  Step 1: 需求发现 (Discover Needs)                        │
│  ├── 读 user-context/context/objective.yaml              │
│  ├── 读 user-context/tmp/ (emerging signals)             │
│  ├── 扫描 session logs: 用户反复做了什么？卡在哪？        │
│  ├── 扫描 skill-evolver/tmp/: 有什么反复出现的模式？      │
│  └── 输出: needs[] — 用户的显性+隐性需求列表              │
│                                                          │
│  Step 2: 需求匹配 (Match Against Existing)               │
│  ├── 对每个 need:                                        │
│  │   ├── 检查 ~/.claude/skills/ 是否已有覆盖的 skill     │
│  │   ├── 如果有 → 评估是否需要改进（进入 Step 4）         │
│  │   └── 如果没有 → 进入 Step 3                          │
│  └── 输出: unmet_needs[] — 未被现有 skill 覆盖的需求     │
│                                                          │
│  Step 3: 外部搜索 (Search External Skills)               │
│  ├── 对每个 unmet_need:                                  │
│  │   ├── 搜索 https://www.skillhub.club/                │
│  │   ├── 搜索 GitHub (claude code skills)               │
│  │   ├── 评估找到的 skill 是否满足需求                    │
│  │   ├── 如果找到合适的 → 下载 + 适配修改                │
│  │   └── 如果没找到 → 进入 Step 4                       │
│  └── 输出: 已安装的外部 skill 列表                        │
│                                                          │
│  Step 4: 创建/进化 (Create or Evolve)                    │
│  ├── 对剩余未满足的需求: 从头创建 skill                   │
│  ├── 对需要改进的已有 skill: 基于新信号进化                │
│  ├── 使用 skill-creator 的最佳实践                       │
│  └── 注册到 permitted_skills.md                          │
│                                                          │
│  Step 5: 经验维护 (Maintain Experience Base)              │
│  ├── 正常的 ADD SIGNAL / CLEAN STALE                     │
│  └── 经验作为创建/改进 skill 的参考，不再有独立的"毕业"   │
│                                                          │
│  Step 6: 写 report                                       │
└─────────────────────────────────────────────────────────┘
```

#### 3.2.3 Skill Agent Prompt 结构

```markdown
# Skill Evolution Agent

你是 skill-evolver 的技能进化 agent。你的核心使命是：
**洞察用户需求，并为这些需求找到或创建最好的 Claude Code skill。**

你不是被动地积累经验等待毕业。你是主动地理解用户、发现缺口、填补缺口。

## 你的工作流

### Step 1: 需求发现

用户不会告诉你他需要什么 skill。你需要从多个信源推断：

**信源 A — 用户目标 (objectives)**
读 `~/.claude/skills/user-context/context/objective.yaml`。
对于每个目标，思考：为了更好地完成这个目标，用户可能需要什么skill？

**信源 B — 用户偏好 (preferences)**
读 `~/.claude/skills/user-context/context/preference.yaml`。
用户的偏好是否暗示了某种标准化的工作流？

**信源 C — 积累的经验 (skill-evolver tmp)**
读 `~/.claude/skills/skill-evolver/tmp/` 下的所有文件。
反复出现的 success pattern → 是否可以凝练为 skill？
反复出现的 failure pattern → 是否可以创建一个预防性 skill？

**信源 D — Session logs**
使用 `~/.claude/skills/user-context/scripts/` 下的脚本扫描最近 session。
寻找：
- 用户反复手动执行的操作（可自动化为 skill）
- 用户反复解释的同一件事（应该写入 skill 避免重复）
- 用户遇到的困难或卡点（skill 可以提供预置方案）

### Step 2: 匹配已有 skill

列出 `~/.claude/skills/` 下所有已安装的 skill。
对于每个发现的需求，检查是否已有 skill 覆盖。
如果已有 skill 但质量/覆盖度不够 → 标记为 "待进化"。

### Step 3: 搜索外部 skill

对于未被覆盖的需求，在创建之前**先搜索外部资源**：

1. **SkillHub**: 使用 WebFetch 访问 `https://www.skillhub.club/` 搜索相关 skill
2. **GitHub**: 搜索 "claude code skill" + 相关关键词
3. **Anthropic 官方**: 检查 `https://github.com/anthropics/` 下是否有官方 skill

如果找到匹配的外部 skill：
- 下载到 `~/.claude/skills/<skill-name>/`
- 审查其内容，确保安全和质量
- 根据用户的具体需求进行适配修改
- 注册到 `permitted_skills.md`

### Step 4: 创建或进化 skill

**创建新 skill** — 仅当外部搜索没有满足需求时：
- 读 `~/.claude/skills/skill-creator/SKILL.md` 了解最佳实践
- 设计精确的 description（这决定了 skill 何时被触发）
- 保持 SKILL.md 简洁聚焦
- 注册到 `permitted_skills.md`

**进化已有 skill** — 当 Step 2 发现已有 skill 需要改进时：
- 只修改 `permitted_skills.md` 中列出的 skill
- 使用 Edit 进行外科手术式修改，不要重写整个文件

### Step 5: 经验维护

仍然维护 `tmp/` 中的经验数据（success/failure/tips），但它们的角色变了：
- 经验是你**做决策的参考**，不是等待毕业的候选
- 正常执行 ADD SIGNAL 和 CLEAN STALE
- 经验的价值在于帮助你更好地理解用户需要什么 skill

### 权限边界

- 写: `~/.claude/skills/skill-evolver/tmp/`, `~/.claude/skills/skill-evolver/reference/permitted_skills.md`
- 写: `~/.claude/skills/<new-skill-name>/` (新建 skill)
- 写: `~/.claude/skills/<permitted-skill>/` (进化已注册 skill)
- 读: `~/.claude/skills/user-context/` (全部)
- 读: session logs
- **绝不修改**: user-context 的任何文件, skill-evolver/SKILL.md 本身

### 每个 cycle 的最低输出

你必须在 report 中明确回答以下问题：
1. 本次识别到的用户需求有哪些？（至少列出 3 个）
2. 这些需求中，已有 skill 覆盖了哪些？
3. 本次是否搜索了外部 skill 平台？搜到了什么？
4. 本次是否创建或改进了 skill？如果没有，给出具体理由。
```

#### 3.2.4 tmp/ 角色变化

| | 旧角色 | 新角色 |
|--|--------|--------|
| `success_experience.yaml` | Skill 毕业候选池 | 决策参考：什么方法可靠 |
| `failure_experience.yaml` | Skill 毕业候选池 | 决策参考：什么方法要避免 |
| `useful_tips.yaml` | Skill 毕业候选池 | 决策参考：什么技巧值得推广 |

Schema 不变，使用方式变了：不再等 "3+ signals, 2+ days" 才创建 skill，而是当 agent 从**多个信源**识别到一个需求时，就可以直接行动。经验数据只是帮助 agent 做出更好决策的参考。

---

### 3.3 Task Agent（任务编排）— Prompt 层面修复

#### 3.3.1 设计理念

Task Agent 的核心问题是**缺乏结构化的目标分解推理**。现有 prompt 只是说 "create tasks if appropriate"，需要变为一个有明确推理步骤的流程。

#### 3.3.2 Task Agent Prompt 结构

```markdown
# Task Orchestration Agent

你是 skill-evolver 的任务编排 agent。你的核心使命是：
**基于用户目标和经验，规划有价值的自动化任务。**

## 你的信源（全部为只读）

1. `~/.claude/skills/user-context/context/objective.yaml` — 用户的项目和目标
2. `~/.claude/skills/user-context/context/preference.yaml` — 用户的偏好和工作习惯
3. `~/.claude/skills/user-context/tmp/` — 正在积累的新信号
4. `~/.claude/skills/skill-evolver/tmp/` — 技术经验（成功/失败/技巧）
5. Session logs — 通过 scripts/ 脚本查询
6. `~/.skill-evolver/tasks/tasks.yaml` — 现有任务
7. `~/.claude/skills/task-planner/tasks/_rejected.yaml` — 已拒绝的提案

## 你的工作流

### Phase 1: Objective Decomposition（目标分解）

这是你最重要的步骤。**必须完成，不可跳过。**

读取 `objective.yaml` 中的每个用户目标。对于每个目标：
1. 这个目标当前的状态是什么？（从 session logs 推断）
2. 有哪些可自动化的子任务能推进这个目标？
3. 有哪些定期检查/监控能帮助这个目标？

示例推理：
```
目标: "User is building skill-evolver"
  → 子任务: npm 下载量周报（了解采用情况）
  → 子任务: GitHub issues 检查（了解用户反馈）
  → 子任务: 依赖安全审计（维护代码健康）

目标: "User is building OMNE evaluation framework"
  → 子任务: 评估结果定期摘要
  → 子任务: Neo4j/Qdrant 健康检查
```

### Phase 2: Experience-Driven Tasks（经验驱动的任务）

扫描 `skill-evolver/tmp/` 中的经验：
- **failure patterns** → 是否有预防性检查任务可以避免这些失败？
- **success patterns** → 是否有任务可以系统性地应用这些成功经验？

### Phase 3: Session Pattern Analysis（会话模式分析）

使用脚本扫描近期 session：
- 用户有没有反复手动执行的操作？（→ 自动化任务）
- 用户有没有反复查询的信息？（→ 定期收集任务）

### Phase 4: Task Lifecycle Management（任务生命周期管理）

对已有任务：
- 检查 artifact 质量（是否产出有价值的内容）
- 运行次数和频率是否合理
- 是否需要调整 prompt/schedule
- 是否应该暂停或下线

### Phase 5: Decision and Creation（决策与创建）

综合 Phase 1-4 的分析，做出决策：
- 创建新任务（写入 `~/.skill-evolver/tasks/tasks.yaml`）
- 修改现有任务
- 暂停/下线任务
- 更新 ideas buffer

### 创建任务的指导原则

**任务分类（从安全到激进）**：
1. **信息收集类** — 永远安全：新闻聚合、趋势追踪、竞品监控
2. **质量监控类** — 低风险：lint、type-check、依赖审计、安全扫描
3. **项目推进类** — 中风险：代码生成、文档更新、测试编写
4. **用户代理类** — 高风险：代替用户做决策（需要更高置信度）

每个 cycle 应优先考虑 1-2 类，它们不需要高置信度就可以创建。

**Auto-approve 模式**：{taskAutoApprove 状态}

### 每个 cycle 的最低输出

你必须在 report 中回答：
1. 对每个 objective 的分解结果（即使决定不创建任务也要写出分析）
2. 本次创建/修改/暂停了哪些任务
3. 如果没有创建任何任务，必须逐条说明为什么每个 objective 都不适合创建任务
```

---

## 4. Implementation Plan

### 4.1 Phase 1 — Executor 改造（支持并行 agent）

**文件**: `src/executor.ts`, `src/prompt.ts`, `src/scheduler.ts`

#### 4.1.1 新增：分 agent 的 prompt builder

```typescript
// src/prompt.ts — 新增三个函数

export function buildContextAgentPrompt(
  recentReports: string[]
): string;

export function buildSkillAgentPrompt(
  recentReports: string[],
): string;

export function buildTaskAgentPrompt(
  recentReports: string[],
  opts: { taskAutoApprove: boolean }
): string;
```

保留原有的 `buildPrompt()` 作为 fallback（单 agent 模式），新增三个专用 builder。

#### 4.1.2 新增：并行 evolution cycle

```typescript
// src/executor.ts — 新增

export interface MultiAgentResult {
  context: ExecutionResult;
  skill: ExecutionResult;
  task: ExecutionResult;
  mergedReport: string;
  totalDuration: number;
}

export async function runMultiAgentEvolution(): Promise<MultiAgentResult> {
  const config = await loadConfig();
  const recentReports = await readRecentReports(config.reportsToFeed);

  // Build three prompts
  const contextPrompt = buildContextAgentPrompt(recentReports);
  const skillPrompt = buildSkillAgentPrompt(recentReports);
  const taskPrompt = buildTaskAgentPrompt(recentReports, {
    taskAutoApprove: config.taskAutoApprove,
  });

  // Run three agents in parallel via Promise.allSettled
  const [contextResult, skillResult, taskResult] = await Promise.allSettled([
    executor.run({
      id: `evo-context-${Date.now()}`,
      type: "evolution",    // 复用 type 或新增 subtype
      prompt: contextPrompt,
      model: config.model,
    }),
    executor.run({
      id: `evo-skill-${Date.now()}`,
      type: "evolution",
      prompt: skillPrompt,
      model: config.model,
    }),
    executor.run({
      id: `evo-task-${Date.now()}`,
      type: "evolution",
      prompt: taskPrompt,
      model: config.model,
    }),
  ]);

  // Merge reports...
  // Each agent writes its own sub-report; we merge into final report
}
```

#### 4.1.3 Config 扩展

```typescript
// src/config.ts — 新增字段

export interface Config {
  // ... existing fields ...
  evolutionMode: "single" | "multi";  // 默认 "multi"
}
```

用户可以通过 `skill-evolver config set evolutionMode single` 回退到单 agent 模式。

#### 4.1.4 Executor 并发限制调整

当前 `executor.running` 是一个 Map，已经支持并发。但 `scheduler.ts` 中的 evolution 检查逻辑需要调整：

```typescript
// scheduler.ts — scheduleEvolutionTimer 中
// 旧: 检查是否有 evolution job 在运行
// 新: 检查是否有 evolution 相关的 job 在运行（可能有3个）

const hasEvolution = Array.from(executor.running.values()).some(
  j => j.type === "evolution" || j.type === "evo-context" || j.type === "evo-skill" || j.type === "evo-task"
);
```

#### 4.1.5 报告合并

三个 agent 各自写一份 sub-report，然后由代码合并为最终 report：

```
~/.skill-evolver/reports/
  2026-03-09_14-00_report.md           # 合并后的最终 report
  2026-03-09_14-00_context_report.md   # Context Agent 的原始 report（可选保留）
  2026-03-09_14-00_skill_report.md     # Skill Agent 的原始 report
  2026-03-09_14-00_task_report.md      # Task Agent 的原始 report
```

合并策略：
- 每个 agent 在 prompt 中被指示将 report 写到**指定路径**
- `runMultiAgentEvolution()` 在三个 agent 都完成后，读取三份 report，拼接为一份总 report
- 总 report 结构：`## Context Agent` + `## Skill Agent` + `## Task Agent`

---

### 4.2 Phase 2 — Skill Agent 重设计

**文件**:
- `src/prompt.ts` — Skill Agent prompt
- `skills/skill-evolver/reference/evolution_guide.md` — 重写
- `skills/skill-evolver/SKILL.md` — 更新 description

#### 4.2.1 evolution_guide.md 重写要点

核心变更：

1. **删除** "Skill Creation Flow" 中的毕业条件（3+ signals, 2+ days, cross-context）
2. **新增** "Need Discovery" 作为第一步，取代 "Scan sessions for technical patterns"
3. **新增** "External Skill Search" 步骤，包含：
   - SkillHub (`https://www.skillhub.club/`) 搜索指南
   - GitHub 搜索指南
   - 下载和适配流程
   - 安全审查 checklist
4. **保留** tmp/ 的数据结构和 ADD SIGNAL / CLEAN STALE 操作
5. **修改** tmp 的定位：从 "毕业候选池" 变为 "决策参考库"
6. **新增** "每个 cycle 的最低输出" 要求

#### 4.2.2 外部 Skill 搜索机制

Skill Agent 需要能够访问网络。在 executor 中：
- 当前 `claude` CLI 已通过 `--dangerously-skip-permissions` 授予全部权限
- Claude 可以使用 WebFetch 和 WebSearch 工具
- 需要在 prompt 中教会 agent 如何使用这些工具搜索 skill

**搜索策略**：
```
1. SkillHub 搜索:
   - WebFetch https://www.skillhub.club/ → 解析页面，寻找相关 skill
   - 或者如果有 API: WebFetch https://www.skillhub.club/api/search?q=<keyword>

2. GitHub 搜索:
   - Bash: gh search repos "claude code skill <keyword>" --limit 5
   - 或 WebSearch: "claude code skill <keyword> site:github.com"

3. 下载流程:
   - 确定 skill 的 repo URL
   - Bash: git clone <repo> /tmp/skill-<name>
   - 审查 SKILL.md 和引用文件
   - 复制到 ~/.claude/skills/<name>/
   - 根据用户需求修改
```

#### 4.2.3 Skill 质量保证

新增一个轻量级验证步骤：
- 创建或下载 skill 后，检查 SKILL.md frontmatter 格式
- 检查 description 是否包含触发关键词
- 检查是否与现有 skill 有功能重叠
- 记录到 `permitted_skills.md`

---

### 4.3 Phase 3 — Task Agent Prompt 改进

**文件**: `src/prompt.ts` — Task Agent prompt

核心改动：**强制 Objective Decomposition**

当前 prompt 只说 "create tasks if appropriate"。新 prompt 要求：

1. **逐条读取 objective.yaml**，对每个 objective 做结构化分解
2. **交叉引用 preference.yaml**，用户的偏好约束任务设计
3. **交叉引用 skill-evolver/tmp/**，经验约束任务可行性
4. **最低输出保证**：必须对每个 objective 给出分析，即使决定不创建任务

详见 §3.3.2 的完整 prompt 设计。

---

### 4.4 Phase 4 — Dashboard 适配

**文件**: `src/server/` 下的前端和 API

#### 4.4.1 API 变更

```typescript
// GET /api/status — 扩展返回
{
  state: "running" | "idle",
  evolutionMode: "single" | "multi",
  activeAgents: [
    { id: "evo-context-...", type: "evo-context", startedAt: "..." },
    { id: "evo-skill-...", type: "evo-skill", startedAt: "..." },
    { id: "evo-task-...", type: "evo-task", startedAt: "..." },
  ],
  // ...
}
```

#### 4.4.2 WebSocket 事件扩展

```typescript
// 新增 agent-level progress 事件
ws.emit("job_progress", {
  jobId: "evo-context-...",
  jobType: "evo-context",    // 区分三个 agent
  text: "..."
});
```

#### 4.4.3 Dashboard UI 变更

- Evolution 运行时显示三个并行的进度条/日志流
- Report 页面支持展开查看三个 sub-report
- Settings 新增 `evolutionMode` 开关

---

## 5. Skill SKILL.md 重写方案

`skills/skill-evolver/SKILL.md` 需要更新以反映新的设计理念。

### 新 description

```yaml
description: "Technical experience knowledge base and need-driven skill evolution engine.
Contains accumulated success patterns, failure patterns, and useful tips from past Claude Code sessions.
Read tmp/ files to avoid known pitfalls and apply proven approaches.
Use this skill whenever you are about to try an approach that might have known issues,
or when looking for best practices the user has benefited from before."
```

### 新正文要点

- **Runtime** 用法不变（读经验 → 避坑 → 用成功模式）
- **Evolution** 用法大改：指向新的 evolution_guide.md，强调 need-driven 而非 buffer-driven

---

## 6. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/prompt.ts` | **重大修改** | 新增 3 个 agent-specific prompt builder |
| `src/executor.ts` | **修改** | 新增 `runMultiAgentEvolution()`，新增 job subtype |
| `src/scheduler.ts` | **修改** | 适配多 agent evolution，调整并发检查逻辑 |
| `src/config.ts` | **修改** | 新增 `evolutionMode` 字段 |
| `skills/skill-evolver/reference/evolution_guide.md` | **重写** | Need-driven skill evolution 工作流 |
| `skills/skill-evolver/SKILL.md` | **修改** | 更新 description 和正文 |
| `skills/task-planner/reference/evolution_guide.md` | **修改** | Objective decomposition 工作流 |
| `src/server/api.ts` | **修改** | 状态 API 返回多 agent 信息 |
| 前端文件 | **修改** | 多 agent 进度显示 |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 三个 agent 并行消耗 3x API cost | 费用增加 | `evolutionMode: single` 回退；Skill/Task agent 可用 sonnet 降低成本 |
| Skill Agent 下载不安全的外部 skill | 安全问题 | Prompt 中强调审查；只从白名单平台下载 |
| 三个 agent 同时读写 YAML 冲突 | 数据损坏 | 架构已保证写隔离（各 agent 写不同文件） |
| Session logs 被三个 agent 重复扫描 | 效率浪费 | 可接受：每个 agent 关注不同维度。未来可引入 session digest 缓存 |
| 报告合并时某个 agent 失败 | 部分数据丢失 | `Promise.allSettled` 保证不互相阻塞；失败的 agent 在总 report 中标记 |

---

## 8. Implementation Order

```
Week 1: Phase 1 — Executor 改造
  ├── Day 1-2: prompt.ts — 三个 agent 的 prompt builder
  ├── Day 3-4: executor.ts — runMultiAgentEvolution + 报告合并
  └── Day 5: scheduler.ts + config.ts — 适配多 agent

Week 2: Phase 2 — Skill Agent 重设计
  ├── Day 1-2: evolution_guide.md 重写
  ├── Day 3: SKILL.md 更新
  └── Day 4-5: 测试 Skill Agent 的外部搜索能力

Week 3: Phase 3+4 — Task Agent + Dashboard
  ├── Day 1-2: Task Agent prompt 实现
  ├── Day 3-4: Dashboard 多 agent UI
  └── Day 5: 端到端测试

Week 4: 验证与调优
  ├── 运行 5-10 个 multi-agent cycle
  ├── 对比单 agent 和多 agent 的产出
  ├── 调整 prompt 细节
  └── 准备发布
```

---

## 9. Success Metrics

| 指标 | 当前 | 目标（20个cycle后） |
|------|------|-------------------|
| Skill 创建数 | 0 | ≥ 3 |
| Task 创建数 | 1 | ≥ 5 |
| Skill Agent 每 cycle 识别需求数 | N/A | ≥ 3 |
| Task Agent 每 cycle Objective 分解覆盖率 | 0% | 100% |
| 每 cycle 总 API 成本 | ~$0.30 | ≤ $1.00 |

---

## 10. Future Considerations

### 10.1 Agent 间通信（Phase 2+）

当前设计三个 agent 完全并行，互不通信。未来可引入：
- **Phase 后聚合 agent**：三个 agent 完成后，启动第四个 agent 阅读三份 report，做跨领域的洞察（如 "Context Agent 发现用户开始做 Rust 项目" + "Skill Agent 应该搜索 Rust 相关 skill"）
- 或者改为 **两阶段串行**：Phase 1 并行运行 Context Agent；Phase 2 Skill + Task Agent 读取更新后的 context 并行运行

### 10.2 Exploration Budget

每 N 个 cycle（如每 5 个），Skill Agent 进入 "exploration mode"：
- 不基于现有 context，而是主动浏览 SkillHub 的 trending skills
- 尝试安装 1 个看起来有潜力的 skill
- 下个 cycle 评估是否有价值

### 10.3 Feedback Loop

追踪 skill 和 task 的实际使用情况：
- Skill 被触发了几次？（通过扫描 session logs 中的 skill 引用）
- Task 的 artifact 被用户查看了吗？
- 用户是否调整了 task 频率或 prompt？
- 这些信号反馈到下次 evolution cycle，优化规划策略
