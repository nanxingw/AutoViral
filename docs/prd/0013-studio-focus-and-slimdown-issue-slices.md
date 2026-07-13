# 0013 · Studio 工作台聚焦（issue slices）

> Parent: [docs/prd/0013-studio-focus-and-slimdown.md](0013-studio-focus-and-slimdown.md)
> 本文件是这批 issue 的事实源（docs-only tracker，绝不开 GitHub Issue）。triage：全部 `ready-for-agent`。
> **测试先行（.claude/rules/test-first.md）**：每片「预设测试」必须在实现代码动笔前落盘并**证红**——这是每片 Acceptance criteria 的第一项，不逐片重复。测外部行为不测实现细节；先 grep 最近的测试先例照抄模式。
> **执行约定**：每片由 codex (GPT-5.6) 实现，Claude 主线编排并与 codex 同步 review；分歧以测试/浏览器证据裁决。
> **实施顺序**：S1、S2、S4 可并行起步 → S3（S2 后，TopBar/Tweaks 文件重叠）→ S5（依赖 S3+S4）→ S6（依赖 S2）→ S7（依赖 S1+S2）→ S8（依赖 S7）→ S9（依赖 S4）→ S10 收尾。
> **E2E 铁律**：S10 经 Workflow 多纬度 subagent 执行（≥5 纬 + completeness-critic），主 agent 不亲点浏览器；浏览器纬度用 Claude subagent（codex 无浏览器 MCP）。
> **调研前置**：实现者开工前先读 parent PRD 的 Problem/Decisions；六份调研原始 JSON（含全部 file:line 证据链）归档在 [docs/prd/0013-recon/](0013-recon/)（`result-{notch,icons,playhead,timeline,slash,simplify}.json`），勿重复调查。

---

## S1 · store→Player seek 桥：拖 playhead / 点 ruler / 快捷键真正驱动预览

**What**：`store.ts` 新增 `requestSeekFrame(frame)`（写 `pendingSeek:{frame,seq}`，seq 递增防 Zustand 同帧去重）与 `reportPlayerFrame(frame)`（Player 上报，仅更新 currentFrame）；PreviewPanel 新增订阅 pendingSeek 的 effect 执行 `playerRef.current.seekTo()`，frameupdate 改调 reportPlayerFrame；Scrubber 废弃直接 seek+setFrame 双路径改走 requestSeekFrame。迁移全部 seek 意图调用点：`Playhead.tsx`、`Ruler.tsx`、`useShortcuts.ts`(J/L)、`features/terminal/useBridgeEvents.ts`(ui-seek)、`panels/Chat/index.tsx`(locator)、`panels/RightPane/index.tsx`(viewer-action)。composition load 清空 pendingSeek；pointermove 按 rAF 合并 latest-wins，pointerup 最终帧无条件提交。
**禁**：`useEffect(() => seekTo(frame), [frame])`——播放中 frameupdate 会回流成每帧 seek（抖动/回退）。边界帧以 Player 实际夹紧（durationInFrames-1）为准。

**预设测试**（先落盘证红）：
- `PreviewPanel.test.tsx`：Player mock seekTo=vi.fn；同 render 挂 PreviewPanel+Playhead，pointerDown x=0/pointerMove x=100（沿用 Playhead.test.tsx:28-35 参数）断言 `seekTo(90)`——当前红（store=90、seekTo 0 次）。
- 同法 Ruler 集成：clientX=100/50px/s/30fps → `seekTo(60)`。
- 反向回归：派发 frameupdate{frame:42} → currentFrame/Playhead left 更新且 seekTo **未**被调（reportPlayerFrame 不回流）。
- 播放中 scrub：isPlaying=true 连续拖动 → seekTo 收到最新帧、pause 未被调。
- store 单测：requestSeekFrame 沿用 store.test.ts:659-693 的 clamp 预期；reportPlayerFrame 不增 seq。

**Acceptance criteria**：
- [ ] 预设测试证红后转绿；`npm run test:web` 全绿。
- [ ] 快捷键/terminal/Chat locator 调用点全部迁移（grep `setFrame(` 生产代码剩余调用仅 reportPlayerFrame 内部与合法非 seek 用途）。

**Blocked by**：None。
**Code-area hints**：`web/src/features/studio/store.ts:922-931`、`panels/PreviewPanel.tsx:128-176`、`panels/Timeline/{Playhead,Ruler}.tsx`、`hooks/useShortcuts.ts:74-81`。

