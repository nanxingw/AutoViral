# PRD-0013 · Studio 工作台聚焦：布局固定、时间线精修、slash 命令与产品瘦身

**Status: Proposed (2026-07-10) · triage: `ready-for-agent` · 目标版本：v0.1.11**

> Source: 用户反馈（2026-07-10 深夜，附 4 张截图）——① Studio 作品页顶部"刘海"全局导航导致创作页面可上下滚动、不固定；② 剧本阅读模式等多处按钮图标不居中；③ 时间线（轨道面板）设计粗糙，要求持平或超越同类工具（可参考开源项目）；④ 拖时间线 playhead 不驱动视频预览（反向正常）；⑤ 调研如何在 UI 里原生支持 claude code / codex 的 "/" 命令；⑥ 灵感、数据两页鸡肋，连同定时任务一并去掉，简化产品聚焦内容生产。
> 调研：六纬度 codex (GPT-5.6, xhigh) 独立调研 + Claude 主线 review（workflow `wf_873b9dae-193`，全部结论带 file:line 证据并经主线抽查核实）。调研原始 JSON 归档在 [docs/prd/0013-recon/](0013-recon/)。
> Issue 切片：随 `to-issues` 落 [docs/prd/0013-studio-focus-and-slimdown-issue-slices.md](0013-studio-focus-and-slimdown-issue-slices.md)（docs-only tracker，绝不开 GitHub Issue）。
> **执行约定（用户 2026-07-10 立规）**：所有切片的具体实现由 codex (GPT-5.6) 执行，Claude 主线编排 + 与 codex 同步 review；测试先行纪律不变。

---

## Problem Statement

用户是全职创作者，每天在 Studio 里完成"生成素材 → 剪辑 → 导出"的内容生产闭环。当前工作台有六个互相独立但都直接伤害核心体验的问题：

1. **创作页面不固定**。App 在所有路由前无条件挂载 sticky TopNav（约 62px），Studio 自身又是 `height:100vh`，两者叠加使文档高度 ≈ 100vh+62px，纵向滚动落在 window 上（`web/src/App.tsx:14-16`、`web/src/pages/Studio.tsx:274`、`web/src/styles/globals.css:17` 只锁了 overflow-x）。滚动后两条 header 叠一起，专业剪辑工具的"工作台感"荡然无存。
2. **图标按钮系统性不居中**。`globals.css:75` 的 pill 规则以 (0,3,1) specificity 向 `.studio-shell` 内所有按钮泄漏 `padding:5px 11px`，`data-bare` 标记并未真正退出该规则——固定尺寸 icon 按钮的图标被推离中心 3–6px。仓库已有三处源码注释各自打补丁承认此病（`LibraryTab.tsx:176-180`、`PreviewPanel.tsx:597-600`、`TopBar.tsx:369-371`），但 reader 关闭按钮、TopBar "?"、Tweaks 关闭、Timeline 缩放、ScriptTab 五组按钮、会话删除等 47 个 icon-only 候选中的大多数仍未收编。
3. **时间线设计低于同类工具及格线**。对标 pneuma-skills（官方包 3.13.3）与 DesignCombo 官方源码：ruler 刻度只按总时长取步长不随 zoom 自适应（`Ruler.tsx:29-31`，截图里 106s 的片子只有 0:00/0:10 两个标签）；音频紫 `#c084fc`/叠加青 `#7dd3fc` 高饱和整块填充与 editorial·cool 调性冲突（`Clip.tsx:187-201`）；clip 无 hover 态；trim 手柄不可见；空轨道纯空白；选择模型只支持单 clip；zoom 仅 0.4–3.0 按钮无 wheel/pinch。数据基础（filmstrip 缓存、真实波形、snap guide）其实已接近对标——差的是视觉收口与高阶交互，不是从零建设。
4. **playhead 拖动是"假 seek"**。全仓所有 seek 意图（Playhead 拖动、Ruler 点击、J/L 快捷键、terminal ui-seek、Chat locator）都止步于 `setFrame` 写 Zustand（`store.ts:922-931`），而唯一的 `playerRef.seekTo()` 只被 PreviewPanel 自己的运输控件调用（`PreviewPanel.tsx:169-176`）——store→Player 方向根本没有桥。反向（Player→store）有 frameupdate 桥所以正常。d5ba0aa（#77）把"seek"定义成写 store，测试也只锁 currentFrame，全绿但画面从未动过。
5. **slash 命令全军覆没**。聊天走"每轮新建 CLI 进程"协议（Claude：`-p <prompt> --output-format stream-json`，`claude.ts:113-135`；Codex：`codex exec --json`），前端把 `<viewer-context>` 信封拼在用户文本之前（`useChatSocket.ts:255-275`），命令永远不在消息开头，无从识别。实验证实 Claude headless 原生支持 `/compact` 等命令且 `system/init.slash_commands` 可机器枚举；Codex exec 无官方 slash 保证。
6. **灵感/数据两页 + 两套定时任务是无人使用的复杂度**。Explore/Analytics 连带 coach 域侵入通用 Chat（`useChatSocket.ts:86-94` 的 sendOverride）、research-scheduler 与 analytics-collector 两套 cron（`src/server/index.ts:186-190`）、`autoviral trends` CLI（其 Source 契约已失配，实际全部 skip，`src/context/trends.ts:63-68`）、Settings 两大节、14+ 组双语词条与 Works 首页静态占位 InsightRibbon。

