# 032 · Studio 预览硬切边界卡顿/回放 ~0.x 秒（GitHub #98 本地镜像）

**Severity: HIGH（WYSIWYG 命题的预览侧信任缺口） · triage: `ready-for-agent`（根因机制已证实，收编 [PRD-0016](../prd/0016-preview-hardcut-fidelity.md)） · 记录日期: 2026-07-15 · 根因确认: 2026-07-15**

> GitHub: https://github.com/nanxingw/AutoViral/issues/98（用户直接在 GitHub 创建，本文件为 docs-only tracker 镜像 + 根因回填）
> 复现夹具与排除清单见 GitHub issue 原文（12×4s CFR 硬切、无转场、导出侧无重复帧）。

## 根因（已证实 2026-07-15 · Workflow `wf_ac749ac2-c4a` 三路调查 + 双路对抗验证 + 主线亲验）

**症状 = 同一触发器的两个下游**：切点冷挂载（clip Sequence 无 premountFor）→ 新 `<video>` 未 ready → `pauseWhenBuffering:true` 把它抬升为全局 buffering block、未静音时冻结帧钟（**stall**）；block 期间"其他媒体"（BGM/VO 音频、超前的视频元素）落入 Remotion 的 0.15s 激进纠偏分支被直接赋值拽回帧钟时间（**回放已播过的 0.x 秒**）。`acceptableTimeShiftInSeconds: 1.2` 的自由漂移窗（窗内播放中零纠偏）是回放幅度的弹药库。

关键证据（remotion@4.0.459 已装源码 + 应用内插桩）：
- `node_modules/remotion/dist/cjs/Sequence.js:182` — 切点无暖场重叠窗（上一 Sequence 卸载与下一挂载同 commit）。
- `use-media-buffering.js:109` — 新元素 `readyState < HAVE_FUTURE_DATA` → `blockMedia()` + `.load()`。
- `@remotion/player/.../use-playback.js:150` — 未静音时 buffering 冻结 rAF 帧钟。
- `use-media-playback.js:167 / :200-219` + `seek.js:12` — 播放中 ≤1.2s 漂移零纠偏；"其他媒体 buffering"时阈值 0.15s 直接 `currentTime = shouldBeTime`（可向后）。
- 插桩实录（work `w_20260715_0035_20d`）：活跃元素 ct 1.116 → 被拽回 0.1（rAF 节流诱发、非切点——证明向后 seek 机制在本应用真实开火；切点级主从判别由 PRD-0016 S1 红基线夹具完成）。
- 夹具前提修正：0-48s 段并非纯视频——BGM+VO 音频轨在场，且 Seedance MP4 自带 AAC、`sourceAudio.enabled` 默认 true，AudioTrackRenderer 未传 pauseWhenBuffering——音频与视觉回放同源。

**已排除**：转场实现、`out:4` 源时间算术错误（Sequence 重置是设计公式）、"旧帧滞留 compositor"假说（零代码支撑）、VFR/非零 start/混编码；资源压力（#37 亲缘）为放大器非根因。

**修复方向**（已验证可行，详见 PRD-0016）：`premountFor` 暖场（premount 态真 `.load()` 且显式不触发全局 buffering，`use-media-buffering.js:20-43`）+ 音频轨 buffering 语义收紧 + 1.2s 阈值复审 + 浏览器回归夹具看守。

## 诊断陷阱存档（后续插桩必读）

- 遮挡 tab 的 rAF 节流会诱发与本 issue 同形的 ct 回拽假象（本次调查亲历）——插桩先过 rAF 心跳 ≥30/s 门控。
- `use-playback.js:124-149` 的 AudioContext-resume 门控可能比 hidden-timeout 更早停钟——插桩前全局静音可绕开。

## S1 红基线实录（2026-07-15）

**结论：夹具在当前实现上证红——三断言两红（①②），③绿。** 边界级主从判别：**回放（audio replay）是主症状，与 Player 静音无关；stall 表现为 buffering `waiting` 事件（亦与静音无关）；032 假设的"未静音 buffering 冻结 rAF 帧钟"未在本机复现为可测帧钟冻结。**