---

## S2 · IconButton 组件 + pill 规则降 specificity + 第一批收编（reader/TopBar/Tweaks）

**What**：新增 `web/src/ui/IconButton.tsx/.module.css/.test.tsx`（强制 aria-label、默认 type=button、data-bare + data-icon-button marker；CSS `padding:0; display:inline-grid; place-items:center; line-height:0; flex:none`，SVG display:block；尺寸 compact/sm/md/lg，variant ghost/surface/danger）。新增最小 `web/src/ui/icons.tsx`（XIcon 等，24×24 viewBox），逐步替换 Unicode "×"。改 `globals.css:75` pill 规则为 `:where(.studio-shell) :where(button:not(.send-btn):not([data-accent-swatch]):not([data-bare]))`——data-bare 真正退出、CSS Module 可覆盖。第一批收编：`reader/ScriptReader.tsx:230`（截图缺陷本体）、`TopBar.tsx:331`("?")、`Tweaks/index.tsx:35`(关闭)。
**禁**：全局 `button svg` 通配规则；把 reader TOC 数字按钮/编辑文字按钮收编进 IconButton（反例，要有反向断言）。

**预设测试**：
- `IconButton.test.tsx`：type=button 默认、ref/click/disabled 转发、缺 aria-label 时 dev 告警、marker 与 SVG aria-hidden wrapper、尺寸/variant class、外部 className 合并不覆盖 marker。
- `ScriptReader.test.tsx`：按本地化 accessible name 取关闭按钮，断言 data-icon-button + SVG 子节点（非文本"×"），点击仍 closeReader——当前红。
- `TopBar.test.tsx` / `Tweaks/index.test.tsx`：目标按钮带 marker、原行为不变。
- 反向断言：reader edit 按钮与 mini-TOC **不**带 marker。

**Acceptance criteria**：
- [ ] 证红转绿 + `test:web` 全绿。
- [ ] globals.css 变更后既有依赖 pill fallback 的按钮视觉不回退（对照 icons 调研"已符合规范正例"清单抽查 LibraryTab/PreviewPanel/Chat composer 测试不破）。

**Blocked by**：None。
**Code-area hints**：`web/src/styles/globals.css:73-90`、`web/src/features/studio/reader/ScriptReader.tsx`、调研清单见 `result-icons.json` findings[2]（静态确认高风险按钮全列表）。

---

## S3 · Studio 视口锁定 + TopNav 条件隐藏 + 全局控件迁移 + macOS drag

**What**：① `App.tsx` 用 `matchPath('/studio/:workId/*')` 在 Studio 路由不渲染 TopNav；② 新增 `web/src/features/settings/GlobalSettingsHost.tsx` 常驻挂载 SettingsPanel + Cmd/Ctrl+, 快捷键（从 TopNav.tsx:46-57 解耦，TopNav 只留按钮调 store）；③ Studio shell 改 `height:100vh`（fallback）+`100dvh`+`min-height:0`+`overflow:hidden`（建议抽 Studio.module.css），内部 PanelGroup 滚动链不动；④ 新增 `Tweaks/AppPreferencesSection.tsx`：LocaleToggle + 打开全局设置按钮（ThemeSection 已在）；⑤ TopBar 空白区在 darwin Electron 下 `-webkit-app-region: drag`、交互控件 no-drag（迁移 TopNav.module.css:15-26 的模式）；⑥ Studio LoadErrorScreen 补"返回作品列表"动作（隐藏 TopNav 后失败页无退出口）。
**禁**：全局 body overflow:hidden（Works/Editor 需文档滚动）；把三个全局控件横排塞进 TopBar（小窗截断）。

**预设测试**：
- `App.test.tsx`：/studio/w1 挂载 App 断言无 role=navigation；/ 与 /works 导航仍在。
- `Studio.layout.test.tsx`：shell computed overflow:hidden + 高度锁定规则；五 Panel 三 ResizeHandle 完整。
- `GlobalSettingsHost.test.tsx`：无 TopNav 时 Cmd/Ctrl+, 开、Esc 关。
- `Tweaks/index.test.tsx` + `Studio.integration.test.tsx`：齿轮开 Tweaks；语言写 locale store；全局设置按钮写 settings store。
- 桌面壳：mock `window.autoviralDesktop.platform='darwin'` 断言 TopBar drag / 按钮 no-drag。