## Solution

**A · 工作台固定**：Studio 路由不渲染 TopNav；Studio shell 锁 `100vh`+`100dvh` fallback + `overflow:hidden`，滚动全部交给既有内部面板（已具备 min-height:0/overflow 链）。全局控件迁移：SettingsPanel 宿主 + Cmd/Ctrl+, 快捷键抽成常驻 GlobalSettingsHost；语言/主题/全局设置入口进 Studio 既有 TweaksPanel。macOS Electron 拖拽区从 TopNav 迁给 Studio TopBar。待 D 完成后 TopNav 整体退役，Works 页头承接品牌与全局控件。
**B · 图标居中一次性根治**：新建 `ui/IconButton`（padding:0 + inline-grid + place-items:center + line-height:0 + SVG display:block），globals.css pill 规则降为 `:where()` 低 specificity 并真正排除 `[data-bare]`；按 reader→Studio 高频区→portal/外围三批收编，Timeline 内的按钮并入时间线重构片。
**C · 时间线拉齐对标**：新增 timeline 语义色 token（低饱和四类型色，选中态回归 --accent 体系）；ruler 主次刻度随 px/s 自适应（DesignCombo 模型）；clip 中性 surface 主体 + 类型色细轨 + 五态；行高 56/44/36 分级；playhead 1px 线 + 下尖把手 + scrub 时间 tooltip；zoom 5–300px/s + wheel/pinch + Fit；可见 trim 手柄 + source ghost；空轨虚线引导；多选（modifier + 跨轨框选 + 组移动，trim 仍只作用 primary）。
**D · 产品瘦身**：删除 Explore/Analytics 页面、features、queries、lib 族；删除 trends/analytics/coach 三组路由、两套 cron、`autoviral trends` CLI、coach 对 Chat 的侵入；config 旧字段运行时显式剥离（config 无 Zod strict，旧 YAML 不会炸但会经 /api/config 回显——必须在归一化入口过滤）；保留 topicHint 通用链路、per-work research 目录与 cost-ledger（它们直接服务内容生产）。旧路由精确 redirect 到 `/`；遗留磁盘数据（~/.autoviral/trends 等）不自动删除。
**E · seek 桥修复**：store 拆 `requestSeekFrame`（用户 seek 意图，带 seq 防去重）与 `reportPlayerFrame`（Player 上报）双向语义；PreviewPanel 订阅 pendingSeek 执行 imperative `seekTo`；全部 seek 意图调用点（Playhead/Ruler/快捷键/terminal/Chat locator/Scrubber）统一迁到 requestSeekFrame。绝不写 naive `useEffect(seekTo, [frame])`（播放中每帧 frameupdate 会被反射成 seek 造成抖动）。
**F · slash 命令（方案 B）**：bridge 侧命令注册表（`local | translate | passthrough` 三类）+ WS 新增 `{action:'command'}` 帧（绝不拼 viewer-context）；Claude backend 从 init 帧捕获 `slash_commands`/`skills` 作为动态能力集，安全策略过滤后透传；Codex 未映射命令显式 unsupported（exec 无官方保证，绝不把 slash 当普通 prompt 烧 turn）；`/model`→setSessionModel、`/new`→建会话、`/stop`→killSession 本地实现；UI composer 输入 `/` 弹 autocomplete CommandMenu。Codex App Server 迁移单列后续 PRD。

