# 033 · 预览中 BGM/VO 音频轨非切点处 ~600ms 漂移纠偏回放（#98 收口后的独立残留）

**Severity: MEDIUM（可闻但非切点级、幅度恒定 ~600ms） · triage: `ready-for-agent` · 记录日期: 2026-07-15**

> Source: PRD-0016 S2/S3/S4 三轮浏览器插桩实录（[032 § S2/S3/S4](032-preview-hardcut-stutter-replay.md)）。#98 的切点级卡顿/回放已由 premount + 音频 pauseWhenBuffering 修复归零（video 负跳双档双态均 0、切点音频回放清零、帧钟单调）；本 issue 跟踪**剩下的另一台机器**。

## 现象（三轮实录一致）

长音频轨（`memory_secret_bgm.mp3` BGM + `tts_79227f8e672c.mp3` VO）在**非切点**位置（各轮暂停端附近 / 12-16s 渐进漂移区）出现 4-8 次/12 跨界的 `currentTime` 负跳，幅度稳定 **~580-670ms**，mute-independent，与 AssetSidebar 开/关无关，与视频 `acceptableTimeShiftInSeconds` 取 1.2 或默认无关（两档全等）。

## 机制（已定位，见 032 § S3）

音频元素走 remotion **独立的**同步循环、带**自己的** `acceptableTimeShiftInSeconds`（AudioTrackRenderer 未设 → 4.0.459 缺省实算 0.65s）：长音轨渐进跑赢帧钟 →（越过阈值或落入 0.15s 分支）被 `currentTime = shouldBeTime` 拽回 → 已播 ~600ms 重放。视频侧的修复（premount / 视频 prop）在机制上触及不到这条循环。

## 修复方向（独立 tradeoff，需自己的实验轮）

- 候选 1：给 `<Audio>` 设更紧的 `acceptableTimeShiftInSeconds`——纠偏更频繁但每次更小（可能 choppy，需要实测听感）。
- 候选 2：排查音频为何渐进跑赢帧钟（playbackRate 精度 / 帧钟 tick 粒度），治本。
- 候选 3：音频轨也 premount（若挂载时刻的初始偏移是漂移种子）。
- 验证工具：`scripts/probes/boundary-probe.js` 已能捕获该签名（audio 负跳 + 位置），加听感 A/B。

## Acceptance criteria

- [ ] 预设：探针在 12 跨界内 audio 负跳 = 0（或 <50ms 不可闻阈内），两档听感 A/B 存档
- [ ] 视频侧三断言不回归（waiting 不升、video 负跳保持 0、帧钟单调）
- [ ] 032 的 S2-S4 实录表补一行终局数据