**Acceptance criteria**：
- [ ] 证红转绿 + `test:web` 全绿。
- [ ] 浏览器验收归 S10 布局纬（window 不可滚 + 内部面板可滚 + 1024×680 小窗）。

**Blocked by**：S2（TopBar/Tweaks 文件重叠，S2 先合入）。
**Code-area hints**：`web/src/App.tsx:12-18`、`web/src/ui/TopNav.tsx`、`web/src/pages/Studio.tsx:267-280`、`desktop/main.ts:394-418`。

---

## S4 · 瘦身：删除 Explore/Analytics/coach/两套 cron/trends CLI + config 兼容

**What**：按 `result-simplify.json` proposal 全量执行——
(a) 前端：删 Explore/Analytics 页面与测试、`features/explore/`(18 文件)、`features/analytics/`(27 文件)、queries `{trends,angleBriefs,analytics,analytics-insights}`、lib `{benchmark,creator-analytics,content-pillars,platform-honesty}` 族、InsightRibbon 三件套 + Works 尾部区块；main.tsx 抽 routes 后 `/explore`/`/analytics` 精确 `<Navigate replace to="/">`，其余仍 404；TopNav 只留 Works tab；NotFound KNOWN_ROUTES 清理；Chat 去 coach（CoachConfig/coach prop/CoachIdeaActions/parser）、useChatSocket 去 sendOverride；Settings 删 research/douyin 两节 + CSS + store 字段 + config query + MSW + 中英词条。
(b) 服务端：删 routes `{trends,analytics,coach}.ts`、`research-scheduler.ts`、`trends-write.ts`、`src/trends/`、domain `{analytics-collector,collector-parse,generate-insights,insight-guardrail,coach-context,coach-session,angle-briefs}` 族、`infra/collector-env.ts`、`python/collector/collect.py`；api.ts unmount 三 router；index.ts 移除两套 cron 启动；ws-bridge 删 trends_/coach_ 会话特判并把系统提示里 `autoviral trends` 改为通用按需 research；删 Bridge `/trends` + includeTrends + `src/context/trends.ts`；CLI 先拆 `profileCommand` 到新 `commands/profile.ts` 再删 trendsCommand；删 `/api/interests` + config.interests。
(c) 依赖：移除 node-cron、@types/node-cron、fast-xml-parser；删趋势抓取专属 --heavy/Playwright cache doctor/setup 逻辑；**保留** scripts/ensure-chromium.mjs 与桌面 Remotion Chromium。
(d) config 兼容：loadConfig() 显式解构丢弃 research/analytics/interests 后合并默认；不启动时重写磁盘；PUT 旧 flat 字段静默忽略返 200；redactedConfigResponse 不回显退休字段。
(e) docs：README/CONTEXT code-map 更新；新增退役 ADR、ADR-010/011 标 Superseded、ADR-013 清 coach 描述；trend-research-via-cli.md 归档；skill 手册删 first-trends-scrape/--heavy 文案（保留 topicHint 与 per-work research 说明）；CHANGELOG 0.1.11 Removed/Breaking 措辞见调研 proposal(d)。
**保留红线**：topicHint 全链路、per-work research 目录、cost-ledger 全部、通用 research module。

**预设测试**（调研 presetTests 全单照抄，此处摘要）：
- 路由矩阵：/explore、/analytics replace→/；拼错路径仍 404 且不建议已删页面。
- 旧 config 兼容：含 research/analytics/interests 的 fixture 加载成功、GET /api/config 不回显、PUT 旧字段 200 且不建 scheduler。
- removed-route 矩阵：/api/trends*、/api/analytics*、/api/coach*、bridge /trends 全 404；/api/works/:id/cost 等保留路由回归。
- 共享链路：普通 work 多会话 Chat backend 测试保留通过（证 ws-bridge 删特判未伤主链）；NewWorkCard topicHint payload、cost-ledger 套件继续通过。
- 删除清单内的旧测试文件同步删除（见调研 presetTests[3][6]）。

**Acceptance criteria**：
- [ ] 证红转绿；`test:web` + `test:server` + `test:cli` + `typecheck:web` + `build:backend` + `build:frontend` 全绿（不并发跑两套 vitest）。
- [ ] grep 生产代码无 trends/coach/analytics-collector 残余 import。

