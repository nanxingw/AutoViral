# 创作者数据采集 + EverMemOS 记忆同步 设计文档

## 目标

为 AutoViral 添加三个模块化能力：
1. **定时采集创作者社交媒体数据**，前端展示真实数据仪表盘
2. **创作对话自动同步到 EverMemOS**（可选，opt-in）
3. **Agent 按需获取创作者数据和记忆**（通过 skill 提示词引导，不注入 system prompt）

## 架构

```
┌─ 定时采集服务 ─────────────────────────────┐
│  analytics-collector.ts                    │
│  - cron: 每 1 小时                          │
│  - 调用 creator-analytics 脚本              │
│  - 存储: ~/.autoviral/analytics/            │
│  - API: GET /api/analytics/creator          │
└────────────────────────────────────────────┘

┌─ 记忆同步服务 ─────────────────────────────┐
│  memory-sync.ts                            │
│  - 触发: pipeline 步骤完成时                │
│  - 内容: user + assistant 纯文本消息         │
│  - 目标: EverMemOS addMemory() API          │
│  - 控制: config.memory.syncEnabled (默认关) │
└────────────────────────────────────────────┘

┌─ Agent 按需访问 ──────────────────────────┐
│  通过 skill 提示词告知 agent 可用数据源：    │
│  - 脚本: 创作者数据采集/读取缓存             │
│  - API: 记忆搜索/用户画像                   │
│  Agent 在需要时主动调用，不预加载            │
└────────────────────────────────────────────┘
```

三个模块互相独立：采集服务挂了不影响记忆同步，记忆同步关闭不影响数据采集，Agent 访问任一数据源失败只影响该数据源。

---

## 模块 1: 创作者数据定时采集

### 配置

`config.yaml` 新增字段：

```yaml
analytics:
  douyinUrl: ""          # 用户的抖音主页 URL
  collectInterval: 60    # 采集间隔（分钟），默认 60
  enabled: true          # 是否启用定时采集
```

用户在设置页面输入抖音主页 URL，保存到 config。

### 采集服务 (`src/analytics-collector.ts`)

- 服务启动时注册 cron job
- 每次执行: 调用 `python3 ~/.claude/skills/creator-analytics/scripts/collect.py` 并传入 URL
- 脚本输出 JSON → 存储到 `~/.autoviral/analytics/douyin/latest.json`
- 同时存一份带日期的快照 `~/.autoviral/analytics/douyin/{YYYY-MM-DD}.json`（每天最多一份，用于趋势对比）
- 采集成功/失败记录到日志

### 数据缓存策略

- `latest.json` 带 `collected_at` 时间戳
- Agent 调用脚本时先检查 `latest.json`，1 小时内的数据直接返回，不重复采集
- 脚本增加 `--cache-dir` 参数支持读取缓存

### API 端点

```
GET /api/analytics/creator
  → 返回 latest.json 内容 + 趋势数据（对比昨天/上周的快照）

GET /api/analytics/creator/history
  → 返回最近 30 天的日快照列表（用于图表）
```

### 前端 Analytics 页面

替换当前的"作品数量统计"为真实数据仪表盘：

**顶部数据卡片（4 个）：**
- 粉丝数（+ 日/周变化）
- 总获赞数
- 平均播放量
- 互动率

**作品表现列表：**
- 最近作品的播放/点赞/评论/分享/收藏
- 按互动量排序，高亮爆款

**未配置状态：**
- 如果 `analytics.douyinUrl` 为空，显示引导：输入抖音主页 URL → 保存 → 首次采集

---

## 模块 2: EverMemOS 对话同步

### 配置

```yaml
memory:
  apiKey: ""              # EverMemOS API Key (从 .env 读取)
  userId: ""              # 可选
  syncEnabled: false      # 默认关闭，用户在设置中手动开启
```