- **夹具/探针**：`scripts/probes/boundary-probe.js` + `boundary-probe.md`（commit `c1f9903`），可重复执行的浏览器插桩回归（脚本化驱动：合成 pointerdown 走 Scrubber、`autoviral:ui-play/pause` window 事件走 Player）。
- **环境**：work `w_20260715_0035_20d`（总时长 274.38s，前 48s = 12×4s 硬切；切点 4/8/12…44s），daemon `localhost:3271` 预构建 dist，浏览器插桩 subagent（主 agent 不亲点）。
- **rAF 门控（关键·亲历遮挡陷阱）**：初始注入时探针 tab `visibilityState=hidden`（同窗有另一同 URL tab 占前台）→ `rafRate=0`、rafHistory 空——**正是 032 记的节流假象源**。`osascript activate` + 经 AppleScript 把探针 tab 设为 window 活动 tab 后 `visibilityState=visible`、`rafRate` 稳定 75。**三次判定跑全程 `rafRateMin` 74/72/75（≥30）、107/88/77 心跳样本**——数据有效，未在节流环境下判定。

### 主跑（unmuted，21 跨界 / 7 轮，rafRateMin=74）

| 断言 | 观测 | 判定 |
|---|---|---|
| ① 无 stall | `waiting=40`、`stalled=0`、`clockFreeze=0` | **红**（每轮 ~5.7 次 waiting） |
| ② 无回放 | `backwardJumpPlayer=19`，**全 audio**，幅度 129–375ms（中位 ~244ms），**全部聚在 8s 切点**（ct 从 ~8.30 被拽回 ~8.06） | **红** |
| ③ 帧钟单调 | `monotonicClock=true`、master 帧钟零后退 | 绿 |

- mount→canplay（Player clip video 冷挂载代价）：n=21，min 8 / p50 14 / p90 17 / max 19 ms。
- 负跳全落在**数据-URI 音频元素**（Remotion 内联的 narration/sourceAudio 段），BGM/VO 的 .mp3 未现负跳——跑赢帧钟最多的那条音频被 0.15s 纠偏拽回，与 `use-media-playback.js:200-219` 描述一致。
- 负跳 `atMs` 均在各轮 seek 之后 ~5.5s（masterSec ~8s）稳态播放期发生，**非 seek 守卫漏判**（探针对 seek 后 450ms 内的 ct 变化免判，且只在 `!paused` 元素上判负跳——排除 247 个 filmstrip 抽帧 `<video>` 噪声）。

### 主从诊断（matched 12 跨界，muted vs unmuted）

| 指标 | unmuted (12×) | muted (12×) |
|---|---|---|
| `waiting` | 20 | 20 |
| `stalled` | 0 | 0 |
| `clockFreeze` | 0 | 0 |
| audio 负跳 | 8 | 10 |
| 负跳幅度 | 140–306ms | 116–215ms |
| 负跳位置 | 全 8s 切点 | 全 8s 切点 |

**两态几乎全等**：静音**不减** `waiting`（20=20）、**不消除**音频回放（8 vs 10，噪声内）。故：
- **stall 与 replay 均 mute-independent**。冷挂载 buffering block（新 `<video>` `readyState<HAVE_FUTURE_DATA` → `blockMedia()`）与音频 0.15s 同步纠偏（`currentTime=shouldBeTime`）都不看 Player 静音。
- 032 原假设的"未静音 → buffering 冻结 rAF 帧钟"（`@remotion/player use-playback.js:150`）在本机/本 build **未复现为可测帧钟冻结**（两态 `clockFreeze=0`、`monotonicClock=true`）——该 stall 分支要么未触发、要么冻结 <300ms/<0.01s 分辨率。真正复现的是 **buffering `waiting` + ~0.12–0.38s 音频回放**，二者皆与静音无关。

