# Content Evaluator 系统设计文档

> **Goal:** 在 AutoViral pipeline 的每个阶段切换点插入独立的 Evaluator Agent 进行严格质量审查，借鉴 Anthropic harness design 的 GAN 式架构，实现"创作-评审"分离。

## 核心架构

### 双 Agent 持久会话模型

```
Work
├── 创作 Agent (cliSessionId) ─── 贯穿整个 work 生命周期，--resume 延续
├── Evaluator Agent (evalSessionId) ─── 每个阶段独立，同阶段内 --resume 延续
│   ├── research 阶段 evalSession → 阶段完成后丢弃
│   ├── plan 阶段 evalSession → 阶段完成后丢弃
│   ├── assets 阶段 evalSession → 阶段完成后丢弃
│   └── assembly 阶段 evalSession → 阶段完成后丢弃
```

通信方式：文件交接（file-based handoff），不共享上下文。

### Pipeline 状态机扩展

```
pending → active → evaluating → done
                 ↗ (eval通过)
          evaluating
                 ↘ (eval打回) → active(修复中) → evaluating(复查)
                                    ↕ (最多3轮)
                              eval_blocked(人工介入)
```

新增状态：`evaluating`、`eval_blocked`

### 触发模式

- **混合模式（C）**：阶段内创作 agent 自由工作，仅在 `pipeline/advance` 被调用时拦截触发 evaluator
- **用户可切换**：work 级别 `evaluationMode: boolean` 字段

### 评审方式

- **全维度审查（C）**：文本审查 + 文件检查（ffprobe/ls）+ 视觉审查（Claude Vision 读取图片/视频帧）

### 修复流程

- **原 agent resume（A）**：evaluator 反馈注入原创作 agent 的会话，基于已有上下文修复

### 迭代上限

- **硬上限 3 次 + 人工介入（A）**：超过后暂停，用户选择强制通过/给方向/重来

### UI 呈现

- **单一时间线，角色区分（A）**：创作 agent 和 evaluator 在同一聊天流中，用不同颜色和标签区分

---

## 数据模型

### Work 扩展

```typescript
interface Work {
  // ...existing
  evaluationMode: boolean;
  evalSessionIds: Record<string, string>;  // { "plan": "session-xxx" }
  evalAttempts: Record<string, number>;    // { "plan": 2 }
}
```

### PipelineStep 状态扩展

```typescript
type StepStatus = "pending" | "active" | "evaluating" | "done" | "skipped" | "eval_blocked";
```

### 评审结果文件

存储在 `{workDir}/eval-{step}-{attempt}.json`：

```json
{
  "step": "assets",
  "attempt": 1,
  "verdict": "fail",
  "scores": { "aesthetics": 6, "consistency": 4, "technical": 8 },
  "issues": [
    { "severity": "critical", "description": "第3镜色调与整体不一致", "file": "frames/frame-03.png" }
  ],
  "suggestions": ["重新生成第3镜首帧，增加 warm color grading 关键词"]
}
```

---

## Evaluator Agent 规格

### 启动方式

与创作 agent 完全一致：`spawn("claude", ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"])`

首次启动为新 session，同阶段复查时 `--resume evalSessionId`。

### System Prompt 构成

```
角色定义 + 评审标准（从 criteria/{step}.md 加载）
+ 本次评审对象（产出文件路径、创作 agent 阶段总结）
+ 评审历史（上一轮结果 + 修复说明，仅复查时）
+ 输出格式要求（结构化 JSON）
```

### 能力权限

- 读取文件（cat/ls）、检查视频（ffprobe）
- 读取图片（Claude Vision）
- **不允许**修改文件、调用生成 API

---

## 拦截流程（pipeline/advance 改造）

```
创作Agent调用 pipeline/advance
  → evaluationMode 关闭？ → 直接推进（现有行为）
  → evaluationMode 开启？
      → 设状态为 "evaluating"
      → 构建 evaluator prompt
      → spawnEvaluator(workId, step)
          → 首次？新 session
          → 复查？--resume evalSessionId
      → evaluator 返回结构化结果
          → PASS → 推进 pipeline，丢弃 evalSessionId
          → FAIL → 设状态回 "active"
              → 反馈注入创作Agent（resume）
              → evalAttempts++
              → evalAttempts > 3？→ "eval_blocked"
```

---

## UI 设计

### StreamBlock 扩展

```typescript
type StreamBlock = {
  type: "user" | "text" | "thinking" | "tool_use" | "tool_result"
      | "step_divider" | "eval_divider";
  source?: "creator" | "evaluator";
}
```

### 渲染规则

| source | 颜色 | 标签 |
|--------|------|------|
| creator (default) | 现有蓝色 accent | 创作 |
| evaluator | 琥珀/橙色 accent | 评审 |

### eval_divider

- type=start: "── 评审开始 (第N轮) ──"
- type=end+pass: "── 评审通过 ✓ ──"
- type=end+fail: "── 评审未通过 ✗ ──"

### Evaluation Toggle

Studio 顶栏 toggle 开关，label "质量评审"

### eval_blocked 面板

```
⚠️ 评审已达最大迭代次数 (3/3)
[强制通过]  [给出修改方向]  [重新开始该阶段]
```

---

## Skill 结构

```
skills/content-evaluator/
  SKILL.md                 — 通用评审方法论、输出格式、评分体系
  criteria/
    research.md            — 调研评审标准
    plan.md                — 策划评审标准
    assets.md              — 素材评审标准（含视觉审查）
    assembly.md            — 合成评审标准（含技术审查）
  modules/                 — 可扩展评审能力
  references/
    douyin.md              — 抖音平台评审标准
    xiaohongshu.md         — 小红书平台评审标准
```

---

## 需要修改的文件

| 文件 | 改动 |
|------|------|
| `src/ws-bridge.ts` | 新增 spawnEvaluator()、evaluator 消息路由（带 source 标记）、eval session 管理 |
| `src/work-store.ts` | 新增 evaluating/eval_blocked 状态、eval 相关字段、评审结果读写 |
| `src/server/api.ts` | 改造 pipeline/advance 拦截逻辑、新增 eval API（toggle/force-pass/retry） |
| `web/src/pages/Studio.svelte` | StreamBlock source 渲染、eval toggle、eval_blocked 面板、evaluator 消息样式 |
| `web/src/components/PipelineSteps.svelte` | evaluating/eval_blocked 状态显示 |
| `web/src/lib/api.ts` | 新增 eval 相关 API 类型和函数 |
| `web/src/lib/ws.ts` | 处理 evaluator source 的消息 |
| `docs/skill-structure-guide.md` | 更新为 4+1 规则 |
| `CLAUDE.md` | 更新 skill 规则描述 |
| `skills/content-evaluator/*` | 全新 skill 目录 |