**Blocked by**：None（与 S3 并行安全：S4 动 TopNav 仅删 tab 数组项）。
**Code-area hints**：全列表见 `result-simplify.json` findings+proposal（file:line 级）。**大片，建议 codex 分 (a)(b) 两个 task 串行执行，(c)(d)(e) 随后**。

---

## S5 · TopNav 整体退役 + WorksHeader（品牌/语言/主题/设置承接）

**What**：S3+S4 合入后：新增 `web/src/features/works/WorksHeader.tsx/.module.css`（品牌字 + LocaleToggle + ThemeToggle + 全局设置按钮 + macOS drag region）；App.tsx 永久移除 TopNav；删 TopNav.tsx/.module.css/.test.tsx；Editor 页面复核（保留路由）：无 TopNav 后需有返回入口与可用全局控件（沿用其页头或补最小返回）；NotFound/ErrorBoundary 依赖各自"返回首页"按钮即可；重写 e2e/navigation.spec 为 Works→打开作品→Studio→返回 的真实路径（顺手修调研发现的旧双语标签既有漂移）。

**预设测试**：
- `WorksHeader.test.tsx`：控件齐备、语言/主题/设置写对应 store、darwin 下 drag/no-drag。
- `App.test.tsx` 改写：任何路由均无 TopNav；Works 页有 WorksHeader。
- Editor 冒烟：挂载 Editor 路由断言返回入口存在。

**Acceptance criteria**：
- [ ] 证红转绿 + `test:web` 全绿；grep 无 TopNav 残余引用。

**Blocked by**：S3、S4。
**Code-area hints**：`web/src/pages/Works.tsx:74-78`、`web/src/pages/Editor.tsx`。

---

## S6 · 图标收编第二/三批（ScriptTab/SessionStrip/portal 组件）

**What**：用 S2 的 IconButton 收编：第二批 `ScriptTab.tsx` 五组（reader 入口/全屏/分镜 reader/省略号/Reorder）、`SessionStrip.tsx`+`TerminalSessionStrip.tsx` 删除按钮（保持 18px 视觉外框、内部扩 24px 透明命中层）；第三批 portal/外围 `DiveCanvas.tsx:382`、`AssetPreviewModal.tsx:204`、`ScriptModal.tsx:194`、`SettingsPanel` 关闭、`ThemeToggle`、`WorkCardMenu`。删除各自重复的尺寸/居中声明，保留定位/透明度/业务态 class。Timeline 内按钮（zoom/LaneGapAdd/TrackHeader menu）**不在本片**——归 S7 一并重构。

**预设测试**：各组件既有测试加结构断言（marker + 原 click/aria 行为不变）；SessionStrip 断言命中层尺寸。

**TDD proof（2026-07-11）**：
- redProof：`npm run test:web -- <6 个 S6 targeted 测试文件>` → `Test Files 6 failed (6)`；`Tests 6 failed | 102 passed (108)`。
- greenProof：同一 targeted 命令 → `Test Files 6 passed (6)`；`Tests 108 passed (108)`。
- 附加门禁：`npm run typecheck:web` 退出码 `0`。
- 集成 gate（2026-07-12 wave1 收尾门禁）：全量 `test:web` 226 files / 1693 tests 全绿，`test:server`/`test:cli`/`typecheck:web`/双端 build 同轮全绿。

**Acceptance criteria**：
- [ ] 证红转绿 + `test:web` 全绿；像素中心差验收归 S10 图标纬。

**Blocked by**：S2；ScriptTab 部分若与 S4 的 Chat 改动相邻注意 rebase 顺序（S4 先）。
**Code-area hints**：全清单 `result-icons.json` findings[3][4]。

---

## S7 · 时间线重构 phase 1：token/刻度/playhead/header/clip 五态/波形密度/空轨

