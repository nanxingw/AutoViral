# Studio 媒体元素盘点 (2026-07-15)

> PRD-0016 S4 交付物 · 供后续「解码预算 / buffering」类 gate 决策免从零考古。
> 基线：#98 调查（Workflow `wf_ac749ac2-c4a`，codex 盘点 Studio 十类表面）+ 双路对抗验证补的遗漏挂载点。
> **本文档所有行号在 HEAD `b10c195`（2026-07-15）逐条核对源码后落档**；升 Remotion / 改 Player 配置 / 加媒体表面时以此为回归锚。
> 关联：[PRD-0016](../prd/0016-preview-hardcut-fidelity.md) · [docs/issues/032](../issues/032-preview-hardcut-stutter-replay.md)（S4 压力复测原始数据）。

---

## 为什么要盘点

预览的解码预算（Chrome 每 tab 硬件解码器上限 ~16–24 个 `<video>` context）是 #98 硬切卡顿的**放大器**，也是 #37 预览死锁的**根因族**。PRD-0016 S2 的 `premountFor` 暖场会让相邻 clip 的 `<video>` 稳态共存（1→2），必须确认这个 +1 叠加重素材 work 不炸预算。要判断「再加一个媒体表面会不会压垮预览」，得先有一张**谁在什么时候挂了多少个媒体元素**的全表。历史上每次「预览抖动 / 死锁」都在重新考古这张表——本文档把它钉死。

判据术语：
- **解码器常驻（readyState=4 / autoPlay / loop）** = 真占一个硬件解码 context，最贵。
- **metadata-only + 一次 seek 画一帧** = 画完即释放解码管线，不常驻（LibraryTab poster 走这条）。
- **仅 seek 取帧、从不 play**（filmstrip 抽帧）= 瞬态，取完帧即可回收。
- **导出 `OffthreadVideo`** = ffmpeg 抽帧，headless，**不在浏览器预览解码预算内**（独立标注，勿混入预览计数）。

---

## A. 预览合成树（Remotion Player）—— 解码预算的核心

| # | 元素 | 源码锚 | 说明 |
|---|---|---|---|
| A1 | 视频 clip `<Video>`（预览）/ `<OffthreadVideo>`（导出） | `VideoTrackRenderer.tsx:144` `const VideoEl = isRendering ? OffthreadVideo : Video` | 预览走原生 `<video>`（浏览器解码/seek）；导出走 ffmpeg 抽帧。**每个无转场 clip = 一个独立 `<Sequence>`**。 |
| A1-props | 预览专属 props | `VideoTrackRenderer.tsx:223` `previewOnlyProps`，`:226` `acceptableTimeShiftInSeconds: 1.2`（S3 两档复审后 KEEP）+ `pauseWhenBuffering` | 仅 `!isRendering` 挂；`OffthreadVideo` 无 buffering 概念（`:180-183` 注释）。 |
| A1-premount | 外层 Sequence `premountFor` | `VideoTrackRenderer.tsx:622` `PREMOUNT_FRAMES = Math.round(fps)`（≈24 帧≈1s）；挂点 `:643`（普通 clip）/`:660`（clip+entrance）/`:686`（多 clip TransitionSeries 外层） | remotion `Sequence.js:249` 只在 `!env.isRendering` 走 premounted 变体 → **仅预览生效，导出树零变化**。**稳态 Player clip `<video>` 峰值 1→2**（见 §F 实测）。 |
| A1-blur | blur fitMode 背板 | `VideoTrackRenderer.tsx:252` `// the blur backdrop is a SECOND stacked <video>` | blur 适配模式下同源再堆一个 `<video>` → 该 clip 元素数翻倍（预览专属）。 |
| A2 | 音频轨 `<Audio>`（原生 `<audio>`） | `AudioTrackRenderer.tsx:70` `<Audio>`；`:68` `previewOnlyProps = isRendering ? {} : { pauseWhenBuffering: true }`（S3 补） | BGM / VO（一等 AudioClip）。**视频自带 AAC 原声不在此列**——它经 `VideoTrackRenderer` 的 `<VideoEl>` `muted`/`volume` prop 留在视频元素上（`VideoTrackRenderer.tsx:164-179`，review 纠正）。**音频元素走独立同步循环、带自己的 `acceptableTimeShiftInSeconds`（未设→remotion 默认）**——视频 prop 从 1.2 改默认在机制上触及不到音频漂移（S3 结论）。 |
| A3 | 覆盖 / 贴纸轨 `<Img>` | `OverlayTrackRenderer.tsx:48` `<Img>` | 静态图，非解码常驻。 |

---

## B. Timeline（底部常驻）