**对修复方向的含义**：premount 暖场（S2）应同时消除两症状的共同触发器（切点冷挂载）；S3 的音频轨 `pauseWhenBuffering` + 1.2s 阈值复审直接针对本实录的 audio 回放主症状（回放幅度 0.12–0.38s ⊂ 1.2s 自由漂移窗，收窄阈值可压缩回放可及幅度）。转绿目标：三断言全绿（`waiting=0`、`backwardJumpPlayer=0`、`monotonicClock=true`），muted/unmuted 两跑一致。

## S2 premount 后实录（2026-07-15）

**结论：premount 大幅压低 stall（waiting 40→4，≈90%），但音频回放未清零——① 显著改善未到 0、② 音频负跳仍存、③ 帧钟仍单调。** 按 PRD-0016 S2 验收，只有 ③ 全绿；① ② 显著改善但未归零，**收口交给 S3**（音频轨 `pauseWhenBuffering` + 1.2s→默认 阈值复审直接针对残留的 audio 回放）。不硬凑绿。

- **实现**：`web/src/features/studio/composition/tracks/VideoTrackRenderer.tsx` 三条外层 `<Sequence>`（普通单 clip / 单 clip+entrance / 多 clip TransitionSeries 外层）加 `premountFor = Math.round(fps)`（常数集中定义 `PREMOUNT_FRAMES`）。仅预览生效：remotion `Sequence.js:249` 只在 `!env.isRendering` 走 `PremountedPostmountedSequence`，导出树零变化（premount 态真 `.load()` 但显式跳过全局 buffering，`use-media-buffering.js:20-43`）。
- **环境**：同 S1（work `w_20260715_0035_20d`，daemon `localhost:3271`，前端 `build:frontend` 后重载 dist），浏览器插桩本 agent 亲跑（S2 subagent，非主 agent）。**rAF 门控全程通过**：主跑 `rafRateMin=75`/117 样本；unmuted `rafRateMin=74`；muted `rafRateMin=69`（均 ≥30，未在节流环境判定）。首次 play 用真实鼠标手势解锁 AudioContext（截图二确画面从黑帧→真实视频帧前进）。

### 主跑（unmuted，21 跨界 / 7 轮，endSec=13.5，rafRateMin=75）

| 断言 | S1 红基线 | S2 premount 后 | 判定 |
|---|---|---|---|
| ① 无 stall | `waiting=40`、`stalled=0`、`clockFreeze=0` | `waiting=4`、`stalled=0`、`clockFreeze=0` | 改善 ≈90%，**未到 0** |
| ② 无回放 | `backwardJumpPlayer=19`（全 audio，129–375ms，聚 8s 切点） | `backwardJumpPlayer=12`（全 audio，579–680ms，聚各轮**暂停端 ~13.4s**，非 8s 切点） | 改善，**未到 0** |
| ③ 帧钟单调 | `monotonicClock=true` | `monotonicClock=true`、`clockBackward=0` | 绿（不变） |

- mount→canplay（切点新 Player video 冷挂载代价）：n=21，min 8 / p50 9 / p90 16 / max 17 ms——比 S1（p50 14/max 19）更快，premount 已预暖新元素，切点几乎零挂载延迟。
- **负跳性质变化（关键）**：S1 的负跳全落在 8s 切点（数据-URI narration/sourceAudio 段）；premount 后**切点级音频回放消失**，残留 12 条负跳全在 BGM(`memory_secret_bgm.mp3`)+VO(`tts_79227f8e672c.mp3`)两条 .mp3 上、且 `distToRoundEnd` 100–1038ms（贴各轮暂停端），幅度升至 ~600ms。

### 主从诊断（endSec=25，12 跨界 matched，cut 点 4/8/12/16/20/24 与轮末 25s 充分分离）

| 指标 | unmuted (12×, 3 轮) | muted (12×, 3 轮) |
|---|---|---|
| `waiting` | 3 | 6 |
| `stalled` | 0 | 0 |
| `clockFreeze` | 0 | 0 |
| audio `backwardJumpPlayer` | 6 | 4 |
| 负跳幅度 | 557–618ms | 557–571ms |
| `monotonicClock` | true | true |
| `mountToCanplay` p50/max | 9/18 ms | 10/29 ms |

