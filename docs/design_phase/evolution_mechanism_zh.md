# 演化机制：两级积累与毕业

## 概述

演化机制将原始对话信号转化为可靠的知识和技能。它采用简单的两级模型：观察在 `tmp` 中积累，当 Claude 判断其足够成熟时，它们毕业到 `context`（用户知识）或成为独立的 skill（技术模式）。

核心洞察：**Claude 是裁判**。我们不使用数值置信度公式。SKILL.md 提供毕业指导原则，由 Claude 凭理解力来判断一个观察是否有足够证据毕业。

---

## 1. 两级模型

```
  ┌───────────────┐                    ┌───────────────┐
  │     tmp        │    Claude 判断      │   context     │
  │   (积累观察)    │ ──── 毕业 ────▶   │  (已确认知识)  │
  │                │                    │               │
  │ 原始信号       │                    │ 精简记录       │
  │ 可追溯         │                    │ 最小化字段     │
  └───────────────┘                    └───────────────┘
        ▲                                     │
        │ 新证据                               │ 矛盾/过时
        │                                     ▼
   会话日志扫描                            降级回 tmp
```

### 为什么不用三级？为什么不用数值公式？

- **简洁**：系统操作员是 LLM。它不需要计算 `0.73 >= 0.8 阈值`。它能读懂"在 4 个会话中观察到 5 次，跨 2 周"并理解这是强证据。
- **灵活**：死板的公式无法捕捉细微差别。"用户明确说'永远用 bun'"比"项目中有 bun.lockb"更有说服力——Claude 天然理解这一点。
- **可维护**：更少的活动部件，更少的边界情况，更少的 bug。

---

## 2. 数据结构

### 2.1 tmp 条目（积累中）

```yaml
# 最少字段，最大可追溯性
entries:
  - content: "用户偏好使用 bun 而非 npm 进行包管理"
    signals:
      - session: "abc-123"
        date: "2026-03-01"
        detail: "用户纠正 agent：'用 bun install，不要 npm'"
      - session: "def-456"
        date: "2026-03-02"
        detail: "项目中有 bun.lockb，没有 package-lock.json"
      - session: "ghi-789"
        date: "2026-03-03"
        detail: "用户说 '永远用 bun'"
    first_seen: "2026-03-01"
    last_seen: "2026-03-03"
    times_seen: 3
```

字段：
- `content` — 观察到了什么（一句话）
- `signals` — 证据链（会话ID + 日期 + 简短描述）
- `first_seen` / `last_seen` — 时间跨度
- `times_seen` — 被观察到的次数

就这些。没有置信度分数，没有权重，没有衰减公式。

### 2.2 context 条目（已确认）

```yaml
# 更加精简——只有确认的知识
entries:
  - content: "用户偏好使用 bun 而非 npm 进行包管理"
    graduated: "2026-03-05"
    source_signals: 4        # 毕业时的信号数
    last_validated: "2026-03-05"
```

字段：
- `content` — 已确认的知识
- `graduated` — 何时晋升
- `source_signals` — 毕业时的证据强度（用于审计）
- `last_validated` — 最后一次被强化

### 2.3 skill-evolver 的 tmp 条目

```yaml
# success_experience.yaml
entries:
  - content: "提交 TypeScript 变更前运行 tsc --noEmit 可以提早发现类型错误"
    signals:
      - session: "sess-001"
        date: "2026-02-28"
        detail: "Agent 先运行 tsc，在提交前捕获了类型错误"
      - session: "sess-005"
        date: "2026-03-02"
        detail: "再次确认有效——tsc 又捕获了一个问题"
    first_seen: "2026-02-28"
    last_seen: "2026-03-02"
    times_seen: 2
    applicable_to: ["typescript"]
```

`applicable_to` 字段帮助 Claude 判断一个经验是否足够广泛，可以成为独立 skill。

---

## 3. 毕业指导原则

这些是写在 SKILL.md 中的指导原则，不是硬编码规则：

### user-context（tmp → context）

| 指导原则 | 理由 |
|----------|------|
| 在 3+ 个不同会话中观察到 | 防止单次对话过拟合 |
| 时间跨度至少 2 天 | 确保不是一次性偏好 |
| 无矛盾证据（或矛盾远少于支持） | 一致性检查 |
| 用户显式声明权重远高于隐式模式 | "永远用 X" > 从文件模式推断 |
| 有疑问时，多等一个周期 | 默认保守 |

### skill-evolver（tmp → 独立 skill）

| 指导原则 | 理由 |
|----------|------|
| 跨多个项目/上下文观察到的模式 | 确保通用性 |
| 多条信号且适用范围广 | 非项目特有的怪癖 |
| 能表达为清晰、可执行的指令集 | 技能质量检查 |
| 未被已有 skill 覆盖 | 避免重复 |

---

## 4. 操作

每个演化周期，Claude 对数据执行以下操作：

### user-context 数据操作