| # | 元素 | 源码锚 | 说明 |
|---|---|---|---|
| B1 | Filmstrip 抽帧 `<video>` | `useFrameExtractor.ts:89` `document.createElement("video")`（`crossOrigin=anonymous preload=auto muted playsInline`，`:10` 注释）；宿主 `Filmstrip.tsx` | **隐藏、仅 `seek` 取帧、从不 `play`**——每 clip 惰性挂载抽帧。夹具实测 `mediaTracked` 峰值 66（大量瞬态抽帧元素）。探针据「不带 `#t=` 分片 + 从不 `playing`」把它与 Player 媒体剥离，判据只认 Player。 |
| B2 | Waveform 解码 `AudioContext` | `useWaveform.ts:124` `new AudioContext()`；宿主 `WaveformBars.tsx` | 离线解码音频画波形——**非 media element**，但占一次音频解码；峰值回填（peaks boot-backfill）已 throttle。 |

---

## C. AssetSidebar（24-asset 事故 work 的解码压力面 —— S4 复测靶心）

| # | 元素 | 源码锚 | 说明 |
|---|---|---|---|
| C1-hover | LibraryTab 视频瓦片 hover 全解码 | `LibraryTab.tsx:513` `<video muted playsInline autoPlay loop preload=auto>`（`item.kind==="video" && hovered`） | **仅 hover 时挂、离开即 UNMOUNT**（`:431-437` 注释：readyState=4 每个都占解码 context，~7 个就爆预算 LRU 逐出重解码 → ~3s hitch，2026-05-08 诊断）。**同一时刻至多 1 个 hover 全解码 video**。 |
| C1-poster | LibraryTab 视频瓦片 poster | `LibraryTab.tsx:542` `<video preload=metadata>` + `onLoadedMetadata` seek 0.1s（`:547-556`） | **metadata-only + 一次 seek 画一帧即释放解码管线**（非常驻）；load 经 `mediaLoadGate` 4 并发闸门（`:444-453` `useGatedMediaSrc`，`#37`）错峰。24-asset grid 开 = 24 个 poster `<video>` 挂载但解码器错峰释放。 |
| C1-img | LibraryTab 图片瓦片 | `LibraryTab.tsx:592` `<img loading=lazy>` | — |
| C2 | AssetPreviewModal | `:262` `<video controls>` / `:237` `<img>` / `:309` `<audio controls>` | 放大预览，**一次一个**（模态）。 |
| C3 | ScriptTab / ScriptModal Markdown 视频嵌入 | `ScriptTab.tsx:626` / `ScriptModal.tsx:249` `<Markdown text={script} workId={workId} />` → `chat/Markdown.tsx:100` `<video>`（`:97` `isVideo` 按扩展名 mp4/mov/webm 切换）；`ScriptTab.tsx:1368` `<img>` | **脚本 markdown 里含视频 URL 时才挂 `<video>`**（对抗验证补的遗漏挂载点——盘点初稿只记了 LibraryTab，漏了脚本 tab 经 Markdown 组件内嵌视频）。 |

---

## D. 其他 Studio 表面

| # | 元素 | 源码锚 | 说明 |
|---|---|---|---|
| D1 | Chat 面板附件 / 内嵌 | `panels/Chat/index.tsx:77` `<video muted playsInline preload=metadata>` / `:79` `<img loading=lazy>`；消息内嵌 `chat/Markdown.tsx:100` `<video>` | 聊天附件无虚拟化（#98 放大器注释提及）。 |
| D2 | Dive 画布缩略 | `dive/nodes/MediaThumb.tsx:38` `<video>`（`useInViewport` 视口闸门 `:34`，延迟 metadata 加载）/ `:52` `<img loading=lazy>`；`dive/DiveCanvas.tsx:111` http-served URL 覆盖 | 视口外不加载 metadata（`useInViewport.ts:4` 注释）。 |
| D3 | ScriptReader take 缩略 | `reader/ScriptReader.tsx:504` `<video>`（muted）/ `:519` `<img>`（`:365` 按 image→`<img>` / video→muted `<video>` 分支） | — |
| D4 | Inspector VariantSwitcher | `panels/Inspector/VariantSwitcher.tsx:149` `<img>` | 变体缩略，静态。 |

---

## E. 对抗验证补的遗漏挂载点（#98 十类表面之外）

盘点初稿（codex Studio 十类）漏了以下四处，双路对抗验证补齐——逐条已在本轮核对行号：