- **两态几乎全等（mute-independent，同 S1）**：静音**不减** waiting（3 vs 6，噪声内）、**不消除**音频回放（6 vs 4）。残留 stall/replay 都不看 Player 静音——与 S1 结论一致。
- **长窗口下负跳位置**：unmuted 6 条负跳分布 masterSec ~12–16.7s（12/16 切点附近区域），非仅轮末——说明 BGM/VO 随播放渐进跑赢帧钟、到 ~600ms 时被 `use-media-playback.js:200-219` 拽回；幅度 ⊂ 1.2s 自由漂移窗，正是 S3 收窄阈值的靶点。

**S2 净结论**：premount 消除了**切点冷挂载**这个共同触发器——① stall 降 ~90%、切点级音频回放消失、mount→canplay 近零。残留是 BGM/VO 音频轨在 1.2s 自由漂移窗内渐进跑赢帧钟后的 ~600ms 纠偏回放（mute-independent），**未被 premount 触及**，正是 S3（AudioTrackRenderer `pauseWhenBuffering` + `acceptableTimeShiftInSeconds` 1.2s→默认复审）的收口目标。③ 帧钟单调全程保持。**S2 不宣称夹具全绿**——按 PRD-0016 只 ③ 转绿，① ② 移交 S3。

## S3 实录（2026-07-15）音频轨 buffering 语义 + 1.2s 阈值复审

**结论：AudioTrackRenderer 补 `pauseWhenBuffering`（对齐视频预览分支，rendering 分支不动）；`acceptableTimeShiftInSeconds: 1.2` 经两档实测复审后 KEEP（不收窄回默认）。残留的 ~600ms 音频回放证实由音频元素自身的漂移阈值主导，非视频 prop 可及——本轮不宣称夹具全绿。**

- **实现**：`web/src/features/studio/composition/tracks/AudioTrackRenderer.tsx` 的 `AudioClipRenderer` 加 `getRemotionEnvironment` 分支——预览（`isRendering=false`）给 `<Audio>` 传 `pauseWhenBuffering: true`（与预览 `<Video>` 一致，音频未 ready 同样进全局 block 而非静默漂移）；server render（`isRendering=true`）不传该 preview-only prop（ffmpeg 无 buffering 概念）。预设测试 `AudioTrackRenderer.buffering.test.tsx` 三 case（预览带 / render 不带 / volume+fade 不回归）先证红（case ① fail：`pauseWhenBuffering` 缺失）后转绿。
- **环境**：同 S1/S2（work `w_20260715_0035_20d`，daemon `localhost:3271`，两档各 `build:frontend` 后 reload dist），浏览器插桩本 agent 亲跑（S3 subagent，非主 agent）。**rAF 门控全程通过**：A 档 `rafRateMin=74`/74 样本；B 档 `rafRateMin=75`/76 样本（均 ≥30，未在节流环境判定）。首次 play 用真实鼠标手势解锁 AudioContext（截图二确画面从黑帧→FRAME 00:13/00:24 真实视频帧 + 字幕前进）。

### acceptableTimeShiftInSeconds 两档实测（各 unmuted 12 跨界 / 2 轮，startSec 3.2 → endSec 25，cut 点 4/8/12/16/20/24）

| 断言 / 指标 | A：ats = **1.2**（现值） | B：ats = **默认**（移除 prop；remotion 4.0.459 实算 0.65s——0.45 基准 + 0.2 amplification 上浮，见 `use-media-playback.js:79-90`；review 纠正：非 0.45s） |
|---|---|---|
| ① `waitingCount`（Player） | 2 | 2 |
| `stalled` / `clockFreeze` | 0 / 0 | 0 / 0 |
| ③ `monotonicClock` | true | true |
| **video 元素 ct 负跳** | **0** | **0** |
| ② audio 元素 ct 负跳 | 8（全 BGM+VO，579–666ms） | 4（全 BGM+VO，603–645ms） |
| `mountToCanplay` p50 / max | 9 / 25 ms | 9 / 15 ms |

