# AutoViral 全量问题修复设计文档

> 2026-04-01 | 涵盖 issues-and-improvements.md 中全部 12 个问题 + 质量优先原则注入

---

## 问题清单与实施方案

### G: 质量优先原则注入

**文件**: `src/ws-bridge.ts` — `buildSystemPrompt()`
**方案**: 在 system prompt 最前面（角色声明之前）插入质量优先原则（4 条）。放最前面是因为 Claude 对开头指令遵循度最高。

### BUG-3: 进程稳定性（三层修复）

**3a. 全局异常捕获** — `src/cli.ts`
- 在 `startServer()` 之前注册 `uncaughtException` / `unhandledRejection` 处理器
- 记录错误但不退出进程

**3b. 前端错误提示** — `web/src/components/AssetPanel.svelte`
- 新增 `loadError` 状态变量
- fetch 失败时设 `loadError = true`
- 显示"服务器连接失败"+ 重试按钮

**3c. pm2 守护** — `ecosystem.config.cjs` + `src/cli.ts`
- 新增 pm2 配置文件
- `start` 命令增加 `--pm2` 选项
- 检测 pm2 是否安装，自动委托

### BUG-4: 对话历史 JSONL 增量持久化

**文件**: `src/ws-bridge.ts`
**方案**:
- 新增 `appendToChatLog()` 方法，每条消息追加写入 `chat.jsonl`（JSONL 格式）
- 所有 `messageHistory.push()` 调用点后增加 `appendToChatLog()`
- session 恢复时优先从 JSONL 加载，兼容 legacy JSON 格式并自动迁移

### BUG-5: 字幕渲染管线

**新增文件**: `skills/content-assembly/scripts/subtitle_burn.py`
**方案**: moviepy + Pillow
- 支持 SRT / ASS / JSON 字幕格式
- 5 种预设风格：modern / cinematic / bold / minimal / karaoke
- 强制使用 `~/.autoviral/fonts/` 下的高质量字体
- SKILL.md 新增强制规则：禁止 Agent 自行用 ffmpeg drawtext

### OPT-1: 创建流程智能自动触发（方案 C）

**文件**: `src/server/api.ts` + `web/src/App.svelte`
**方案**:
- research prompt 开头增加信息充分性检查
- `buildInitialPrompt()` 在信息不足时改为引导 Agent 先提问
- 保留自动触发，但 Agent 行为从"硬跑"变为"先问再做"

### BUG-1 + ARCH-3: topicHint 优先级修复

**文件**: `src/server/api.ts`
**方案**:
- topicHint 存在时，作为调研的核心约束（最高优先级）
- `config.interests` 从"必须相关"改为"可以参考"（软性参考）
- 热搜仅用于选标签蹭流量

### BUG-2 + ARCH-1 + OPT-2: 内容类型体系重构

**文件**: `src/work-store.ts` + `web/src/lib/api.ts` + `web/src/components/NewWorkModal.svelte` + `web/src/lib/i18n.ts` + `src/server/api.ts` + `web/src/App.svelte`
**方案**:
- ContentCategory 类型统一为 `"anxiety" | "conflict" | "comedy" | "envy" | "other"`
- NewWorkModal 新增第 5 个"其他"按钮
- 选"其他"时不套情绪模板，Agent 在对话中与用户协商
- research prompt 为"other"类型提供通用调研路径

### ARCH-2 + ARCH-4 + OPT-3: Agent 行为策略

**新增文件**: `skills/asset-generation/modules/fallback-strategy.md`
**更新文件**: `src/ws-bridge.ts` — `buildSystemPrompt()`
**方案**:
- 新增 fallback-strategy 技能文档，覆盖 6 种受阻场景的标准降级路径
- buildSystemPrompt 中增加受阻降级策略摘要 + 首帧驱动原则
- 指引 Agent 阅读完整降级策略文档

---

## 改动文件清单

| 文件 | 改动类型 | 关联 Issue |
|------|---------|-----------|
| `src/ws-bridge.ts` | 修改 | G, BUG-4, BUG-5, ARCH-2/4, OPT-3 |
| `src/cli.ts` | 修改 | BUG-3a, BUG-3c |
| `src/server/api.ts` | 修改 | OPT-1, BUG-1, ARCH-3, BUG-2 |
| `src/work-store.ts` | 修改 | BUG-2 |
| `web/src/components/AssetPanel.svelte` | 修改 | BUG-3b |
| `web/src/components/NewWorkModal.svelte` | 修改 | BUG-2 |
| `web/src/App.svelte` | 修改 | OPT-1, BUG-2 |
| `web/src/lib/api.ts` | 修改 | BUG-2 |
| `web/src/lib/i18n.ts` | 修改 | BUG-2 |
| `ecosystem.config.cjs` | 新增 | BUG-3c |
| `skills/content-assembly/scripts/subtitle_burn.py` | 新增 | BUG-5 |
| `skills/content-assembly/SKILL.md` | 修改 | BUG-5 |
| `skills/asset-generation/modules/fallback-strategy.md` | 新增 | ARCH-2, ARCH-4, OPT-3 |