**What**：按 `result-timeline.json` proposal 的 spec 执行——
① tokens.css 增 timeline 语义色（暗 `--timeline-video:#a8c5d6/-audio:#a89bb8/-caption:#9caf9f/-overlay:#88adb8`，亮 `#2a3a4a/#655b70/#506157/#3f6068`，soft/border 用 color-mix）；② 新增 `Timeline/timelineMetrics.ts`(行高 56/44/36+gap4+header176+ruler28)、`timelineScale.ts`(computeRulerScale: 候选 [0.1..300] 取首个 major≥72px，5 细分，minor<8px 折叠，m:ss/m:ss.d/h:mm:ss，viewport±1 major 裁剪)、`timelinePresentation.ts`(kind→token 映射+空轨文案)；③ `Ruler.tsx` 主次刻度（major 8px/minor 4px）；④ `Playhead.tsx` 1px 线+12×14 下尖把手+14px 抓取区+scrub 时 mm:ss.ff 玻璃 tooltip（200ms 后消失）；⑤ `TimelineTrackHeader` 176px：JetBrains Mono 10px code badge + Inter 11px 名称 + 内联 mute/visibility(24px hit) + 菜单留低频项；⑥ `Clip.tsx`+新 Clip.module.css：中性 surface 主体 + 2px 类型色轨 + normal/hover/selected/dragging/focus-visible 五态（selected= accent-hi border + 0 0 0 1px accent + glow；dragging opacity .82）；字幕 clip 18px CC mono badge + 11px 单行；⑦ Filmstrip opacity .82/hover .94 + 按 48–96px tile 从 [0.25,0.5,1,2,5]s 选 step；波形 ~3px/bar+1px gap，normal 用 audio-soft、selected 用 audio base；⑧ Track.tsx 空轨 sticky 虚线提示（per-kind 文案，pointer-events:none，drag-over 时让位既有反馈）+ selected-row 2px accent 左轨；⑨ Timeline zoom/LaneGapAdd/TrackHeader 按钮借机收编 IconButton。玻璃只给 sticky header/ruler/tooltip/菜单；clip 不加 backdrop-filter；动画 200ms ease-out、drag/scrub 中关 transition、遵守 prefers-reduced-motion。

**预设测试**：
- 新增 `timelineScale.test.ts`（pps 临界/major≥72/minor≥8/裁剪/格式/duration=0）、`timelinePresentation.test.ts`（行高/gap/暗亮 token/空轨文案）。
- 扩展 Filmstrip/PeaksSvg/WaveformBars（step 映射/trim source offset/密度）、Clip.test.tsx（data-state 五态/kind attr）、Track.test.tsx（空轨 hint/selected-row）、Ruler.test.tsx（主次 tick/scrub tooltip）。

**Acceptance criteria**：
- [ ] 证红转绿 + `test:web` 全绿。
- [ ] 视觉验收归 S10 时间线纬（三档 zoom × 暗亮主题截图 + computed-style 二确）。

**Blocked by**：S1（scrub tooltip 依赖真 seek）、S2（IconButton）。
**Code-area hints**：`web/src/features/studio/panels/Timeline/` 全目录 + `web/src/styles/tokens.css`。**大片，codex 建议按 ①②③④ / ⑤⑥ / ⑦⑧⑨ 三个 task 串行**。

---

## S8 · 时间线 phase 2：zoom 手势 / snap 统一 / trim 可见手柄 / 多选框选

**What**：① 新增 `Timeline/hooks/useTimelineZoom.ts`：5–300px/s、按钮 1.25×、Fit、88px 对数 slider + `NN px/s` mono badge、Ctrl/⌘+wheel 与 pinch 围绕鼠标时间锚定 zoom、普通/Shift wheel 横移、双击 badge 回 Fit；② snap 统一屏幕 6px 阈值（候选 t=0/playhead/全轨 clip 端点/beat），guide 贯穿 lane + ruler 顶 4px diamond+时间 badge；③ trim：10px hit + 2px 可见 rail（hover 40% kind 色/selected accent），拖动画 1px dashed --accent-lo 完整 source ghost，filmstrip/波形保持 source-time 锚定；④ 多选：store 增 `timelineSelection:{ids,primaryId,anchorId}`（旧 selection=primary 兼容层），新增 `selectionMath.ts` + `MarqueeSelection.tsx`：Shift/⌘/Ctrl click 与空白区框选 union/toggle、Esc/空白点击清空、组拖动保持相对 offset、组删除；trim 仅作用 primary；Inspector 继续读 primary。

**预设测试**：
- `useTimelineZoom.test.ts`（clamp/1.25×/Fit/锚点时间不漂移/wheel 横移）、`selectionMath.test.ts`（replace/toggle/union/矩形相交/跨轨/Esc/删后 reconcile/组移动 offset）。
- 扩展 snapPoints/useClipResize（6px 等价性/0.1s 最短/source 上限/ghost bounds）。
- store 兼容：单选路径行为与旧 selection 完全等价（Inspector/Dive/快捷键既有测试不破）。