设置页面新增"记忆同步"开关，说明文字："开启后，每次创作完成时自动将对话记录同步到 EverMemOS，让 AI 记住你的创作历史。"

### 同步服务 (`src/memory-sync.ts`)

**单一职责**：接收对话数据，格式化，调用 `MemoryClient.addMemory()`。

**接口：**
```typescript
export async function syncStepConversation(
  workId: string,
  workTitle: string,
  stepKey: string,
  stepName: string,
  blocks: StreamBlock[],
  config: Config
): Promise<void>
```

**数据过滤**：
- 只保留 `type === "user"` 和 `type === "text"` 的 block
- 过滤掉 `thinking`、`tool_use`、`tool_result`、`step_divider`
- 拼接为对话格式：`用户: xxx\n助手: xxx\n...`

**调用 addMemory：**
```typescript
await memoryClient.addMemory({
  content: formattedConversation,
  groupId: workId,
  groupName: `${workTitle} - ${stepName}`,
  role: "conversation",
})
```

### 触发时机

在 `ws-bridge.ts` 的 `pipeline_updated` 事件处理中（或前端保存步骤历史时），检测到步骤变为 `done` 时调用同步。

**错误隔离**：同步失败只打日志，不影响主流程。用 try-catch 包裹，永远不抛异常到调用方。

---

## 模块 3: Agent 按需访问数据

### 实现方式

**不改 `buildSystemPrompt()`**。改为在各 skill 的提示词中告知 agent 可用的数据获取方式。

### 需要更新的 Skill 文档

**trend-research/SKILL.md** 新增段落：
```markdown
## 可用数据源

在调研过程中，你可以访问以下数据来了解用户的账号情况：

- **创作者数据**：`curl http://localhost:3271/api/analytics/creator` 获取粉丝数、互动率、作品表现
- **历史记忆**：`curl http://localhost:3271/api/memory/search?q=关键词&method=hybrid&topK=5` 搜索历史创作经验
- **用户画像**：`curl http://localhost:3271/api/memory/profile` 获取创作风格档案

根据用户的账号数据和历史经验，给出更有针对性的趋势推荐。
```

**content-planning/SKILL.md** 新增类似段落，引导 agent 在规划时参考历史数据。

**asset-generation/SKILL.md** 和 **content-assembly/SKILL.md** 通常不需要这些数据，不添加。

### 效果

- Agent 在调研阶段可能调用 `/api/analytics/creator` 看账号数据，据此推荐"适合你粉丝量级的内容策略"
- Agent 在规划阶段可能搜索记忆 "上次做的咖啡主题"，避免重复选题
- 不需要时不调用，节省 token

---

## 文件变动清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/analytics-collector.ts` | 新建 | 定时采集服务 |
| `src/memory-sync.ts` | 新建 | 对话同步到 EverMemOS |
| `src/config.ts` | 修改 | Config 接口新增 analytics 字段 |
| `src/server/api.ts` | 修改 | 新增 `/api/analytics/creator` 端点 |
| `src/server/index.ts` | 修改 | 启动时初始化采集服务 |
| `src/ws-bridge.ts` | 修改 | 步骤完成时触发记忆同步 |
| `web/src/pages/Analytics.svelte` | 重写 | 真实数据仪表盘 |
| `web/src/pages/SettingsPanel.svelte` | 修改 | 抖音 URL + 记忆同步开关 |
| `skills/trend-research/SKILL.md` | 修改 | 添加可用数据源提示 |
| `skills/content-planning/SKILL.md` | 修改 | 添加可用数据源提示 |

## 错误隔离原则

- 采集失败 → 只记日志，Analytics 页面显示"上次采集: X 小时前（采集失败）"
- 记忆同步失败 → 只记日志，不影响 pipeline 推进
- Agent 调用数据 API 失败 → agent 自行处理（没有数据就不用），不阻断创作流程
- EverMemOS 未配置 → 同步服务静默不启动，agent 调用记忆 API 返回空结果
