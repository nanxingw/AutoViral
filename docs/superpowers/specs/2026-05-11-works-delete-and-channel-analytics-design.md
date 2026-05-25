# 作品删除 · 已发布作品列表 · Settings panel 移植

> **Spec date**: 2026-05-11
> **Status**: design approved, awaiting plan
> **Author**: brainstorming session

## 背景

这次迭代解决三个"后端就绪、前端缺口"的最后一公里问题。三者都是 R32–R47 polish 期延续——把不可见的后端状态暴露给用户：

1. `deleteWork()` 后端已能级联清理 work 目录（chat / assets / output），前端没有任何入口
2. `analytics-collector.ts` 每天抓抖音作品级数据（含 play_count 等），前端只展示了汇总指标，没作品明细
3. `Config.analytics.douyinUrl` 字段 + `/api/config` GET/PUT endpoint 仍在，但前端的 `SettingsPanel.svelte`（main-legacy）在 svelte→react UI redesign 时没被移植，导致绑定能力对用户消失

## 范围

三个独立可发布的功能 section，建议落地顺序 §3 → §2 → §1（Settings 是其它两个的依赖）。

## §1. 作品级联删除（功能 1）

### 用户故事

> 我在首页 Works 区有一堆 draft 作品，想把它们删掉以及对应的 chat / 生成素材 / 渲染成品。

### 交互流

1. `WorksGrid.tsx` 卡片 hover 时右上角浮现 `⋯` 按钮（editorial 调性：`bg: var(--surface-1)/40%` + `backdrop-filter: blur(8px)`）
2. 点 `⋯` 弹 `<DropdownMenu>`，目前只一项 `Delete`（i18n key `works.menu.delete`）。预留可扩展位（未来加 Rename / Duplicate）
3. 点 `Delete` 弹 `<ConfirmDialog>`：
   - Title: `Delete "{title}"?`
   - Body (两段):
     - `This will permanently remove the chat history, generated assets, and rendered output.`
     - `Shared assets and render-queue history are not affected.`
   - Primary action: `Delete`（`--danger` 红，destructive variant）
   - Secondary: `Cancel`（默认聚焦在 Cancel 上，符合 a11y dangerous-default-cancel 规约）
4. 确认 → `DELETE /api/works/:id` → 乐观从 Tanstack Query `["works"]` cache 移除 → 失败时 rollback + 全局 ErrorToast

### In-flight 保护

Work 状态为 `creating` 且 `cliSessionId` 在 ws-bridge 内存活跃时：
- ⋯ menu 里 Delete **不灰显**，但点击后 Confirm Dialog 多一行警告：
  > `This work is currently being created. Deleting will stop the active session.`
- 后端 `deleteWork()` 行为变更：如果 work 有 `cliSessionId`，先调 `wsBridge.closeSession(sessionId)` kill 进程 → 再 `rm -rf workDir`。避免 chat.jsonl 写到一半被 rm 的 race。

### 改动文件

新增：
- `web/src/features/works/DeleteWorkConfirm.tsx`
- `web/src/features/works/WorkCardMenu.tsx`（封装 ⋯ + DropdownMenu）

修改：
- `web/src/features/works/WorksGrid.tsx` —— 集成 WorkCardMenu，传递 work 数据
- `web/src/features/works/WorksGrid.module.css` —— ⋯ 按钮的 hover 状态
- `web/src/queries/works.ts` —— 加 `useDeleteWork()` mutation
- `src/work-store.ts` —— `deleteWork(id, opts?)` 接受可选 `closeSession` callback
- `src/server/api.ts` —— DELETE /api/works/:id 调用时传入 `wsBridge.closeSession`
- `web/src/i18n/messages.ts` —— ~6 new keys

### 测试

- `WorksGrid.test.tsx`: hover → ⋯ → Delete → Confirm → mutation called with right id；creating 状态显示警告文案
- `work-store.test.ts`: deleteWork with active session 调用 closeSession callback
- `api.test.ts`: DELETE /api/works/:id 上 creating 状态 work 触发 closeSession

---

## §2. Analytics 已发布作品列表（功能 2）

### 用户故事

> 我绑定了抖音号，想在 Analytics 页面看到所有线上发布的作品和它们的播放量。

### 数据来源

后端已存在：
- `~/.autoviral/analytics/douyin/latest.json` 包含 `works[]`，每条 `{aweme_id, desc, create_time, play_count, digg_count, comment_count, share_count, collect_count}`
- 全量字段类型见 `CreatorData.works` in `src/analytics-collector.ts:17`

新增 API：
- `GET /api/analytics/creator/works` → 从 latest.json 读 `works[]`，按 `create_time desc` normalize 后返回
- Schema: `{ works: Array<NormalizedWork>, lastCollectedAt: string }`
- 三种 case: 有数据 / works 空 / latest.json 不存在 → 404

### UI 位置

