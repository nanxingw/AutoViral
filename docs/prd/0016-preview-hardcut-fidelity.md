# PRD-0016 · 预览硬切边界保真：warm handoff 与单调时钟

**Status: Proposed (2026-07-15) → Implemented (2026-07-15) · 目标版本：v0.2.1（与 PRD-0015 同版）**
> 交付实况：S1-S4 全交付（红基线 → premount → 音频语义 → 压力复测）。#98 切点级症状归零（切点回放清零、video 负跳 0、waiting 40→4、帧钟单调）；非切点 BGM/VO ~600ms 音频漂移为独立残留 → [issue 033](../issues/033-audio-track-drift-replay.md)。

> Source: GitHub issue [#98](https://github.com/nanxingw/AutoViral/issues/98)（用户 2026-07-15 报告，含 12×4s CFR 最小复现夹具与三个排序假设）· 本地镜像 [docs/issues/032](../issues/032-preview-hardcut-stutter-replay.md)。
> 根因调查：2026-07-15 Workflow `wf_ac749ac2-c4a`（Remotion 4.0.459 源码取证 + Studio 媒体元素盘点（codex）+ 真实事故 work 浏览器插桩（Opus）+ 双路对抗验证，全部 partial-confirmed 后经主线亲验修正）。
> Issue 切片：随 `to-issues` 落 `0016-preview-hardcut-fidelity-issue-slices.md`（docs-only tracker）。
> 纪律不变：测试先行（红基线夹具先证红）；E2E 走 Workflow 多纬 subagent。

---

## Problem Statement

用户在 Studio 预览里播放 12 个背靠背 4s 硬切视频 clip（`w_20260715_0035_20d` 前 48s，全部 720×1280 H.264 CFR 24fps、in:0/out:4、无转场无图片 clip），每个切点都出现**短暂卡顿 + 视觉上"重放上一段约 0.x 秒"**。导出侧抽查 5 个边界无重复帧对——这是**预览独有**的保真缺陷。Studio 的预览是人机协作的唯一视觉真相（WYSIWYG 是 v0.2.0 的灵魂验收），预览在最基本的硬切上抖动，直接瓦解"预览即成片"的信任。

### 根因（机制家族已证实；边界级主从判别留给红基线夹具）

**架构前提（全部亲验）**：预览用 Remotion 原生 `<Video>`（isRendering 分支；OffthreadVideo 会榨干硬解码器，2026-05-08 决策不回退）；每个无转场 clip 是独立 `<Sequence>`，**无 premountFor/postmountFor**；每个预览 `<Video>` 带 `acceptableTimeShiftInSeconds: 1.2` + `pauseWhenBuffering: true`；BGM/VO 音频轨与视频自带 AAC 原声（`sourceAudio.enabled` 默认 true）同场播放，AudioTrackRenderer 未传 pauseWhenBuffering。

**触发器（remotion@4.0.459 源码证实）**：切点帧上一 Sequence 卸载、下一 Sequence 同一 commit 才挂载（`Sequence.js:182` 无暖场重叠窗）；新 `<video>` 此刻才拿到 src，`readyState < HAVE_FUTURE_DATA` 即 `blockMedia()` + `.load()`（`use-media-buffering.js:109`）；Player 全局未静音时 buffering block 冻结 rAF 帧钟（`@remotion/player use-playback.js:150`）——**这是切点 stall 的直接机制**。

**回放机制（源码证实 + 应用内运行时演示）**：Remotion 的同步循环在播放中、漂移 ≤1.2s 时**完全不纠偏**（`use-media-playback.js:167`，非"轻推"）——媒体元素可自由跑赢帧钟；而当"其他媒体在 buffering"（正是切点新元素触发的全局 block）时，纠偏阈值骤降为 0.15s 并直接赋值 `currentTime = shouldBeTime`（`use-media-playback.js:200-219` + `seek.js:12`）——**超前的元素被拽回帧钟时间，用户看到/听到已播过的 0.x 秒重放**。插桩在真实 work 上捕获了该机制开火实录：活跃元素 ct 前进到 1.116 后被拽回 0.1（因 tab 遮挡 rAF 节流诱发、非切点处——证明机制真实存在于本应用，切点处的主从判别由红基线夹具完成）。带声视频（本夹具默认形态）的音频元素同样落入该分支——音频重放与视觉重放同源。

**放大器（非独立根因）**：24 asset / 22 clip 的解码与网络压力（AssetSidebar 24 个 `<video>`、filmstrip 抽帧、聊天附件無虚拟化等）延长新元素 ready 时间，扩大 stall 与漂移窗口。#37（预览死锁）的 mediaLoadGate（4 并发信号量）已缓解 thumbnail 侧，Player 刻意不在 gate 内。

**已排除**：转场实现（夹具无转场）、`out:4` 处的源时间计算错误（`use-current-frame.js` 的 Sequence 重置是设计公式，无算术回退）、"旧帧滞留在 compositor"假说（零代码支撑，对抗验证剔除）、VFR/非零 start_time/混编码（夹具全同构 CFR）。

**修复抓手（4.0.459 已验证可行）**：`<Sequence premountFor>` 在切点前 N 帧挂载新元素——premount 态会真正 `.load()` 暖场但**显式跳过全局 buffering**（`use-media-buffering.js:20-43`）且子树时间冻结不预播（`freeze.js:46-54`）——一刀移除"切点冷挂载"这个两个症状共同的触发器。postmountFor 只延旧不暖新且加重资源占用，不采用。

## Solution

一句话：**给每个视频 clip 的 Sequence 加 premount 暖场窗，让切点交接前新元素已 ready；收紧音频轨的 buffering 语义防"回放"；用可插桩的浏览器回归夹具把"跨切点单调播放"钉进 CI 门**。

用户视角的最终状态：12×4s 硬切夹具从 3.2s 播到 45s，每个切点画面与声音单调前进——不停、不闪、不重放；20+ asset 的重负载 work 同样成立；该保真由自动化浏览器回归夹具（循环跨界 ≥20 次，断言无 waiting、无同元素 currentTime 负跳、帧钟单调）长期看守。

## User Stories

1. As a 创作者, I want 预览跨硬切点时画面单调前进不卡不重放, so that 我能靠预览判断成片节奏（快切视频每 4 秒一个切点，抖一下节奏就毁了）。
2. As a 创作者, I want 切点处音频（BGM/旁白/原声）不重放上一句, so that 审片时不被"跳针"式重放误导。
3. As a 创作者, I want 重素材库（20+ 视频 asset）的 work 预览同样流畅, so that 项目做大后预览不退化。
4. As a chat/CLI agent, I want 预览播放行为可信, so that 我据预览向用户汇报的"节奏没问题"是真的。
5. As a 维护者, I want 一个自动化浏览器回归夹具看守切点保真, so that 未来改 Player 配置/升 Remotion 时回归被 CI 抓住而非用户抓住。
6. As a 维护者, I want 预览媒体元素盘点与 buffering 语义有文档与测试锚点, so that 下次"预览抖动"类 issue 不用从零考古。

## Implementation Decisions

1. **红基线夹具先行（切片 S1）**——浏览器插桩回归：12×4s 夹具 work、可见 tab（规避 rAF 节流陷阱：激活窗口 + rAF 心跳 ≥30/s 门控后才判定）、跨切点循环 ≥20 次，采集每元素 mount/canplay/waiting/seeking 事件与 currentTime 序列 + 帧钟读数；断言三条：无 waiting/stalled、无同元素 ct 负跳（>0.05s）、帧钟单调。**先在当前实现上证红**（复现 stall/负跳并留边界级判别数据），修复后转绿；同时带静音诊断开关（全局静音 vs 非静音两跑）判别 stall/回放主从。
2. **premount 暖场（切片 S2）**——视频 clip 的外层 `<Sequence>`（含 TransitionSeries 包裹路径的外层）加 `premountFor`（起点值 ≈1s=fps 帧，常数集中定义）；只影响预览（isRendering 路径 Sequence 行为不变——premount 只在非 rendering 生效，见取证）；验证 blur fitMode（双元素）与 freeze/entrance 路径不被暖场破坏。
3. **音频轨 buffering 语义（切片 S3）**——AudioTrackRenderer 补 `pauseWhenBuffering`（与视频一致，音频未 ready 同样进 block 而非静默漂移）；复审 `acceptableTimeShiftInSeconds: 1.2`（premount 后冷挂载漂移源消失，评估是否收窄回默认以缩短"回放"可及幅度——由 S1 夹具在两个值下实测定夺，结论进 ADR 或代码注释）。
4. **资源压力复测与盘点修正（切片 S4，轻量）**——premount 会让相邻两 clip 元素共存（稳态 1→2），用 S1 夹具在 24-asset work 上复测确认无解码器预算回归（历史教训：OffthreadVideo 池化曾致 ~3s hitch）；把调查修正后的媒体元素盘点（含 WorksGrid 封面、useAudioAudition 单例、ScriptTab/ScriptModal 嵌入等遗漏挂载点）落进 docs 供后续 gate 决策。
5. **不动的东西**：预览用原生 `<Video>` 的决策不回退；`pauseWhenBuffering: true` 保留（去掉它 = 陈旧帧静默呈现，比 stall 更不诚实）；导出路径零改动（缺陷预览独有）。

## Testing Decisions

- **好测试测外部行为**：夹具断言"用户可感知的播放单调性"（事件流 + ct 序列 + 帧钟），不断言 Remotion 内部实现；premount 的单测断言 Sequence props 与既有渲染快照不回归（transitionIn/freeze/blur 路径各一）。
- **先证红**：S1 夹具必须先在当前实现上复现（stall 或负跳至少其一，且留下判别数据），才允许 S2 动手。
- **先例**：浏览器插桩脚本模式沿用本次调查 probe agent 的注入探针（MutationObserver + 媒体事件 hook + 100ms poll）；组件测试沿用 `VideoTrackRenderer.render-branch.test.tsx` 的 props 断言形态；遮挡陷阱的门控沿用既有教训（rAF 心跳门控 + osascript activate）。
- **E2E 收口**：并入两 PRD 联合多纬 E2E（纬度⑥：12×4s 夹具跨切点播放，截图 + 探针数据二确）。

## Out of Scope

- **Player 池化/预解码架构改造**（如自管双 video 元素交叉淡入）——premount 不够时再立项。
- **filmstrip/AssetSidebar 的进一步 gate 调参**——本 PRD 只复测确认不回归，gate 策略优化另立。
- **导出侧任何改动**——导出无此缺陷（026 已修的 OffthreadVideo 路径不动）。
- **Remotion 升级**——4.0.459 能力足够，升级风险独立评估。

## Further Notes

- **上游依赖**：premountFor 语义、buffering block、0.15s/1.2s 纠偏分支全部是 remotion@4.0.459 行为（node_modules 源码逐行核验，对抗验证修正过 3 处行号漂移与 1 处误引）；升级 Remotion 时 S1 夹具是回归网。
- **诊断陷阱存档**：插桩若在遮挡 tab 下跑，rAF 节流会诱发与 #98 同形的 ct 回拽假象（本次调查亲历）——所有后续边界插桩必须先过 rAF 心跳门控；对抗验证还指出 AudioContext-resume 门控（`use-playback.js:124-149`）可能比 hidden-timeout 更早停钟，插桩前先全局静音可绕开。
- **与 #37 的关系**：同资源族不同故障——#37 是 thumbnail 洪峰把 Player 饿死在启动（已修 mediaLoadGate），#98 是切点冷交接；S4 的复测同时看守两者不互相回归。