- **两档在 video 侧完全等价**：`waiting`、`stalled`、`clockFreeze`、`monotonicClock` 全相同，且**视频元素 ct 负跳两档都为 0**——`acceptableTimeShiftInSeconds` 唯一真正管辖的量（视频元素回放）在两档下都无回放。
- **负跳全落 audio、mute-independent**：两档下每一条负跳都在 `memory_secret_bgm.mp3` + `tts_79227f8e672c.mp3` 两条音频轨上、幅度 ~600ms，与 S2 残留同源。音频元素走**独立的**同步循环、带**自己的** `acceptableTimeShiftInSeconds`（AudioTrackRenderer 未设 → remotion 默认），视频 prop 从 1.2 改默认**在机制上无法触及音频漂移**。8 vs 4 的计数差是同一机制（BGM/VO 渐进跑赢帧钟被 0.15s 纠偏拽回）在 12 跨界小样本下的 run-to-run 噪声，非视频 prop 的因果贡献。

### 决策：KEEP 1.2（保守保留）

按 PRD-0016 S3 决策规则：两档均非 0（都有 ~2 waiting + 残留音频负跳），进入"默认档更优则改"分支比较。但**默认档在本 prop 真正管辖的轴（视频元素回放）上毫无增益（两档均 0）**，8-vs-4 的差异属不可归因于视频 prop 的音频噪声；而 R47-fix5 的历史动机（主线程 jank 下拓宽阈值防误 discrete seek）依旧成立——premount 不解决主线程 jank，安静的插桩环境也不复现它。故**保守保留 1.2**，两档数据落 `VideoTrackRenderer.tsx` previewOnlyProps 注释。残留的非切点音频漂移纠偏回放独立立案跟踪：[033](033-audio-track-drift-replay.md)。

### 残留与下一手（诚实标注）

premount（S2）+ 音频 `pauseWhenBuffering`（S3）+ 1.2s 复审后，夹具**仍未全绿**：`waiting≈2`、audio 负跳 4–8 条 ~600ms（video 负跳 0、帧钟单调）。残留的 ~600ms 音频回放**不在视频 `acceptableTimeShiftInSeconds` 的可及范围内**——它由**音频元素自身**的漂移阈值主导（当前用 remotion 默认）。真正能压这条残留的下一手是**收窄 AudioTrackRenderer `<Audio>` 的 `acceptableTimeShiftInSeconds`**（本 slice 未纳入——task 明确把 ATS 决策限定在视频 prop、音频仅补 `pauseWhenBuffering`；且收窄音频阈值有"纠偏更频繁→音频更 choppy"的独立 tradeoff，需单独实测定夺）。本轮不硬凑绿：S3 交付 = 音频 `pauseWhenBuffering` + 视频 1.2s 复审（KEEP，两档数据存档），video 侧回放两档均 0、帧钟单调；audio 侧残留移交音频阈值单独立项。

## S4 压力复测（2026-07-15）资源压力 + 媒体元素盘点

**结论：premount 使稳态 Player clip `<video>` 峰值 1→2（实测证实），叠加 24-asset grid（24 poster `<video>` 常驻）压力复测无解码预算回归——无 ~3s hitch 族、video 负跳两态均 0、帧钟单调；残留 audio 负跳 7 条 ~600ms 两态全等，是 S3 已存档的音频阈值残留、与 grid 开/关无关、非本轮引入。** 媒体元素全盘点落 [`docs/research/2026-07-15-studio-media-element-inventory.md`](../research/2026-07-15-studio-media-element-inventory.md)。

- **无实现代码变更**：S4 = 复测 + 盘点落档（premount 在 S2 已落）。故无预设测试（纯文档 + 浏览器复测，属 test-first.md「不可测变更」例外）；既有套件不触（仅新增 2 个 md）。
- **环境**：同 S1/S2/S3（work `w_20260715_0035_20d`，daemon `localhost:3271`，HEAD `b10c195` 服务的 dist——已核对 bundle 携 `acceptableTimeShiftInSeconds:1.2` + `premountFor` + `pauseWhenBuffering`），浏览器插桩 S4 subagent 亲跑。**rAF 门控全程通过**：State A `rafRateMin=71`/105 样本；State B `rafRateMin=71`/90 样本（均 ≥30）。首次 play 真实鼠标手势解锁 AudioContext（截图二确 FRAME 00:08.71 真实视频帧 + 字幕前进）。

