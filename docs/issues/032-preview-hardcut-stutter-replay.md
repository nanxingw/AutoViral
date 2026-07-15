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

## Acceptance criteria

见 [PRD-0016](../prd/0016-preview-hardcut-fidelity.md) 验收与切片（S1 红基线夹具 → S2 premount → S3 音频语义 → S4 压力复测）。
