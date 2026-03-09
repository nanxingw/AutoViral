# skill-evolver 系统架构文档

> 本文档是 skill-evolver 项目的权威技术参考，涵盖系统设计哲学、组件架构、数据流、调度机制和安全边界。

---

## 目录

1. [系统总览](#1-系统总览)
2. [系统架构图](#2-系统架构图)
3. [三大 Agent 并行架构](#3-三大-agent-并行架构)
4. [Task-Skill 协同进化机制](#4-task-skill-协同进化机制)
5. [数据流](#5-数据流)
6. [调度系统](#6-调度系统)
7. [执行引擎](#7-执行引擎)
8. [Web Dashboard](#8-web-dashboard)
9. [配置系统](#9-配置系统)
10. [文件系统布局](#10-文件系统布局)
11. [安全边界](#11-安全边界)

---

## 1. 系统总览

### 核心理念

skill-evolver 的核心信念是：**技能应当自己书写自己。**

Claude Code 是一个强大的智能体，但它不具备跨会话的学习能力——每次会话都从零开始，成功的模式被遗忘，失败的方法被重复，用户偏好需要反复解释。skill-evolver 是一个后台守护进程，它周期性地启动 Claude Code 实例，回顾过去的对话日志，从中提取：

- **失败模式** — 哪些方法行不通，为什么
- **成功模式** — 哪些方法有效，值得被固化
- **用户偏好** — 反复出现的请求、风格选择、工具偏好
- **技能候选** — 新技能的创建，或已有技能的优化

### 设计哲学

| 原则 | 说明 |
|------|------|
| **零摩擦** | 后台运行，无需人工干预 |
| **保守演化** | 基于证据的渐进式演化，而非冲动修改 |
| **证据驱动** | 每个技能变更都基于实际对话历史 |
| **积累-毕业制** | 信号需要 3+ 会话、跨 2+ 天、无矛盾才能毕业为确认知识 |
| **增量迭代** | 小幅高频改进，而非大规模重写 |

### 运行模型

系统通过 `child_process.spawn()` 调用用户已安装的 `claude` CLI，以 `--dangerously-skip-permissions` 模式运行，赋予演化 Agent 完整的文件读写权限。每个 Agent 接收一个精心构造的 prompt，执行分析和演化任务，输出流式 JSON 供实时监控。

---

## 2. 系统架构图

### 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          skill-evolver daemon                              │
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────────────────┐ │
│  │   CLI Layer   │    │  Web Server  │    │        Scheduler               │ │
│  │  (commander)  │    │   (Hono)     │    │                                │ │
│  │              │    │  port:3271   │    │  ┌─────────────────────────┐   │ │
│  │  start       │    │  /api/*     │    │  │  Evolution Timer        │   │ │
│  │  stop        │    │  /ws        │    │  │  (interval-based)       │   │ │
│  │  evolve      │    │  /*  (SPA)  │    │  ├─────────────────────────┤   │ │
│  │  status      │    │              │    │  │  Task Tick (30s loop)   │   │ │
│  │  config      │    └──────┬───────┘    │  │  (cron + one-shot)     │   │ │
│  │  task *      │           │            │  └─────────────────────────┘   │ │
│  └──────┬───────┘           │            └──────────────┬─────────────────┘ │
│         │                   │                           │                   │
│         └─────────┬─────────┘                           │                   │
│                   │                                     │                   │
│                   ▼                                     ▼                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        Executor (EventEmitter)                       │   │
│  │                                                                      │   │
│  │   running: Map<jobId, ExecutionJob>                                  │   │
│  │                                                                      │   │
│  │   ┌────────────────────────────────────────────────────────────┐     │   │
│  │   │               claude CLI (child_process.spawn)             │     │   │
│  │   │                                                            │     │   │
│  │   │   args: -p <prompt> --output-format stream-json            │     │   │
│  │   │         --verbose --model <model>                          │     │   │
│  │   │         --dangerously-skip-permissions                     │     │   │
│  │   │         --no-session-persistence                           │     │   │
│  │   │                                                            │     │   │
│  │   │   env: { ...process.env, CLAUDECODE: <deleted> }           │     │   │
│  │   │   cwd: $HOME                                               │     │   │
│  │   └────────────────────────────────────────────────────────────┘     │   │
│  │                                                                      │   │
│  │   Events: job_start, job_progress, job_end, job_error               │   │
│  │           cycle_start, cycle_progress, cycle_end, cycle_error       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                          │                                                  │
│                          │ WebSocket broadcast                              │
│                          ▼                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     WebSocket Server (/ws)                           │   │
│  │   event: { event, data, timestamp }                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
┌──────────────────────┐  ┌──────────────────────────┐
│  ~/.claude/skills/   │  │  ~/.skill-evolver/       │
│                      │  │                          │
│  user-context/       │  │  config.yaml             │
│  skill-evolver/      │  │  reports/                │
│  task-planner/       │  │  tasks/                  │
│  skill-creator/      │  │    tasks.yaml            │
│  <evolved-skills>/   │  │    <task-id>/            │
└──────────────────────┘  │      artifacts/          │
              ▲           │      reports/             │
              │           └──────────────────────────┘
              │                       ▲
              └───────────┬───────────┘
                          │
              ┌───────────┴───────────┐
              │  ~/.claude/projects/  │
              │   (session JSONL)     │
              └───────────────────────┘
```

### 模块依赖关系

```
cli.ts ──────────────┐
                     ▼
              ┌─────────────┐
              │ executor.ts │ ◄─── scheduler.ts
              └──────┬──────┘
                     │
            ┌────────┼────────┐
            ▼        ▼        ▼
       prompt.ts  config.ts  reports.ts
            │
            ▼
       task-store.ts
            │
            ▼
         cron.ts

server/
  index.ts ──► api.ts ──► executor, scheduler, config, task-store, reports
            ──► ws.ts  ──► executor (events)
```

---

## 3. 三大 Agent 并行架构

在 `multi` 演化模式下（默认），系统在每个演化周期并行启动三个独立的 Claude Code Agent，各司其职：

```
                    runMultiAgentEvolution()
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │Context Agent │ │ Skill Agent  │ │  Task Agent  │
    │ (evo-context)│ │ (evo-skill)  │ │  (evo-task)  │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
           │                │                │
    ┌──────┴───────┐ ┌──────┴───────┐ ┌──────┴───────┐
    │  写入范围：   │ │  写入范围：   │ │  写入范围：   │
    │              │ │              │ │              │
    │ user-context/│ │ skill-evolver│ │ tasks.yaml   │
    │  context/    │ │  /tmp/       │ │ ideas.yaml   │
    │  tmp/        │ │ permitted_   │ │ _rejected.   │
    │              │ │  skills.md   │ │  yaml        │
    │              │ │ <new-skills>/│ │              │
    └──────────────┘ └──────────────┘ └──────────────┘
           │                │                │
           ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ context_     │ │ skill_       │ │ task_         │
    │ report.md    │ │ report.md    │ │ report.md     │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
           │                │                │
           └────────────────┼────────────────┘
                            │
                    Promise.allSettled()
                            │
                            ▼
                  ┌──────────────────┐
                  │  merged report   │
                  │  (YYYY-MM-DD_    │
                  │   HH-mm_report   │
                  │   .md)           │
                  └──────────────────┘
```

### 3.1 Context Agent (evo-context)

**职责：** 维护用户画像 — 偏好、目标、认知。

**工作流程：**
1. 读取上次报告，确定上次分析到哪个会话
2. 使用 `list-sessions.mjs --since <date>` 查找新会话
3. 使用 `session-digest.mjs` 和 `search-messages.mjs` 提取用户信号
4. 将信号写入 `tmp/` YAML 文件
5. 检查毕业条件：3+ 信号，跨 2+ 天，无矛盾 -> 从 tmp 毕业到 context
6. 清理 60+ 天的过期条目
7. 输出报告

**数据分区（严格隔离）：**
- **可写：** `~/.claude/skills/user-context/context/` 和 `tmp/`
- **可读：** `~/.claude/projects/`（会话日志）
- **禁触：** `skill-evolver/` 和 `tasks/`

### 3.2 Skill Agent (evo-skill)

**职责：** 发现用户需求，搜索或创建最合适的 Claude Code 技能。

**工作流程（6 阶段）：**
1. **需求发现（必选）** — 从 6 个来源识别需求：
   - Source A: 用户目标 (objective.yaml)
   - Source B: 用户偏好 (preference.yaml)
   - Source C: 积累经验 (tmp/*.yaml)
   - Source D: 会话日志 (session logs)
   - Source E: 任务执行模式 (tasks.yaml + task reports)
   - Source F: **skill-need 信号**（来自 post-task 的高优先级需求）
2. **匹配已有技能** — `ls ~/.claude/skills/`
3. **搜索外部技能** — SkillHub、GitHub、Anthropic 官方
4. **创建或演化技能** — 使用 skill-creator 方法论
5. **经验维护** — 更新 success/failure/tips
6. **输出报告**

**数据分区：**
- **可写：** `skill-evolver/tmp/`、`permitted_skills.md`、新技能目录
- **只读：** `user-context/`、`tasks.yaml`、task reports
- **禁触：** `user-context/` 数据文件、`tasks.yaml`

### 3.3 Task Agent (evo-task)

**职责：** 将用户目标分解为可自动执行的任务。

**工作流程（7 阶段）：**
1. **目标分解（必选）** — 对 objective.yaml 中的每个目标进行分解
2. **经验驱动任务** — 基于 failure/success/tips 设计预防性任务
3. **会话模式分析** — 发现用户重复手动操作
4. **技能感知（协同进化）** — 盘点可用技能，识别技能缺口，创建 skill-building 任务
5. **任务生命周期管理** — 检查现有任务状态，调整/暂停/移除
6. **决策与创建** — 按安全层级创建任务
7. **输出报告**

**任务安全层级（优先选择安全类别）：**
1. 信息收集 — 始终安全
2. 质量检查 — 低风险
3. 项目监控 — 低风险
4. 项目工作 — 中风险

---

## 4. Task-Skill 协同进化机制

这是 skill-evolver 最独特的架构设计之一：Task 和 Skill 之间形成闭环进化。

```
                     ┌──────────────────────────────────┐
                     │        Evolution Cycle            │
                     │                                  │
                     │  ┌──────────┐   ┌──────────┐    │
                     │  │  Skill   │   │   Task   │    │
                     │  │  Agent   │◄──│  Agent   │    │
                     │  └────┬─────┘   └────┬─────┘    │
                     └───────┼──────────────┼──────────┘
                             │              │
                    creates/ │              │ creates
                    evolves  │              │ tasks
                    skills   │              │
                             ▼              ▼
                     ┌──────────┐   ┌──────────────┐
                     │  Skills  │   │    Tasks     │
                     │ (*.md)   │   │ (tasks.yaml) │
                     └────┬─────┘   └──────┬───────┘
                          │                │
                 ┌────────┘                │ scheduler
                 │ relatedSkills           │ executes
                 │ reference               │
                 ▼                         ▼
            ┌─────────────────────────────────┐
            │         Task Execution          │
            │  (reads related skill SKILL.md  │
            │   for best practices)           │
            └───────────────┬─────────────────┘
                            │
                            │ task report
                            ▼
            ┌─────────────────────────────────┐
            │        Post-Task Review         │
            │                                 │
            │  - update experience base       │
            │  - emit skill-need signals ──────────┐
            │  - verify skill-building tasks  │    │
            └─────────────────────────────────┘    │
                                                   │
                                                   ▼
                                        ┌──────────────────┐
                                        │ skill_needs.yaml │
                                        │ (priority queue) │
                                        └────────┬─────────┘
                                                 │
                                    next cycle   │
                                    Skill Agent  │
                                    reads this   │
                                    FIRST        │
                                                 ▼
                                        ┌──────────────────┐
                                        │  Create/Evolve   │
                                        │  target skill    │
                                        └──────────────────┘
```

### 闭环详解

1. **Task Agent 创建任务** — 可以设置 `relatedSkills` 字段引用已有技能，也可以创建 `skill-building` 类型任务来填补技能缺口

2. **任务执行时引用技能** — `buildTaskPrompt()` 自动将 `relatedSkills` 中列出的技能 SKILL.md 路径注入 prompt，Agent 在执行前阅读这些最佳实践

3. **Post-Task Review** — 任务完成后，review agent 评估执行质量：
   - 成功经验 -> `success_experience.yaml`
   - 失败经验 -> `failure_experience.yaml`
   - 技能需求 -> `skill_needs.yaml`（高优先级信号）

4. **Skill Agent 优先处理 skill-need 信号** — 下一个演化周期中，Skill Agent 首先读取 `skill_needs.yaml`，将其作为最高优先级需求

5. **新技能增强未来任务** — 被创建的技能自动可用于后续任务执行

### Skill-Building 任务

Task Agent 可以创建特殊的 `skill-building` 任务，包含：
- `tags: ["skill-building"]`
- `skillTarget: "<skill-name>"`

这类任务的 prompt 模板要求 Agent 使用 skill-creator 方法论创建/改进技能，并注册到 `permitted_skills.md`。Post-Task Review 会验证目标技能是否成功创建。

---

## 5. 数据流

### 完整数据流：从会话日志到技能进化

```
~/.claude/projects/**/*.jsonl
        │
        │  list-sessions.mjs / session-digest.mjs / search-messages.mjs
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│                    Evolution Cycle (parallel)                  │
│                                                               │
│  Context Agent          Skill Agent           Task Agent      │
│       │                      │                     │          │
│       │ extract              │ extract             │ decompose│
│       │ signals              │ patterns            │ objectives│
│       ▼                      ▼                     ▼          │
│  user-context/          skill-evolver/         tasks.yaml     │
│    tmp/*.yaml             tmp/*.yaml           ideas.yaml     │
│       │                      │                     │          │
│       │ graduate             │ crystallize         │ schedule │
│       │ (3+ signals,        │ into skills         │          │
│       │  2+ days)           │                     │          │
│       ▼                      ▼                     ▼          │
│  user-context/          ~/.claude/skills/      Scheduler      │
│    context/*.yaml         <new-skill>/         executes       │
│                                                    │          │
└────────────────────────────────────────────────────┼──────────┘
                                                     │
                                                     ▼
                                              Task Execution
                                                     │
                                                     │ report
                                                     ▼
                                              Post-Task Review
                                                     │
                                          ┌──────────┼──────────┐
                                          ▼          ▼          ▼
                                     experience  skill_needs  follow-up
                                     updates     signals      ideas
```

### 积累-毕业制数据流（Context Agent 示例）

```
Session Log 中的观察
        │
        │  "用户偏好使用 TypeScript"
        │
        ▼
preference_tmp.yaml
┌─────────────────────────────────────────┐
│ entries:                                │
│   - key: "language_preference"          │
│     value: "TypeScript"                 │
│     signals:                            │
│       - session: "abc123"               │
│         date: "2026-03-05"              │
│         detail: "用户要求用 TS 重写"     │
│       - session: "def456"               │
│         date: "2026-03-07"              │
│         detail: "拒绝 JS 方案，选 TS"   │
│       - session: "ghi789"    ◄── 第3个信号│
│         date: "2026-03-08"              │
│         detail: "主动配置 tsconfig"      │
│     signal_count: 3                     │
│     first_seen: "2026-03-05"            │
│     last_seen: "2026-03-08"             │
└─────────────────────┬───────────────────┘
                      │
        3+ signals, 2+ days span, no contradictions
                      │ GRADUATE
                      ▼
preference.yaml
┌─────────────────────────────────────────┐
│ entries:                                │
│   - key: "language_preference"          │
│     value: "TypeScript"                 │
│     source_signals: 3                   │
│     confirmed_at: "2026-03-08"          │
└─────────────────────────────────────────┘
```

---

## 6. 调度系统

调度系统由 `scheduler.ts` 实现，包含两个独立的调度器：

### 6.1 Evolution Timer（演化周期定时器）

```
┌─────────────────────────────────────────────────┐
│              Evolution Timer                     │
│                                                 │
│  startScheduler("1h")                           │
│        │                                        │
│        ▼                                        │
│  intervalMs = 3600000                           │
│        │                                        │
│        ▼                                        │
│  setTimeout(runEvolutionCycle, intervalMs)       │
│        │                                        │
│        │  cycle completes                       │
│        ▼                                        │
│  setTimeout(runEvolutionCycle, intervalMs) ──┐   │
│        │                                    │   │
│        └────────────── loop ────────────────┘   │
│                                                 │
│  Guard: if executor.hasEvolutionRunning         │
│         → retry in 60s                          │
└─────────────────────────────────────────────────┘
```

**关键特性：**
- 计时器在上一个周期**完成后**才开始计算下一次
- 如果有演化 Job 正在运行，延迟 60 秒后重试
- 支持 `reschedule()` 动态重置计时器（配置变更后调用）
- 间隔格式：`"30m"` (1-59分钟) 或 `"2h"` (1-23小时)

### 6.2 Task Tick（任务检查循环）

```
┌─────────────────────────────────────────────────┐
│              Task Tick (30-second interval)       │
│                                                  │
│  setInterval(tick, 30_000)                       │
│        │                                         │
│        ▼                                         │
│  ┌─ Check concurrency ─────────────────────┐    │
│  │  activeTaskJobs >= taskMaxConcurrent?    │    │
│  │  YES → return (skip this tick)           │    │
│  └──────────────┬──────────────────────────┘    │
│                 │ NO                             │
│                 ▼                                │
│  ┌─ Process post-task queue ───────────────┐    │
│  │  postTaskQueue.length > 0?              │    │
│  │  YES → dequeue one, run it              │    │
│  └──────────────┬──────────────────────────┘    │
│                 │                                │
│                 ▼                                │
│  ┌─ Check active tasks ───────────────────┐    │
│  │  For each task where:                   │    │
│  │    status === "active"                  │    │
│  │    schedule exists                      │    │
│  │    not already running                  │    │
│  │    runCount < taskMaxRunsPerTask        │    │
│  │                                         │    │
│  │  ┌─ Cron tasks ─────────────────┐      │    │
│  │  │  nextCronRun(cron, lastRun)  │      │    │
│  │  │  now >= nextRun? → execute   │      │    │
│  │  └──────────────────────────────┘      │    │
│  │                                         │    │
│  │  ┌─ One-shot tasks ────────────┐       │    │
│  │  │  now >= scheduled_at?       │       │    │
│  │  │  YES → execute              │       │    │
│  │  └─────────────────────────────┘       │    │
│  └─────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### 6.3 手动触发

三种方式触发演化周期：

| 触发方式 | 入口 | 说明 |
|----------|------|------|
| CLI | `skill-evolver evolve` | 前台运行，实时显示进度 |
| API | `POST /api/trigger` | 异步触发，通过 WebSocket 接收进度 |
| Dashboard | "Trigger Evolution" 按钮 | 调用 API 触发 |

手动触发后会调用 `reschedule()` 重置演化计时器，避免短时间内重复运行。

### 6.4 Post-Task Cycle

任务完成后自动触发 Post-Task Review（当 `taskAutoApprove` 开启时）：

```
Task 完成 → triggerPostTaskCycle()
               │
               ├─ debounce 检查 (postTaskDebounce 秒)
               │  │
               │  ├─ 在窗口内 → 加入 postTaskQueue
               │  │              (下一个 tick 处理)
               │  │
               │  └─ 超出窗口 → 立即执行 runPostTaskJob()
               │
               └─ 启动 post-task claude 实例
                  type: "post-task"
```

---

## 7. 执行引擎

### 7.1 Executor 核心

`executor.ts` 导出一个全局单例 `executor`，继承自 `EventEmitter`，是所有 Claude CLI 调用的唯一入口。

```typescript
class Executor extends EventEmitter {
  running: Map<string, ExecutionJob>  // 当前活跃 Job
  lastRun: Date | null                // 最近一次运行时间
  lastResult: ExecutionResult | null  // 最近一次运行结果

  // 派生状态
  state: "idle" | "running"           // 兼容旧接口
  activeCount: number
  isIdle: boolean
  hasEvolutionRunning: boolean        // 是否有演化 Job 在运行
}
```

### 7.2 Job 类型

| JobType | 说明 | 触发来源 |
|---------|------|----------|
| `evolution` | 单 Agent 演化周期（兼容模式） | scheduler / CLI / API |
| `evo-context` | Context Agent（多 Agent 模式） | runMultiAgentEvolution() |
| `evo-skill` | Skill Agent（多 Agent 模式） | runMultiAgentEvolution() |
| `evo-task` | Task Agent（多 Agent 模式） | runMultiAgentEvolution() |
| `task` | 用户定义的自动化任务 | scheduler tick / CLI / API |
| `post-task` | 任务完成后的回顾分析 | triggerPostTaskCycle() |

### 7.3 Claude CLI 集成

每个 Job 通过 `child_process.spawn()` 启动一个独立的 Claude CLI 进程：

```
spawn("claude", [
  "-p", <prompt>,                      // 非交互模式，传入 prompt
  "--output-format", "stream-json",    // 流式 JSON 输出
  "--verbose",                         // 详细输出（含工具调用）
  "--model", <model>,                  // 指定模型
  "--dangerously-skip-permissions",    // 跳过所有权限确认
  "--no-session-persistence",          // 不保存会话
], {
  cwd: homedir(),                      // 工作目录为用户 home
  stdio: ["ignore", "pipe", "pipe"],   // stdin 忽略，stdout/stderr 管道
  env: { ...process.env, CLAUDECODE: undefined }, // 删除 CLAUDECODE 环境变量
})
```

**删除 CLAUDECODE 环境变量的原因：** 防止 Claude CLI 检测到自己运行在另一个 Claude Code 实例内部，从而影响行为。

### 7.4 流式 JSON 解析

Executor 逐行解析 Claude CLI 的 stream-json 输出：

| JSON type | 处理方式 |
|-----------|----------|
| `system` (subtype: `init`) | 发射 `job_progress`，记录模型和会话 ID |
| `assistant` (message.content) | 提取 `text` 块和 `tool_use` 块，发射 `job_progress` |
| `tool_result` | 发射 `job_progress`（工具执行完成） |
| `result` | 最终结果，包含 `cost_usd` 和 `duration_ms` |

### 7.5 事件系统

```
Executor Events
│
├── job_start     { jobId, jobType, taskId?, taskName? }
├── job_progress  { jobId, jobType, taskId?, taskName?, text }
├── job_end       { jobId, jobType, taskId?, taskName?, result }
├── job_error     { jobId, jobType, taskId?, taskName?, error }
│
├── cycle_start   {}                    // 演化周期开始
├── cycle_progress  <text>              // 向后兼容
├── cycle_end     { result }            // 演化周期完成
└── cycle_error   { error }             // 演化周期失败
```

**事件路由：**
- CLI (`cli.ts`) 监听 `job_progress` 和 `cycle_progress` 直接输出到 stdout
- Daemon (`cli.ts` start 命令) 将所有事件桥接到 WebSocket broadcast
- Web Dashboard 通过 WebSocket 接收实时更新

### 7.6 Multi-Agent 演化流程

```typescript
async function runMultiAgentEvolution(): Promise<MultiAgentResult> {
  // 1. 加载配置和最近报告
  // 2. 构建三个 Agent 的独立 prompt（含各自的报告输出路径）
  // 3. Promise.allSettled() 并行执行三个 Agent
  // 4. 合并三份子报告为一份总报告
  // 5. 清理过期报告
  // 6. 发射 cycle_end 事件
}
```

使用 `Promise.allSettled()` 而非 `Promise.all()`，确保某个 Agent 失败不影响其他 Agent 的执行。

---

## 8. Web Dashboard

### 8.1 服务器架构

```
┌─────────────────────────────────────────────────────┐
│                   Hono Server                        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  API Routes (apiRoutes)                       │  │
│  │                                               │  │
│  │  /api/status          GET    系统状态          │  │
│  │  /api/trigger         POST   触发演化          │  │
│  │  /api/reports         GET    报告列表          │  │
│  │  /api/reports/:fn     GET    报告内容          │  │
│  │  /api/context/:pillar GET    上下文数据        │  │
│  │  /api/skills          GET    已注册技能        │  │
│  │  /api/config          GET    获取配置          │  │
│  │  /api/config          PUT    更新配置          │  │
│  │  /api/tasks           GET    任务列表          │  │
│  │  /api/tasks           POST   创建任务          │  │
│  │  /api/tasks/:id       GET    任务详情          │  │
│  │  /api/tasks/:id       PUT    更新任务          │  │
│  │  /api/tasks/:id       DELETE 删除任务          │  │
│  │  /api/tasks/:id/approve   POST 批准任务       │  │
│  │  /api/tasks/:id/reject    POST 拒绝任务       │  │
│  │  /api/tasks/:id/trigger   POST 手动触发任务   │  │
│  │  /api/tasks/:id/runs      GET  运行历史       │  │
│  │  /api/tasks/:id/runs/:fn  GET  运行报告       │  │
│  │  /api/tasks/:id/artifacts GET  工件列表       │  │
│  │  /api/tasks/:id/artifacts/open POST 打开目录  │  │
│  │  /api/skill-needs     GET    技能需求信号      │  │
│  │  /api/ideas           GET    创意缓冲区        │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Static Files (SPA)                           │  │
│  │  web/dist/*  → serveStatic                    │  │
│  │  *           → index.html (SPA fallback)      │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  WebSocket Server                             │  │
│  │  path: /ws                                    │  │
│  │                                               │  │
│  │  On connect:                                  │  │
│  │    → send { event: "status", data: {...} }    │  │
│  │                                               │  │
│  │  Broadcast events:                            │  │
│  │    cycle_start, cycle_progress, cycle_end,    │  │
│  │    cycle_error, job_start, job_progress,      │  │
│  │    job_end, job_error                         │  │
│  │                                               │  │
│  │  Message format:                              │  │
│  │    { event, data, timestamp }                 │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 8.2 实时更新机制

```
Frontend (React)
    │
    │ WebSocket connect → /ws
    │
    ▼
┌──────────────┐
│  ws.onopen   │──► 收到初始 status
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────────────────────────────┐
│ ws.onmessage │────►│  event router:                       │
└──────────────┘     │                                      │
                     │  cycle_start  → 更新 UI 状态为运行中  │
                     │  cycle_progress → 追加实时输出        │
                     │  cycle_end    → 刷新报告列表          │
                     │  job_start    → 显示活跃 Job          │
                     │  job_progress → 追加 Job 输出         │
                     │  job_end      → 刷新任务状态          │
                     └──────────────────────────────────────┘
```

### 8.3 Context Pillar 数据映射

API `/api/context/:pillar` 支持 6 个数据支柱：

| Pillar | Context 路径 | Tmp 路径 | 归属 |
|--------|-------------|----------|------|
| `preference` | `user-context/context/preference.yaml` | `user-context/tmp/preference_tmp.yaml` | User Context |
| `objective` | `user-context/context/objective.yaml` | `user-context/tmp/objective_tmp.yaml` | User Context |
| `cognition` | `user-context/context/cognition.yaml` | `user-context/tmp/cognition_tmp.yaml` | User Context |
| `success_experience` | _(无)_ | `skill-evolver/tmp/success_experience.yaml` | Skill Evolver |
| `failure_experience` | _(无)_ | `skill-evolver/tmp/failure_experience.yaml` | Skill Evolver |
| `useful_tips` | _(无)_ | `skill-evolver/tmp/useful_tips.yaml` | Skill Evolver |

注意：Skill Evolver 的三个支柱只有 tmp 层，没有 context 毕业层——经验不会"毕业"，而是当积累足够时**结晶为独立技能**。

---

## 9. 配置系统

### 9.1 配置文件

路径：`~/.skill-evolver/config.yaml`

### 9.2 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `interval` | `string` | `"1h"` | 演化周期间隔。格式：`Nm` (1-59分钟) 或 `Nh` (1-23小时) |
| `model` | `string` | `"opus"` | Claude 模型名称 |
| `autoRun` | `boolean` | `true` | 启动时是否自动开始调度 |
| `port` | `number` | `3271` | Web Dashboard 端口 |
| `maxReports` | `number` | `50` | 最大保留报告数量（超出自动删除最旧的） |
| `reportsToFeed` | `number` | `5` | 每次演化周期提供给 Agent 的最近报告数量 |
| `taskAutoApprove` | `boolean` | `true` | Agent 创建的任务是否自动批准（true: active+approved, false: pending+unapproved） |
| `taskMaxConcurrent` | `number` | `3` | 同时运行的最大 task/post-task Job 数 |
| `taskMaxRunsPerTask` | `number` | `20` | 单个任务最大运行次数（超出自动暂停） |
| `postTaskDebounce` | `number` | `300` | Post-task review 去抖时间（秒） |
| `evolutionMode` | `"single" \| "multi"` | `"multi"` | 演化模式：single=单 Agent，multi=三 Agent 并行 |

### 9.3 配置变更

三种方式修改配置：
- CLI: `skill-evolver config set interval 30m`
- API: `PUT /api/config { "interval": "30m" }`
- 直接编辑: `~/.skill-evolver/config.yaml`

配置写入时使用 `js-yaml` 序列化，`lineWidth: -1` 避免自动换行。

---

## 10. 文件系统布局

### 10.1 项目源码

```
skill-evolver/                        # 项目根目录
├── src/
│   ├── cli.ts                        # CLI 入口（commander）
│   ├── executor.ts                   # 执行引擎核心
│   ├── prompt.ts                     # 所有 Agent prompt 构建
│   ├── scheduler.ts                  # 调度器（evolution + task tick）
│   ├── config.ts                     # 配置加载/保存
│   ├── task-store.ts                 # 任务 CRUD + 工件 + 技能需求
│   ├── reports.ts                    # 报告列表/读取/清理
│   ├── cron.ts                       # Cron 表达式解析
│   └── server/
│       ├── index.ts                  # Hono 服务器启动
│       ├── api.ts                    # REST API 路由
│       └── ws.ts                     # WebSocket 服务器
├── web/                              # 前端 SPA（React）
│   └── dist/                         # 构建产物
├── skills/                           # 技能模板源码（安装时复制到 ~/.claude/skills/）
│   ├── user-context/
│   └── skill-evolver/
└── scripts/                          # 测试和工具脚本
```

### 10.2 运行时数据

```
~/.skill-evolver/                     # 守护进程数据根目录
├── config.yaml                       # 配置文件
├── daemon.pid                        # 守护进程 PID 文件
├── daemon.log                        # 守护进程日志
├── reports/                          # 演化周期报告
│   ├── 2026-03-08_14-30_report.md          # 合并报告（multi 模式）
│   ├── 2026-03-08_14-30_context_report.md  # Context Agent 子报告
│   ├── 2026-03-08_14-30_skill_report.md    # Skill Agent 子报告
│   ├── 2026-03-08_14-30_task_report.md     # Task Agent 子报告
│   └── 2026-03-08_15-00_post-task_report.md
└── tasks/                            # 任务数据
    ├── tasks.yaml                    # 任务定义（中心存储）
    └── <task-id>/
        ├── artifacts/                # 任务产出的持久化工件
        └── reports/                  # 任务运行报告
            └── 2026-03-08_14-30_report.md
```

### 10.3 技能目录

```
~/.claude/skills/                     # Claude Code 技能根目录
├── user-context/                     # Meta-skill: 用户画像
│   ├── SKILL.md                      # 路由文件（frontmatter + 描述）
│   ├── reference/
│   │   ├── runtime_guide.md          # 正常会话时的使用指南
│   │   └── evolution_guide.md        # 后台演化的操作手册
│   ├── context/                      # 毕业后的确认知识
│   │   ├── preference.yaml
│   │   ├── objective.yaml
│   │   └── cognition.yaml
│   ├── tmp/                          # 积累中的观察信号
│   │   ├── preference_tmp.yaml
│   │   ├── objective_tmp.yaml
│   │   └── cognition_tmp.yaml
│   └── scripts/                      # 会话搜索工具
│       ├── list-sessions.mjs
│       ├── session-digest.mjs
│       ├── search-messages.mjs
│       ├── extract-tool-flow.mjs
│       └── session-stats.mjs
│
├── skill-evolver/                    # Meta-skill: 技术经验
│   ├── SKILL.md
│   ├── reference/
│   │   ├── permitted_skills.md       # 可修改的技能注册表
│   │   ├── runtime_guide.md
│   │   └── evolution_guide.md
│   └── tmp/
│       ├── success_experience.yaml
│       ├── failure_experience.yaml
│       ├── useful_tips.yaml
│       └── skill_needs.yaml          # Task->Skill 桥接信号
│
├── task-planner/                     # Meta-skill: 任务规划
│   ├── SKILL.md
│   ├── reference/
│   │   ├── task_schema.md
│   │   └── evolution_guide.md
│   ├── buffer/
│   │   └── ideas.yaml                # 创意缓冲区
│   └── tasks/
│       └── _rejected.yaml            # 被拒绝的任务记录
│
├── skill-creator/                    # Anthropic 官方技能创建器
│   ├── SKILL.md
│   ├── references/
│   ├── scripts/
│   └── agents/
│
└── <evolved-skills>/                 # 由 Skill Agent 创建的技能
    └── SKILL.md
```

### 10.4 会话日志

```
~/.claude/projects/                   # Claude Code 会话日志根目录
└── <project-hash>/
    └── <session-id>.jsonl            # 单个会话的 JSONL 文件
                                      # 每行：{ type, message, sessionId, timestamp, cwd }
```

---

## 11. 安全边界

### 11.1 CRITICAL_PATH 约束

所有 Agent prompt 都包含以下约束：

> **CRITICAL PATH CONSTRAINT:** You must ONLY read and write skill files under `~/.claude/skills/` (the installed location). NEVER modify files inside any project source directory (e.g. any path containing `/skill-evolver/skills/` or similar project paths). The project's `skills/` directory contains source templates and must not be touched.

这防止演化 Agent 修改项目源码中的技能模板，而非运行时安装位置的技能文件。

### 11.2 Agent 数据隔离

三个并行 Agent 的写入范围严格隔离，避免竞态条件：

```
┌──────────────────────────────────────────────────────────┐
│                    写入权限矩阵                            │
│                                                          │
│               Context Agent  Skill Agent  Task Agent     │
│                                                          │
│  user-context/context/    W           -          -       │
│  user-context/tmp/        W           -          -       │
│  skill-evolver/tmp/       -           W          -       │
│  permitted_skills.md      -           W          -       │
│  <new-skill>/             -           W          -       │
│  tasks.yaml               -           -          W       │
│  ideas.yaml               -           -          W       │
│  _rejected.yaml           -           -          W       │
│                                                          │
│  session logs             R           R          R       │
│  user-context/context/    -           R          R       │
│  skill-evolver/tmp/       -           -          R       │
│  tasks.yaml               -           R          -       │
│  task reports             -           R          -       │
│                                                          │
│  W = 可写  R = 只读  - = 禁止访问                          │
└──────────────────────────────────────────────────────────┘
```

### 11.3 Task 执行安全

Task 执行 prompt 包含以下安全规则：

```
CRITICAL SAFETY RULES:
- NEVER modify user source files directly.
- Use git branches for any code changes.
- All persistent artifacts should be written to the artifacts directory.
- Write your task report to the specified report path when done.
```

任务按安全层级分类，优先创建低风险任务：
1. **信息收集** — 始终安全（新闻、趋势、摘要、监控）
2. **质量检查** — 低风险（lint、类型检查、依赖审计、安全扫描）
3. **项目监控** — 低风险（进度跟踪、状态报告）
4. **项目工作** — 中风险（代码生成、文档编写）

### 11.4 并发控制

| 控制点 | 机制 | 默认值 |
|--------|------|--------|
| 演化周期互斥 | `executor.hasEvolutionRunning` 检查 | 最多 1 个演化周期（含 3 个并行 Agent） |
| Task 并发上限 | `taskMaxConcurrent` | 3 |
| 单任务运行上限 | `taskMaxRunsPerTask` | 20（超出自动暂停） |
| Post-task 去抖 | `postTaskDebounce` | 300 秒 |
| 重复运行保护 | `executor.running` Map 中按 `taskId` 去重 | 同一任务不可并行运行 |

### 11.5 环境隔离

- 每个 Claude CLI 进程以 `--no-session-persistence` 运行，不保存会话到历史
- `CLAUDECODE` 环境变量被删除，防止嵌套检测
- 工作目录设为 `$HOME`，而非项目目录
- PID 文件 (`daemon.pid`) 确保单例守护进程

### 11.6 数据保护

- 报告自动清理：`cleanupReports(maxReports)` 保留最近 N 份
- 过期 tmp 条目自动清理：60+ 天且信号不足的条目被移除
- 被拒绝任务记录在 `_rejected.yaml`，Agent 在创建前必须检查避免重复提案
- 技能修改仅限 `permitted_skills.md` 中注册的技能

---

## 附录：关键接口速查

### ExecutionJob

```typescript
interface ExecutionJob {
  id: string;           // 唯一标识，如 "evo-context-1-1709928000000"
  type: JobType;        // "evolution" | "post-task" | "task" | "evo-context" | "evo-skill" | "evo-task"
  prompt: string;       // 完整的 Agent prompt
  model: string;        // Claude 模型名称
  taskId?: string;      // 关联的 Task ID（task/post-task 类型）
  taskName?: string;    // 关联的 Task 名称
}
```

### Task

```typescript
interface Task {
  id: string;                  // "t_20260308_1430_a1b"
  name: string;
  description?: string;
  prompt: string;              // 任务执行 prompt
  schedule?: TaskSchedule;     // { type: "cron", cron: "0 8 * * *" } | { type: "one-shot", at: "<ISO>" }
  status: "active" | "paused" | "completed" | "running" | "pending" | "expired";
  approved?: boolean;
  model?: string;
  tags?: string[];
  source?: string;             // "agent" | "user"
  runCount: number;
  lastRun?: string;
  createdAt: string;
  relatedSkills?: string[];    // 关联技能（执行时注入 prompt）
  skillTarget?: string;        // skill-building 任务的目标技能
}
```

### SkillNeed

```typescript
interface SkillNeed {
  need: string;              // 需要什么技能
  source_task?: string;      // 来源任务 ID
  task_name?: string;        // 来源任务名称
  evidence: string;          // 为什么需要
  priority: "high" | "medium";
  date: string;
  addressed?: boolean;       // Skill Agent 是否已处理
}
```
