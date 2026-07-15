# Changelog

All notable changes to this project will be documented in this file.

> 本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本（SemVer）](https://semver.org/lang/zh-CN/)。
> 发布说明取自 `## [版本] - 日期` 小节（发布流程通过 awk 抽取该段落）。

## [Unreleased]

## [0.2.1] - 2026-07-15

**Agent 后台任务生命周期 + 预览硬切保真**（PRD-0015 S1-S7 + PRD-0016 S1-S4，GitHub #96/#97/#98 三 issue 当日根因当日修）—— 两条主线：① Studio chat 里 agent 启动的后台 Workflow **活过 turn 边界、全程看得见、被杀有交代**（030 事故的结构性修复：九次受控实验钉死 claude CLI print-mode 行为真值表，帧归一化 → registry → `ui-workflow` 信封 → 任务卡片全链路焊通）；② 预览硬切边界**不卡不回放**（#98：remotion 源码级取证 + 浏览器插桩红基线 → premount 暖场，切点级症状归零）。全程测试先行（server 2047→2115、web 1920→1937，只增不减），六轮 codex 对抗审查闭环，联合多纬浏览器 E2E 收口。

### Added

- **后台任务生命周期链路（PRD-0015）** — ChatBackend seam 归一化 claude stream-json 任务帧（`task_started/updated/notification/background_tasks_changed`，真实抓取 fixture 锁形状，tool_use id 关联保留）；`BackgroundTaskRegistry` 深模块（同 id upsert、终态单调状态机、进程代际隔离、settleOnExit 合成终态带 reason、死代际不重开）；新 `ui-workflow` / `ui-workflow-snapshot` 信封（身份 = workId+sessionId+generation+taskId，snapshot-then-push 保序，契约入 `event-stream.md`）；Studio chat 任务卡片面板（durable 卡片 + 状态 chip + usage 摘要，仅终态首达 toast，刷新/重连经 snapshot 恢复，`session_killed`/`cli_exited` 联动兜底）。
- **KillGate drain 纪律** — 全部 11 处进程回收路径收敛单一 `requestKill(session, cause)` chokepoint + cause 策略表：活任务时新消息**排队不杀**（`chat_notice` 提示 + result 后自动 flush，绕过去重、多 result 帧防重复 flush）、模型/后端切换返回 409 提示（含 named session）、断连 grace / idle-TTL 跳过回收、显式 /stop / 删 work（枚举全部 session）/ abort / test-runner 超时走杀 + settle + 终态广播绝不静默；daemon 退出 `shutdownAll` 立即收尾并如实广播；源码 grep-gate 挡未来新增裸 kill。
- **spawn ceiling 配置（ADR-015）** — chat spawn env 注入 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`（默认 0 = workflow 无限等待，`config.chat.bgWaitCeilingMs` 可覆盖，非法值校验拒入 env）；九次受控实验真值表入库（workflow 型 result-hold/600s 默认/env 有效性；bash 型 result 后 ~5s 上游必杀、env 无效）＋脱敏 fixture ＋ `scripts/probes/recapture-ceiling.sh` 重采脚本。
- **Journal 打捞 orphaned** — 宿主进程死后从 workflow journal 收割已完成 agent 计数（按 journal key 去重防 resume 虚高）+ result 摘要，registry 标 `orphaned`（仅 harvest 内部路径可产生）随卡片可见（"已完成 N/M · 可打捞"）；run 窗口唯一归属，损坏 journal 优雅降级。
- **预览硬切保真（PRD-0016）** — 视频 clip Sequence `premountFor`（≈1s 暖场窗，premount 态预 `.load()` 不触发全局 buffering；仅预览生效，导出渲染树零变化）；AudioTrackRenderer 预览分支补 `pauseWhenBuffering`；`acceptableTimeShiftInSeconds: 1.2` 两档实测复审 KEEP（数据入注释）。
- **边界保真回归夹具** — `scripts/probes/boundary-probe.js`（MutationObserver + 媒体事件 + 100ms poll + rAF 心跳门控 + 三断言汇总），可重复浏览器插桩回归；Studio 媒体元素全盘点落 `docs/research/2026-07-15-studio-media-element-inventory.md`。

### Fixed

- **#96 · Studio chat 后台 Workflow 随进程退出被杀** — 根因：claude CLI print-mode 600s 后台任务等待上限（上游行为，AutoViral 源码零出现；运行时日志两次事故同签名 + 二进制字符串双验证）到点在子进程内强杀任务。修复 = ceiling 默认 0（无限等）+ KillGate 防 AutoViral 侧 11 处 kill 点接棒 + 消息队列防 sendMessage SIGTERM 残活进程。
- **#97 · 前端对 subagent 零可见性** — 根因修正：链路每层都在、最后一公里被静默丢弃（seam 不归一化 → 无 registry → 无信封 → web 显式 ignore `cli_event`）。修复 = 上述任务生命周期链路全量焊通。
- **#98 · 硬切边界预览卡顿/回放 ~0.x 秒** — 根因：切点冷挂载（无 premount）→ 全局 buffering block（stall）+ 0.15s 激进纠偏向后 seek 超前媒体（回放），1.2s 自由漂移窗供弹药。修复后切点级归零：切点音频回放清零、video ct 负跳双档双态均 0、waiting 40→2-4（↓90%+）、帧钟全程单调、mount→canplay p50 14→9ms；24-asset 压力两态复测无解码预算回归。
- **markOrphaned TS2367 收窄误报** — transition 返回 boolean，调用方用返回值而非重读被收窄的 status。

### Known Issues

- **非切点 BGM/VO 音频 ~600ms 漂移纠偏回放**（docs/issues/033）— 长音轨渐进跑赢帧钟后被拽回，与切点无关、与 premount/视频阈值无关（音频元素自带独立同步循环），幅度恒定 ~600ms、4-8 次/12 跨界；需独立实验轮定音频侧阈值（有 choppy tradeoff）。
- **workflow 型任务的 result-hold 语义** — ceiling=0 下启动后台 workflow 的那一轮 chat，回复文本即时流出但 `turn_complete`（idle/cost 记账）延迟到 workflow 收尾（上游 print-mode 语义）；期间 UI 由任务卡片承担状态可见性，新消息自动排队。
- **bash 型后台任务上游必杀** — claude CLI 对 `run_in_background` Bash 任务在最终 result 后 ~5s 一律收割且 env 不可救（九实验实证）；chat 内长后台工作必须用 Workflow 工具（后续在 skills/autoviral recipe 层补教学）。
- **终止 UX 三残留**（docs/issues/034）— `/stop` 对"spawn turn 已结束但任务仍跑"的边缘态是 no-op（正常路径 turn 与任务同寿命；删 work 为兜底入口）；stopped 终态 toast 待 MutationObserver 级探针复核（completed toast 已证实、同机制）；排队提示（服务端中文）与终态 toast（前端 locale）语言混用。
- **codex 后端无任务卡片** — codex chat 无 Workflow 工具、seam 空实现（by design，PRD-0015 Out of Scope）；任务生命周期可见性本期仅 claude 后端。

## [0.2.0] - 2026-07-15

**WYSIWYG 焊死与剪辑能力对标**（PRD-0014，19 片）—— 一条主线：让 agent 亲手剪出一条完整短视频，且**预览认可的节奏就是成片的节奏**。两侧收敛同一份 composition：转场 / 变速 / mask / blend / effects 全部走 Remotion 同源组件（预览=导出 by construction），CLI 与 UI 每个新编辑动词都经共享 op 三端接线（sweep gate 常驻防止再造 store-only 动词）。全程测试先行（预设测试证红→转绿），每片经 codex 独立审查，S16 落地机器化的「预览=导出」逐像素回归 gate（8 fixture + 专用 CI job），S18 经三轮 Workflow 多纬度浏览器 E2E（截图 + DOM/computed-style 二确 + completeness-critic）终验：抓出并当日修复变速导出不可交付（served-URL 误判致 Remotion 解码 HTML）、四 cinematic 转场端点 500、captions 默认路径 500、硬件编码器 -12900 等真回归，末轮三证（成品 ffprobe + 抽帧非 HTML + 浏览器可见）齐全销账。

### Added

- **stylize / motion 转场进 Remotion 注册表**（WYSIWYG by construction）— `TRANSITION_PRESET_META` 新增 `glitch`、`light-leak`、`whip-pan-left`、`whip-pan-right`、`zoom-in`、`zoom-out` 六个 preset，各对应一个 Remotion presentation 组件（CSS filter/transform/keyframe 插值），预览与导出走同一组件、肉眼一致。
- **入场转场 `VideoClip.transitionIn`** — clip 头部套 presentation 组件（preset + durationSec + easing，refine 校验时长不超 clip），支撑逐拍快切的表达根基；CLI `clip set --transition-in glitch:0.4`（`none` 清除）、Inspector 入场转场选择器。
- **变速导出真实生效** — 多值 speed keyframe 按曲线切段、段内恒速 `setpts=PTS/k` + `atempo=k`（超 [0.5,2] 时 comma-chain）concat 拼接，产物进 pre-pass 缓存（cache key 覆盖曲线内容）；AudioClip 静态 speed 经 `atempo` 生效。同一 composition 预览播放时长与导出成片时长一致（±1 帧）。
- **原声拆轨 `sourceAudio` + `detachAudio`** — schema 新增 `VideoClip.sourceAudio`（缺省 enabled，向后兼容）；`detachAudio` 原子生成同源 AudioClip（src/in/out/offset 对齐）并关掉源声开关，预览/导出两侧源声互斥不双份出声；CLI `clip detach-audio`、Inspector 原声开关 + 音量 + Detach 按钮。
- **`clip import` 成片回填时间线** — 新增共享 op（ffprobe → 构造 VideoClip + Asset 登记 + `op:"import"` provenance 边）+ bridge 端点 + CLI `clip import <path> [--track] [--replace-timeline] [--at]`；素材库 video「添加到时间线」收敛到同一服务端 importClip（probe 是唯一真实时长来源），不再落固定 5s 占位。
- **共享 ops 下沉两批** — `rippleDeleteClip` / `collapseGapsOnTrack` / `duplicateClip` / `setTrackProps` / `removeKeyframe` / `moveKeyframe` / `updateTransition` / 多目标 `select` 协议 / `reframe` 语义糖（组合 crop + scale/x/y keyframe，不引新 schema）全部提升为共享 op 三端接线，store 降为薄包装；CLI 补 `clip remove --ripple`、`track collapse`、`clip duplicate`、`track set --label/--language/--volume/--muted`、`clip keyframe remove/move`、`transition set`、`clip reframe`。新增 **opsSweepGate 棘轮**：枚举 store 全部编辑类 action 断言各有共享 op 对应，常驻防止再造 store-only 动词。
- **cubic-bezier easing** — `KeyframeEasingSchema` 从 4 离散枚举扩为 `枚举 ∪ {type:"cubic-bezier", p:[x1,y1,x2,y2]}`（x 域校验），插值统一走 Remotion `Easing.bezier`；CLI `--easing "cubic-bezier(0.4,0,0.2,1)"`、Inspector 自定义 bezier 四数字输入。
- **`snapToFrame` 帧量化 + 同轨 overlap 校验** — 共享 ops 层所有写 offset/in/out/durationSec 的 op 统一过 `snapToFrame(sec, fps)`；`refineTrack` 增同轨半开区间重叠检测（video/audio error 带双 clip id + 区间，overlay 轨放行 PiP）。CLI/bridge 全路径落点帧对齐。
- **mask（rect/ellipse + feather + letterbox preset）** — schema 新增 `VideoClip.mask`；Remotion 侧 CSS `mask-image`（内嵌 data-URI SVG path + `feGaussianBlur` 软边，预览=导出同一组件）；letterbox 做成 preset（`clip mask --preset letterbox-2.35` 展开为居中 rect band）；CLI `clip mask --shape ellipse --feather 0.2 [--inverted]` / `--none`、Inspector mask 节。
- **blendMode 五枚举 + 有序 effects 栈 + adjustment 轨** — `VideoClip/OverlayClip.blendMode`（normal/screen/multiply/overlay/add，CSS `mix-blend-mode`）；扁平 `filters` 升级为有序 `effects: [{id,type,params,enabled}]` 栈（读时旧 filters **无损自动投影**为一个 grade entry 并回写新格式，内置 grade/blur/vignette/grain），共享 op `add/remove/reorder/toggle/updateEffectParams`；新增 `kind:"adjustment"` 轨（时间窗内包裹下层轨输出）。CLI `clip effects add/remove/reorder/toggle/set`、`clip set --blend`、`track add --kind adjustment`。
- **字幕闭环** — `captions generate --script <file> [--max-cjk-chars 14]`：ASR 词级 timing 与台词真值粗对齐（LCS 级）→ 替换文本 → CJK 按上限分行 → 产出 CaptionModel；CLI `export`/`render` 补 `--caption-tracks zh[,en]` 透传渲染队列。
- **生成韧性** — 生成路由接入 request abort（客户端断连/显式 abort → 取消上游 provider job，不能取消的停止入账后续轮询并标 orphaned 记入 cost-ledger）；work 目录 `generation-manifest.json` 内容寻址幂等（done 跳过、in-flight 拒绝重复下单、failed 允许重试）；孤儿锁 fail-closed，重复下单返 409。
- **render 队列全生命周期 CLI + 单帧快照** — `render enqueue` / `status <jobId>`（含 progress）/ `cancel` / `history` / `snapshot --frame N [--out png]`（走 `remotion-still` 单帧，agent 的廉价 ground-truth 自检点）；既有 `export` 同步语义保留。
- **预览=导出一致性 gate** — 测试基建：A 路 Remotion 直出单帧 PNG（预览）、B 路导出管线（含 pre-pass）抽同帧 PNG，逐像素比对（容差能抓住「变速回退 1×」级差异）；fixture 覆盖 transitionIn/多值 speed/mask/blend/effects/adjustment/freeze/reverse，作为 `test:server` integration 族并入专用 `RUN_CONSISTENCY_GATE=1` CI job。
- **skills/autoviral 六条 operator recipes + 手册补全** — decouple-narration / beat-cutting / burn-subtitles-asr-aligned / generate-cover 等操作机制片，生成韧性 gotcha、成本旋钮（720p vs 1080p）、managed ffmpeg gotcha、render 队列 / 快照端点文档；`autoviral docs` 输出源同步，每条 recipe 引用的 CLI 动词经 grep 断言真实存在。

### Fixed

- **四个 cinematic 转场 REST 端点渲染 500**（issue #93 根因）— `src/server/render/transitions.ts` 三种坏法一次修净：glitch-cut / domain-warp 的 `geq` 内小写 `t` 改大写 `T`、非法 `alpha(X,Y)` 改 `a(x,y)`/`ld,st`、grav-lens 塞进 `lenscorrection` 静态 option 的时间表达式改逐帧参数化；`POST /api/transitions/{glitch,light-leak,domain-warp,grav-lens}` 对含音轨 clip 4/4 → 200 出正常成片。附修无音轨 clip 打这四端点仍 500（`applyFn` 无条件 `acrossfade` 但端点只探视频流）→ 按有无音频流条件构建音轨链。
- **freeze 预览黑帧** — 消费侧真裂缝，改用 Remotion `<Freeze>` HOLD 帧，预览定格与导出一致。
- **变速 / 变换导出不可交付**（S18 E2E 抓获，两段根因）— ① Stage 0 speed 预处理在 `rewriteClipSrcsToAbsolute` 之前运行，daemon cwd≠workDir 时 ffprobe ENOENT（预处理入口先 join workDir 再 probe/pass）；② `rewriteSpeedBaked` 写 FS 绝对路径被 `resolveOne` 误当页绝对 URL → SPA catch-all 返 HTML → Remotion「Invalid data」（`resolveOne` 的 `/` 分支排除真实 FS 绝对路径，同型 crop/flip/timewarp 预处理产物统一受益）。R3 三证（成品 ffprobe 72f/3.000s ≈ comp 71.51f + 抽帧源时码 2.208s@输出 1.667s 证收缩 + 浏览器成品区可见）销账。
- **硬件编码器 videotoolbox `-12900`** — `h264_videotoolbox` 设 bitrate 失败时自动降级软件 `libx264`，导出 deliverable 不再被特定 resolution/bitrate 阻断。
- **ASR captions 默认路径 500** — `captions generate --script` 不带 `--language` 时 whisper "Detected language" banner 污染 `JSON.parse(stdout)`；`parseAsrStdout` 自底向上扫首个可解析 JSON + python `redirect_stdout(sys.stderr)`，canonical recipe 默认路径不再崩。
- **`clip move --offset` 静默丢弃** — 同轨 `--offset` 分支曾静默 no-op（trackOffset 不变），修复 `moveClipToTrack` 同轨 offset 分支。
- **`comp set --duration auto` 变速感知** — auto 时长曾忽略变速收缩（effectiveClipDuration 2.7 却回 4s），现按 effective 时长收缩（复验 4→2.98s）。
- **adjustment kind 类型穿透** — adjustment 轨 kind 补齐 web 类型 / UI 映射（tsc 16 处）。

### Deprecated

- **四个 `/api/transitions/{glitch,light-leak,domain-warp,grav-lens}` REST 烘焙端点** — 被 S2 的 Remotion 注册表路径（预览=导出同源）替代，标 [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745) `Deprecation` + `Link` successor-version 响应头，**计划 v0.3 移除**（暂不删，manual 注明）。

### Known Issues

- **UI 鼠标拖拽 clip 移动 / trim 落点写 off-grid offset**（S15 residual，已登记）— 真实鼠标拖拽仍直写时间字段绕过 `snapToFrame`（E2E 复现 offset×fps 非整数），完整 rewire 需新共享 move/resize op + keyframe rebasing，归 SINK_PENDING 棘轮欠账；CLI/bridge/op 全路径及 ripple/collapse 派生 offset 均已帧对齐，导出可能因此微抖。
- **生成韧性（断连取消 / manifest 幂等）无 runtime E2E** — 真实付费 provider 弃单会烧用户额度，编排层有意跳过（intentional skip），已由 S10 单测 + 代码级覆盖。
- **blend screen/multiply 导出侧像素级混合未抽帧验证** — 预览侧已 DOM 二确落点元素 + inline/computed `mix-blend-mode`（screen/multiply 皆落 overlay `<img>`），导出侧同码路但未抽帧比对。
- **Studio 无内置 overlap lint 面板** — agent 写入重叠 clip 时结构化错误仅在 API 层（preflight/lint 端点），人-UI 侧仅把重叠 clip 真实渲染出来、无警示可见性。

## [0.1.11] - 2026-07-12

### Added

- **Chat slash 命令菜单** — 输入 `/` 即可按当前会话与后端浏览并用键盘执行命令；支持新建会话、停止生成、切换模型，以及在 Claude 会话中压缩上下文，不支持的 Codex 命令会明确说明而不会误发成普通消息。
- **时间线精细交互** — 新增按钮缩放与 Fit 适配，滚轮和捏合缩放会以鼠标所指时间为锚点；同时加入统一吸附引导、可见裁剪手柄与源素材幽灵边界，并支持跨轨框选、多选、成组移动和删除。

### Changed

- **预览 seek 全链路接通** — 拖动 playhead、点击标尺、预览 scrub、J/L 快捷键及 Chat / Terminal 跳转现在都会立即驱动预览画面，并避免播放帧回报反向触发重复 seek。
- **图标按钮统一且可访问** — Studio 阅读器、顶栏、侧栏、会话条、弹窗、设置与作品卡等图标控件统一为稳定居中的点击区域，补齐可访问名称、键盘焦点与一致的尺寸和状态反馈。
- **Studio 固定工作台布局** — 创作页锁定在视口内并将滚动交给各内部面板；旧全局导航栏已退役，作品页新增独立页头承接品牌、语言、主题和全局设置，macOS 桌面端仍可从作品页头与 Studio 顶栏拖动窗口。
- **时间线两阶段重建** — 重做语义色、主次刻度、playhead、轨道头、五态 clip、胶片格与波形密度、空轨提示和缩放控件；选中、拖动、裁剪、吸附及多选反馈在暗亮主题和不同缩放档位下保持清晰一致。

### Removed

- **0.x breaking：** 移除 Explore / Analytics UI、trends / analytics / coach API、`autoviral trends` 及两套后台采集。

### Breaking

- 旧配置仍可加载但相关字段被忽略；既有磁盘缓存不会自动删除。

## [0.1.10] - 2026-07-09

**导出保真与 fps 一等公民**（PRD-0011 + PRD-0012，14 片）—— 两条主线：**导出可交付**（成片"跳回前几帧"抽动根治 + 成品与素材分家、导出历史找得回）与**画布帧率可改**（fps 从"文档谎称锁定、实则裸奔"升级为与画幅同级的一等可编辑参数）。全程测试先行（预设测试证红→转绿），每批实现经 codex 独立审查（19 findings，9 个 medium+ 全部修复或有据驳回），8 纬浏览器 E2E（截图 + DOM/computed-style 二确 + completeness-critic）验收，E2E 抓出的三个 CONFIRMED 缺口当日修复并复验通过。

### 导出保真（PRD-0012）

- **成片倒跳抽动根治** — 导出与预览共用的视频组件按 `getRemotionEnvironment().isRendering` 分支：服务端导出（含 streaming 路径）走帧精确的 `OffthreadVideo`（ffmpeg 抽帧），浏览器预览保持原生 `<Video>`（2026-05-08 解码器预算优化不回退）；预览专属的 seek 容差参数只在预览分支下发。实证：对帧级取证 work 重新导出，倒跳事件从 44 处降为 **0 处**（源片基线 0；预览纬 20 采样点严格单调无倒带）。
- **ffmpeg 预处理关键帧归一** — 裁剪/翻转、timewarp、变速三个 pre-pass 重编码统一补 `-g/-keyint_min = 帧率`（对齐 Seedance 入库归一先例），拆掉"过 pre-pass 的 clip 被 libx264 默认 ~10s GOP 抹掉 1s 归一"的潜伏雷；pre-pass 缓存 key 同步纳入 fps，防止改帧率后命中旧 GOP 缓存令修复静默失效。
- **jitter-scan 取证工具入库**（`scripts/jitter-scan.mjs` + `src/domain/backward-jump-scan.ts` 纯核）— 帧级倒跳检测（灰度指纹 + "与前 1 帧差异大却与前 k 帧近同"签名）成为仓库 QA 标尺，"导出是否干净"由数据判定。

### 成品管理（PRD-0012）

- **素材库「成品」分组** — 导出成片/代理独立成组、带成片徽章与 mono 导出时间，与源素材分区展示；渲染中间产物（`autoviral-export-*`、`*-ducked/-burned/-normalized`）与 pre-pass 缓存过滤不再展示。一次导出素材库只新增 1–2 个条目（此前 4–5 个 mp4 全量混入 CLIPS）。
- **渲染中间产物清理** — 渲染成功产出 final 后服务端 best-effort 删除本次派生的中间 mp4；失败路径保留现场以便诊断。
- **导出历史** — 新增 `GET /api/works/:id/render/jobs` 与 TopBar「渲染记录」菜单（时间倒序，每条含下载/在 Finder 显示/预览三入口），关掉进度弹窗后成片始终找得回。
- **导出实时可见** — 素材库 watcher 补上 `output/` 目录监听：导出完成后成品组实时出现新成片，无需刷新页面。
- **agent 导出同权** — bridge `POST /export`（agent/CLI 路径）完成后写入 render-queue 终态记录，agent 导出的成片与 UI 导出一样出现在导出历史里（此前永远缺席）。

### 画布帧率（PRD-0011）

- **正式修改入口，agent-人同路** — 共享 ops 核新增 `setFps` 意图（四档 24/25/30/60，非法值带码拒绝、同值幂等）；bridge 新增 `POST /comp/fps` per-intent 路由（镜像 `/comp/aspect`）；CLI 新增 `autoviral comp fps <24|25|30|60>`；Studio 设置抽屉新增「画布帧率」四档 segmented control（24 档标注 Seedance 源推荐）。四条入口收敛到同一个 op、同一份 composition.yaml、同一个 `composition-changed` 广播——CLI 改完 UI 无刷新即时反映（E2E 实测）。
- **preset 与 fps 解耦（修陷阱）** — 平台 preset 应用不再覆写画布 fps，导出也不再用 preset.fps 压过画布值（preset 的 fps 字段降级为记录值）。实证：24fps 画布套「抖音」preset 导出，成片 `r_frame_rate=24/1`。
- **video 作品默认 24fps** — 新建 video 作品（UI 与 CLI 双路）默认与 Seedance 源片同帧率，从源头消除播放漂移；YouTube ingest 等显式传值路径不受影响。
- **手册纠偏** — 删除 "fps is locked at create-time" 不实文案两处，`comp fps` verb 文档化（时间字段全为秒、改 fps 无损、不触发素材重生成）。

### Fixed

- **新建作品种子路径绕过 content-type registry**（codex review 抓获）— Studio 与 bridge 的 fresh-video 种子路径裸调 `makeEmptyComposition` 工厂，registry 的 seedFactory 无生产调用方；两处改走同一 manifest，UI/CLI 新建行为收敛单一事实源。
- **成品组正则漏手工命名成片** — `final-30fps.mp4` 这类无毫秒时间戳的成片此前静默混入 CLIPS；放宽为 `final-/proxy-` 前缀匹配，无时间戳时优雅省略时间徽章。
- **成片/时间戳徽章亮色主题下不可辨** — 徽章误用与页面背景配对的 `--accent-hi` token（亮色主题=深墨色）叠在深色缩略图上对比度 ≈1:1；改用固定深玻璃底 + 亮字（≈19:1），并以对比度回归测试锁住。

**画布全貌与剧本通读升级** —— 两条主线：**Dive 画布 editorial 重设计**（横向时间轴、缩放系统、去玻璃纯色化、扇叠/边/入场的高级感细节）与 **ScriptReader 剧本通读**（剧本 + 分镜交织成一条阅读流，从全屏 modal 进化为**中央停靠面板**：左对话、中阅读、右编辑三区并存）。全程测试先行（预设测试证红→转绿），多轮多纬度浏览器 E2E（截图 + DOM/computed-style 二确）验收。

### Dive 画布 · editorial 重设计

- **横向时间轴布局 + 缩放系统**（`clusterLayout` 纯函数）— 分镜簇沿横轴按镜号排布如一条胶片；缩放档位驱动信息密度（低缩放降级渲染、视口外裁剪），MiniMap 按资产类型上色。
- **高级感六项**（借鉴 infinite-canvas 技法）— 簇内素材**扇形叠卡**（hover 整叠微移）、节点**去框**（内容自身即形状）、**签名入场 stagger**、生成中态 **GeneratingOverlay**（渐近进度曲线，等待后端发射 pending 即点亮）、**DiveEdge 三件套**（选中 marching-ants 流动虚线 + hover 辉光 + 16px 隐形命中路径）、背景低缩放降级。
- **画布去玻璃** — 画布平面全面改用不透明 `--canvas-*` token（暗 `#0b0c10` 真黑 / 亮 `#f4f2ed` 暖米），半透明 glass surface 退出高频重绘区；文字对比度由 token 级 WCAG 契约测试锁死。

### ScriptReader 剧本通读 · 中央停靠面板

- **交织阅读流**（`splitScriptByAnchors` 纯核）— 剧本 markdown 按 ATX 标题切段，每个分镜卡按 `mdAnchor` 插到对应标题之后（无锚点者归尾部「分镜册」），~720px 编辑部阅读列 + 右缘镜号 mini-TOC 跳转 + 卡上「编辑」直达侧栏编辑面。顶栏「剧本」一键进入。
- **中央停靠面板（非 modal）** — 阅读面板只覆盖中央列（预览 + 时间轴），左侧对话与右侧分镜列表**保持可见可交互**：侧栏分镜卡 hover ⤢ 打开面板并平滑定位该镜（短暂高亮 ring）、剧本折叠头 ⤢ 从头通读；面板内「编辑」跳转侧栏展开时**面板保持打开**（中读右改同屏）；ESC 关闭但焦点在输入框时豁免；背景为不透明 `--canvas-bg`，下层预览不透出。
- **编辑区文字空间** — 侧栏画面描述 / 旁白 / 剧本输入框改 `field-sizing: content` 随内容自动增高（封顶后内滚），字号 12.5px / 行高 1.6，长文案不再挤在两行小缝里。

### Fixed

- **交织锚点前缀容错** — agent 起草的剧本标题带时长后缀（如「开场 · Hook（0–8s）」）而分镜 `mdAnchor` 只存节拍名时，旧严格全等匹配整批失配、所有分镜静默掉进「分镜册」（浏览器 E2E 抓获）；现先全等（保持重复标题下的确定性）、无命中再做双向前缀匹配。
- **ScriptReader 自加载剧本** — 从 LIBRARY tab（ScriptTab 未挂载）打开阅读器时 script store 为空，整批分镜劣化成非交织视图；现由阅读器自行经同一纯文本服务拉取（与 ScriptTab 在飞加载去重）。
- **Dive MiniMap 零节点** — 受控 nodes 无 `onNodesChange` 时 xyflow 不回写 measured 尺寸，MiniMap 画不出任何节点矩形；补 `initialWidth/Height` 修复。
- **Dive 箭头颜色被 xyflow inline style 压制** — token 色改走 `markerEnd.color` inline 注入。

## [0.1.8] - 2026-07-06

**工作台可信度与全貌升级**（PRD-0010）—— 两条主线：**可信**（消息不再重复、成本有账可查、Chat 后端可选）与**全貌**（剧本可读、素材可辨、分镜聚簇画布）。六个切片经三个 Wave 落地（22 片 tracer-bullet，测试先行），并经**两轮多纬度浏览器 E2E**（截图 + DOM/computed-style 二确）验收：第二轮揪出并**三修**了一个 Dive 画布内簇按钮真鼠标点击全失效的 CRITICAL 回归（根因是 xyflow 的 pane 平移在缺 `nopan` 逃逸时抢占了 pointerdown，前两修只补了 `pointer-events` 漏了这一重）。

### Wave A · 修缮（Chat 可靠性 / 剧本可读 / 素材卡形）

- **Chat 消息重复/闪回根治**（A1/A2）— 给每个消息块发**稳定 id**（server 在块进 messageHistory 时分配 `{sessionId}:{seq}`，chat 日志落盘带 id），HTTP history / WS history 重放 / WS 实时块**三条 seed 路径携带同一 id**，前端 store 改 by-id upsert；旧无 id 日志按行号合成兜底 id。发送侧加 useRef in-flight 锁 + 断线禁发提示 + server ≤3s 幂等窗，把重复从"启发式压制"变为"结构性不可能"，且第二发不再误杀正在流式输出的 CLI。实证：曾同一条 user 消息落盘两份的历史 work 加载后折叠为单气泡；mid-turn reload 不再"闪回旧状态再跳回"。
- **剧本·分镜可读性**（A3/A4/A5）— 剧本 tab 首屏从"~140px 小框里的裸 markdown"改为**默认渲染排版**（编辑部 `.md-bubble` 样式 + remarkGfm 表格/引用/标题 + 高度自适应，手动切换 localStorage 记忆）；抽出 **Chat 与剧本共用的 Markdown 组件**（含资产 URL 翻译）；新增**全屏阅读/编辑 modal**（~720px 阅读列宽、≥15px 字号，portal 到 body 避开 glass 祖先 backdrop-filter 定位陷阱，保存与 agent `script edit` 同路径）；分镜摘要行窄栏时 meta 按优先级降级保标题可读，右栏可拖宽从 28% 放到 40%（拖动结果持久化）。
- **素材库 per-kind 卡形分家**（A6/A7）— AUDIO 组从 9:16 竖版大卡换 **~52px 紧凑横条**（迷你波形 + mono 时长 + 就地**单例试听**：同刻只播一个、切 work/卸载即停），一屏音频密度从 2-4 张升到 ≥10 条；TEXT 组换**内容 snippet 卡**（前 ~200 字符 3 行 clamp + 扩展名徽章）+ 预览弹窗全文；**管线内部文件**（`.peaks.json` / `concat.txt` 及下划线/连字符变体等）从素材库过滤出去（纯前端过滤，agent 经 bridge 的文件投影零变化）；MIME 表补 m4a/aac/flac/ogg 使音频 Range/seek 生效。

### Wave B · 成本与画布（Per-work 成本 / Dive 分镜聚簇）

- **Per-work 成本账本 + 徽章**（B1-B4）— 新增 SQLite `cost-ledger` 深模块（`cost_events` 表，单一 `recordCostEvent()` 入口，**best-effort：记账失败绝不阻断生成**）+ per-work 汇总端点；**六路埋点**（视频 / 生图 / BGM / TTS / 翻译 / agent 会话），拿不到真实账单的调用诚实标 `estimated`；生图请求补 `usage:{include:true}` 换 OpenRouter 真实成本并顺带补上图片 provenance 注册。Studio/Editor 顶栏新增「本片 $X」**成本徽章** + 点开的明细面板（按 kind 分解 + 估算徽标 + agent token 用量 + 口径起始日注明）；生成/对话完成后**无刷新更新**。agent 会话花费**跨刷新存活**（从持久化 ChatBlock usage 重建，delta 取值实证防 resume 累计值重复计账）。
- **Dive 分镜聚簇画布**（B5/B6/B7）— 衍生图谱从平铺 asset DAG 升级为**按分镜聚簇的全貌层**：新增 `useSceneClusters` 纯函数（簇成员 = scene 的素材 ∪ 生成 take，选用 take 高亮，衍生资产沿 provenance 祖先链归簇，无归属者进默认折叠的"未归属"簇），xyflow group node 渲染 + 视口裁剪 + 视口外视频不拉 metadata。簇标题条复用分镜列表 i18n（含"需重生"三重编码）、**点簇标题跳回 ScriptTab 对应分镜卡**；"按分镜聚簇"（默认）/"按衍生链"双视图 toggle；入口从 Inspector tab 深处**提升到 Studio 顶栏**。补上 **i2v firstFrame→视频的 provenance 断链**（反查源图 id 填入 `fromAssetId`，data URI/外链反查不到时静默降级为无边、不阻断生成），定妆照→视频这条主力工作流在画布上终于连线。

### Wave C · Codex Chat 后端（完整 parity）

- **Chat 面板可按会话选择 Claude 或 Codex 驱动**（C1-C5）— 抽 `ChatBackend` 接口（`buildSpawn` + `createLineParser`），claude 实现为现有逻辑**纯平移零行为变化**；codex 实现基于 `codex exec --json`（JSONL 事件，schema 经本机真跑锚定 fixture）+ `codex exec resume`。后端为 **per-session 属性**：新建会话时选择、已有会话禁切（跨后端 resume 不互通，UI 明示"切换即新对话"），切换复刻 model switcher 的 killSession+respawn。**viewer-context / viewer-action / checkpoint 三者本就 backend-agnostic**，codex 会话同等支持读界面焦点、驱动 Studio 跳转、每轮自动打 checkpoint。认证由用户在 Terminal 跑一次 `codex login` 自理，Chat 侧只检测登录态并给引导（未登录不 spawn、给友好文案而非 ENOENT）。codex 用量徽章 **token-only**（无美元、不做本地价格折算——诚实纪律）。新增 [ADR-013](docs/adr/ADR-013-chat-multi-backend.md)（Chat 多后端架构），CONTEXT.md 不变量 #4 的"multi-backend Chat deferred to 0.2.0"更新为已落地。范围：仅 work chat，coach/trends/cli-brief 保持 claude。

### 两轮 E2E 回流修复（用户可感知）

- **直连 UI 生成后成本徽章不刷新不更新**（BE1-F1）— `GenerationDialog` 四条直连 dispatch 只 invalidate `['assets']` 从不 invalidate `['cost']`，叠加 `staleTime:30s` → 直连生成后徽章金额停在旧值；现补 cost invalidation，生成后徽章无刷新即变。
- **agent 经 CLI 生成的图片成本 100% 隐身**（BE3-F1，CRITICAL）— bridge `scene generate`（CLI/agent `autoviral scene generate` 落点）真实生成并计费一张图却完全不记入 cost-ledger，而 UI 侧正确记账 → agent 花的钱在成本徽章里查不到；现补 `recordCostEvent`，CLI 与 UI 两路径记账一致。
- **CLI 长同步生成误报 `fetch failed`**（BE3-F3）— openrouter-image 同步出图可达 ~2 分钟，CLI 裸 fetch 无超时调优 → 拿到失败但 server 已生成并计费，agent 无从得知易重复扣费；改为显式超时上限（保留 ~15min 客户端预算）+ 清晰退出码。
- **viewer-action tag 死链接通**（CE2-F1）— `<viewer-action>` tag 曾被解析剥离进气泡却从不驱动 Studio（`dispatchAction` 全仓零赋值）；现接通死链，claude 与 codex 会话输出的 tag 都真驱动 playhead 跳转/选中 clip/Inspector 展开对应属性；reseed 路径也剥离标签，reload 后气泡不再残留裸 `<viewer-action>`。
- **空作品 codex 探路裸 500**（CE1-F5）— 空 work 的 bridge `GET /comp`、`/clips`、`/assets` 裸 500，codex 探路命中即报错；转优雅降级（空列表/结构化响应）。
- **Dive 簇内交互按钮真鼠标点击全失效**（BE2-F1，CRITICAL，三修）— 簇标题跳转 / 未归属折叠 / take 选用三处控件对真实鼠标点击全部失效：`draggable:false` 的簇组节点被 xyflow 置 `pointer-events:none` 且不带 `nopan`，pane 的 d3-zoom 在 pointerdown 时抢去发起画布平移把 click 吃掉。前两修只补 `pointer-events:auto`（重开命中目标）漏了这一重；三修抽 `hitTarget` 原语给三控件同时补 `nopan/nodrag` 逃逸，浏览器复验三条路径真鼠标可用（`elementFromPoint` ⇒ 控件自身而非 `react-flow__pane`）。

### Fixed（其他）

- **Seedance 轮询层 `polling_url` 缺失时给可诊断错误**（i2v 诊断沉淀）— enqueue 返 200 但响应体无 `polling_url` 时，旧代码会把它当 `fetch(undefined)` 在轮询循环深处抛出无法归因的 `Failed to parse URL from undefined`；现于 enqueue 边界 fail-fast，抛带上游 body 的显式错误（`Seedance enqueue returned no polling_url: …`），并有回归测试钉死「守卫短路于任何 poll fetch 之前」。

### Changed（其他）

- **i2v recipe：`data:` 锚图路径补实证 + 可达性 gotcha**（文档纠偏）— 2026-06-10 探针只发过 http-URL 锚图，`data:` 内联路当时仅代码正确、从未打过真 API；2026-06-15 付费探针实证：work-relative `firstFrame` → 服务端内联 `data:` URI → **OpenRouter Seedance 接受并出片**（64×64 `data:` 锚 + 显式 `16:9` → 真实 864×496/24fps/4s，方形锚未锁画幅）。recipe 同时写明锚图**由 OpenRouter 服务端拉取**：传 work-relative 路径（路由内联 `data:`，首选）或公网可下载 `https://` URL 才可达，**`http://localhost…` 必失败 `400 resource download failed`**。

## [0.1.7] - 2026-06-12

本版由两批工作组成：**Agent 工作面大修**（PRD-0009 七片 + agent 视角冒烟与多纬度 E2E 揪出的修复簇，先列于下）与 **折叠镜表（Shot Sheet）**（PRD-0008，见本节后半）。Agent 工作面批的主线：聊天暂停键真正可用、BGM 生成从零到一、agent 的 CLI 开箱即用（不再被幽灵路径逼去读源码）、操作手册与实现全面对齐并有自动防漂移测试、旧作品 resume 也能学到新能力、导出成片从 100% 失败修到真实出片。

### Added
- **BGM/配乐生成端点从零到一**（0009·B2）— `POST /api/generate/bgm`：Lyria 3 Pro via OpenRouter（chat/completions SSE 流式，约 $0.08/首、整曲约 1–2 分钟），器乐默认（`vocal` 可选）、`durationSeconds` 5–180 可选（服务端校验 + ffmpeg 截断，Lyria 上游无时长参数）、落 assets + AssetEntry/provenance 登记 + `asset-added` 广播（与视频端点同模式）。key 走 `config.openrouter.apiKey` 显式注入（无 key 503 / 无 key 开发态 stub）；registry 新增 `music` capability。**付费探针实证**（$0.08）：SSE `delta.audio.data` 契约未漂移，拼接字节 ffprobe 二确为 mp3（74.4s）。此前用户让 agent "自己生成配乐" 三重无路（无端点 + 提示词漏教 + UI 死信封命 agent 跑已删 .py）——agent 被逼读源码逆向的那张截图就是这条根因。
- **comp.duration 终于有写入路径**（0009·B6）— 新共享 op `setCompositionDuration` + bridge `POST /comp/duration` + CLI `autoviral comp set --duration <秒|auto>`（`auto` 从全轨 clip end 推导；允许缩短，截断内容时 CLI 给非阻断警告）。此前 duration 只会被 clip 增改单调撑大，缩短只能整份 `comp put` 或直编 yaml——而直编会被 Studio 打开时的 800ms 防抖自动保存覆盖（manual 现已写明该陷阱与"写入必须走 bridge"的原因）。另：clip 跨轨移动经查**已有**全链路（`autoviral clip move <id> --to-track`），0009 该半片为过时前提，本次仅补 manual 文档。

### Fixed
- **`PUT /api/config` 响应回显全部明文 secret**（冒烟揪出，CRITICAL）— GET 早已脱敏（#60），PUT 路径漏网：任意配置保存的响应体直接带回 openrouter/jimeng/memory 全家明文 key。现 GET/PUT 共用同一 `redactedConfigResponse`（strip + `{set,lastFour}` meta），sweep matrix 测试循环整个 secret family 双面钉死。
- **导出成片在裸 dist daemon 下 100% 失败**（E2E 揪出的既存硬伤）— render / export / snapshot 三条路径全断：Remotion 入口被解析成 `PACKAGE_ROOT` 的 child（dist 布局下=幽灵路径 `dist/web/...`），运行时 webpack 撞裸 ENOENT；与本版 B5 修复的 spawn PATH 同族的第四处 child-vs-sibling 错配（仅打包 Electron 因预构建 bundle 幸免）。现 sibling 常量统一解析 + 入口缺失时 webpack 之前给出可操作错误（指明设 `AUTOVIRAL_REMOTION_BUNDLE` 或从含 web/src 的检出运行）+ **doctor 新增「remotion 渲染入口」核心检查**——「doctor 全绿但渲染 0%」的自相矛盾从此不可能。
- **图像生成端点透传非法参数给付费 provider 并泄露内部 id** — `/api/generate/image` 非法 aspectRatio 不本地校验（video 端点同场景干净），provider 错误体裸露内部 model id 与账户 id。现本地枚举校验（转发前 400 列合法值）+ `sanitizeProviderError` 对外脱敏；image/video/bgm 三端点对 fresh work（尚无 composition.yaml）不再静默跳过 AssetEntry 登记（共享 bootstrap，`assetId` 真返回）。
- **BGM 上游间歇性空音频无韧性** — Lyria 偶发返回 200 但 0 音频字节，此前一击即 500 且 UI 只有泛化「生成服务调度失败」。现仅对空音频自动重试 1 次（其他错误不重试，防双倍计费），重试仍空返 502 + 中文可操作文案「上游模型临时返空，请稍后重试」，前端按 code 白名单直显（英文内部错误一律走本地化兜底，不漏给用户）。
- **安装态 skill 手册永久冻结** — skill-sync 的 content-hash 门对 legacy marker（无 hash 字段的旧标记 + 版本未 bump）被旁路，`~/.claude/skills/autoviral` 的 manual 停在旧档、整族新端点教学到不了被动加载的 agent。现 legacy marker 当场强制比对并补写 hash；另 `autoviral docs` 现可服务 `contracts/` 与 `recipes/` 命名空间（此前手册散文指引的 topic 全 404）。
- **教学面若干谎言与缺口**（冒烟/E2E 实测揪出）— 幻影端点 `POST /api/render` 改正为 `/api/works/:id/render` 并纳入 parity sweep（消除 gate 盲区）；manual 招牌示例 `clip set --opacity` 改正（opacity 是 keyframe 属性）；overlay 教学校准（实现早已支持，说谎的是手册）；track add/remove 教学补齐；新增 `autoviral checkpoint create [--label]`（纯 CLI agent 此前零快照创建路径）；`--format` 显式 flag 不再被管道态忽略；setup 未知 flag 现拒绝（`--check` 提示改用 doctor）；`scene list` honor `--format json`。
- **聊天暂停键无效（多会话 work）**（0009·B1）— abort 端点是 pre-ADR-008 化石：前端不带 sessionId、端点永远杀 `s_1`，在会话 2 流式时按停杀的是空对象且静默无反馈。现 sessionId 全链路透传（前端 body → 端点 → `killSession(workId, sessionId)`），`aborted:false`/请求失败有可见 toast（zh/en），多会话隔离有测试钉死（杀 s_2 时 s_1 的 CLI 进程与事件流毫发无伤），单会话路径向后兼容。
- **agent 的 autoviral CLI PATH 指向幽灵目录**（0009·B5）— v0.1.0 起 spawn env 的 PATH 指向不存在的 `dist/cli/autoviral/bin`：`PACKAGE_ROOT` 在 dist 布局下就是 `dist/` 本身，而 `cli/` 是它的 **sibling** 不是 child（2a79daf 为兼容 packaged-Electron 改 `process.cwd()`→`PACKAGE_ROOT` 时引入的回归）。agent 第一条 `autoviral` 命令即 command not found，只能硬编码绝对路径干完全场——与提示词宣称"开箱即用"直接矛盾。现三处 child→sibling（chat spawn / Studio 终端 spawn / `autoviral docs` 的 manual 解析）统一收敛到单一事实源 `CLI_BIN_DIR` + spawn 前 fail-fast 自检（幽灵路径不再沉默）；存在性测试钉死 dev/npm/Electron 三种出货布局。
- **生成对话框死信封退役**（0009·B3）— image 生成、全部变体、BGM 此前向 chat 发"跑 X 脚本"信封，逐字命令 agent 运行 4 个磁盘上不存在的 .py（`6e3693c` 只清了 server 端死引用，web 端漏网）。现全路径 direct-dispatch 真端点：image→`/api/generate/image`（前端语义化命名）、image/video 变体带 `referenceImage`/`firstFrameImage` 锚（相对 uri 自动绝对化，OpenRouter 服务端才取得到）、tts 变体→`/api/works/:id/tts`、BGM→`/api/generate/bgm`；script 信封机制整体删除，并有"绝不 POST .py / 绝不发死信封"守卫测试。顺手收编 dead-control 家族：resolution 下拉移除（端点从不消费）、imageUrl 控件接通 i2v 锚、死 `requirements.txt` 提示删除、BGM 时长输入 onChange clamp 5–180（#75 旧账）。
- **manual 只教 2/13 生成端点，"单一事实源"不变量已破**（0009·B4）— `autoviral docs` 的内容源 03-cli-reference 补齐全部 agent 该会的端点参数表（写前逐字段对照路由源码）：双 TTS 怎么选（system-scoped 自定路径 vs work-scoped 自动登记+广播）、双 captions 分层关系、mix（真实 MixTrack 字段）、4×transitions、frames/select（实为分镜候选帧选优器，非 i2v 锚帧——侦察设想被源码纠正）；"内部端点"单列不教并写明理由（含实证 dead 的 `/api/video/reframe`）。新增 **parity sweep 测试**：提示词名册里每个 `/api/` 端点必须能在 manual 命中，新端点自动入网。对抗 review 审出并清除幻影参数 `loudnessTargetLufs`（mix 端点不消费它，正确归属是 `/api/render`）。skill-sync 由纯版本门改 **content-hash 门**——同版本内改 manual 也会传播到安装态 `~/.claude/skills`（此前 marker 锁版本导致永久冻结，正是"安装态 manual 是旧档"的根因）。
- **resume 旧提示词：既有 work 永远学不到新教学**（0009·B7，三选一选型）— 采用"教学下沉 docs 为主 + resume 增量注入为辅"：参数表全部移出系统提示词、只活在 `autoviral docs`（resume 的 agent 现查现用，零上下文损失）；提示词保留端点名册 + "参数以 docs 为准、勿凭记忆"骨架句。resume 时按 `PROMPT_VERSION` 经 `--append-system-prompt` 注入增量 changelog（陈述句措辞；sidecar 记 `lastInjectedPromptVersion` 防重复注入，版本戳只在真注入后推进）。放弃的 (b) 方案（过期弃 resume 开新会话）因丢上下文代价不可接受。系统提示词同时新增兜底禁令：任何指令（含 UI 信封）叫 agent 跑不存在的脚本或翻 `src/`，一律 `autoviral ask` 告知用户该能力暂不可用——"agent 读源码"从根上断绝。
- **视频生成格式终于真的可控（对话 agent + UI 双路径）** — 五层根因一次清算。①真凶：seedance adapter 把 `duration`/`aspect_ratio`/`frame_images` 包进 `input:{}` 发给 OpenRouter，而官方 schema 是**扁平**的——参数从第一天起被网关静默丢弃，请求退化成裸 model+prompt（这正是"竖屏请求返回 16:9""i2v 输出固定 720×1280"的实测假象；所谓 i2v 此前从未真正生效，连锚图都没送达过）。现已扁平化 + `frame_images` 改为官方形状 `{type:"image_url",image_url:{url},frame_type:"first_frame"|"last_frame"}`。②`/api/generate/video` 此前吞参（durationSec 写死 5、resolution 折成二值）——现接受 `aspectRatio`（7 枚举校验）/ `resolution`（480p/720p/1080p）/ `durationSec`（整数 4–15，旧教学的 "3" 上游根本不支持），旧 `resolution:"16:9"` 用法兼容；**画幅默认画布跟随**（comp.aspect 映射最近支持比例，4:5→3:4，与图像端同一规则），agent 路径与 UI 路径（providers 端点）行为一致。③该端点现**原子登记 AssetEntry + provenance 并返回 assetId**——系统提示词里"会登记 AssetEntry"的承诺此前是假的，现在为真，scene handoff 不再悬挂。④i2v 锚图本地路径现自动转 data URI（此前把本地绝对路径当 URL 发出，i2v 必然无效）；lastFrame 补齐与 firstFrame 同级的路径沙箱。⑤轮询上限 5 分钟 → 15 分钟（实测 4s 任务也会超 5 分钟，旧上限白白丢弃已计费任务）。**付费探针实证**（ffprobe 二确，共 $2.57）：t2v 16:9@720p → 1280×720 横屏；9:16@1080p → 1080×1920（1080p 真实可得）；i2v 9:16 竖图锚 + 显式 16:9 → 1280×720（**显式画幅赢，不被输入图锁定**）；全部 24fps；写实人像锚图被 ByteDance 审核 400 拒单（不计费）。Web 生成对话框时长选项 3s（非法值）→ 4/5/8/10/15；图像 tab 残留 4:5 不再泄漏进视频请求（双层防护）。知识面三件套（ws-bridge 提示词 / CLI 手册 / i2v recipe）同步重写为真参数与实测结论。

### Changed
- **图像 provider 通用化改名 `nanobanana` → `openrouter-image`** — 文件 / 类（`OpenRouterImageProvider`）/ registry id 全部换成如实的通用名（真身一直是 OpenRouter `openai/gpt-5.4-image-2`，旧名是换模型前的历史产品名，极具误导性）。旧 id `nanobanana` 永久保留为入站别名（在 `getProvider` 查找咽喉归一化），旧文档命令 `--provider nanobanana`、旧 work 的 chat 历史、外部脚本零破坏；既有 composition provenance 里的历史 `providerId: nanobanana` 不回写（纯审计字段，无任何代码读回）。文档面（README / AGENT.md / CONTEXT.md 词表 / ADR-007 注记 / CLI 手册 / recipe）同步诚实化。

**折叠镜表（Shot Sheet）**（PRD-0008）—— 「剧本·分镜」tab 交互重设计。用户反馈"按钮很多很杂"：原每张分镜卡常驻 ~12 个裸控件、一屏 ≈72 个可见控件，且人在 UI 里根本不能新建/删除分镜。本版把卡片改成**折叠态一行只读镜头条 + 点击就地展开的卡内 Inspector（手风琴单展开）**，默认视图只剩 ~3 个常驻按钮；设计经多 agent workflow（4 角度提案 × 2 立场评审）选定，全部写路径不变（per-intent bridge + 共享 scene ops，agent-人一致）。

### Added
- **UI 新建/删除分镜** — 列表底部「＋ 新建分镜」+ 空状态主按钮（替换"去敲 CLI"的死文案）→ `POST /scene`；⋯ 菜单删除（两步确认 + 外点/Escape 取消）→ `DELETE /scene/:id`。与 agent `autoviral scene add/remove` 同一路由同一 ops，新建 scene 记录字节级一致（E2E 经磁盘 yaml 对比证实）。新卡经 refetch 自动展开。
- **✓ 已存微反馈** — 字段 inline-commit 成功后短暂显示 `role=status`「✓ 已存」，修"离焦即存但无信号"的可发现性缺口。
- **剧本折叠条** — 剧本编辑器外包 ▾/▸ 折叠开关（默认展开，localStorage 记忆），叙事层与逐镜执行表视觉分层。
- **Claude Fable 5 模型档位** — 聊天 agent / Explore 教练 / Settings 三处模型切换器新增 Fable 档（Opus 之上的最强档）。沿用"只存裸别名、CLI 运行时解析最新版"的设计；默认档位保持 Opus 不变。

### Changed
- **分镜卡两态化** — 折叠态零表单控件（镜号 / 三态状态点 / 标题 / 时长 / 景别 / 意图 / 已生成缩略图）；展开态才渲染全部编辑控件（标题/画面/旁白/时长/景别/运镜/意图/↑↓/生成 CTA），手风琴同时仅 1 卡展开。既有 inline-commit、focus 防顶掉、null-clear、生成防重入逐项保留。
- **stale 状态多重编码** — 「需重生」不再只靠 8px 纯色点：实心琥珀点（`--status-warn`，双主题 token）+ mono 文字徽章，三态（◌待生成/●已生成/◍需重生）不靠颜色即可区分（e2e Hard rule 5）。
- **上移/下移收进 ⋯ 菜单**，整卡拖拽重排保留。

### Fixed
- **生图画幅：用户决定，画布跟随** — 此前 `/api/generate/image` 公开参数 `width/height` 被 provider 静默丢弃（一律落模型 1024×1024 方图默认），且「生成此幕」逐镜出图无条件方图。现在优先级=显式参数（aspectRatio / width/height 推导）> 作品自己的画布 `comp.aspect`（用户定的，9:16/1:1/16:9/4:5）> 模型默认，零平台硬编码——16:9 画布的抖音 work 就出 16:9。真实出图实证 9:16 → 720×1280。顺手统一 composition-ops 的 works-root 解析到共享 `getWorksRoot()`（修自定义 DATA_DIR 下 bridge 与 REST 指向不同目录的遗留分歧），并把图像 provider 的对外名号从历史遗留的 "NanoBanana" 改为如实的 "GPT Image 2 (via OpenRouter)"（内部 id 不变保兼容）。
- **生成素材要手动刷新才出现**（用户报告）— 复合根因双修：① 只有 5 个 blessed 端点广播 `asset-added`，agent 经 Bash/ffmpeg/python **直接写盘**的素材（以及转场/captions 等输出）没有任何事件——新增 **assets 目录 watcher**（递归监听 `<work>/assets/`，防抖合并、滤 tmp/dotfile/目录事件），任何写入/删除都在 chokepoint 广播，新端点不会再重开缺口；② 前端 bridge WebSocket **没有重连逻辑**，daemon 重启/电脑睡眠断线后页面永久失聪——`useBridgeEvents` 现带上限指数退避自动重连，重连成功后全量补刷（composition/carousel/script/素材库），错过的事件不再丢。浏览器 E2E 双纬度证实：直接写盘 ~5s 内未刷新出现真解码缩略图（删除同步收敛）；杀 daemon 重启后不刷新页面事件流自动恢复。
- **删除失败误报"保存失败"** — `ErrorLine` 未传 kind 时统一落 saveFailed 文案；现删除/重排各有专属错误文案（对抗 review 双 reviewer 同挖）。
- **新建自动展开可能选错卡** — 占位标题同名时 title 回退会匹配旧卡；现仅在 bridge 未返回 id 时才启用 title 回退。
- 清理 `work-store.ts` 两处历史遗留 unused 声明（TS6133）。

## [0.1.6] - 2026-06-09

**剧本·分镜规划层**（PRD-0007）—— 在生成之前先排剧本、看分镜、逐镜生成。AutoViral 重定位为电影级 AI-native 万能视频生成器，本版专做 **L1 规划层**：把"生成前先有计划"做成素材区里可写、可改、agent 与人共编的一层。两条命题贯穿：**计划与执行解耦**（生成只是 handoff，规划层不拥有生成引擎、不碰 timeline）+ **agent-人一致**（剧本/分镜的每一次写都经同一份 scene ops，CLI 排镜与 UI 改卡收敛到同一 `composition.yaml`）。9 个纵切片实现，经 per-wave 对抗式 review + 多纬度浏览器 E2E（截图 + DOM/computed-style 二确）验收。

### Added
- **剧本（plan/script.md）编辑器** — 素材区第三 tab「剧本·分镜」顶部挂一块自由文本叙事总纲（markdown，edit/preview 切换），读写经 `GET|PUT /api/works/:id/plan/script.md`（raw text/markdown），外部编辑经 plan-watcher → `plan-changed` 广播实时回流；空 plan 返回空串不造模板（#73/#83 i18n-as-data 铁律）。剧本与分镜是两个独立面，弱链于 `scene.mdAnchor`，诚实显 drift。
- **分镜骨架卡片** — `composition.scenes[]` 渲染成按 `order` 排序的卡片列表，逐镜 inline 编辑 intent / 画面描述 / 旁白 / 时长 / 景别 / 运镜 + 上下移/拖拽 reorder；每一次编辑都走 per-intent bridge 路由（不进 800ms 整份 autosave），`comp.scenes` 在 store 里是只读镜像。
- **生成 handoff「生成此幕」/「重拍」** — 用该镜自身字段（prompt 富化景别/运镜/旁白）调现有生成流程；产物登记为 `composition.assets` 的 `AssetEntry` + 回链该分镜（`generatedAssetIds`/`selectedAssetId`/`status=generated`），**register 与 link 在同一把 per-work 写锁内原子提交 → 永无悬挂引用**；改画面描述后该镜转 `stale`「需重生」，卡片显缩略图与已生成态。产物不自动铺 timeline。
- **`autoviral scene` CLI** — `add` / `list` / `set` / `reorder` / `link` / `generate` / `remove`，与 UI 共用同一 scene ops；`autoviral script show|edit` 读写剧本。任何 CLI agent 排好的分镜在 UI 里字节级一致地显现。
- **8 字段 SceneSchema 升级**（`intent`/`prompt`/`narration`/`durationSec`/`shotSize`/`cameraMovement`/`mdAnchor` + 生成态 `generatedAssetIds`/`selectedAssetId`/`status`），向后兼容（旧 work 无 `scenes` 键原样 parse），新建 `newSceneId()` + 共享 `scene.ts` ops（addScene 自动连号 order / setSceneProps 含运行时白名单 + null-clear 协议 / reorder 连号 / linkSceneAssets / removeScene）。

### Changed
- **每次 composition 写经 per-work 写锁** — `mutateCompositionFor` 用 `withWorkLock` 串行化同一 work 的 read-modify-write 临界区（修 lost-update：并发写读到上一笔已提交状态，不同 work 并行）；整份 `PUT /comp` 与 `POST /restore` 也经 identity-mutator 入锁。
- **文件 watcher 与路由统一 works-root 解析** — composition-watcher / plan-watcher 改用共享 `getWorksRoot()`（`AUTOVIRAL_WORKS_ROOT` → `<AUTOVIRAL_DATA_DIR>/works` → `~/.autoviral/works`），不再与 REST 路由在非默认配置下分歧。

### Fixed
- **跨 work 剧本串台** — `scriptStore` 升级为 work-tenant-aware（记 `workId` + 切 work 同步 `reset()` + 编辑器 `isMine` 守卫 + commit 实时门控），A→B 切换不再短暂显示/误提交上一个 work 的剧本。
- **剧本 mount-load 失败静默吞** — 加载失败从空吞改为 `role=alert` 错误提示（新增 `scriptLoadFailed` zh/en），不再让编辑器停在无信号的空白态。
- **新建 work 首次 agent 写入 ENOENT**（多纬度 E2E 挖出）— 刚建的 work 还没 `composition.yaml` 时，agent 第一次 `scene add`/`clip add` 会失败，而人在 Studio 靠 autosave 免费拿到该文件——违背 agent-人一致。写/预览 chokepoint（`mutateCompositionFor`/`dryRunMutate`）现对真实 work 惰性 seed 一份最小 composition（经 `getWork()` 门控，typo'd workId 不污染磁盘；只读路径仍 ENOENT→404）。
- **agent 提示词与 skill 手册漂移** — agent 系统提示（`ws-bridge.ts`）与 skill 手册（CLI reference + *script-to-storyboard* recipe）漏教 `autoviral scene generate`（S7）与 `autoviral script show|edit`（S5），且仍把"生成此幕"教成裸 `POST /api/generate/image` + 手动 `scene link` 的旧路径——恰是会制造悬挂引用的写法（image 裸端点不登记 `composition.assets`）。现统一教 handoff 动词（含 image-only 边界、reshoot、stale-on-edit），并修正 "(future) Studio storyboard panel" 等过期措辞。

## [0.1.5] - 2026-06-08

**诚实的数据 + 有根的教练**（PRD-0006）—— 灵感（Explore）与数据（Analytics）两页重做。核心命题：把"零零散散、对创作者没帮助"的空壳，改造成一条扎根真实磁盘数据的诊断叙事 + 一个读得懂你作品的对话教练。两条铁律贯穿：**绝不展示拿不到的数据、绝不用假承诺骗用户；把已经拥有却藏起来的真实数据和已经建好却睡着的能力唤醒。** 14 个纵切片经串行 TDD 实现（5 个 deep 模块红→绿）+ 2 轮多纬度浏览器 E2E（截图 + DOM/computed-style 二确）全绿验收。

### Added
- **数据页 · 真实作品表现** — 把早已在磁盘、早已被适配器解析、却从没上屏的 9 件作品真实 per-post 指标（播放/点赞/评论/分享/收藏）渲染成可排序的作品表现表 + 平均播放 KPI（built-not-wired 接线）。
- **数据页 · benchmark 诊断带** — 每个 KPI 旁附同粉丝层基线带，把"互动率 2.6%"变成"低于 nano 层中位数，目标区间 X–Y"的诊断句（静态基线 JSON，无实时采集；抖音基线 platform-correct 或明确标注参考性）。
- **数据页 · 内容支柱 + 成长轨迹** — 9 件作品打内容支柱标签并对比各支柱表现；前瞻式成长轨迹 + 下一里程碑卡（在数据点稀少时比回顾图表更有意义）。
- **数据页 · 同步入口** — 数据页 hero 加"同步数据"按钮（复用 S5 refresh），未登录抖音时给本地化可操作提示 + 一键跳设置。
- **灵感页 · 有根的策略 coach** — 唤醒已建好却零前端调用的研究 agent，挂成灵感页可对话面板（持久 session + sidecar 历史 + session 级 model 作用域 + 起手提问库）；coach 读用户真实作品 + 趋势 + 兴趣，给打分过的选题，并发 `<coach-idea>` 供一键落成新作品。
- **灵感页 · 真实个性化选题 brief** — 删掉写死的假"起手切角"占位卡，换成 agent 基于作品+趋势+兴趣生成的真实 brief（纯函数 shaper，诚实 grounding chip，薄数据时坦诚说明不编造）。
- **灵感页 · 趋势 drill-down** — 趋势行可展开（趋势线 / 可看样例 / 相关切角 / Rising-Breakout 紧迫角标），并亮出此前零 UI 调用的 report.md 研究报告；来源诚实标注（agent 推理 vs 实采）。
- **抖音创作者数据采集器** — 以托管 Python venv（f2 + browser_cookie3，复用 v0.1.2 doctor/venv 机制）重建被 #72 删除的采集器；读用户已登录浏览器的 sessionid cookie 拉取本人数据。

### Changed
- **删除做不到的人口属性承诺** — 年龄/性别/地域三张卡读的是 OAuth-only 私有数据（用户平台在其规模下任何 API 都不返回），"等待后台采集"是架构性谎言：删卡，换诚实三段式空态（说明为什么 / 带水印示例 / 真实 CTA）+ 平台诚实矩阵。
- **趋势按兴趣排序 + 新鲜度** — 把用户声明的兴趣喂进趋势排序路径；加 last-collected 时间戳 + stale 角标，月旧数据不再伪装实时。
- **`POST /api/analytics/refresh` 从硬 501 改为真刷新** — 未登录时返回诚实的 401 + 可操作的重新登录提示，而非静默死胡同。
- **设置默认模型不再硬编码版本号** — 下拉框由"Claude Opus · 4.7"改为"Claude Opus"：config 只存别名，claude-cli 运行时解析为该档最新模型，永不再随发版过期。

### Fixed
- **0005 bug backlog 清零（9 个）** — B1/B9 CI 与 release 门控不再漏构建/测试 bundled `cli/autoviral` 且 verify-version 校验 cli==root==tag；B2/B6 trends 路由 platform allow-list 守卫 + 路径段 sanitize；B3/B4 Works 网格在 creating 时轮询刷新 + WorkCover 封面 URL 变化时重置 failed 态；B5 `duplicateSlide` 改用防碰撞 id 生成器；B7 删除确认弹窗用函数 replacer 防 `$` 注入；B8 桌面版本号取自 `app.getVersion()` 而非硬编码回退。
- **测试不再污染真实 `~/.autoviral`** — `api.trends` / `api.cover` 测试经 `os.homedir()` 写入用户真实目录（`withTempDataDir` 只隔离 `AUTOVIRAL_DATA_DIR`，对 homedir 无效），曾把抖音热门覆盖成占位 fixture；改用 `vi.mock("node:os")` 模块层隔离，跑全套测试前后真实目录指纹一致（零污染）。

### 已知边界（诚实声明）
- **抖音真实数据采集需用户在浏览器登录 douyin.com**（采集器读 sessionid cookie）；未登录的 401 诚实路径已验证，真数据成功路径需用户授权后自验。
- coach / 选题 brief 的服务端生成内容当前为中文，不随界面语言切换（非阻塞，后续修）。

## [0.1.4] - 2026-06-05

桌面端 bug 修复（用户在 0.1.3 桌面 app 实测发现；经"诊断 → 多纬度浏览器复现 → 验证"三段 Workflow 定位 + DOM/computed-style 二确——静态分析三次误判"无 bug"，浏览器实践揪出真因）。

### Fixed
- **Explore 热门切换不再锁死** — 切到 YouTube/TikTok 后再切其他平台，热门列表曾卡在旧平台卡片并累积串台（count 漂移 22→43→32→25）。根因：youtube 采集数据 22 个 item **共用同一 id**（tiktok 部分重复），而 `TrendingPanel` 按 `key={item.id}` 渲染 → React 列表协调遇重复 key 崩坏、旧行不卸载。改为 `key={`${platform}-${idx}`}`：排名快照按（平台,位置）键控，切平台整列干净重挂，对**任何**重复-id 数据健壮。
- **macOS 窗口可拖动** — `titleBarStyle:"hiddenInset"` 的无边框窗口把拖动交给渲染层 `-webkit-app-region: drag`，但前端从未声明拖动区 → 整窗不可拖。补：TopNav 玻璃条加 mac-gated 拖动区 + 交互控件 `no-drag`（经已暴露的 `window.autoviralDesktop.platform` 判定；浏览器/Windows 不受影响，`-webkit-app-region` 是纯命中测试，零视觉改动）。
- **release.yml npm publish 不再静默跳过** — `publish-npm` 补 `needs: verify-version`：此前 `VERSION` 解析为空 → 幂等检查命中 latest → `npm publish` 自 0.1.0 后每版被静默 skip（0.1.1/0.1.3 从未上 npm）。0.1.4 起恢复正常发布（带 provenance），并加空-VERSION 硬失败守卫。

### Changed
- **Works 滚动性能** — 作品页滚动卡顿（合成/绘制过载，非 JS）。每卡 `backdrop-filter: blur` 改平涂（盖在不透明封面上近无差，省去 2N 个 blur 面）、环境渐变从 `background-attachment: fixed` 搬到 fixed `body::after` 层、噪点 + sticky 导航 `translateZ(0)` 提层。保留 editorial-glass 观感（computed-style 二确 light+dark + 滚动中）。content-visibility / 虚拟化留待 profiling 后续。

## [0.1.3] - 2026-06-05

**把 NLE 接通给 agent**（PRD-0004）。核心命题：任意 CLI agent 经 `autoviral` CLI 驱动剪辑，与人在 UI 操作产出一致——调研坐实"意图级编辑能力是 built-but-human-only"，本版把**写路径**补齐。keystone = [ADR-009](docs/adr/ADR-009-shared-composition-ops-core.md)：意图级 mutation 单一实现放 `@shared/composition/ops`，前端 store（immer draft）与后端 bridge（parsed object）共消费同一份纯函数，永久消除前后端漂移。21 个纵切片，每片切穿 schema→@shared ops→bridge/CLI→UI→test 端到端可验证；命题核心经两轮多纬度浏览器 E2E（agent-CLI 驱动 vs 人-UI 各纬度，截图 + DOM/computed-style 二确）证明。

### Added
- **意图级动词，CLI / bridge / store 共用同一份 @shared op**（[ADR-009](docs/adr/ADR-009-shared-composition-ops-core.md)）— `clip split`（指定时刻切两段 + keyframe 重基）/ `clip trim`（邻接 cap clamp + 最小时长）/ `clip set --track-id`（跨同 kind 轨移动 + 源轨孤儿 transition prune）/ `clip keyframe add/set`（opacity·scale·position 等可 keyframe，crossfade·Ken Burns 不再必败）/ `transition add/remove`（preset 来自共享 registry，afterClipId 非末位约束）/ `track add/remove` + `clip add --track-id` 精确定位 + overlay 片段真支持。前端 store 切到调 ops，现有 store 测试零断言改写即绿（零行为变化安全网）。
- **整份回写 + 写前预检** — `comp put <file|-stdin>`（万能逃生口，经 chokepoint zod 校验原子回写）/ `comp validate`（`@shared/composition/preflight` 纯校验返回 `{ok,errors,warnings}` 不落盘）/ 写端点 `--dry-run`（写 chokepoint 一处实现，跑 mutator + 校验但不落盘不广播），砍掉 agent "PUT→400→读 zod dump→猜" 的昂贵循环。
- **ASR 字幕接通最后一公里** — `captions generate [--language]` 调已有 ASR 把带时间码 segments 写进 text track（**无 text 轨自动建轨**）；Studio 加"生成字幕"按钮触发同流程；改完即刷新。
- **基础画面操作** — fit-fill 填充模式（cover / contain-letterbox / blur-bg）/ crop + 翻转镜像（`crop{x,y,w,h}` + `flipH/flipV`，Remotion preview + ffmpeg export **双消费**）/ 倒放（ffmpeg 真倒放 + preview 明示"仅导出生效"占位，不造假 WYSIWYG）+ 定格（`freezeAtSec` preview+export 双生效）/ 画布比例一键切换（9:16 ↔ 1:1 ↔ 16:9 ↔ 4:5，按比例适配既有 clip 的 static + keyframe 偏移）。所有新字段均有渲染器/ffmpeg 消费断言（防死字段）。
- **编辑安全网** — clip 级 undo + Cmd/Ctrl+Z（覆盖 split/trim/move/set/delete/ripple-delete/collapse-gaps）/ agent 可达 `checkpoint list` · `checkpoint restore`（**restore 前自动快照当前态防丢数据**，可逆）。
- **写路径改完即刷新** — 写 chokepoint `mutateCompositionFor`/`mutateCarouselFor` 成功落盘后经注入式 `onCommitted` 回调广播 `composition-changed`/`carousel-changed`，前端无需 reload 即反映（composition-ops 不耦合 event bus）；**carousel Editor 页接上 bridge 订阅**（此前结构性未接通）。`fs.watch` 降为兜底。
- **CLI agent 的 skill 自动保活** — `~/.claude/skills` 在两条更新路径都同步 bundled skill：npm 安装/更新（postinstall）与 Electron 桌面端更新（daemon boot），共用单一 `syncSkills` 核心（版本门控只在缺失或版本变时动手、缺失自愈、symlink 守卫尊重 dev live-edit、保留用户 `.yaml`/`permitted_skills.md`、裁剪旧布局 orphan）。外部 CLI agent（claude / codex / kimi / aider / gemini）加载的 autoviral 操作手册永远跟随包版本——含本版 `manual/{video,carousel}` 分轨重构。桌面端 boot 路径源目录解析（`skills/` 是 `dist/` 的 sibling，非 `dist/skills`）经真实重启 daemon 端到端验证：marker 写 `0.1.3`、安装态 `diff -rq` 归零。

### Changed
- **错误码契约两端打通** — 所有 4xx 校验错带 `code:4`，`client.ts` 按退出码分支：4xx→exit 4 / 5xx→exit 3 / `ask` timeout→124，agent 可据退出码做控制流。CLI 集成测试接入标准 gate。
- **平台 preset 真生效** — 尺寸 / 响度 LUFS / 码率下沉 `@shared` 单一事实源（前端 `PlatformPresetSection` 与 `runRenderPipeline` 读同一份）；`/export` 的 `preset` 真被应用，未知 preset → 400。
- **`carousel set-layer` 改为 PATCH** — deep-merge：只覆盖显式给的字段、保留其余 box/style，对齐 `clip set` 的 patch 语义（此前是 REPLACE，agent 改一字段会清掉全部样式）；新增 `--italic`/`--tracking` flag。
- **`whoami` 报告真实包版本**（此前硬编码 `BRIDGE_VERSION="0.1.0"`，改为读 package version 单一事实源）。

### Fixed
- **止谎** — 清掉文档/manual/recipe/CLI help 里照做必败的假承诺（必报 400 的 `clip set --keyframes`、运行时 throw 的 overlay 能力、指向已删脚本/不存在 UI 的假注释）；变量变速 export 静默回 1× 时发 warn；crossfade recipe 回填为真能跑通的 `transition add` 路径。
- **`clip set` 拒绝静默 strip** — `@shared/composition/patch` deep-merge + per-kind 白名单，解析嵌套路径（`transforms.scale` / `filters.brightness` / `style.color` / `fade.in` / `ducking.ratio` 等），未知/拼错 key 返 400 而非 zod 静默吞；CLI 按字段期望类型解析（`--color 000000` 不再被强转成数字 0）。
- **`captions generate` 默认路径对真实作品 400**（浏览器 E2E 实证）— 真实 composition 的音频 src 存为 served-URL 形 `/api/works/<id>/assets/...`，resolve 时被 path-traversal 守卫误杀；resolve 前剥前缀（门控在该前缀上，恶意 `../` / 绝对路径仍拒）。同步加固 captions 音频路径 path-traversal（resolve + 前缀校验）。
- **意图 op 写路径硬伤**（各片对抗复审 + E2E 加固）— `splitClip` 浅拷贝致两段 clip 共享嵌套对象引用（agent split 后 patch 一段会污染另一段）→ 双宿主安全的 read-through cloneDeep；ripple-delete / collapse-gaps 漏进 undo 栈（数据丢失）；`transition` durationSec / `keyframe` atSec / `freezeAtSec` 时长越界未拒；`CompositionOpError` 经 store toast surface 而非静默 no-op。

## [0.1.2] - 2026-06-04

**开箱即用与工位体验**（PRD-0003）。两条主线：① 把"装完到处静默坏"的依赖摩擦清零——app 一律从受管位置解析二进制，不再赌用户 shell 的 PATH；② 把工位从"原语齐了 UX 没接上"补成顺手——素材库生成即见/能删/能拖、agent 能"看见"自己的产出、一个 work 能并存多个对话/终端。会话 keying 的 keystone 选择经核验后落 [ADR-008](docs/adr/ADR-008-multi-session-chat-terminal.md)。

### Added
- **依赖自检 + 自举**（PRD §1）— `autoviral doctor`（✓/○/✗ 依赖就绪表 + 解析来源 + 修复指引；核心缺失退非零）/ `autoviral setup [--heavy]`（带进度安装 ffmpeg/ffprobe + TTS venv，重型懒装），用户端 CLI 与 agent-bridge CLI 双就位。桌面端经 electron-builder `extraResources` 装机即带 ffmpeg。Python venv（`edge-tts` + `stable-ts`）首用自动建好；playwright chromium 首用懒装。
- **Gemini-via-OpenRouter TTS**（PRD §2）— 主力 TTS 改 `google/gemini-3.1-flash-tts-preview`（走 OpenRouter `/v1/audio/speech`），`edge-tts` 退为零 key fallback；翻转 fallback 链为 Gemini→edge，退役 `api.openai.com` 直连。
- **素材库交互对齐 pro 编辑器**（PRD §3）— 生成图/视频**不刷新即进库**；库内素材**删除**（删盘 + 级联清引用 clip，两步确认）；**库→时间线拖拽**（类型约束：video→video / audio→bgm / image→overlay，非法落点拒绝 + 提示）；**同类型轨道间 clip 拖拽**（专用 grip handle，保留 body-scrub）。
- **`autoviral snapshot`**（PRD §4）— 截当前画面为 PNG 让 agent 用 Read"看见"产出做视觉自检：video 走 Remotion `renderStill` 当前帧（文字层合成进帧）、carousel 返回当前 slide（base-only 时显式标注 `textLayersComposited:false`）。
- **多对话 / 多终端会话**（PRD §5，[ADR-008](docs/adr/ADR-008-multi-session-chat-terminal.md)）— 一个 work 内并存多个 Chat / Terminal 会话：新建保留原有、可跳回、刷新恢复；Chat 会话清单走 `.sessions.jsonl` sidecar + 新 `/api/works/:id/sessions` 端点，Terminal 会话客户端 namespaced；终端 pty 跨重连存活 + scrollback 回放 + respawn。

### Changed
- **ffmpeg/ffprobe 受管解析**（PRD §1）— 新 `src/infra/deps.ts`：解析优先级 env → 受管 `~/.autoviral/bin` → vendored（ffmpeg-static / @ffprobe-installer 绝对路径）→ 系统 PATH。精简 PATH（无 `/opt/homebrew/bin`）下渲染/导出/波形/TTS 转码仍可用；`ensureSpawnPath` 过渡兜底共存。
- **会话 keying `(workId)` → `(workId, sessionId)`**（[ADR-008](docs/adr/ADR-008-multi-session-chat-terminal.md)）— `WsBridge` 嵌套 `Map<workId, Map<sessionId, WsSession>>`、WS 路由带 sessionId、PtyPool 同改；旧单 `cliSessionId` 懒迁移为首会话。focus（playhead/选中）仍 work-scoped 共享。[ADR-005](docs/adr/ADR-005-dual-chat-entry-layout.md) single-session 范围被本 ADR 在多会话维度收窄。
- **不变量 #2 成真** — TTS 退役 `api.openai.com` 直连后，外部网关确为 OpenRouter 唯一；CONTEXT.md 措辞同步。

### Fixed
- **snapshot/export 渲染的相对 src**（PRD §4 E2E）— renderStill / mp4 export 渲染前未把 clip.src 改写成 `http://localhost:<port>/...` 绝对 URL，headless Chromium 无 origin 加载不了视频 → 无限挂起；改写函数还会把已是 `/api/works/...` 的 src 双包裹成 404——一并修复（两路径共享）。
- **Gemini TTS 只支持 pcm**（PRD §2 E2E）— OpenRouter 该模型拒 `response_format:mp3`；改为请求 pcm 再用受管 ffmpeg 转码 mp3，并补空 body / 非音频 content-type 守卫（失败回落 edge）。
- **素材库 / 字幕 ASR 自举漏洞** — venv 就绪判定漏 `stable-ts`（edge 有、stable-ts 缺时 ASR 静默 503）+ youtube-ingest ASR 走裸 python3，均修。
- 生成素材不自动进库（generate.ts 不发事件 + 前端无 `asset-added` case，两端补齐）。

## [0.1.1] - 2026-06-03

**可扩展性奠基与结构清债**（PRD-0002）。对外可见行为零破坏——破坏面刻意压在内部结构 + 文档治理：把"加内容类型 / 加 provider"从跨 5+ 文件的散弹手术降维成"往中央注册表加一条"。落地三个深模块骨架 + 清掉一批工程债 + 补齐文档双轨治理。三个 keystone 架构决策经 grill-with-docs 压测后落 [ADR-006](docs/adr/ADR-006-content-type-registry.md) / [ADR-007](docs/adr/ADR-007-single-media-provider-registry.md)。

### Added
- **ContentTypeRegistry**（`src/shared/content-types/`，[ADR-006](docs/adr/ADR-006-content-type-registry.md)）— 内容类型从写死的二元枚举（`WorkType`）抽成中央清单（`getContentType` / `listContentTypes`）。`DELIVERABLES`、路由、create 按钮、checkpoint 目标全部派生自注册表；加第三种内容类型从"改 5+ 文件 + 复制视图树"降为"加一条注册项"。genuine type-dispatch 字面量从 34 处降到 0。
- **carousel 协议层 + 知识层**（关 PRD 唯一 high gap）— `autoviral carousel add-slide` / `set-layer` CLI 命令（走 bridge → 服务端 zod 校验，对齐 `clip add/set` 模式）+ `skills/autoviral/manual/carousel/02-schema.md` 完整 schema 文档。agent 编辑图文不再凭一行 prose 盲写 carousel.yaml。
- **单一 MediaProvider registry**（`src/providers/registry.ts`，[ADR-007](docs/adr/ADR-007-single-media-provider-registry.md)）— image / video / TTS 四套并行机制收敛为一个 capability-tagged 注册表（`getProvider(cap,name)` / `getDefaultProvider(cap)` / `listProviders(cap?)`），声明式 `envKey`，单一 `initProviders` 装配。兑现不变量 #2。
- **升级骨架**（`src/shared/migrations/`，深模块 ③）— composition / carousel schema 加 optional `schemaVersion` 字段 + 顺序迁移注册表骨架；收编现有内联迁移器与独立迁移脚本。
- **`AGENT.md`** — 非-Claude CLI agent（codex / kimi / gemini / aider）的项目级入口，兑现 agent-agnostic 承诺。
- **文档治理** — `docs/adr/README.md` ADR 索引 + 状态机；CONTRIBUTING「Version Bump Checklist」+「运维 Known Gotchas」锚点。
- **docs-drift 守卫测试**（`src/docs-drift.test.ts`）— prompt / SKILL.md 里的 manual 引用一旦悬空即变红，subdir-aware。
- **CI web 类型门** — `typecheck:web`（web 最严 tsconfig：`noUnusedLocals` 等）首次入 CI。

### Changed
- **carousel schema 提升到 `src/shared/carousel.ts`**（[ADR-006](docs/adr/ADR-006-content-type-registry.md)）— 从 web-only 变为 server / CLI / migrations 可达；web `editor/types.ts` 留 re-export shim，旧 import 零改动。
- **skill manual 按内容类型 co-located 重构** — `manual/{_shared,video,carousel}/` 子树 + `SKILL.md` 按 `work.type` 分发；recipes 分区 `recipes/{video,carousel}/`。
- **`api.ts` god-module 按域拆分** — 3270 行 / 80 路由 → `src/server/routes/*.ts` 九个子 router（works/render/generate/audio/trends/analytics/assets/system/_shared），主文件 64 行。端点路径 / 行为 / 契约零变化。
- **`src/` root 归类** — 平铺模块归到 `src/infra/`（config/logger/paths）+ `src/domain/`（work-store/memory/analytics-collector/audio-tools）。
- 移除 `autoviral start --pm2` 路径（服务器部署时代残留，desktop-class app 不适用）。

### Removed
- **runway / sora / kling video stub providers** — 产不出真实输出、隐含直连厂商，违反不变量 #2；video 诚实 OpenRouter-only（seedance）。
- **化石清理** — `svelte.config.js`（React 19 项目无 svelte 依赖）/ 孤儿 `web/package-lock.json` / commit 进仓的 `.vite/` 缓存 / `test-studio.mjs` / `ecosystem.config.cjs`。
- 发布构建不再把 `*.test.ts` 编进 `dist/`（新 `tsconfig.build.json`）。

### Fixed
- README drift — 删除已不存在的 `modules/` 脚本、`check_providers.py`、`/invoke` 协议、多 provider 表（Dreamina/即梦/Lyria）等死引用，对齐 0.1.0 现状。
- `ci.yml` 谎称 `tsc --noEmit` 已绿的假注释。

## [0.1.0] - 2026-06-02

首个公开基线。本版本将 AutoViral 重新定位为**创作者工位 + agent-agnostic 操作协议**，修复"AutoViral 是被 Claude Code 驱动的视频工具"这一旧叙事；任何在 Studio 终端面板里运行的 CLI agent（claude / codex / kimi / gemini / aider / cursor-agent）都可通过加载 operator-manual skill 并调用 `autoviral` CLI 来驱动工位。包身份一并重置为 `autoviral@0.1.0`。

### Added
- **Terminal panel** replaces the bespoke ChatPanel in Studio (`web/src/features/terminal/`). xterm.js + node-pty + WebSocket bridges the user's real local shell into the Studio left column.
- **`@autoviral/cli` (`cli/autoviral/`)** — the agent-facing bridge. Read commands (`whoami / docs / comp show / list clips / list assets / comp diff`), write commands (`clip add / set / remove`), UI commands (`select / seek / play / pause / toast / progress / ask`), and tasks (`export / render`). Exit-code semantics 0/1/2/3/4/124/127.
- **Bridge HTTP+WebSocket protocol v1** (`/api/bridge/v1/*` + `/ws/bridge/:workId` + `/ws/terminal/:workId`). Loopback-only, cross-origin upgrades rejected. Spec at `docs/archive/specs/2026-05-14-agentic-terminal-bridge-protocol.md`.
- **Operator manual skill** (`skills/autoviral/`) — agent-agnostic markdown: SKILL.md + 6 manual files + 5 recipes + 2 contracts. `autoviral docs` serves the same content as a runtime command.
- **Approval gate** — `autoviral ask "..." --yes-no` blocks until the user clicks YES/NO in a Studio modal; CLI exit code maps to user choice (0=yes, 1=no, 2=cancelled, 124=timeout).
- **File watcher** — `composition.yaml` mtime triggers `composition-changed` event broadcast to Studio so external edits re-render the UI without manual refresh.
- **`autoviral comp diff`** — unified diff between current `composition.yaml` and the last-written baseline.
- **Render progress strip** in Studio (`RenderProgressBar.tsx`) wired to `ui-render-progress` events from the export pipeline.
- **Toast variant set** extended (`info / success / warn / error`) with kind-dot indicator in editorial glass styling.
- **Terminal auto-reconnect** with 1s/2s/5s backoff + manual reconnect button when give-up.
- **Electron 桌面壳**（`desktop/main.ts`）—— thin host 包裹现有 Node daemon：用 `ELECTRON_RUN_AS_NODE` 内嵌 Node spawn daemon、health-check 端口 3271 后再开 `BrowserWindow`；single-instance 锁、退出时优雅 kill daemon、login-shell PATH 恢复（让 Studio 内 agent 的 `claude` 能解析）。
- **`electron-builder` 桌面打包**（`desktop/electron-builder.yml`）—— mac dmg+zip（arm64）/ win nsis（x64）；asar 内含 `dist/package.json` + `cli/autoviral` + skills，native module unpacked，`@electron/rebuild` beforeBuild 重编 Electron-ABI 原生模块。
- **「双击即用」资源 bundle** —— extraResources 随包 ffmpeg + ffprobe + Chrome Headless Shell + 预构建 Remotion bundle；daemon 经 `FFMPEG_PATH`/`FFPROBE_PATH`/`AUTOVIRAL_CHROMIUM_PATH`/`AUTOVIRAL_REMOTION_BUNDLE` 指向 bundled 制品，首次运行无需用户装 ffmpeg、无运行时 webpack、无只读 asar 下载 Chromium。
- **自动更新** —— `electron-updater` GitHub publish provider 接入；0.1.0 unsigned，mac `autoDownload` 关闭（降级为检查+通知），win nsis 可更新但每次重新触发警告。
- **npm 包 `autoviral@0.1.0` 自包含** —— 根包改名、丢弃历史 `autocode` bin、tarball 排除 tests/maps、`prepublishOnly` 构建 backend+cli、`files` 一并 ship `cli/autoviral`（`npm i -g autoviral` 自给自足）、`postinstall` 守卫使 `npm ci` 在干净 checkout 下存活；`@autoviral/cli` 丢弃 undici 改用 Node 20 global fetch、`yaml` 提升到根依赖。
- **GitHub Actions** —— `ci.yml`（ubuntu 上 build + test:web + test:server，装 ffmpeg 跑音频集成测试）；`release.yml`（`v*.*.*` tag → version-guard → 桌面矩阵 mac+win electron-builder publish → npm publish `autoviral` with provenance → CHANGELOG 抽取的 gh release notes）。

### Changed
- **包身份重置**：`@nanxingw/autocode-cli@0.2.0` → `autoviral@0.1.0`（unscoped）；bin 去掉历史 `autocode` 别名，仅保留 `autoviral`；CLI `.name()`/`.version()` 与用户提示统一为 `autoviral`。
- **文档结构**：`docs/superpowers/` 整体迁入 `docs/archive/`（保留全部 61 份 plans/specs/notes），仓内路径引用一并更新。
- **Skill content scope**: editorial taste content (Brand Personality, rubrics, evaluator criteria) and module scripts (subtitle burn-in, beat detection, smart crop, CLIP asset search, AI image generators) **removed from `skills/autoviral/`**. They were workstation-mis-located content. Preserved in git tag `pre-skill-rewrite-snapshot` for future sibling-skill packaging.
- **Render pipeline audio**: `normalizeLufs` pass-2 now outputs AAC (was PCM_S16LE) with `+faststart` for video containers, fixing browser playback stutter on exported MP4s.
- **VideoTrackRenderer**: opacity keyframes now applied (was dropped on the floor — Overlay track supported it, Video did not). Enables real CSS-alpha crossfade when adjacent clips overlap.

### Removed
- `web/src/features/studio/panels/Chat/` (entire ChatPanel + sub-components + WebSocket chat protocol)
- `skills/autoviral/{taste,modules,references}/` — see snapshot tag
- `GET /api/works/:id/rubric/:module` → **410 Gone**
- `POST /api/audio/beats` → **410 Gone**
- `burnSubtitles()` throws — use `composition.captionStrategy="overlay"` + `composition.captions` for in-render CaptionsLayer
- `buildClipIndex / searchClipIndex` return `{ stub: true, reason: "clip_index_removed_in_refactor" }`

### Fixed
- Terminal font rendered as Inter (italic-serif fallback) instead of JetBrains Mono on first paint. Three-pronged fix: literal font stack (no `var()` in xterm options), `await document.fonts.ready` before Terminal construction, CSS pin `font-family` on `.xterm` wrapper.
- Terminal showed double-image ghost halos on macOS retina. Three independent bugs: WebglAddon DPR atlas upsampling (removed addon, default canvas renderer is DPR-aware), ResizeObserver firing `fit()` on zero-size frames (RAF-coalesced + zero-size guard + dedup on physical pixels), React Strict Mode double-mount creating two overlapping Terminal instances in same DOM node (`termRef.current` guard + full cleanup with ref nulling). _Diagnosis credit: codex:codex-rescue subagent independent second-opinion after two main-session fix attempts._

### Implementation notes
- 60+ commits across 6 phases on `refactor/agentic-terminal`. Tags: `phase-0-foundation`, `phase-1-terminal-mvp`, `phase-2-cli-readonly`, `phase-3-bridge-complete`, `phase-4-skill-rewritten`, `phase-5-polish-complete`, `pre-skill-rewrite-snapshot` (taste/modules archive), `refactor-complete` (final).
- Test matrix at branch HEAD: server 339+/342 (2 pre-existing orphan D3-cleanup fails in config.test.ts, unrelated to refactor); web 608/626 (14 pre-existing orphan fails in dirty-tree files outside refactor scope + 4 transitively affected by toast-store schema extension); CLI 10/10.
- Plan + spec under `docs/archive/{plans,specs}/2026-05-14-agentic-terminal-*.md`.
- node-pty spawn-helper executable bit auto-repaired via `postinstall` (macOS arm64 prebuild perm-loss workaround).

## [0.2.0] - 2026-03-09

> 历史记录：此版本为前身 AutoCode fork（npm 包 `@nanxingw/autocode-cli`）。项目于 0.1.0 重命名为 AutoViral 并重置版本号。

### Added
- Multi-agent parallel evolution architecture (Context Agent, Skill Agent, Task Agent)
- Proactive task scheduling system with cron and one-shot task support
- Bidirectional skill-task linkage: tasks emit skill_needs signals, skills enhance task execution
- skill-creator integration: Skill Agent now uses skill-creator methodology for all skill work
- External skill search via SkillHub (skillhub.club) before creating new skills
- AutoCode Dashboard: renamed from Skill-Evolver Dashboard

### Changed
- Renamed project from skill-evolver to AutoCode
- npm package: skill-evolver → @nanxingw/autocode-cli (autocode-cli was taken by unrelated project)
- CLI command: skill-evolver → autocode (old command preserved as alias)

### Fixed
- postinstall no longer overwrites runtime-updated permitted_skills.md
- task-planner runtime_guide.md: corrected task file path (centralized tasks.yaml)

## [0.1.7] - 2026-03-04

### Added
- Initial skill-evolver release with single-agent evolution cycle
- user-context, skill-evolver, task-planner core skills
- WebSocket dashboard for real-time monitoring