### premount 1→2 稳态证据（暂停态元素计数，非播放态峰值噪声）

| 位置 | 是否在 ~1s premount 窗内 | Player clip `<video>` 数 | 挂载的 src |
|---|---|---|---|
| 6.0s（clip#2 中段，8s 切点前 ~2s） | 否 | **1** | `seedance-9d57eec297ff.mp4#t=0,4` |
| 7.58s（8s 切点前 ~0.4s） | 是 | **2** | `seedance-9d57...#t=0,4`（当前）+ `seedance-05ccae25a76a.mp4#t=0,4`（预挂下一 clip） |

播放态两态 `peakMountedPlayerVideos=2`（挂载峰值；任一瞬间仅 1 个 `!paused` 实际前进，另一个 premount 冻结但已 `.load()` 占解码管线）。

### 两态压力复测（AssetSidebar 关 / 开，各 unmuted 12 跨界 / 2 轮，startSec 3.2 → endSec 25，切点 4/8/12/16/20/24）

| 指标 | S1 红基线（无 premount） | State A：关（Inspector，无 grid） | State B：开（LIBRARY·CLIPS·24，24 poster 常驻） |
|---|---|---|---|
| 并发媒体元素 | — | 2 `<video>`(Player) + 5 `<audio>` | **26 `<video>`（24 poster + 2 Player）+ 5 `<audio>` = 31 总媒体元素** |
| `peakMountedPlayerVideos` | 1 | 2 | 2 |
| waiting（Player） | **40** | 2 | 3 |
| stalled / clockFreeze | 0 / 0 | 0 / 0 | 0 / 0 |
| **video 元素 ct 负跳** | 0（全 audio） | **0** | **0** |
| audio 元素 ct 负跳 | 19（129–375ms，聚 8s 切点） | 7（全 BGM+VO，595–644ms） | 7（全 BGM+VO，602–669ms） |
| `monotonicClock` | true | true | true |
| **mount→canplay p50 / max** | 14 / 19 ms | 11 / 23 ms | **10 / 20 ms** |
| rafRateMin | 74 | 71 | 71 |

- **无 ~3s hitch 族**：两态 mount→canplay `max` ≤23ms——比历史 OffthreadVideo 池化 ~3s hitch（`LibraryTab.tsx:435` 教训）低 ~130×。24 poster 常驻不诱发 Player 冷挂载抬升。
- **压力不放大回放**：video 负跳两态均 0；audio 负跳 7 条 ~600ms **两态全等**——premount 未触及的音频轨自身漂移阈值残留（S3 存档、mute-independent），**与 grid 开/关无关、非 S4 引入**，恒定 = 无回归。
- **为何不炸预算**：① poster metadata-only + seek 一帧即释放解码器、经 mediaLoadGate 4 并发闸门错峰；② hover 全解码 `<video>` 至多 1 个且离开即 unmount；③ premount 子树冻结不预播、显式跳过全局 buffering；④ Player 刻意不进 gate 保 headroom。逐条挂点见盘点文档 §C/§F。

### 与 #37 的互不回归

S4 同时看守两故障族：#37（thumbnail 洪峰饿死 Player 启动，已修 mediaLoadGate）+ #98（切点冷交接，本 PRD premount）。24-asset grid 开态 24 poster 全挂 + Player premount 1→2 并存下，两者都不复现——mediaLoadGate 闸门与 premount 暖场正交、不互相抢解码预算。

## Acceptance criteria

见 [PRD-0016](../prd/0016-preview-hardcut-fidelity.md) 验收与切片（S1 红基线夹具 → S2 premount → S3 音频语义 → S4 压力复测）。