`web/src/pages/Analytics.tsx` 现有顺序：
```
[CHANNEL HEALTH hero] [KPIBar] [ProfileBar] [DemographicsRow] [InsightsList]
```

新插入：
```
[..前面..] [DemographicsRow] [PublishedWorksList ← 新增] [InsightsList]
```

理由：数据 → 明细 → 行动的认知顺序。

### 信息密度

```
┌──────────────────────────────────────────────────────────┐
│ MAR 28      Sakura coffee morning routine vlog           │
│             (desc, line-clamp-2)                         │
│                                                          │
│ 12.4K plays  ❤ 842  💬 67  ↗ 23                          │
└──────────────────────────────────────────────────────────┘
```

每条:
- 左 eyebrow: `MAR 28` (JetBrains Mono, dimmed, 从 `create_time` 格式化)
- 标题: `desc` 最多 2 行 (line-clamp-2, R39 已有模式)
- 底部 4 个数据徽章: `play / digg / comment / share`
  - `play_count` 用 `--accent` 高亮（最重要指标）
  - 其它三个用 `--accent-lo`
- 整行可点击 → 新 tab 打开 `https://www.douyin.com/video/{aweme_id}`，`rel="noopener noreferrer"`

### 排序与条数

- 默认按 `create_time desc`（answer: 最近发布优先）
- 显示 top 20；如果总数 > 20，底部加 `Show all (N)` 按钮直接全展开（不分页，editorial 风格倾向 long-scroll）
- **不做 Sort toggle**（YAGNI——以后有用户要再加）

### 空态

1. **从未绑定抖音号** （latest.json 不存在 / douyinUrl 为空）：
   - 编辑大字: `Connect your Douyin channel to see published works.`
   - CTA: `Connect your Douyin channel →`，点击 **打开 SettingsPanel 并自动滚到「抖音号绑定」section**（避免死胡同）
2. **绑定但无作品** (`works = []`)：
   - `Your channel has no published videos yet.`
3. **抓取失败** (API 5xx)：
   - section 内显示 `Couldn't load works · Retry` + 全局 ErrorToast

### 改动文件

新增：
- `web/src/features/analytics/PublishedWorksList.tsx`
- `web/src/features/analytics/PublishedWorksList.module.css`

修改：
- `web/src/pages/Analytics.tsx` —— 插入 section
- `web/src/queries/analytics.ts` —— 加 `useCreatorWorks()` query
- `src/server/api.ts` —— 加 `/api/analytics/creator/works` endpoint
- `web/src/i18n/messages.ts` —— ~8 new keys

### 测试

- 后端: `api.test.ts` works endpoint 三种 case
- 前端: `PublishedWorksList.test.tsx` 渲染列表、空态、外链、Show all 切换、CTA 打开 Settings panel

---

## §3. Settings panel React 移植（功能 3）

### 用户故事

> 我想在前端 UI 里改抖音号 URL、改 Claude 默认模型、改调研 cron——不想 ssh 去改 .env 或 config.yaml。

### 入口

顶导右侧加 `⚙️` 按钮，紧挨现有 `ThemeToggle`：
```
[Brand] · [Works] [Studio] [Explore] [Analytics]      [🔍] [🌗] [⚙️]
```
- 点击触发 `<SettingsPanel>` open
- 键盘快捷键 `⌘ ,` (macOS 习惯, i18n 暂不暴露)
- ARIA: `aria-label="Open settings"`

### Panel 形态

参考 main-legacy `SettingsPanel.svelte`：
- Right-slide overlay，~480px 宽
- 透出 backdrop（点击遮罩关闭）
- Esc 关闭
- editorial 玻璃: `backdrop-filter: blur(24px) saturate(140%)` + `--glass-border`
- slide-in 动画 300ms cubic-bezier

### 4 sections + 默认模型（已 drop memory sync）

```
┌─ Settings ──────────────────────────────────────────── ✕ ┐
│                                                          │
│ 即梦 API                                                  │
│   AccessKey   [********]  [显示]                          │
│   SecretKey   [********]  [显示]                          │
│                                                          │
│ OpenRouter API                                            │
│   API Key     [********]  [显示]                          │
│                                                          │
│ 调研设置                                                  │
│   [○─] 启用自动调研                                       │
│   Cron 表达式   [0 9 * * *]                              │
│                                                          │
│ 抖音号绑定                                                │
│   Profile URL  [https://www.douyin.com/user/...]         │
│   [Refresh now]                                          │
│   Last collected: 2026-05-09 09:00                       │
│                                                          │
│ 默认模型                                                  │
│   [Sonnet ▾]                                             │
│                                                          │
│                            [Cancel]  [Save changes]      │
└──────────────────────────────────────────────────────────┘
```

### 相对 main-legacy 的关键变化