用户视角的最终状态：打开作品即全屏固定工作台，无刘海、页面不滚；所有小按钮图标严格居中；时间线的刻度、配色、clip 态、缩放、多选达到或超过 OpenCut/pneuma 同档；拖 playhead 画面实时跟随；聊天框输入 `/` 出命令菜单，`/compact` 等真实生效；顶部导航只剩"作品"心智，灵感/数据/定时任务彻底消失。

## User Stories

1. As a 创作者, I want 打开作品后整个创作界面固定占满视口, so that 我不会在剪辑中途把页面滚出两条叠加的 header。
2. As a 创作者, I want 界面上所有图标按钮的图标严格居中, so that 工具在细节上不掉专业感。
3. As a 创作者, I want 拖动时间线 playhead 时预览画面实时跟随, so that 我能靠 scrub 找帧。
4. As a 创作者, I want 时间线的刻度随缩放加密、clip 有清晰的类型/选中/悬停状态、trim 手柄可见, so that 复杂工程也能精准操作。
5. As a 创作者, I want 框选/多选 clip 并整组移动删除, so that 整理时间线不用一个个拖。
6. As a 创作者, I want 空轨道有"拖入素材"的引导, so that 我知道那条轨道能放什么。
7. As a 创作者, I want 在聊天框输入 "/" 看到当前 agent 支持的命令并直接执行, so that claude code / codex 的能力不被 UI 阉割。
8. As a 创作者, I want 灵感、数据两页和定时抓取彻底消失, so that 产品只剩内容生产的最短路径。
9. As a 老用户, I want 旧书签 /explore /analytics 自动回到首页、旧 config 不报错, so that 升级 0.1.11 无感。
10. As a 工位 agent, I want seek/命令等能力有结构化协议, so that CLI 驱动与人工 UI 操作产出一致。

## Implementation Decisions

- **TopNav 分两步退役**：先 Studio 路由条件隐藏（最小可交付、可独立验收），删页完成后整体退役 + WorksHeader 承接。**Editor（image-text）路由保留**——它是内容生产工具，不在瘦身范围；整体退役片需给 Editor 页同样的无 TopNav 处理。
- **视口锁定只锁 Studio shell 不锁全站 body**：Works/Editor 仍需文档滚动。`100vh` 先声明、`100dvh` 后声明做渐进增强。
- **IconButton 是新组件而非改造 ui/Button**：Button 是文字按钮（padding:7px 14px）；icon-only 的结构约束（line-height:0、强制 aria-label）值得独立组件。全局规则绝不写 `button svg` 通配——reader TOC 数字按钮、图标+文字按钮是明确反例。
- **timeline 语义色进 tokens.css**：暗 `--timeline-video:#a8c5d6 / -audio:#a89bb8 / -caption:#9caf9f / -overlay:#88adb8`，亮色对应 `#2a3a4a/#655b70/#506157/#3f6068`；soft/border 用 color-mix。选中态永远走 --accent 体系。clip 主体不加 backdrop-filter（滚动合成成本），玻璃只给 sticky header/ruler/tooltip/菜单。
- **多选新增 `timelineSelection:{ids,primaryId,anchorId}` 并保留旧 `selection` 作为 primary 兼容层**——selection 被 Inspector/Dive/Chat/快捷键大量当单 string 消费，直接改数组是破坏面失控。v0.1.11 组操作范围 = 移动 + 删除；**不做组 resize、不做 track lock**（lock 需动 shared schema，超前端范围）。
- **seek 桥用 pendingSeek{frame,seq} 而非直接 effect 依赖 currentFrame**：防播放中 frameupdate 回流成 seek；composition 切换时清空 pendingSeek；高频 pointermove 按 rAF 合并 latest-wins，pointerup 最终帧无条件提交。
- **slash 命令以 provider init 动态集合为真值**，不硬编码命令表；展示前过安全 deny 策略（/logout、/heapdump 等破坏性命令不进菜单）；不为 autocomplete 主动 spawn 探测进程（SessionStart hooks 有副作用，调研中已实证）。命令消息在 chat 历史记录为独立 command block，不污染模型上下文语义。
- **瘦身是彻底删除而非隐藏 UI**：路由、API、cron、CLI、Settings、i18n、MSW fixture、docs 全链路；node-cron/@types/node-cron/fast-xml-parser 依赖一并移除。**保留**：topicHint 全链路（Works 新建卡/work-store/session prompt 独立消费）、cost-ledger（Studio 成本徽章的数据源）、桌面 Remotion Chromium（与趋势抓取的 Playwright cache 是两条链路，勿误删）。
- **config 兼容**：loadConfig() 显式解构丢弃 research/analytics/interests 三个退休键后再并默认值；不在启动时重写磁盘；PUT 旧 flat 字段静默忽略返 200；redactedConfigResponse 确保退休字段不回显。
- **ADR**：新增"聚焦内容生产、退役 discovery/analytics 域"ADR，将 ADR-010（coach persona）/ADR-011（douyin collector）标 Superseded。