| # | 元素 | 源码锚 | 为何易漏 |
|---|---|---|---|
| E1 | WorksGrid 封面 `<video>` | `works/WorksGrid.tsx:184` `<video muted loop playsInline preload=metadata>` hover-play（`:182` `if (work.coverIsVideo)`） | **在 works 列表页、Studio 之外**——盘点只扫了 Studio feature 树，漏了列表页封面视频。 |
| E2 | useAudioAudition 单例 | `studio/hooks/useAudioAudition.ts:60` `const el = new Audio(src)`（模块级单例 `:15` `let audioEl: HTMLAudioElement | null`） | **命令式 `new Audio()`，非 JSX** —— grep `<video>/<audio>` 扫不到；单例不变量保证最多 1 个 audition `HTMLAudioElement`（`:51` 注释）。 |
| E3 | 导出 `OffthreadVideo`（独立标注） | `VideoTrackRenderer.tsx:144` `isRendering` 分支 | **不是遗漏，是必须独立标注**：导出走 ffmpeg 抽帧、headless，**零浏览器预览解码预算**（`:139` 注释）。任何「预览解码预算」核算都不能把它算进去；026 已修的帧精确 seek 路径不动（PRD-0016 Out of Scope）。 |
| E4 | ScriptTab/ScriptModal Markdown 内嵌（见 C3） | 同 C3 | 脚本经共享 `chat/Markdown` 组件内嵌视频，盘点初稿只记 chat 面板一处。 |

---

## F. premount 稳态 1→2 的解码预算结论（S4 实测 · 2026-07-15）

**机制**：`premountFor ≈ 24 帧（≈1s）` → 切点前 ~1s 预挂下一 clip 的 `<video>` 并真 `.load()` 暖场（remotion `use-media-buffering.js:20-43` 显式跳过全局 buffering、`freeze.js` 冻结子树时间不预播），与当前 clip 的 `<video>` 共存 → **稳态 Player clip `<video>` 峰值 1→2**（premount 窗内），窗外回落 1。

**实测证据（work `w_20260715_0035_20d`，daemon `localhost:3271`，HEAD `b10c195` 服务的 dist，浏览器插桩 rAF 门控 rafRateMin 71 全程 ≥30）**：

- 暂停在 **6.0s**（clip#2 中段，8s 切点前 ~2s，**在 ~1s premount 窗之外**）= **1 个** Player `<video>`（`seedance-9d57eec297ff.mp4#t=0,4`）。
- 暂停在 **7.58s**（8s 切点前 ~0.4s，**在 premount 窗内**）= **2 个** Player `<video>`（`seedance-9d57...#t=0,4` 当前 + `seedance-05ccae25a76a.mp4#t=0,4` 预挂的下一 clip）。
- 播放态两态复测 `peakMountedPlayerVideos = 2`（挂载峰值；其中任一瞬间仅 1 个 `!paused` 实际解码前进，另一个 premount 冻结但 `.load()` 已占解码管线）。

**两态压力复测（AssetSidebar 关 / 开，各 unmuted ≥12 跨界，endSec=25 覆盖切点 4/8/12/16/20/24）**：

| 指标 | 关（Inspector tab，无 grid） | 开（LIBRARY·CLIPS·24，24 poster 常驻） |
|---|---|---|
| 并发 `<video>` 元素 | 2 Player + 5 `<audio>` | **24 poster + 2 Player + 5 `<audio>` = 26+** |
| `peakMountedPlayerVideos` | 2 | 2 |
| waiting（Player） | 2 | 3 |
| stalled / clockFreeze | 0 / 0 | 0 / 0 |
| **video 元素 ct 负跳** | **0** | **0** |
| audio 元素 ct 负跳 | 7（全 BGM+VO，595–644ms） | 7（全 BGM+VO，602–669ms） |
| `monotonicClock` | true | true |
| **mount→canplay p50 / max** | **11 / 23 ms** | **10 / 20 ms** |
| rafRateMin | 71 | 71 |

**结论：premount +1 稳态视频元素叠加 24-asset grid 压力，解码预算无回归。**

1. **无 ~3s hitch 族**：两态 mount→canplay `max` 均 ≤23ms——比历史 OffthreadVideo 池化 ~3s hitch（`LibraryTab.tsx:435` 教训）低 ~130×。24 poster 常驻不诱发 Player 冷挂载抬升。
2. **压力不放大回放**：video 负跳两态均 **0**（premount + S3 音频 `pauseWhenBuffering` 已消除切点冷挂载这个共同触发器）；audio 负跳 7 条 ~600ms **两态全等**——是 S3 已存档的残留（音频元素自身漂移阈值主导、mute-independent、非视频 prop 可及），**与 grid 开/关无关，非 S4 引入**。
3. **为何不炸预算**（缓释机制汇总）：① poster 是 metadata-only + 一次 seek 画一帧即释放解码器、经 mediaLoadGate 4 并发闸门错峰（C1-poster）；② hover 全解码 `<video>` 一次至多 1 个且离开即 unmount（C1-hover）；③ premount 子树时间冻结不预播、premount 态显式跳过全局 buffering（A1-premount）；④ Player 刻意不进 mediaLoadGate（保证预览始终有解码 headroom，`mediaLoadGate.ts:18`）。

原始跑法与逐轮数据见 [docs/issues/032 § S4 压力复测](../issues/032-preview-hardcut-stutter-replay.md)。