| 操作 | 描述 |
|------|------|
| **添加信号** | 发现新证据 → 追加到现有 tmp 条目的 signals，或创建新条目 |
| **毕业** | tmp 条目有足够证据 → 将 content 移至 context，从 tmp 移除 |
| **矛盾** | 新证据与 context 条目相悖 → 降级回 tmp 重新观察 |
| **更新** | context 条目需要基于新信号细化 → 就地更新 |
| **清理过期** | tmp 条目长期未被观察到 → 移除 |

### skill-evolver 数据操作

| 操作 | 描述 |
|------|------|
| **添加信号** | 发现新的成功/失败/技巧 → 追加到现有 tmp 条目或创建新条目 |
| **创建技能** | 积累的经验准备好成为独立 skill → 写新的 SKILL.md + 注册到 permitted_skills.md |
| **更新技能** | 已注册的 skill 需要改进 → 修改现有 SKILL.md |
| **清理过期** | tmp 条目不再相关 → 移除 |

---

## 5. 冲突解决

**新证据与已确认 context 矛盾：**
1. 单个矛盾 → 记录但不行动。一个数据点不应推翻已建立的知识。
2. 重复矛盾 → 将 context 条目降级回 tmp 重新观察。
3. 用户明确说"我改主意了" → 快速通道：立即更新 context。

**tmp 中的竞争观察：**
- 如果两个 tmp 条目互相矛盾，Claude 保留两者并等待更多证据。
- 信号更多且更近期的那个最终会毕业。

---

## 6. 过时与清理

Claude 可以用常识清理过期条目：
- tmp 条目 60+ 天未被强化 → 可能不再相关
- 条目关于一个不再活跃的特定项目 → 移除
- 条目被更具体或更准确的观察取代 → 合并或移除

对于已确认的 context，过时处理更温和：
- 确认条目假定有效，除非被矛盾
- 非常旧的条目（180+ 天未被强化）可以标记待审查

---

## 7. 生命周期示例

**"用户偏好生成的 UI 使用暗色模式"**

**第 1 天，会话 12：**
```
Claude 扫描日志，注意到：用户在仪表板中要求暗色模式。
→ 添加信号到 preference_tmp.yaml
  content: "用户偏好生成的 UI 使用暗色模式"
  signals: [{ session: "12", detail: "为仪表板请求暗色模式" }]
  times_seen: 1
```

**第 3 天，会话 15：**
```
Claude 注意到：用户再次请求暗色模式，这次是设置页面。
→ 添加信号（强化现有条目）
  times_seen: 2
```

**第 8 天，会话 20：**
```
用户明确说："我总是想要暗色模式作为默认"
→ 添加信号（显式声明，非常强）
  times_seen: 3，跨 3 个会话，7 天
→ Claude 判断：3 个会话，7 天，显式声明 → 毕业
→ 移入 preference.yaml：graduated: "2026-03-08"
```

**第 60 天，无更多提及：**
```
条目留在 context 中——已确认的知识不会快速过期。
除非被矛盾，否则仍然有效。
```

**第 65 天，会话 45：**
```
用户说："其实，现在用系统默认主题吧"
→ Claude 判断：显式矛盾 → 降级回 tmp
→ 创建新 tmp 条目："用户偏好系统默认主题"
```

---

## 8. 文件组织

```
~/.claude/skills/
├── user-context/
│   ├── SKILL.md
│   ├── context/                # 已确认知识
│   │   ├── preference.yaml
│   │   ├── objective.yaml
│   │   └── cognition.yaml
│   ├── tmp/                    # 积累中的观察
│   │   ├── preference_tmp.yaml
│   │   ├── objective_tmp.yaml
│   │   └── cognition_tmp.yaml
│   └── scripts/
│
├── skill-evolver/
│   ├── SKILL.md
│   ├── reference/
│   │   └── permitted_skills.md
│   ├── tmp/
│   │   ├── success_experience.yaml
│   │   ├── failure_experience.yaml
│   │   └── useful_tips.yaml
│   └── scripts/
│
├── <演化创建的技能-1>/
│   └── SKILL.md
├── <演化创建的技能-2>/
│   └── SKILL.md
└── ...

~/.skill-evolver/
└── reports/                   # 完成报告
    ├── 2026-03-03_14-30_report.md
    ├── 2026-03-03_15-30_report.md
    └── ...                    # 最多 50 份，最旧自动删除
```

---

## 9. 设计原则

1. **Claude 原生**：Claude 读 YAML，理解上下文，做出判断。不需要数值机制。

2. **可追溯**：每个毕业条目都可追溯到来自特定会话的特定信号。

3. **保守**：毕业需要跨多个会话的多个信号。假阴性（遗漏真实模式）优于假阳性（固化错误模式）。

4. **自我修正**：矛盾会降级条目。过时允许清理。Claude 可以修正自己之前的判断。

5. **极简**：每条 YAML 记录只有 4-5 个字段。不臃肿。

---

*文档版本：2.0*
*创建日期：2026-03-03*
*状态：设计阶段*