## Testing Decisions

- **每片预设测试先落盘证红**（.claude/rules/test-first.md），测外部行为：seek 桥测"拖动 handler 最终触发 seekTo(帧)"不测内部 Map；瘦身测"路由 404/redirect + 旧 config 可加载"不测删了几个文件。
- **playhead 桥的红测锚点**：PreviewPanel.test.tsx 的 Player mock 把 seekTo 换成 vi.fn，同 render 挂 PreviewPanel+Playhead，拖动后断言 seekTo(90)——当前代码 store=90 但 seekTo 调用 0 次，天然红。
- **图标居中双层验收**：vitest 断结构（data-icon-button marker、SVG 子节点、反向断言 TOC/edit 不被收编）；像素级中心差 ≤1px 归 E2E 纬（DOM getBoundingClientRect 中心比对，暗/亮主题 × 100%/125% 缩放）。
- **timeline 纯函数先行**：timelineScale（主次刻度/格式/viewport 裁剪）、useTimelineZoom（clamp/锚点不漂移）、selectionMath（union/toggle/矩形相交/组移动 offset）都是可隔离红测的纯核。
- **slash 契约测试**：spawn-mock 断言 `/compact` 的 positional prompt 精确等于 `/compact`（无 viewer-context/附件信封/教学前缀）——这是方案 B 的核心不变量；Codex 未映射命令必须返回 unsupported 而非降级成普通 prompt。
- **瘦身门禁**：旧 config fixture 加载成功 + /api/config 不回显退休字段 + removed-route 矩阵 404 + 保留路由回归（cost/works/studio）+ `test:web`/`test:server`/`test:cli`/typecheck/双端 build 全绿。
- **E2E 验收纬度预写**（实施后按 e2e-testing.md 派 Workflow，主 agent 不亲跑；浏览器纬度用 Claude subagent——codex wrapper 无浏览器 MCP）：① 布局纬——1440×900 与 1024×680 无全局导航、window 不可滚、内部面板可滚；② 图标纬——高频按钮中心差 computed-style 二确；③ seek 纬——拖 playhead/点 ruler/快捷键三路径画面跟随；④ 时间线视觉纬——三档 zoom 下刻度/密度/五态/暗亮主题；⑤ 命令纬——"/" 菜单、/compact 真实生效、Codex unsupported 提示；⑥ 瘦身纬——直链 redirect、TopNav 消失、Settings 无退休节、Works/Editor 正常；⑦ 最后一公里纬——CLI 驱动 seek/命令与 UI 产出一致。

## Slices

见 [0013-studio-focus-and-slimdown-issue-slices.md](0013-studio-focus-and-slimdown-issue-slices.md)。关键路径：S1(seek 桥) 与 S2(IconButton) 与 S4(瘦身) 可并行起步；S3(Studio 布局) 排 S2 后；S5(TopNav 退役) 依赖 S3+S4；S7/S8(时间线) 依赖 S1+S2；S9(slash) 依赖 S4；S10(E2E+发布) 收尾。

## 需用户拍板的决策点（已按默认值推进，可随时推翻）

1. Editor（image-text）页**保留**（默认）——若也要退役请说，影响 S5 的 WorksHeader 范围。
2. 时间线多选范围 = 框选+组移动+组删除，**不含组 resize**（默认，OpenCut 有组 resize 但破坏面大）。
3. slash 命令 v0.1.11 核心集 = `/compact` `/model` `/new` `/stop` + Claude 自定义 skills 动态列表（默认）；Codex 侧显式 unsupported，App Server 原生化单列后续 PRD。
4. `~/.autoviral/trends`、`collector-venv`、`coach_main` 等遗留磁盘数据**不自动删除**，release note 给手工清理说明（默认）。