**Acceptance criteria**：
- [ ] 证红转绿 + `test:web` 全绿；交互验收归 S10。

**Blocked by**：S7。
**Code-area hints**：`store.ts:102,135`（selection 单 string 现状）、`index.tsx:31-96`（zoom 现状）。

---

## S9 · slash 命令方案 B：注册表 + command 帧 + Claude 动态能力 + CommandMenu

**What**：按 `result-slash.json` proposal 方案 B——
server：新增 `src/server/chat-commands/{types,registry,local}.ts`（条目 name/backend/kind(local|translate|passthrough)/args/availability/description + deny 策略）；`chat-backends/types.ts` 增 onCapabilities；`claude.ts` 从 init 帧捕获 slash_commands+skills 并缓存合并；`codex.ts` 未映射命令返回结构化 unsupported（绝不当普通 prompt）；`ws-bridge.ts` 新增 `{action:'command',name,args}` 分流（**不拼 viewer-context/附件/教学前缀**）；本地实现 `/model`→setSessionModel(下轮 spawn 带 --model)、`/new`→建 AutoViral session、`/stop`→killSession、`/compact`→Claude 透传/Codex unavailable；`routes/works.ts` 增 `GET /api/works/:id/chat-commands?sessionId=` + WS capability 推送。
web：新增 `panels/Chat/CommandMenu.tsx/.test.tsx`（首字符 "/" 触发 listbox，↑↓/Tab/Enter/Esc，按 backend/session 过滤，实时跟 capability 更新）；`useChatSocket.ts` 增 sendCommand()（不走 viewer-context builder/附件/optimistic echo）；命令与结果在历史里渲染为独立 command block（不混普通 user 气泡）。空白新 session 的 provider 命令禁用并解释（/compact 需历史）。

**预设测试**（调研 presetTests 全单照抄，摘要）：
- registry 分类/过滤/unknown→unsupported 永不降级 prompt。
- claude.ts init 解析捕获 slash_commands+skills、重复 init 更新、去重。
- `ws-bridge-slash-command.test.ts`（spawn-mock 先例：ws-bridge-resume-prompt 模式）：/compact 的 positional prompt **精确等于** `/compact`；/model haiku 走 session setter 且下轮 spawn 带 --model haiku；busy/断线/错误恢复。
- codex adapter：/compact 等未映射显式拒绝。
- CommandMenu：过滤/键盘/ARIA/句中 "/" 与 URL 不触发/IME composing Enter 不误执行；sendCommand 不含信封。

**Acceptance criteria**：
- [ ] 证红转绿；`test:web`+`test:server` 全绿。
- [ ] 真机验收归 S10 命令纬（/compact 在有历史的 Claude 会话真实生效；Codex 显式 unsupported 提示）。

**Blocked by**：S4（coach/sendOverride 先删干净）。
**Code-area hints**：`src/ws-bridge.ts:1125-1233`（spawn 生命周期）、`src/server/chat-backends/claude.ts:45-52`（init 现状只取 sessionId）。**大片，codex 建议 server / web 两个 task 串行**。

---

## S10 · 多纬度 E2E 验收 + CHANGELOG + bump v0.1.11

**What**：① 改动含 src/server/src/shared → 先 `build:backend` + 重启 daemon，前端 `build:frontend`（3271 服务预构建产物，验 bundle 新鲜度）；② 设计 Workflow 派 ≥7 个纬度 subagent（布局/图标/seek/时间线视觉/命令/瘦身/CLI-UI 一致性，纬度定义见 parent PRD Testing Decisions）+ completeness-critic，浏览器纬度用 Claude subagent，每纬截图 + DOM/computed-style 二确；③ 修复回归直至全纬 pass；④ CHANGELOG `## [0.1.11]`（含 Removed/Breaking 措辞）+ version bump + 全套件门禁（web/server/cli/typecheck/双端 build）。

**Acceptance criteria**：
- [ ] E2E 全纬 pass 且证据（截图路径 + DOM 数据）落 e2e-report。
- [ ] `pgrep -f vitest | wc -l` ≤3；CHANGELOG/version 就绪（发布 tag 由用户拍板后再推）。

**Blocked by**：S1–S9。
