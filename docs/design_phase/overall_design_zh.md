# Skill Evolver — 总体设计文档

> **自动创建和演化技能。**

---

## 1. 项目哲学

Claude Code 是一个强大的 agent，但它每次会话都从零开始。它不会积累经验、不会固化用户偏好、也不会从自己的失败中学习。Skill 系统本身已经存在——但没有人会主动去写 skill。

**Skill Evolver** 闭合了这个循环。它定期在后台启动一个 Claude Code 实例，回顾对话历史，通过两个元技能（user-context 和 skill-evolver）渐进地积累认知，并在时机成熟时自动演化为技能。

### 核心原则

1. **演化优于指令** — 知识不是被写出来的，它是*演化*出来的。tmp 中积累的观察必须经过反复验证才能毕业为正式的 context 或 skill。
2. **两大支柱** — `user-context`（用户是谁）和 `skill-evolver`（什么方法有效）是正交的两个关注点。
3. **Claude 即引擎** — 不自建 agent 逻辑。直接 spawn 用户已安装的 `claude` CLI，让 Claude 自己读日志、判断、写文件。编排器只管启动和调度。
4. **从简设计** — YAML 字段精简优雅，不用复杂的数值公式，让 Claude 凭理解力做判断。

---

## 2. 架构总览

```
┌───────────────────────────────────────────────────────────────────────┐
│                          skill-evolver                                │
│                                                                       │
│  ┌──────────────┐    ┌───────────────────┐    ┌────────────────────┐ │
│  │   Scheduler   │───▶│   Orchestrator    │───▶│   Claude Code CLI  │ │
│  │ (cron/手动触发)│    │   (Node.js)       │    │  (bypassPermissions)│ │
│  └──────────────┘    └───────────────────┘    └─────────┬──────────┘ │
│                                                          │            │
│                           编排器只负责：                    │            │
│                           1. 读取最近5份报告               │            │
│                           2. spawn claude                 │            │
│                           3. 管理报告文件（保留50份）        │            │
│                                                          │            │
│                           Claude 负责一切：                 │            │
│                           1. 读取会话日志                   │            │
│                           2. 读写 tmp 和 context           │            │
│                           3. 创建/更新 skill               │            │
│                           4. 写完成报告                     │            │
│                                                          │            │
│                              ┌────────────────────────────┤            │
│                              │                            │            │
│                              ▼                            ▼            │
│                    ┌──────────────────┐        ┌──────────────────┐   │
│                    │  user-context    │        │  skill-evolver   │   │
│                    │  (元技能)         │        │  (元技能)         │   │
│                    │  ~/.claude/skills/│        │  ~/.claude/skills/│   │
│                    └──────────────────┘        └──────────────────┘   │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                      Web 仪表板 (localhost:3271)               │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │   │
│  │  │ 报告时间线 │  │ 设置     │  │ 技能浏览  │  │  手动触发    │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

    Claude 读取：
    ~/.claude/projects/*/   (会话日志, JSONL)
    ~/.claude/history.jsonl (命令历史)

    Claude 写入：
    ~/.claude/skills/       (元技能数据 + 演化生成的技能)
    ~/.skill-evolver/reports/  (完成报告)
```

---

## 3. 技术栈

| 层级 | 选型 | 理由 |
|------|------|------|
| **语言** | TypeScript | 类型安全，npm 生态原生支持 |
| **运行时** | Node.js (>=18) | 跨平台，`child_process` 原生支持 |
| **后端** | Hono | 超轻量（14KB），同时服务 API + 静态资源 |
| **前端** | Svelte 5 + Vite | 极小打包体积，编译型框架 |
| **调度** | node-cron | 进程内调度，零配置 |
| **数据存储** | YAML 文件 | 人类可读，LLM 原生可理解，从简 |
| **Claude Code 接口** | CLI 子进程（`claude -p`） | 零依赖，复用用户已安装的 Claude Code |
| **包格式** | npm 全局包 | `npm install -g skill-evolver` 一键安装 |

