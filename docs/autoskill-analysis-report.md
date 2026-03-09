# AutoSkill 项目分析报告

> 分析对象：[ECNU-ICALK/AutoSkill](https://github.com/ECNU-ICALK/AutoSkill)
> 论文：arXiv:2603.01145
> 分析日期：2026-03-09

## 一、AutoSkill 是什么

AutoSkill 是华东师范大学开发的 **Experience-Driven Lifelong Learning (ELL)** Python SDK，让 LLM Agent 能够从对话历史中自动提取、维护、复用技能。核心理念与 skill-evolver 一致：**Agent 应该跨会话学习，而不是每次从零开始。**

## 二、核心架构

AutoSkill 采用**双管线架构**：

```
管线 A — 学习（异步）
  用户对话结束 → Skill 提取（LLM/启发式） → Skill 候选
  → 维护决策（新增/合并/丢弃） → 版本化 Skill 存入 SkillBank

管线 B — 服务（同步）
  用户查询 → 查询改写 → 混合检索（向量 + BM25）
  → Skill 筛选（LLM） → 上下文注入 → LLM 响应
```

关键洞察：**提取在每次对话之后异步发生**，Skill 通过合并/版本机制进化，而非从头重写。

## 三、关键机制详解

### 3.1 Skill 数据模型

```python
@dataclass
class Skill:
    id: str
    name: str
    description: str
    instructions: str        # 核心操作指令
    triggers: List[str]      # 触发条件
    examples: List[str]      # 使用示例
    tags: List[str]
    version: str             # 语义化版本号
    status: str              # active / archived
    confidence: float        # 置信度评分
    source: dict             # 来源溯源信息
    metadata: dict           # 版本历史等
```

### 3.2 Skill 提取策略

- **每次最多提取 1 个 Skill**（质量优先于数量）
- LLM 提取器强调：
  - **证据优先**：以用户实际输入为主要证据，完整对话仅作上下文
  - **可复用性评估**：仅在"该用户可能再次需要"时才提取
  - **去标识化**：移除特定案例的实体名，使 Skill 具有通用性
- 启发式提取器作为无 LLM 时的降级方案

### 3.3 Skill 维护决策（核心差异所在）

`SkillMaintainer` 实现 **新增/合并/丢弃** 三选一决策：

```
新候选 Skill
  │
  ├─ 向量相似度 > 0.4？→ 存在潜在重复
  │    │
  │    └─ LLM 判断"能力同一性" → MERGE（合并到已有 Skill，版本号 +1）
  │                              或 DISCARD（冗余/低质量）
  │
  └─ 无重复 → ADD（作为新 Skill 加入）
```

**LLM-as-Judge**：AutoSkill 用 LLM 判断两个 Skill 是否代表"同一能力"，比纯向量相似度更可靠。

### 3.4 混合检索

```
最终得分 = 0.9 × 向量相似度 + 0.1 × BM25关键词得分
```

- 向量检索捕捉语义相似
- BM25 捕捉精确关键词匹配
- 每轮最多注入 3 个 Skill，总字符数不超 6000

### 3.5 存储结构

```
SkillBank/
  Users/<user_id>/<skill-slug>/SKILL.md    # 用户专属 Skill
  Common/<skill-slug>/SKILL.md              # 共享 Skill
  .index/                                   # 向量索引 + BM25 索引
```

## 四、与 skill-evolver 的对比分析

### 4.1 skill-evolver 的设计优势

| 维度 | skill-evolver | AutoSkill |
|------|--------------|-----------|
| **积累机制** | 两层积累（tmp → confirmed），需 3+ 会话 + 2+ 天才毕业 | 首次证据即创建 Skill |
| **关注点分离** | user-context（用户画像）与 skill-evolver（技术经验）分离 | 混合存储 |
| **集成方式** | 原生 Claude Code CLI 集成 | 通用 Python SDK，需包装 |
| **过期清理** | 明确的 60 天过期 + 信号计数阈值 | 较模糊的存档策略 |

### 4.2 AutoSkill 的设计优势

| 维度 | AutoSkill | skill-evolver 现状 |
|------|-----------|-------------------|
| **Skill 创建速度** | 每次对话后立即提取，快速积累 | 门槛过高，两天零积累 |
| **合并机制** | LLM 判断能力同一性 + 自动合并版本化 | 缺乏明确的合并策略 |
| **置信度评分** | 每个候选都有 confidence 分数 | 仅靠会话数和天数 |
| **去标识化** | 提取时自动抽象化 | 未明确要求 |
| **使用追踪** | 记录 Skill 被检索/使用的频率 | 无使用反馈循环 |
| **检索能力** | 混合检索 + 查询改写 | 依赖 SKILL.md 的 description 触发 |

## 五、skill-evolver 两天零积累的问题诊断

基于 AutoSkill 的设计理念，skill-evolver 当前的核心问题是：

### 问题 1：毕业门槛过高

当前要求 **3+ 次会话 + 跨 2+ 天** 才能从 tmp 毕业到正式知识。这意味着：
- 一个有价值的模式需要至少 3 天才能成为正式 Skill
- 初期使用时，tmp 中即使有积累，也看不到任何"产出"
- 用户感知为"系统没有在工作"

**AutoSkill 的做法**：首次提取即创建 Skill（confidence 可低），后续通过合并增强。用户立即看到产出。

### 问题 2：从 tmp 到 Skill 的路径不明确

skill-evolver 的 tmp 积累了信号，但**何时、如何**从这些信号创建一个可用的 Claude Code Skill，缺乏清晰的自动化路径。evolution_guide.md 可能对"创建 Skill"的条件描述过于保守。

### 问题 3：缺少"快速回报"机制

AutoSkill 每次对话后都有产出（至少一个候选）。skill-evolver 的定时演化（默认 1 小时）意味着反馈延迟大，且演化结果可能仅是 tmp 中多了几条记录——没有可感知的变化。

## 六、建议的改进方案

### 6.1 降低毕业门槛，引入置信度分级

```yaml
# 建议的信号置信度等级
low:       # 1 次会话提及 → 存入 tmp，标记 confidence: 0.3
medium:    # 2+ 次会话 或 用户明确表达 → confidence: 0.6
high:      # 3+ 次会话 + 跨 2+ 天 → confidence: 0.9，可毕业

# 但 medium 级别的信号也应该产生可见效果：
# - 写入 tmp 的内容在运行时也被 Claude 读取和参考
# - 用户能在 dashboard 上看到"正在积累的模式"
```

### 6.2 借鉴"立即创建，逐步增强"模式

不必等到完美才创建 Skill。可以：

1. **首次提取**：在 tmp 中记录信号（现有行为）
2. **第二次出现**：创建一个 `draft` 状态的 Skill（新增）
3. **3+ 次确认**：提升为 `active` 状态

Draft Skill 在运行时也能被触发，但会在 SKILL.md 中标注"基于有限证据"。

### 6.3 增加 Skill 合并机制

借鉴 AutoSkill 的 `SkillMaintainer`：

```
新信号进入 →
  与已有 tmp/Skill 做语义匹配 →
    匹配到 → 合并信号，更新版本号，增加 confidence
    未匹配 → 创建新条目
```

让演化 Agent 在 prompt 中明确执行这个决策流程。

### 6.4 增加使用反馈追踪

在 Skill 的 metadata 中记录：
```yaml
usage_stats:
  times_triggered: 0        # 被 Claude 会话触发的次数
  last_triggered: null
  user_feedback: neutral     # positive / neutral / negative
```

演化时参考这些数据决定是否增强、保留或归档 Skill。

### 6.5 演化 Prompt 中增加"快速产出"指令

当前的 evolution_guide.md 可能过于保守。建议在演化 Agent 的 prompt 中增加：

> "如果发现一个有价值的模式在 tmp 中已有 2+ 条记录，即使未完全满足毕业条件，也应该创建一个 draft 状态的 Skill。用户需要看到系统在工作。"

## 七、可直接借鉴的具体实现

| 特性 | 实现方式 | 优先级 |
|------|---------|--------|
| 候选置信度评分 | tmp YAML 条目增加 `confidence` 字段 | 高 |
| 版本历史追踪 | Skill metadata 增加 `version_history` 数组 | 中 |
| 去标识化提取 | 演化 prompt 中要求抽象化具体实体 | 高 |
| LLM-as-Judge 合并 | 演化时用 Claude 判断新旧信号是否属于同一模式 | 高 |
| 使用统计 | SKILL.md 的 frontmatter 中增加 usage_stats | 中 |
| 修复/重试模式 | executor 中 LLM 输出解析失败时带 repair prompt 重试 | 低 |

## 八、总结

AutoSkill 和 skill-evolver 解决同一个问题，但策略不同：

- **AutoSkill**：快速创建、逐步合并、检索驱动。像"先写后改"。
- **skill-evolver**：谨慎积累、达标毕业、触发驱动。像"三思而后行"。

两者各有优劣。skill-evolver 的"积累-毕业"机制在理论上更可靠，但当前门槛过高导致两天无产出。**核心改进方向是：保留积累机制的稳健性，同时降低"可见产出"的门槛，让用户感受到系统在持续工作。**

最实际的第一步改进：**让 tmp 中的积累在运行时也被 Claude 读取和使用**，同时引入 draft Skill 概念，让系统在完全确认之前也能产生有价值的输出。
