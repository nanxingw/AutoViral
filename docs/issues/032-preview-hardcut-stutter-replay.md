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

## Acceptance criteria

见 [PRD-0016](../prd/0016-preview-hardcut-fidelity.md) 验收与切片（S1 红基线夹具 → S2 premount → S3 音频语义 → S4 压力复测）。
