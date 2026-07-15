# PRD-0016 · Issue slices（docs-only tracker）

> Parent: [PRD-0016](0016-preview-hardcut-fidelity.md) · GitHub #98 · 全部 `ready-for-agent` · 2026-07-15 切片
> 纪律：S1 红基线**必须先证红**（复现 stall/负跳）才允许 S2 动手；浏览器插桩一律 subagent 执行且先过 rAF 心跳门控（遮挡陷阱见 [032](../issues/032-preview-hardcut-stutter-replay.md)）。
> Wave 计划：W1 = S1 → W2 = S2 → W3 = S3 ∥ S4。

---

## S1 · 红基线：切点插桩回归夹具（AFK）

**What to build**：可重复执行的浏览器插桩回归（脚本 + 文档化跑法，供本 PRD 证红/转绿与 E2E 收口复用）：打开 12×4s 硬切夹具 work（`w_20260715_0035_20d` 或按其 composition 形状新建等价夹具），**可见 tab + rAF 心跳 ≥30/s 门控后**才开始判定；注入探针（MutationObserver + 媒体事件 hook + 100ms poll，沿用 wf_ac749ac2-c4a probe 脚本），从 3.2s 播过 4/8/12s 切点循环 ≥20 次；产出结构化判据：① waiting/stalled 事件计数；② 同元素 currentTime 负跳（>0.05s）清单；③ 帧钟单调性；④ mount→canplay 延迟分布。附静音诊断开关（全局静音/非静音各一跑）判别 stall vs 回放主从。**当前实现上必须红**（至少一条断言 fail 并留下边界级判别数据，回填 032 issue doc）。

**Acceptance criteria**
- [ ] 夹具在当前实现上证红，边界级判别数据（stall vs 负跳主从）回填 [032](../issues/032-preview-hardcut-stutter-replay.md)
- [ ] 断言脚本可重复执行（一条命令/一段文档化流程），非一次性手工操作
- [ ] rAF 心跳门控生效（遮挡环境下拒绝判定而非产出假 fail）

**Blocked by**: None - can start immediately

## S2 · premount 暖场（AFK）

**What to build**：视频 clip 的外层 `<Sequence>`（普通路径与 TransitionSeries 包裹路径的外层）加 `premountFor`（≈1s = fps 帧，常数集中定义并注释依据）；只影响预览（premount 仅非 rendering 生效，rendering 路径零变化）；blur fitMode（双元素）、freeze、entrance/transitionIn 路径在暖场下渲染正确。S1 夹具转绿（waiting=0、负跳=0、帧钟单调）。

**预设测试（先落盘证红）**：`web/src/features/studio/composition/tracks/__tests__/VideoTrackRenderer.premount.test.tsx` — ① 普通 clip Sequence 带 premountFor=fps；② TransitionSeries 外层 Sequence 同样带；③ isRendering 分支渲染树与现状快照一致（回归）；④ freeze/blur/entrance 各路径 props 不被破坏。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] S1 夹具三断言转绿（waiting=0、同元素负跳=0、帧钟单调），跑法与数据存档
- [ ] 既有 web 套件全绿（npm run test:web 一次性运行）

**Blocked by**: S1

## S3 · 音频轨 buffering 语义 + 漂移阈值复审（AFK）

**What to build**：AudioTrackRenderer 补 `pauseWhenBuffering`（与视频一致）；用 S1 夹具在 `acceptableTimeShiftInSeconds` = 1.2 与默认（0.65）两档下实测（premount 已就位的前提下），据数据决定收窄与否，结论与数据写进代码注释或 ADR 短文（引用 R47-fix5 的历史动机，说明为何改/不改）。

**预设测试（先落盘证红）**：`web/src/features/studio/composition/tracks/__tests__/AudioTrackRenderer.buffering.test.tsx` — ① audio 元素带 pauseWhenBuffering；② 既有 volume/fade 行为不回归。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] 阈值决策有 S1 夹具两档实测数据支撑并存档
- [ ] S1 夹具静音/非静音两跑均绿

**Blocked by**: S2

## S4 · 资源压力复测 + 媒体元素盘点落档（AFK · 轻量）

**What to build**：premount 使相邻 clip 元素稳态共存（1→2），在 24-asset 事故 work 上用 S1 夹具复测：无解码器预算回归（无 ~3s hitch 族症状、waiting 仍为 0）、AssetSidebar 开/关两态各一跑。把调查修正后的媒体元素盘点（含 WorksGrid 封面、useAudioAudition 单例、ScriptTab/ScriptModal Markdown 视频嵌入、导出 OffthreadVideo 独立标注等遗漏点）落 `docs/research/2026-07-15-studio-media-element-inventory.md` 供后续 gate 决策。

**Acceptance criteria**
- [ ] 24-asset work 复测数据存档（AssetSidebar 开/关两态）且无回归
- [ ] 媒体元素盘点文档落档（含本次对抗验证补全的遗漏挂载点）

**Blocked by**: S2