### 关键设计决策

- **不使用 Agent SDK** — 直接 `child_process.spawn()` 调用 `claude` CLI，参考 [pneuma-skills](https://github.com/pandazki/pneuma-skills)
- **不自建 agent** — Claude Code 本身就是最好的 agent，我们只需要给它正确的 skill 指导和权限
- **bypassPermissions** — 后台演化任务需要完整的文件读写权限，包括读日志、写 skill、写报告

---

## 4. 两个元技能设计

两个元技能安装后均位于 `~/.claude/skills/`，Claude 创建的新技能也直接写在 `~/.claude/skills/` 下。

### 4.1 `user-context` — 用户是谁？

**职责**：积累和演化对用户偏好、目标、性格认知的理解。

**目录结构**：
```
~/.claude/skills/user-context/
├── SKILL.md                   # 路由器：丰富描述 + 数据概览 + 场景路由
├── reference/
│   ├── runtime_guide.md       # 给日常会话用：如何读取和应用用户画像数据
│   └── evolution_guide.md     # 给后台演化用：添加信号、毕业、清理过期等完整操作手册
├── context/                   # 已确认的用户上下文（毕业后的正式数据）
│   ├── preference.yaml        # 用户偏好（工具选择、代码风格、沟通方式等）
│   ├── objective.yaml         # 用户目标（从小目标到大目标）
│   └── cognition.yaml         # 用户认知（性格特质、MBTI、思维模式等）
└── tmp/                       # 积累中的观察（尚未毕业的过渡数据）
    ├── preference_tmp.yaml
    ├── objective_tmp.yaml
    └── cognition_tmp.yaml
```

**SKILL.md 作为路由器**：SKILL.md 是精简的入口文件，包含对技能用途和数据的丰富描述，然后根据场景将 Claude 路由到合适的指南：
- **日常工作时** -> `reference/runtime_guide.md`（只读：应用已存储的用户知识来个性化响应）
- **演化周期时** -> `reference/evolution_guide.md`（读写：扫描日志、添加信号、毕业条目、处理矛盾）

`evolution_guide.md` 包含原先 SKILL.md 中的全部操作指导：
- 告诉 Claude 何为 `tmp`（过渡观察）、何为 `context`（已确认知识）
- 如何从会话日志中提取用户信号
- 何时将 tmp 中的条目毕业到 context（多次会话反复出现、用户显式声明等）
- 如何处理矛盾（新证据与已确认 context 冲突时）
- Claude Code 执行历史记录的存储位置和查阅技巧

**YAML 字段设计（从简）**：

```yaml
# preference_tmp.yaml — 积累中的偏好观察
entries:
  - content: "用户偏好使用 bun 而非 npm"
    signals:
      - session: "abc-123"
        date: "2026-03-01"
        detail: "用户纠正：'用 bun install'"
      - session: "def-456"
        date: "2026-03-02"
        detail: "项目中有 bun.lockb"
    first_seen: "2026-03-01"
    last_seen: "2026-03-02"
    times_seen: 2
```

```yaml
# preference.yaml — 已确认的偏好
entries:
  - content: "用户偏好使用 bun 而非 npm"
    graduated: "2026-03-05"
    source_signals: 4          # 毕业时累积的信号数
    last_validated: "2026-03-05"
```

设计要点：
- `tmp` 记录每条信号的来源会话和日期，确保可追溯
- `context` 只保留精简的确认信息，不重复存储所有信号
- 字段极少：`content`、`signals`（tmp）/ `graduated`（context）、时间信息
- Claude 凭理解力判断何时毕业，不依赖数值公式

### 4.2 `skill-evolver` — 学到了什么？

**职责**：积累成功/失败经验，积累到一定程度后创建、合并、更新独立的 skill。

**目录结构**：
```
~/.claude/skills/skill-evolver/
├── SKILL.md                   # 路由器：丰富描述 + 数据概览 + 场景路由
├── reference/
│   ├── permitted_skills.md    # 有权限修改的 skill 列表（仅限自己创建的）
│   ├── runtime_guide.md       # 给日常会话用：查阅已知失败/成功经验
│   └── evolution_guide.md     # 给后台演化用：完整操作手册
├── tmp/                       # 积累中的中间经验
│   ├── success_experience.yaml    # 成功经验
│   ├── failure_experience.yaml    # 失败经验
│   └── useful_tips.yaml           # 有用技巧
```

**SKILL.md 作为路由器**：与 user-context 相同的模式。SKILL.md 描述可用的经验数据，然后路由：
- **日常工作时** -> `reference/runtime_guide.md`（在尝试有风险的方法前查阅已知失败，应用已验证的成功模式）
- **演化周期时** -> `reference/evolution_guide.md`（扫描日志、添加信号、在时机成熟时创建/更新 skill）

`evolution_guide.md` 包含原先 SKILL.md 中的全部操作指导：
- 如何从会话日志中识别成功模式、失败模式、可复用技巧
- 如何在 tmp 中积累经验（每次演化周期添加新条目或强化已有条目）
- 何时从积累的经验中提炼出通用的 skill（多个项目/场景中反复出现的模式）
- 如何使用 Claude Code 的文件写入工具在 `~/.claude/skills/` 下创建新的 skill
- 如何判断是否可以对已有 skill 进行演化（参考 `permitted_skills.md`）
- **权限控制**：每次新建 skill 必须将名字写入 `permitted_skills.md`，且只能修改该文件中列出的 skill
- Claude Code 执行历史记录的存储位置和查阅技巧

**YAML 字段设计（从简）**：

```yaml
# success_experience.yaml — 成功经验
entries:
  - content: "在提交 TypeScript 变更前运行 tsc --noEmit 可以提早发现类型错误"
    signals:
      - session: "sess-001"
        date: "2026-02-28"
        detail: "agent 先运行 tsc，提前捕获了类型错误"
      - session: "sess-005"
        date: "2026-03-02"
        detail: "再次验证有效"
    first_seen: "2026-02-28"
    last_seen: "2026-03-02"
    times_seen: 2
    applicable_to: ["typescript"]   # 适用标签
```

```yaml
# permitted_skills.md 示例
# skill-evolver 有权限修改的技能列表
# 每次创建新 skill 后必须在此登记

- review-pr
- quick-test
- deploy-check
```

**Skill 创建流程**：
1. Claude 在 tmp 中发现某类经验反复出现，适用范围广
2. Claude 判断可以提炼为独立 skill
3. Claude 使用 Write 工具在 `~/.claude/skills/<new-skill-name>/SKILL.md` 创建新 skill
4. Claude 将新 skill 名字写入 `permitted_skills.md`
5. 后续演化周期中，Claude 可以根据新的经验更新已注册的 skill

---

## 5. 演化机制

### 5.1 两级演化：tmp → context/skill

区别于复杂的多级流水线和数值公式，我们采用**两级演化**，让 Claude 凭理解力做判断。

```
  ┌───────────────┐                    ┌───────────────┐
  │     tmp        │      Claude 判断    │   context     │
  │   (积累观察)    │ ──── 毕业 ────▶   │  (已确认知识)  │
  │                │                    │               │
  │ 多条信号       │                    │ 精简记录       │
  │ 可追溯来源     │                    │ 毕业日期       │
  └───────────────┘                    └───────────────┘
        ▲                                     │
        │ 新信号                               │ 矛盾/过时
        │                                     ▼
   会话日志扫描                            降级回 tmp
```

**user-context 的演化**：
- 每次演化周期，Claude 扫描新的会话日志
- 发现用户偏好/目标/认知信号 → 写入对应的 `tmp/*.yaml`
- 如果 tmp 中某条目已有多次信号、跨多个会话 → Claude 判断毕业，写入 `context/*.yaml`
- 如果新证据矛盾已确认的 context → Claude 可以降级回 tmp 重新观察

**skill-evolver 的演化**：
- 每次演化周期，Claude 扫描新的会话日志
- 发现成功/失败/技巧信号 → 写入对应的 `tmp/*.yaml`
- 如果某类经验反复出现且适用范围广 → Claude 创建独立 skill
- 如果已有 skill 需要更新 → Claude 检查 `permitted_skills.md` 后修改

### 5.2 Claude 判断毕业的指导原则

在 SKILL.md 中给出的指导原则（非硬编码公式）：

1. **重复性** — 在 3 个以上不同会话中观察到相同模式
2. **显式性** — 用户明确说过"我总是想要 X"比隐式推断权重高得多
3. **一致性** — 没有矛盾证据，或矛盾证据远少于支持证据
4. **时间跨度** — 至少跨 2 天以上的观察，防止单次长会话过拟合
5. **谨慎原则** — 宁可多等一个周期，也不要过早毕业

### 5.3 YAML 字段设计哲学

**从简**：每条记录只需要以下信息：
- `content` — 这条知识是什么
- `signals` — 证据来源（会话ID + 日期 + 简短描述）
- `first_seen` / `last_seen` — 时间跨度
- `times_seen` — 被观察到的次数

**可追溯**：每条 signal 记录了来源会话和日期，可以回溯验证。

**实效性**：`last_seen` 让 Claude 判断信息是否过时，过时的条目可以被清理。

---

## 6. 编排器设计

编排器（Orchestrator）设计极简——它只做三件事：

### 6.1 职责

1. **调度** — 按配置的时间间隔（默认 1 小时）或手动触发
2. **启动 Claude** — spawn 子进程，传入身份认定和最近报告
3. **报告管理** — 维护 `~/.skill-evolver/reports/`，保留最新 50 份

### 6.2 Claude Code CLI 调用

```typescript
import { spawn } from "child_process";
import { readRecentReports } from "./reports";

async function runEvolutionCycle() {
  // 1. 读取最近 5 份完成报告
  const recentReports = await readRecentReports(5);

  // 2. 构建 prompt
  const prompt = buildPrompt(recentReports);

  // 3. spawn claude
  const claude = spawn("claude", [
    "-p", prompt,
    "--output-format", "stream-json",
    "--model", config.model || "sonnet",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
  ], {
    cwd: process.env.HOME,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 4. 等待完成，解析输出
  return waitForCompletion(claude);
}

function buildPrompt(recentReports: string[]): string {
  return `
## 身份认定
本次任务专门用于使用 user-context skill 和 skill-evolver skill 来进行关于 user-context 和 skill 的演化。
请调用 /user-context 和 /skill-evolver 这两个 skill 来执行演化工作。

## 前几次任务的完成历史
${recentReports.length > 0 ? recentReports.join("\n---\n") : "（无历史记录，这是首次演化）"}

## 任务要求
1. 浏览 Claude Code 的会话日志，提取有价值的信号
2. 使用 user-context skill 的指导，更新用户画像的 tmp 和 context
3. 使用 skill-evolver skill 的指导，积累经验，必要时创建或更新 skill
4. 完成后，在 ~/.skill-evolver/reports/ 写一份简短的 md 格式报告，
   文件名格式：YYYY-MM-DD_HH-mm_report.md
  `.trim();
}
```

### 6.3 报告管理

```typescript
// 报告文件格式：~/.skill-evolver/reports/2026-03-03_14-30_report.md
// 最多保留 50 份，超出时删除最旧的

async function cleanupReports() {
  const reports = await getReportFiles(); // 按时间排序
  if (reports.length > 50) {
    const toDelete = reports.slice(0, reports.length - 50);
    for (const file of toDelete) {
      await fs.unlink(file);
    }
  }
}
```

### 6.4 会话日志格式

Claude Code 将对话日志存储在：
```
~/.claude/projects/<项目路径编码>/<会话ID>.jsonl
```

项目路径编码规则：绝对路径中的 `/` 替换为 `-`。每行是一个 JSON 对象，包含：
- `type`："user" | "assistant"
- `message.content`：消息内容
- `sessionId`：UUID
- `timestamp`：ISO 时间戳

SKILL.md 中需要详细说明这些路径和格式，指导 Claude 如何高效浏览日志。

---

## 7. npm 包结构

```
skill-evolver/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI 入口（#!/usr/bin/env node）
│   ├── cli.ts                # CLI 参数解析（commander）
│   ├── orchestrator.ts       # 编排器（调度 + spawn claude + 报告管理）
│   ├── scheduler.ts          # node-cron 调度
│   ├── reports.ts            # 报告读写和清理
│   ├── config.ts             # 配置管理
│   └── server/
│       ├── index.ts          # Hono 服务器
│       ├── api.ts            # REST API 路由
│       └── ws.ts             # WebSocket 实时更新
├── web/                      # Svelte 前端
│   ├── src/
│   │   ├── App.svelte
│   │   ├── main.ts
│   │   └── pages/
│   │       ├── Dashboard.svelte    # 总览 + 手动触发
│   │       ├── Reports.svelte      # 报告时间线
│   │       ├── Skills.svelte       # 浏览 user-context 和 skill-evolver 数据
│   │       └── Settings.svelte     # 配置
│   └── vite.config.ts
├── dist/                     # 编译后的代码
├── skills/                   # 元技能模板（安装时复制到 ~/.claude/skills/）
│   ├── user-context/
│   │   ├── SKILL.md                          # 路由器
│   │   ├── reference/
│   │   │   ├── runtime_guide.md
│   │   │   └── evolution_guide.md
│   │   ├── context/
│   │   │   ├── preference.yaml     # 初始为空
│   │   │   ├── objective.yaml
│   │   │   └── cognition.yaml
│   │   └── tmp/
│   │       ├── preference_tmp.yaml
│   │       ├── objective_tmp.yaml
│   │       └── cognition_tmp.yaml
│   └── skill-evolver/
│       ├── SKILL.md                          # 路由器
│       ├── reference/
│       │   ├── permitted_skills.md  # 初始为空
│       │   ├── runtime_guide.md
│       │   └── evolution_guide.md
│       └── tmp/
│           ├── success_experience.yaml
│           ├── failure_experience.yaml
│           └── useful_tips.yaml
└── docs/
```

### package.json（关键字段）

```json
{
  "name": "skill-evolver",
  "version": "0.1.0",
  "bin": {
    "skill-evolver": "./dist/index.js"
  },
  "files": ["dist/", "skills/"],
  "scripts": {
    "build": "tsc && vite build web/",
    "postinstall": "node dist/postinstall.js"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "js-yaml": "^4.1.0",
    "node-cron": "^3.0.0",
    "commander": "^12.0.0",
    "ws": "^8.0.0"
  }
}
```

### postinstall 脚本

用户执行 `npm install -g skill-evolver` 时：
1. 检查 `claude` CLI 是否可用，不可用则报错提示安装
2. 创建 `~/.skill-evolver/reports/` 目录
3. 将 `skills/user-context/` 复制到 `~/.claude/skills/user-context/`（包括 SKILL.md、reference/ 目录下的 runtime_guide.md 和 evolution_guide.md）
4. 将 `skills/skill-evolver/` 复制到 `~/.claude/skills/skill-evolver/`（包括 SKILL.md、reference/ 目录下的 permitted_skills.md、runtime_guide.md 和 evolution_guide.md）
5. 初始化空的 YAML 文件（`entries: []`）
6. 打印欢迎信息

---

## 8. Web 仪表板设计

### 8.1 页面

**仪表板（首页）**
- 上次演化周期的时间戳和状态
- 快速统计：tmp 中的条目数、context 中的条目数、已创建的 skill 数
- "立即演化" 按钮（手动触发）
- 当前运行状态指示（空闲 / 运行中 / 错误）

**报告时间线**
- 所有演化报告的时间列表
- 点击查看报告全文（md 渲染）
- 显示最近 50 份

**数据浏览**
- 查看 user-context 的 context 和 tmp 数据
- 查看 skill-evolver 的 tmp 数据和 permitted_skills
- 查看 Claude 创建的技能列表

**设置**
- 演化间隔（默认 1 小时）
- 模型选择（sonnet / haiku / opus）
- 自动运行开关

### 8.2 API 路由

```
GET  /api/status              # 编排器状态
POST /api/trigger             # 手动触发演化
GET  /api/reports             # 报告列表（分页）
GET  /api/reports/:filename   # 获取单份报告
GET  /api/context/:pillar     # 查看 user-context 或 skill-evolver 的数据
GET  /api/skills              # 列出所有演化创建的技能
GET  /api/config              # 获取配置
PUT  /api/config              # 更新配置
WS   /ws                      # 实时更新
```

---

## 9. CLI 命令行接口

```bash
# 全局安装
npm install -g skill-evolver

# 启动守护进程（调度器 + Web 仪表板）
skill-evolver start
# → 演化守护进程已启动（间隔：1小时）
# → 仪表板：http://localhost:3271

# 停止守护进程
skill-evolver stop

# 立即运行一次演化周期
skill-evolver evolve

# 在浏览器中打开仪表板
skill-evolver dashboard

# 显示当前状态
skill-evolver status

# 配置
skill-evolver config set interval 2h
skill-evolver config set model opus
```

---

## 10. 安全与隐私

- **纯本地**：所有数据留在用户机器上，无外部服务，无遥测
- **会话日志**：只读取，从不修改
- **bypassPermissions**：演化用 Claude 实例拥有完整文件读写权限（必要的，因为需要写 skill 文件）
- **权限边界**：`permitted_skills.md` 记录 skill-evolver 有权修改的 skill，防止误改用户手动创建的 skill
- **认证**：使用用户已有的 Claude Code 认证
- **前提条件**：要求用户已安装 Claude Code CLI

---

## 11. 实施路线图

### 第一阶段：基础（MVP）
- [ ] 项目脚手架（TypeScript，构建系统）
- [ ] 编写两个元技能的 SKILL.md（核心！决定演化质量）
- [ ] 初始化 YAML 文件模板
- [ ] CLI 启动器（封装 `claude -p` 子进程调用）
- [ ] 编排器（单次演化周期 + 报告管理）
- [ ] CLI 基础（`skill-evolver evolve`）
- [ ] postinstall 脚本

### 第二阶段：守护进程与仪表板
- [ ] 调度器（node-cron）
- [ ] CLI 守护进程管理（`start`、`stop`、`status`）
- [ ] Hono 服务器 + WebSocket
- [ ] Svelte 仪表板

### 第三阶段：打磨与发布
- [ ] 错误处理与恢复
- [ ] npm 包优化
- [ ] README 与文档
- [ ] 首次公开发布

---

## 12. 待讨论问题

1. **上下文窗口**：一次演化能扫描多少会话日志？可能需要让 Claude 自己判断先看哪些。
2. **多项目感知**：演化是全局的，但 tmp 中的信号来自不同项目，是否需要项目标签？
3. **SKILL.md 质量**：两个元技能的 SKILL.md 是整个系统的灵魂，需要精心打磨。
4. **成本控制**：如何防止用户设置过短间隔导致 API 费用失控？

---

*文档版本：2.1*
*创建日期：2026-03-03*
*更新日期：2026-03-04*
*状态：设计阶段*