1. **去掉 Memory sync section**（用户决定）
2. **加 "Refresh now" 按钮**——别让用户绑了后等 cron
3. **加 "Last collected: {date}"**——透明告诉用户数据新旧（读 `latest.json` 的 `collected_at` 字段，不用 mtime）
4. **底部 "Save changes" 显式按钮**——main-legacy 的 auto-save on blur 跟现有 UI redesign 显式 confirmation 方向不一致
5. **password 字段保留显隐切换**

### 数据流

- `useConfig()` GET `/api/config` 加载（已存在）
- 修改后本地 dirty state（不引入 react-hook-form），点 Save → PUT `/api/config`（已存在）
- 关闭 panel 前如有 dirty changes 弹 `<UnsavedChangesConfirm>`（i18n: `Discard unsaved changes?`）

### 新 API: POST /api/analytics/refresh

- 包 `analytics-collector.ts` 现有 `collectData(douyinUrl)` 函数
- 成功返回 `{ collectedAt, worksCount }`
- 失败返回 `{ error, errorCode }`，前端弹 ErrorToast
- 长时间运行（collect.py 可能 30s+）—— 加 loading state，UI 显示 `Refreshing... (~30s)`

### .env 优先级保持

`config.ts` 现有行为不变：`.env` 中 `JIMENG_ACCESS_KEY` / `OPENROUTER_API_KEY` 等仍 override `config.yaml`。UI 修改写入 yaml，env 优先级更高——避免 UI 覆盖 .env。
UI 上如果检测到 env 覆盖，input 旁边显示 `via .env`（dimmed），用户知道在 UI 改了也不会生效。

### 改动文件

新增：
- `web/src/features/settings/SettingsPanel.tsx`
- `web/src/features/settings/SettingsPanel.module.css`
- `web/src/queries/config.ts`

修改：
- `web/src/ui/TopNav.tsx` —— ⚙️ 按钮 + ⌘ , shortcut listener + SettingsPanel mount
- `src/server/api.ts` —— `POST /api/analytics/refresh` endpoint
- `web/src/i18n/messages.ts` —— ~15 new keys

### 测试

- `SettingsPanel.test.tsx`:
  - 渲染所有字段，加载 /api/config 后回填
  - password 显隐切换
  - 修改 → Save → PUT /api/config 调用 + 关 panel
  - Refresh now → POST /api/analytics/refresh → 显示 loading → 完成后 toast
  - Esc 关闭、点遮罩关闭
  - dirty changes 时尝试关 panel 弹 UnsavedChangesConfirm
- `api.test.ts`: refresh endpoint 三种 case (success / 未绑 douyinUrl / collect.py 失败)

---

## 跨 sections 的契约

### Analytics 空态 → Settings panel 跳转

- Analytics PublishedWorksList 空态 #1 的 CTA `Connect your Douyin channel →` 触发：
  - 打开 SettingsPanel
  - 滚到 `#douyin-binding` anchor
- **实现方案**: 用 zustand store `useSettingsPanelStore`，state shape `{ open: boolean, focusSection: 'douyin' | null }`。CTA 调 `useSettingsPanelStore.setState({ open: true, focusSection: 'douyin' })`。SettingsPanel mount 时 `useEffect` 读 `focusSection` 后 scrollIntoView 对应 section ref，然后清空 `focusSection`。
- 不用 URL hash 方案——hash 会污染 history、刷新页面意外重开 panel

### Settings panel ↔ Analytics 数据刷新联动

- Settings panel 里 "Refresh now" 完成后，invalidate `["analytics-creator-works"]` query → Analytics 页 PublishedWorksList 重新加载
- 也 invalidate `["creator-analytics"]`（现有 KPI/Hero 也要 refresh）

---

## 实现顺序

落地建议 **§3 → §2 → §1**：
1. §3 先做，§2 的空态依赖 SettingsPanel 存在才能测试 + 跳转
2. §2 next，依赖 §3 的绑定流程才能真实跑通端到端
3. §1 最后，独立功能，无依赖

每个 section 是独立 PR，互不阻塞。

## 非目标

- ❌ Soft-delete + Undo toast 机制（用户决定 Modal-only）
- ❌ Sort toggle（Latest / Top plays）—— YAGNI，先看用户反馈
- ❌ Memory sync 配置 UI —— 用户决定不做
- ❌ 多平台绑定（小红书 / B 站等）—— 当前只支持抖音，本次不扩
- ❌ 批量删除作品（多选）—— YAGNI，单删够用

## 风险与回滚

- §1 的 in-flight 保护涉及 wsBridge.closeSession——如果实现里 race 处理不严，可能出现进程没杀干净但目录已删的边角。回滚：去掉 closeSession 路径，让用户先手动停止后再删。
- §3 的 .env override 检测——如果检测逻辑写错，可能误标 "via .env" 让用户困惑。回滚：去掉提示。
- §2 的 latest.json 读取——文件大时（理论上不会，works[] 一般 < 100 条）会卡 endpoint；不需要 streaming。
