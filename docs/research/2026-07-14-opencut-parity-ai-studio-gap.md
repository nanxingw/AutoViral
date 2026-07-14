---
date: 2026-07-14
title: "OpenCut 对标 × AI↔Studio 断层：v0.2.0 能力补齐研究"
status: research
owner: 产品与架构
sources:
  - docs/竞品/analysis/inventory/opencut-timeline-core.md
  - docs/竞品/analysis/inventory/opencut-effects-animation.md
  - docs/竞品/analysis/inventory/opencut-text-captions-audio.md
  - docs/竞品/analysis/inventory/opencut-media-project-persistence.md
  - docs/竞品/analysis/inventory/opencut-rewrite-direction.md
  - docs/竞品/analysis/inventory/autoviral-ai-bridge.md
  - docs/竞品/analysis/gaps/editing-operations.md
  - docs/竞品/analysis/gaps/effects-visual.md
  - docs/竞品/analysis/gaps/render-export.md
  - docs/竞品/analysis/gaps/ai-studio-bridge.md
  - docs/竞品/analysis/issue-93.md
  - docs/竞品/analysis/issue-94.md
  - docs/竞品/analysis/issue-95.md
---

# OpenCut 对标 × AI↔Studio 断层：v0.2.0 能力补齐研究

> 证据基线：OpenCut = `../OpenCut-pre-rewrite` worktree（tag `pre-rewrite`，commit `238750c0`，真正的编辑器实现；rewrite 后的 `main`/`bab8af83` 只是架构脚手架，无编辑器功能）。AutoViral = 本仓 `main`，v0.1.11。所有源码引用带 `file:line` 锚点，用户实战证据带 `#93/#94/#95`。
>
> 材料完整度说明：四份 gap 矩阵 + 九份 inventory + 三份 issue 均已产出并读原文。其中 `opencut-preview-render-export.md`、`autoviral-render-pipeline.md`、`autoviral-studio-timeline.md` 三份在首轮编排中缺位（`gaps/render-export.md` 当时直接读源码补位），**已于同日补齐落盘**；补齐盘点进一步核实：#93 根因确在 `transitions.ts:280`（geq 用小写 `t`，geq 只认大写 `T`；domain-warp 同缺陷；grav-lens 则是 `lenscorrection` 静态 option 塞时间表达式），OpenCut 预览与导出共用同一 `buildScene → CanvasRenderer`（WYSIWYG 架构性免费），AutoViral 写路径三分裂（仅约 11 个动词做到 store↔bridge 共享 op 真收敛）。

---

## 1. 执行摘要

下一版本（v0.2.0）的唯一命题是：**让 Studio 能承载 agent 亲手剪出的完整短视频，把当前"预览一套、导出另一套"的 WYSIWYG 裂缝逐条焊死。** 今天 issue #94 的铁证是——agent 产出一条 3 分钟科普成片（39 个生成镜头、42 拍原生速度快切、变化转场、ducking BGM、烧录中文字幕），**整片被迫用裸 ffmpeg 在 Studio 之外拼装**，Studio 时间线从头到尾停在错误的旧慢动作版本（issue #94 Net effect）。用户原话"Studio is the user's direct visual entry point, this is very important"因此被系统性违背。最痛的三件事，按优先级：

1. **电影感转场端点全部 500，且产物永远进不了 composition。** 四个端点 `/api/transitions/{glitch,light-leak,domain-warp,grav-lens}` 当日实测全 HTTP 500，根因是 `src/server/render/transitions.ts:280` 的 `geq` 表达式非法（`t` 未大写成 `T`、`alpha(X,Y)` 不是 geq 合法函数、`if(...)` 嵌进 `p(X+(...),Y)` 令 eval 崩，正是报错里的 `'t*200)*15,0)),Y)'`，issue #93）。这是 Studio-native cinematic 转场的**唯一**路径，一坏，agent 只能裸 ffmpeg，产物游离在 `composition.yaml` 之外（issue #94 blocker #1）。
2. **composition schema 表达不了一个真实快切。** 每一拍需要 per-clip 的"入场转场（flash/glitch/whip/dip）"，而 `VideoClipSchema`（`composition.ts:202-236`）根本没有 `transitionIn` 字段；更刺眼的是**变速能表达、导出却死**——`speed` 是一等 keyframe property（`composition.ts:164），但 `src/server/speed-ramp-ffmpeg.ts` 对多值 speed 曲线导出时 `console.warn` 并静默回退 1×，AudioClip 的 speed 直接被忽略（`composition.ts:161-163` 注释）。预览里动、导出里死，是最典型的最后一公里裂缝（issue #94 建议 #2）。
3. **三层不对齐，agent 够不到人在 UI 早已能做的动作。** AutoViral 有 schema / 共享 ops / store-only action 三层，而 `rippleDeleteClip`、`collapseGaps`、`updateTransition`、`removeKeyframe`、多选框选等一批动词**只活在 React store，不在 `src/shared/composition/ops`，因此 CLI/桥接够不着**（`gaps/editing-operations.md` §A4/B2/B5、`gaps/ai-studio-bridge.md` §A5/C1）。这直接违反 AutoViral"agent 经 CLI 驱动 = 人在 UI 点，两条路产出一致"的核心命题。

关键判断：真正的 schema 硬缺口只有少数几处（per-clip transitionIn、stylize 转场枚举、mask/matte、detach-source-audio、同轨 overlap 不变量、整数帧时间），**八成"差距"其实是三层不对齐——schema 够用、UI 也有，只是没下沉成共享 op**。因此 v0.2.0 的最高杠杆动作不是狂造新功能，而是立一条工程纪律：**任何剪辑能力必须落在共享 ops 层，CLI/bridge 与 UI store 都从这里调**——把"天生双驱动"从口号变成 lint 规则（`gaps/ai-studio-bridge.md` §D2）。同时明确**不抄**两样东西：OpenCut 的浏览器本地 WebCodecs 导出（与 agent-headless 命题正面冲突）、Rust/WASM 合成层（收益是速度而非能力，成本极高）。还要守住 AutoViral 已经领先的地方别去追赶：cut-point 转场（13 preset）、文本/字幕动画、ducking + LUFS loudnorm、provenance 图、freeze/reverse——这些恰是服务端两段式路线换来的、浏览器本地渲染给不了的工业能力。

---

## 2. 今日三 issue 的需求本质

三个 issue 是同一天、同一条 3 分钟成片实战里揪出的三个层次的缺口——从"一个端点坏了"到"整个承载面塌了"到"操作手册没教"。

### #93 — 转场端点 500：Studio-native cinematic 转场的唯一路径断了
- **表象**：四个 cinematic 端点全返回 `HTTP 500 / errorCode: transition_failed`，ffmpeg 报 `Undefined constant or missing '(' in 't*200)*15,0)),Y)'`，filtergraph init 前就崩（`ffmpeg exit null`）。输入已验证合法（两 clip 均存在、1080×1920、clipA 4.29s > transitionDuration）。
- **本质**：这不是一个孤立 bug，而是 issue #94 的直接前提。`gaps/effects-visual.md` §D1 已回源码核对根因——`transitions.ts:280` 起 `buildGlitchCutFilterGraph` 三重错误叠加：(1) geq 时间变量应是大写 `T`，源码写小写 `t` → 未定义常量；(2) `alpha(X,Y)` 不是 geq 合法函数（读 alpha 平面是 `a(x,y)`）；(3) 把整段 `if(between(t,...),sin(t*200)*15,0)` 塞进 `p(X+(...),Y)` 令嵌套 eval 解析失败。domain-warp（`transitions.ts:339`）同病。
- **需求**：① 立即修 geq 并加"两纯色 clip 各渲一遍四转场"的 CI smoke test，滤镜错立即 fail fast（issue #93 原话）；② 更根本——把 stylize 家族做成 Remotion 组件 presentation 进 `TRANSITION_PRESET_META` 注册表，让它像 dissolve 一样 WYSIWYG 且进 composition，而非 composition 外的 ffmpeg 烘焙外挂。

### #94 — Studio 承载不了 agent 剪辑：时间线与成片脱节
- **表象**：42 拍快切的整片用裸 ffmpeg 构建，Studio 时间线从不反映真实成片，最终成片只作为 `output/final_v3_sub.mp4` 存在。
- **本质（五个 blocker，但需回源码去伪）**：`gaps/*` 已逐条与源码核对，纠正了 issue 自述里的若干夸大——
  - blocker #1 转场不可用 = 真（见 #93）。
  - blocker #2 "composition 无法表达快切" = **部分真**：per-clip transition-in 确实无处安放（`composition.ts` 无 `VideoClip.transitionIn`）；但 reframe/punch-in **其实表达得出**——`TransformsSchema.crop`（归一化子区，`composition.ts:59`）+ `scale/x/y` keyframe（`composition.ts:153-159`），"用源第 4–8 秒 + 逐渐推近"= `clip trim --in 4 --out 8` + `keyframe add --property scale`。**这是动词/可发现性 gap，不是 schema gap**（`gaps/editing-operations.md` §E）。sub-clip trim 也表达得出。真正的 schema 硬缺口只有 transitionIn + 变速导出。
  - blocker #3 "无法回填成片" = **部分真**：`clip add --src output/final.mp4` 能放置、legacy 合成器也把 final 当 timeline（`routes/_shared.ts`），但没有一等 verb 自动 probe 时长 / 清旧 clips / 补全 Asset+Provenance（`gaps/ai-studio-bridge.md` §A3）。
  - blocker #4 字幕无一等样式烧录路径 + host ffmpeg 缺 libass = 真（见 #95 item 5）。
  - blocker #5 "render 是黑盒，`GET /api/works/:id/render/:jobId` → 404" = **误判**：状态端点存在，真实路径是 `GET /api/render/jobs/:id`（`routes/render.ts:104`，含 progress），agent 用错了 URL。这是可发现性/文档缺口，不是功能缺失（`gaps/render-export.md` §G7）。
- **需求**：优先级见 issue #94 建议——修转场 → 扩 schema 承载 per-clip transition-in / sub-clip trim / reframe / speed → import/flatten 动词 → 一等样式字幕轨 → render job 状态端点 + 中间预览。

### #95 — 操作手册缺口：短视频这条路线该教 agent 的操作 recipe
- **本质**：这些不是 taste（审美交给 sibling skill），是**如何驱动工位得到短视频结果**的操作机制，agent 当日靠硬试重新推导（issue #95 Summary）。七条缺口全部属于 `skills/autoviral` 操作手册应补的 recipe/gotcha：
  1. 旁白与画面解耦——绝不依赖 i2v 内嵌配音（会音色漂移/丢音），应合成单条锁定 `voice` id 的连续 TTS 轨，画面静音生成，VO 独立成轨（→ `recipes/video/`）。
  2. beat 驱动快切——~4–5s 原生速度切拍，**不要**把 5–8s clip 拉成 2.8× 填时（`setpts` 帧复制明显 judder，即用户的"卡顿"）；每个旁白短语生成专属画面，避免 `[A,B,A,B]` reframe 复用产生的重复感。
  3. 字幕烧录 recipe——ASR（stable-whisper）在干净 TTS VO 上**时间准但文本错**（"内存条"→"那村调"、"AI"→"黑爱"、"DRAM/HBM" 全错）；正确做法是保留 ASR timing、用已知 script 文本替换、按 ≤14 字分行、用 libass-enabled ffmpeg 烧（→ `recipes/video/burn-subtitles-asr-aligned.md`）。
  4. 生成韧性——Seedance/image 偶发瞬时 500（重试别 abort）；客户端超时**不取消服务端生成**（会为孤儿 clip 付费）；批量生成要用 manifest 做幂等可续跑；会话中断下单 clip 前台调用比长后台任务存活率高。**注意**：这七条里"超时不取消服务端生成→孤儿计费"**不是纯 recipe**——它是成本泄漏型服务端健壮性缺陷（与本仓 work-delete orphan render #63 / export dedup #62 同类），单靠"用宽松超时"绕不过；本报告把它拆出来作 **G-41** 排进工程修复（断连即取消生成 + manifest 幂等去重），其余六条才是 `skills/autoviral` 的 recipe/gotcha。
  5. host ffmpeg vs managed——host Homebrew ffmpeg 常缺 libass（无 `subtitles`）与 libfreetype（无 `drawtext`），managed `~/.autoviral/bin/ffmpeg`（6.0）有 libass；任何烧字步骤必须优先 managed 二进制（→ `05-conventions` 一行 gotcha）。
  6. 封面——image 端点能一次原生渲染大气正确的中文标题+副标题+logo（无乱码，→ `recipes/video/generate-cover.md`）。
  7. 成本旋钮——Seedance 720p ≈ $0.15/s vs 1080p ≈ $0.34/s，720p 上采样到 1080p 对抖音/小红书够用。

---

## 3. OpenCut 能力地图（按子系统 + rewrite 启示）

对照对象是 **pre-rewrite**（`238750c0`），它是命令模式 NLE，编辑动词 = 一等 Command 对象（`execute()` 存 `SceneTracks` 快照，`undo()` 恢复），交互层先纯计算 preview 再一次 commit。

| 子系统 | OpenCut pre-rewrite 能力（证据） | 判定 |
|---|---|---|
| **时间线数据模型** | `Project → Scene[] → SceneTracks{overlay[],main,audio[]} → discriminated TimelineElement`（`timeline/types.ts`）；时间端到端建模为 wasm 整数 `MediaTime` tick（commit `eea6d43c` 改 79 文件），trim/split 只 snap/round 一次再推导，架构性免疫倒跳/亚帧漂移 | 架构值得抄「整数帧不变式」 |
| **编辑动词** | trim/split（含 `retainSide:left|right` 快捷键 Q/W）/ ripple（`ripple/diff.ts`+`apply.ts` 后处理器）/ duplicate + clipboard paste / box-select + group-move/group-resize（同 delta，**非** rolling edit）；placement 用半开区间 `start<otherEnd && end>otherStart` 拒绝同轨重叠、main track 强制从 0 起 | ripple/duplicate/overlap 不变量 AutoViral 缺 |
| **effect / 混合** | 五种视觉元素持 `effects?:Effect[]`（`{id,type,params,enabled}`，串行有序、可 reorder/toggle/多实例，Rust `apply_effect_groups` 逐 pass），**但内置只有 Blur 一个**；17 种 `blendMode`；独立 `EffectElement`→sceneEffect 作为 adjustment layer 对时间区间作用 | 架构完整但内容薄（AutoViral 反有 LUT+3ch grade，OpenCut 无调色） |
| **mask / matte** | 9 种 mask（split/cinematic-bars/rect/ellipse/heart/diamond/star/text/freeform 钢笔 Bézier）+ 通用 `feather(0–1000)/inverted/strokeColor/Width/Align`，GPU 应用（`masks/types.ts`）；mask 参数**不可 keyframe**。**成熟度须打折**：UI 硬限**只允许单个 mask**（`Mask[]` 类型在，但非可用 stack，renderer 硬取 `masks?.[0]`，`inventory/opencut-effects-animation.md` §663）；freeform 钢笔只**存**cubic tangents、能移 anchor / 沿现有 segment 插点，但**直接拖 Bézier 控制柄塑形未实现**（新点零 tangent 起步，§840） | AutoViral 整块缺失，最大能力洞之一（但 OpenCut 领先幅度小于表面：单 mask、无 keyframe、无 tangent 塑形） |
| **keyframe / 动画** | `linear|hold|bezier` 段类型 + 左右 Bézier handle + graph editor（可编辑单 key 的 outgoing segment / handle）+ 6 preset + 自定义存 localStorage；命令族 `Upsert/Remove/Retime/UpdateScalarKeyframeCurve`；可动画属性含 transform/opacity/volume/color(RGBA)/text/graphic/effect 参数。**成熟度须打折**：`TangentMode(auto/aligned/broken/flat)` 与 extrapolation **仅是数据模型/求值预留**——无编辑 UI、新 key 默认 `flat`、graph editor 只写 handle/segment 不写 tangent，应视为 substrate 而非完整用户能力（`inventory/opencut-effects-animation.md` §528、§840） | 曲线深度 + keyframe delete/move AutoViral 缺（但 tangentMode/graph-editor 领先幅度被其"半成品 substrate"性质压低——这也正是本报告把 graph editor UI 后置的依据） |
| **文本 / 字幕** | 文本背景 7 参数（enabled/color/cornerRadius/paddingX/Y/offsetX/Y）+ 9 系统字体 + 1920 Google font 目录；**无 stroke、无 shadow、无任何文本动画 preset**；字幕 = 普通 text clip 硬烧录（无 sidecar），可导入 SRT+ASS（含 style 映射）；中文 caption 分块退化为整段一词 | 文本/字幕**动画** AutoViral 反而领先，OpenCut 只强在背景盒 + 字幕导入 |
| **图形 / 贴纸** | flags（271 SVG）+ shapes（rect/ellipse/polygon/star，可 keyframe 形状参数）+ sticker provider registry | AutoViral 仅 carousel 有，video 轨缺 |
| **变速** | `RetimeConfig{rate,maintainPitch}` 恒速 0.01–5×，`maintainPitch` 走离线 SoundTouch `PitchShifter`，**preview 与最终 audio mix 都消费**；**连 speed 曲线数据模型都没有** | AutoViral schema 更强（有曲线+预览），但导出没接上 |
| **预览 / 渲染 / 导出** | 预览与导出复用**同一个 `CanvasRenderer`** 逐帧渲染同一棵 `RootNode`（`renderer-manager.ts` / `scene-exporter.ts:146`）——WYSIWYG **架构性免费**；Rust→wasm 合成器（WebGL/WebGPU + degraded）；导出走 mediabunny/WebCodecs（mp4|webm），**零服务端零 ffmpeg 可离线**；音频只把多轨预混成单个 `AudioBuffer`，**无 loudnorm 无 ducking** | 单渲染器哲学该抄；本地导出 + 无专业音频不抄 |
| **媒体 / 持久化** | 本地优先：项目 JSON→IndexedDB，媒体文件→按项目隔离 OPFS；Mediabunny probe（duration/尺寸/帧率/音轨/可解码性）+ 抽 1s 缩略图；无云同步、无代理生成链路；31 版 schema 迁移链 | probe 导入闭环该借鉴（回填成片场景） |
| **面板布局** | 固定 `Assets | Preview | Properties` + 下方 `Timeline`，拖柄缩放 + Zustand persist 到 localStorage；**无换位/自由停靠/增删面板** | 无特别启示 |

### rewrite 方向的启示：他们自己抛弃了什么

OpenCut `main` 是一次**真实的 destructive reset**——`b3d35fbc` 一次删 1,102 文件 / 131,212 行，清空后只剩 14 个 tracked file（`inventory/opencut-rewrite-direction.md` §1）。rewrite README 把六个能力列为一等目标：**Editor API / plugin-first / Rust 跨端 core / MCP server（面向 AI agent）/ headless 批渲染 / 编辑器内 scripting**——但**截至 `bab8af83` 全部是 scaffold、零实现**（无 project/track/clip/command/keyframe 任何 editor domain model，§5/§6.1）。

对 AutoViral 的三点战略含义：

1. **AutoViral 领先约一个身位。** 竞品刚在纸上规划"让 AI 够着编辑器"，AutoViral 的 `autoviral` CLI + bridge + 共享 ops 已经是能跑的双驱动。**别丢这个先发优势**——补 OpenCut 的 mask/blend/effect-stack 时务必让每个能力同时有 CLI 动词和 UI（`gaps/ai-studio-bridge.md` §D1）。
2. **他们抛弃的正是 AutoViral 该防的坑**（`rewrite-direction.md` §8，均有 commit 支撑）：全局 `EditorCore` singleton（174 处引用，不利 headless 多实例/插件隔离/测试注入）；业务逻辑滞留在 Web UI app；巨型 React hooks 同时持 gesture/DOM/editor state（`6a22a3ec`/`56ca0969` 拆成 controller）；时间在 seconds/frame/ticks 之间散落换算（`eea6d43c` 统一 tick）；命令隐式改 selection（`8bdc8946` 引入 `CommandResult.selection` 显式契约）；注册表 key 封闭域小于真实扩展域（`8b8d65b5` `BuiltinMaskType`→`MaskType` 消除 freeform 特例）。
3. **OpenCut 用整库重写去补的"共享 command/data contract"，AutoViral 已经有雏形**——`src/shared/composition/ops` 就是 UI 与 bridge 共用的收敛地基。缺的不是造它，是**把所有 store-only 动词也纳入这条纪律**（见第 6 章）。

---

## 4. AutoViral 现状盘点

### 4.1 schema 表达力（`src/shared/composition.ts`，单一事实源）
- **能表达且能渲染**：源片段 `in/out`、画布内 `scale/x/y`、归一化 `crop`、`flip`、`freeze`（`freezeAtSec` L230，preview+export 都冻结，**领先 OpenCut** 的 coming-soon）、`reverse`（L231，导出真实 `reverse/areverse`，**OpenCut 无**）、静态变速、cut-point transitions（13 preset）、文本样式（含 `stroke`，**OpenCut 无**）、CaptionModel overlay（逐词 highlight `marker-sweep/scribble/burst/slam/elastic` + entrance，**远超 OpenCut**）、provenance/asset 图（`ProvenanceEdge`+`AssetEntry` L93-137，**OpenCut 无**）。
- **schema 硬缺口**：`VideoClip.transitionIn`（无，L202-236）；stylize 转场枚举（`TRANSITION_PRESETS` `transitions.ts:14-33` 只到 flip/hard-cut，stylize 家族注释自认 "Phase 2 — already orphan endpoints" L43）；mask/matte（无任何概念，最接近的只有矩形 crop）；`blendMode`（无）；detach source audio（`VideoClip` 无 `isSourceAudioEnabled`）；bezier easing（`KeyframeEasingSchema` L145 只有 4 离散枚举）；`groupId`/`linkId`/`locked`（无）。
- **能表达但导出不生效**：多值 speed keyframe（`speed-ramp-ffmpeg.ts` 回退 1×）、AudioClip speed（v1 renderer/export 直接忽略，L161-163 注释）——这是"表达得出、渲染不出"的裂缝，比 OpenCut"模型简单但全渲染"更糟。
- **缺不变量**：`refineTrack`（L357-398）只校验 speed 范围 + transition 完整性，**不校验同轨 clip 时间重叠**；所有时间字段是 `z.number()` 浮点秒，agent 可写任意亚帧 offset，多次 trim/split 累积 round 误差无统一 tick 锚。

### 4.2 Timeline UI / store（`web/src/features/studio/store.ts`）
- store 里有一批**只在 React 层、未下沉共享 ops** 的动词：`rippleDeleteClip`/`collapseGaps`（L143-144、L581-603）、`moveClipWithinTrack`（L172、L374）、`updateTransition`（L490）、`removeKeyframe`/`updateKeyframe`（L938-954）、`renameTrack`/`setTrackLanguage`/`setTrackVolume`、多选 `MarqueeSelection`。**agent CLI/桥接够不着这些**。
- undo/redo 是**两条独立**的 50-深全量 `Track[][]` 快照栈（track-op 栈 L73-90 + clip-op 栈 L90-94，彼此不交织，存在跨栈交错撤销的顺序隐患），且**桥接/CLI 完全没有 undo/redo 动词**——agent 唯一回滚是 `checkpoint create/restore`（整份 composition 粗快照）。

### 4.3 渲染管线（`src/server/render-pipeline.ts`，服务端两段式）
- **刻意选择服务端 Remotion headless + ffmpeg 多级流水线**（浏览器本地渲染无法被 CLI agent 无头驱动，也拿不到 loudnorm/ducking）：预览 = 浏览器 Remotion Player；导出 = REST 入队 → Stage 0/0.4/0.5 ffmpeg 预处理（speed-ramp/time-warp/transforms bake 进缓存 mp4）→ Stage 1 Remotion headless Chromium（`<OffthreadVideo>` 帧精确 seek，S2 修导出倒跳）→ Stage 2 ducking 侧链混音 → Stage 3 字幕烧录（libass，无 text track 即 throw）→ Stage 4 loudnorm 两遍（默认 -14 LUFS）→ Stage 5 `pickEncoder()` 硬件编码（videotoolbox/nvenc/vaapi）。
- **代价**：Remotion composition 在预览/导出共享（一致），但 ffmpeg 预/后处理（变量变速、reverse、ducking、loudnorm）**不进预览** → 这是所有一致性 bug 的来源（`gaps/render-export.md` §G5）。
- **队列生命周期在 REST 完整**：enqueue / list / get（含 progress，`routes/render.ts:104`）/ cancel + Render WS + proxy（半分辨率 24fps）；容器只出 mp4，无 webm/gif。
- **领先项**：ducking + LUFS loudnorm + 硬件编码自适应 + proxy + 队列全生命周期 + sidecar SRT——浏览器本地渲染给不了的工业能力（`gaps/render-export.md` §G16）。

### 4.4 AI 桥接面（`cli/autoviral/`、`src/server/bridge/`）
- **一等公民是双驱动**：`http://127.0.0.1:${port}/api/bridge/v1` + `X-AutoViral-Work-Id`；已共用 `src/shared/composition/ops` 的动词有 split/trim/move/track/scene/transition/keyframe/aspect/fps（`gaps/ai-studio-bridge.md` §D3，这是收敛地基）。
- **CLI 能做**（`inventory/autoviral-ai-bridge.md` 命令表）：`comp show/diff/put/validate/aspect/fps/set`、`clip add/remove/split/trim/move/set`、`clip keyframe add|set`（只 upsert，property 仅 `opacity/scale/x/y/rotation/volume/speed`）、`track add/remove`、`transition add/remove`（无 update）、`scene *`（planning-only，不驱动 timeline 渲染）、`captions generate`（ASR→基础 TextClips，不建 CaptionModel）、`select`（单目标）、`seek/play/pause`、`export`（同步阻塞，无 queue jobId/cancel/captionTracks/burnSubtitles）、`snapshot [--at]`、`checkpoint *`、`ingest youtube`、`quality lint/inspect/validate/check`。
- **CLI 够不着**：ripple/collapse、keyframe delete/move、transition update、多选/框选、track rename/language/volume/mute、asset upload/rm/generate、render queue lifecycle、smart-reframe 批量（且其 Python 脚本已缺失）、libass 独立烧字（`src/domain/audio-tools.ts::burnSubtitles` 无条件 throw）。

---

## 5. 差距矩阵（合并去重四维，按 severity 分层）

下表已合并 `gaps/{editing-operations,effects-visual,render-export,ai-studio-bridge}.md` 四维并去重（同一 #93 转场缺口在四维各出现一次，此处收敛为一条）；另有 G-41 从 issue #95 §4 提升而来——其原文仅列为 recipe/gotcha，但内含一处**服务端工程缺陷**（超时不取消生成→孤儿计费），故在此识别为独立 gap 而非文档条目。severity 判据：**critical** = issue 里用户已实锤被堵 / WYSIWYG 破裂；**high** = 专业剪辑必备且无替代；**medium** = 有替代路径（全量 `comp put` / 直接 curl REST / 近似 op 组合）；**low** = 锦上添花。

### CRITICAL

| # | 差距 | 证据 | proposal |
|---|---|---|---|
| G-1 | 四个 cinematic 转场端点全 500 | `transitions.ts:280` geq 三重错误；issue #93 | 修 geq（`t`→`T`、去 `alpha()`、拆嵌套）+ CI 两纯色 clip 四转场 smoke test，滤镜错 fail fast |
| G-2 | 无 per-clip `transitionIn` schema，cinematic 产物游离 composition 外 | `composition.ts:202-236` 无字段；issue #94 blocker #2 | `VideoClip.transitionIn?:{preset,durationSec,easing}`，Remotion 在 clip 头渲染，进 `TRANSITION_PRESET_META` 注册表（与 cut-point 共用），淘汰 ffmpeg 烘焙端点 |
| G-3 | 变量 speed ramp 导出回退 1×（预览动/导出死） | `speed-ramp-ffmpeg.ts` warn+回退；AudioClip speed 被忽略 `composition.ts:161-163`；issue #94 建议 #2 | 导出 pre-pass 分段 `setpts` 拼接（按 keyframe 切段→段内 setpts/atempo→concat），或走 Remotion 时间重映射；AudioClip 至少匀速 atempo |
| G-4 | 无"导入成片 mp4 为 clip / flatten 到 timeline"一等 verb | `clip add` 不 probe 时长/不清旧 clips；issue #94 blocker #3 | `clip import <mp4> [--replace-timeline]`：ffprobe→注册 Asset+Provenance(import)→可选清空 video 轨放单 clip→广播 |

### HIGH

| # | 差距 | 证据 | proposal |
|---|---|---|---|
| G-5 | libass 独立烧字 adapter 已删但仍被文档引用（死路径+误导） | `audio-tools.ts::burnSubtitles` throw；manual 仍写可用 libass；host ffmpeg 缺 libass（issue #94 #4/#95 #5） | 删/纠正 manual libass 段，**主推 overlay + CaptionModel 烧录路径**（Remotion，无 libass 依赖）；若保留独立 burn 则重建于 managed ffmpeg + doctor feature-probe |
| G-6 | 无 mask/matte 系统（含 cinematic-bars/letterbox） | `composition.ts` 无 mask 概念，仅矩形 crop；OpenCut `masks/types.ts` 9 种 | `VideoClip.mask?:{type,feather,inverted,params}` 起步 rect/ellipse（Remotion SVG clipPath+blur 羽化，ffmpeg geq/alphamerge）；letterbox 作 preset |
| G-7 | ripple delete / collapse gaps 有 UI 无桥接（agent 做不干净快切） | store L143-144/581-603 有，共享 ops 无；issue #94 快切刚需 | 升 `ops.rippleDeleteClip`/`collapseGaps`，CLI `clip remove --ripple` + `track collapse <id>` |
| G-8 | keyframe 只 upsert，无 delete/move；属性面窄（无 color/filters keyframe） | 共享 ops 仅 `addKeyframe/setKeyframe`；store 有 `removeKeyframe/updateKeyframe` 够不着 | 升 `ops.removeKeyframe/moveKeyframe`，CLI `clip keyframe remove/move`；`KeyframePropertySchema` 扩 color/filters |
| G-9 | detach 视频内嵌音轨（拉原声成独立 A 轨做 ducking）无动词无字段 | `composition.ts:202-236` 无 `isSourceAudioEnabled`；OpenCut `ToggleSourceAudioSeparationCommand` | `VideoClip.sourceAudio?:{enabled,volume}` + `op detachAudio(clipId)` 生成同源 AudioClip；CLI `clip detach-audio` |
| G-10 | 预览与导出非单渲染器，speed-ramp/reverse/ducking/loudnorm 只在导出侧 | `gaps/render-export.md` §G5 | 不弃两段式，但**持续缩小 ffmpeg 私有分支**（能进 Remotion 的都进）+ 加"预览 vs 导出单帧 PNG 比对"一致性回归 gate |
| G-11 | render 对 agent 是可发现性黑盒（CLI 无 queue lifecycle） | 状态端点存在于 `GET /api/render/jobs/:id`，issue 用错 URL；CLI export 同步阻塞 | ① 把 `/api/render/jobs/:id` 写进 skill/manual；② CLI 补 `render enqueue/status/cancel/history`，订阅 `/ws/render/jobs/:id` |

### MEDIUM

| # | 差距 | 证据 | proposal |
|---|---|---|---|
| G-12 | 无 per-clip 有序 effect 栈（只有扁平 3 旋钮 grade+lut） | `composition.ts:65` FiltersSchema 扁平；OpenCut `effects/types.ts` 栈 | `filters`→`effects:EffectEntry[]{id,type,params,enabled}`，type 起步 grade（收编现有）+blur+vignette+grain；旧 filters 作 grade entry 向后兼容投影 |
| G-13 | 无 blend mode | 无字段；OpenCut 17 种 | `VideoClip/OverlayClip.blendMode` 枚举先 normal/screen/multiply/overlay/add，Remotion `mix-blend-mode`，ffmpeg `blend` |
| G-14 | 无 adjustment/scene-effect 层（跨 clip 时间区间效果） | filters 只挂单 clip；OpenCut `EffectElement`→sceneEffect | `kind:"adjustment"` track 或 `EffectClip`，作用其时间窗内下层轨 |
| G-15 | keyframe 插值只 4 离散 easing（无 bezier/graph/tangent） | `composition.ts:145`；OpenCut `ScalarAnimationKey{handles,tangentMode}`+graph editor | `easing` 扩 `\|{type:"cubic-bezier",p:[..]}`，Remotion `Easing.bezier`；先开数据模型让 agent 能写 bezier，graph editor UI 后置 |
| G-16 | transition 只 add/remove，不能 in-place update | store 有 `updateTransition` L490，桥接无 | 升 `ops.updateTransition`，CLI `transition set <id> --preset/--dur` |
| G-17 | 多选/框选无桥接协议（select 单目标） | store 有 MarqueeSelection，桥接 `select` 单目标 | `select clips <id1> <id2>…`，桥接补多目标 frame |
| G-18 | motion 转场家族过薄（只有 flip，无 whip-pan/zoom） | `transitions.ts:71` motion 仅 flip；抖音高频 whip-pan | 补 `whip-pan-left/right`（Remotion 位移+motion blur）、`zoom-in/out` 进注册表 |
| G-19 | 普通 TextClip 无背景盒/pill（只有 CaptionModel 有） | `composition.ts:270` style 无 background/padding/radius | `TextClip.style.background?:{color,paddingX,paddingY,radius}` |
| G-20 | 无 SRT/ASS/VTT 字幕文件导入 verb | 只有 `ingest youtube`+`captions generate`；OpenCut 可导入 ASS 含 style 映射 | `captions import <file.srt\|.ass>`→CaptionModel（复用 OpenCut style 映射思路） |
| G-21 | ASR timing + ground-truth 文本替换 + 中文短行分割 工作流缺失 | issue #95 #3 实测 ASR 文本全错 | `captions generate --script <file>`（ASR 出 timing + 已知文本对齐替换）+ `--max-cjk-chars 14`→CaptionModel |
| G-22 | CLI export 无 caption-tracks sidecar（能力在 queue，CLI 够不着） | queue render 支持 captionTracks，CLI export body 只 preset/proxy/variables/strict | CLI `export --caption-tracks zh,en` 透传 queue，或 CLI export 收敛到 queue 路径 |
| G-23 | video 时间线无矢量 shape/sticker（carousel 有，video 无） | video 只有 video/audio/text/overlay 四种 clip | video 增 `kind:"shape"`/`"sticker"` clip 或复用 carousel layer 模型到 video renderer |
| G-24 | 导出容器仅 mp4，无 webm/gif | `render-pipeline.ts:632` finalPath=.mp4；OpenCut mp4\|webm | encode stage 支持 webm 容器（vp9/opus），gif 低优 |
| G-25 | 同轨 overlap 不变量缺失（agent 可静默写重叠 clip） | `refineTrack` L357-398 不校验重叠；OpenCut `placement/overlap.ts` 半开区间拒绝 | preflight/refineTrack 增同轨重叠告警（video 轨 error，overlay 轨放行做 PiP） |
| G-26 | 浮点秒 vs 整数 tick——亚帧漂移风险 | 全时间字段 `z.number()` 秒制；OpenCut `eea6d43c` 全链路 tick | ops 层对 offset/in/out 做 `snapToFrame(sec,fps)` 量化，或引入整数帧内部表示 |
| G-27 | 无 duplicate / copy-paste 片段 | 无动词无 clipboard；OpenCut Duplicate+Paste command | `op duplicateClip`，CLI `clip duplicate <id> [--offset]` |
| G-28 | track rename/language/volume/mute/hidden 无 CLI | store 有，CLI `track` 只 add/remove | `track set <id> --label/--language/--volume/--muted` |
| G-29 | smart reframe 批量无 CLI 且 Python 脚本已缺失 | UI 切 preset 并发 `POST /api/video/reframe`；脚本缺失会 fail | 先修脚本，再 `clip reframe <id> --aspect 9:16`（punch-in 手动 crop 是替代） |
| G-30 | asset upload/rm/generate 无 CLI 封装 | REST-only，CLI 只 list/ingest+受限 scene generate | `asset upload/rm/generate`，删除动词内建级联清 composition 引用 |
| G-31 | scene 图不驱动 timeline 渲染（planning-only） | `gaps/ai-studio-bridge.md`；OpenCut Scene 是渲染一等结构 | scene 图 flatten/compile 成可渲染 timeline |
| G-32 | 任意帧秒开快照验证未充分暴露 | `snapshot [--at]` 已存在但 `gaps/render-export.md` §G8 指其未作"渲染中第 N 帧校验"暴露；`remotion-still.ts` 有单帧能力 | 明确 `render snapshot --frame N`→PNG，给 agent 廉价 ground-truth 自检点 |
| G-41 | 客户端超时不取消服务端生成 → 为孤儿 clip 付费（#95 item 4 的**工程半边**，非纯 recipe） | issue #95 §4："client-side timeout does NOT cancel server-side generation → billed for an orphan clip"；属**成本泄漏型服务端健壮性缺陷**，与本仓历史 work-delete orphan render（#63）/ export dedup（#62）同类 | 服务端：断连/客户端 abort 即取消对应生成 job（对齐 #63 的 `cancelInFlightRenders` 先于释放模式）；批量生成走 manifest **幂等去重**（跳过已完成、同 key 不重复下单，防重复付费）。**这条是工程修复，不是"用宽松超时"能兜住的 recipe**；#95 其余六条仍为 `skills/autoviral` recipe/gotcha |

### LOW

| # | 差距 | 说明 |
|---|---|---|
| G-33 | track/clip lock（防误触） | 两家都缺，`TrackSchema` 有 muted/hidden 无 locked |
| G-34 | split-left/right retain-side | OpenCut Q/W 切并弃一侧；AutoViral 须 split 后再 remove |
| G-35 | 轨内 reorder CLI | store 有 `moveClipWithinTrack`；因 clip 靠绝对 offset，agent 改 offset 可近似 |
| G-36 | maintainPitch/独立变调控制 | OpenCut SoundTouch；AutoViral atempo 隐式保音高不可控 |
| G-37 | 文本 shadow/glow | 两家都缺（AutoViral 有 stroke OpenCut 无），补齐 ROI 高 |
| G-38 | 字体目录/校验/中文字体保证 | `font` 是自由字符串，无 catalog；并入 `quality lint` |
| G-39 | 细粒度 undo/redo 对 agent 不可达 | checkpoint 是有效粗粒度替代，故 low |
| G-40 | timeline viewport zoom/fit/pan 无桥接 | 不影响成片，只影响协作演示；加 `ui-zoom`/`view zoom` |

### 明确不抄 / 两家都缺（避免误规划）

- **不抄**：OpenCut 浏览器本地 WebCodecs 导出整条路线（`gaps/render-export.md` §G13，与 agent-headless 命题正面冲突，无头 CLI 驱动不了）；Rust/WASM/WebGPU 合成层（同文件 §G14，收益是速度非能力，成本极高，继续投硬件编码+流式渲染即可）。（这两个 §G13/§G14 是 render-export 维度内部编号，**与上文合并矩阵 G-13=blend mode / G-14=adjustment 层是不同东西**——矩阵 G-13/G-14 是要建的能力，均已归入 Epic G。）
- **两家都缺，非 OpenCut 驱动**：roll/slip/slide 编辑（OpenCut 也明确未实现）；持久 groupId；linked A/V（linkId）；track/clip lock；文本 shadow/glow。这些补不补是 AutoViral 自身路线判断，不是"追平 OpenCut"。
- **AutoViral 已领先、保持并文档化、v0.2.0 不投入追赶**：cut-point 转场 13 preset（OpenCut pre-rewrite Transitions 面板"尚未实现"）；文本/字幕**动画**（`kinetic-pop/typewriter/slide-up/fade` + CaptionModel 逐词 highlight，OpenCut 文本无任何动画 preset）；freeze/reverse 导出；ducking + LUFS loudnorm；provenance/asset 图；变速数据模型+预览（OpenCut 连曲线都没有）。

---

## 6. AI↔Studio 断层专章（本报告灵魂）

OpenCut 没有 agent 概念——它把编辑能力做成给"人在 UI 点"的，rewrite 才刚开始**规划** MCP/Editor-API/headless（全未实现）。AutoViral 反过来：一等公民是 `autoviral` CLI（agent）+ Studio UI（人）双驱动，桥接面已经跑通。所以本维度的命题不是"抄 OpenCut 的 agent 层"，而是：**当我们补齐 OpenCut 那些成熟剪辑能力时，怎么让每一个能力天生就是双驱动——agent 经 CLI/ops、人经 UI，收敛到同一份 composition。**

### 6.1 正向断层：agent 已会做、Studio 表达不了

这一簇是 agent 今天真的"绕到裸 ffmpeg、成片与时间线脱节"的直接原因（issue #93/#94）：

| 断层 | agent 想做的动作 | Studio/schema 为何表达不了 | severity |
|---|---|---|---|
| cinematic transition-in | `clip transition-in <id> --type glitch --dur 0.4` | 端点 500 + 无 `VideoClip.transitionIn` 字段，产物是烘焙 MP4 游离 composition 外 | critical |
| 变速斜坡 | `clip keyframe add --property speed`（已能写） | 导出静默回退 1×，agent 设的变速是"预览幻觉" | critical |
| 成片回填 | "把这个 master.mp4 放成一条 clip / flatten beats" | 无 import/probe/flatten 一等 verb，Studio 停在旧版本 | critical |
| 样式字幕烧录 | "按 font/size/outline/position 烧字进导出" | 独立 libass adapter 已删 throw；CLI export 无 captionTracks/burnSubtitles | high |
| mask/letterbox | "给这段加椭圆聚光/2.35:1 黑边" | 无任何 mask 概念，agent 连 letterbox 都做不了 | high |
| blend/effect 栈 | "screen 混合叠漏光" / "加 vignette+grain" | 无 blendMode，filters 是扁平不可堆叠 | medium |

### 6.2 反向断层：人在 UI 能做、agent 经 CLI 够不着

这些不是 OpenCut 独有能力，而是 AutoViral 自己 **UI 领先于 bridge** 的地方——补法统一是"把 store 里已有的 intent 提成共享 op + CLI 动词"：

| 反向断层 | UI store 已有 | bridge/CLI 现状 | 下沉目标 |
|---|---|---|---|
| ripple delete / collapse gaps | `rippleDeleteClip`/`collapseGaps` | `clip remove` 只 filter 删留空隙 | `ops.rippleDeleteClip`，`clip remove --ripple` |
| keyframe delete/move | `removeKeyframe`/`updateKeyframe` | 只 upsert | `ops.removeKeyframe/moveKeyframe` |
| transition update | `updateTransition` | 只 add/remove | `ops.updateTransition`，`transition set` |
| 多选/框选/整组操作 | `MarqueeSelection`+group drag | `select` 单目标 | `select clips …` |
| track rename/language/volume/mute | `renameTrack/setTrackLanguage/setTrackVolume` | `track` 只 add/remove | `track set …` |
| render queue lifecycle | Render 队列 REST 全生命周期 | CLI export 同步阻塞绕过 queue | `render enqueue/status/cancel` |

`updateTransition`（当初就没把 update 做成双驱动）是**"补新能力别只做 UI"的活教材**：转场系统上线时 add 做了双驱动、update 只做了 UI，于是留下这条反向断层（`gaps/ai-studio-bridge.md` §C1）。

### 6.3 设计原则：每个新能力必须天生双驱动

`gaps/ai-studio-bridge.md` §D2 提出、本报告确立为 v0.2.0 的工程纪律：

> **任何新剪辑能力必须落在 `src/shared/composition/ops` 共享层，CLI/bridge 和 UI store 都从这里调，禁止只在 store 里写 intent。**

三条落地机制：
1. **收敛地基已存在**：split/trim/move/track/scene/transition/keyframe/aspect/fps 已共用 `src/shared/composition/ops`（§D3）——把上面 6.2 的所有反向断层动词也纳入这条纪律即可，成本低、收益高。
2. **补新能力（mask/blend/effect-stack）时三件一起设计**：`ops.setClipMask` 共享 op + `autoviral clip mask <id> --shape ellipse`（agent）+ Inspector Pen 工具（人）。**不要重蹈 `updateTransition` 覆辙**。
3. **验收标准 = 驱动方纬度一致性**（对齐 CLAUDE.md `<e2e>`）：agent CLI 一条路径 + 人 UI 一条路径，产出**同一份 composition/成片**。这是 AutoViral 相对 OpenCut 的命题核心，也是每条 gap 补齐的落点。

### 6.4 双驱动 determinism 的地基
帧量化（G-26）不只是防倒跳——agent 报的时间点（"在 4.29s 切"）与人在 UI 拖的播放头必须落在同一帧，否则双驱动产出不一致（`gaps/ai-studio-bridge.md` §B5）。整数帧不变式是双驱动 determinism 的地基，虽 severity 标 medium，但它是"两条路收敛到同一 composition"的隐性前提。

---

## 7. v0.2.0 建议范围：可切片的 epic 清单

纪律提醒：本项目奉行 **"boil the ocean"**——顺延必须有**硬依赖理由**（前置 epic 未落地会导致重复返工 / 命题冲突），**不接受"工作量大"作为顺延借口**。下列 epic 按依赖排序。

### 进本版（v0.2.0）

**Epic A — cinematic 转场修复 + stylize 家族进 Remotion 注册表**（P0）
- 目标：修 `geq` 表达式 + CI smoke test（G-1）；把 light-leak/glitch/whip 做成 Remotion presentation 进 `TRANSITION_PRESET_META`，淘汰 ffmpeg 烘焙端点（G-2 前半、G-18）。
- 涉及面：`src/server/render/transitions.ts`、`src/shared/transitions.ts`、Remotion transition 组件、CI。
- 依赖：无。**规模**：中。**理由**：issue #93 用户当日被堵，最高优先级；注册表是 Epic B 的前置。

**Epic B — schema 承载真实快切 + 内嵌音轨分离：per-clip transitionIn + 变速导出 + reframe 语义糖 + detach-source-audio**（P0）
- 目标：`VideoClip.transitionIn`（G-2 后半）；导出分段 setpts 让变速真实生效（G-3）；加 `clip reframe` 语义糖 + recipe（消除 issue #94 blocker #2 的可发现性误判）；**`VideoClip.sourceAudio?:{enabled,volume}` + `op detachAudio(clipId)`（生成同源 AudioClip）+ CLI `clip detach-audio`（G-9）**——把视频原声拉成独立 A 轨，直接支撑 issue #94 的 ducked BGM（BGM 在旁白/原声下压音）与 issue #95 item 1 的 VO 独立成轨工作流（editing-operations §B3 指其为该工作流所需能力的反向操作）。三处（transitionIn/speed/sourceAudio）都是 §1 执行摘要点名的 schema 硬缺口，同属 VideoClip schema 补全，合并在本 epic 一次落地。
- 涉及面：`composition.ts` schema（含 `VideoClip.sourceAudio`）、`speed-ramp-ffmpeg.ts`、render pre-pass、CLI clip 命令（含 `detach-audio`）、共享 ops（含 `detachAudio`）、ducking 混音链消费新 A 轨。
- 依赖：**硬依赖 Epic A**（transitionIn 复用同一 Remotion 注册表；先建注册表再挂 clip 字段，否则 transitionIn 无渲染器可指）；detach-source-audio 部分无 Epic A 依赖，可并行起步。**规模**：大。

**Epic C — 成片回填：import/flatten 一等 verb**（P0）
- 目标：`clip import <mp4> [--replace-timeline]`（ffprobe→Asset+Provenance→放置，G-4/G-31 部分）。
- 涉及面：CLI、bridge 端点、共享 op、ffprobe 封装。
- 依赖：无。**规模**：中。**理由**：issue #94 blocker #3，"Studio 是视觉入口"的最后一公里。

**Epic D — 共享 ops 纪律 + 反向断层批量下沉**（P1，AI↔Studio 灵魂）
- 目标：把 ripple/collapse（G-7）、keyframe delete/move（G-8）、transition update（G-16）、多选（G-17）、track set（G-28）、render queue CLI（G-11）从 store-only 提成共享 op + CLI verb；立"新能力必须落共享 ops"的 lint 规则。
- 涉及面：`src/shared/composition/ops`、`web/src/features/studio/store.ts`（改调共享 op）、CLI 全家、bridge routes。
- 依赖：无（地基已存在）。**规模**：中大。**理由**：单条杠杆最高——八成"差距"是三层不对齐，此 epic 一次性焊死；成本低（intent 已在 store）。

**Epic E — 字幕闭环 + 生成韧性工程 + 文档纠偏**（P1）
- 目标：删/纠正 manual libass 段、主推 overlay+CaptionModel（G-5）；`captions generate --script`（ASR timing + ground-truth 替换 + `--max-cjk-chars`，G-21）；CLI `export --caption-tracks`（G-22）；**生成韧性工程半边（G-41）：断连/客户端 abort 即取消服务端生成 job + 批量生成 manifest 幂等去重，堵住孤儿 clip 计费泄漏（与 #63/#62 同类）**；issue #95 其余六条 recipe 落 `skills/autoviral`。
- 涉及面：`skills/autoviral/manual` + `recipes/video/`、`captions` 命令、CLI export、`audio-tools.ts`、生成/asset 生成路由 + 服务端 job 生命周期（G-41）。
- 依赖：无。**规模**：中。**理由**：issue #94 #4 / #95 直接命中，且死路径+误导文档双重伤害；G-41 是本仓反复出现的成本泄漏族（孤儿 render / 重复 export）的又一实例，属可一次性焊死的工程债。

**Epic F — 渲染验证基础设施**（P1）
- 目标：`/api/render/jobs/:id` 写进 skill（G-11 文档侧）；`render snapshot --frame N`→PNG（G-32），给 agent 廉价 ground-truth 自检点，直接支撑 e2e 铁律"浏览器可见为准"。
- 涉及面：`skills/autoviral/manual`、`remotion-still.ts`、CLI。
- 依赖：无。**规模**：小。**理由**：低成本高收益，agent 因不知端点被逼回裸 ffmpeg。

**Epic G — 视觉表达力扩展：mask + letterbox + blend + effect 栈 + adjustment 层**（P2）
- 目标：`VideoClip.mask` 起步 rect/ellipse + letterbox preset（G-6）；`blendMode` 五枚举（矩阵 G-13，非 render-export §G13）；`filters`→有序 `effects` 栈（G-12）；**跨 clip 时间区间的 adjustment/scene-effect 层（矩阵 G-14）——`kind:"adjustment"` track 或 `EffectClip`，作用其时间窗内下层轨**；bezier easing 数据模型（G-15）。全部三件套双驱动落地。
- 涉及面：`composition.ts`、Remotion renderer、ffmpeg 滤镜、CLI、Inspector UI、共享 ops。
- 依赖：**软依赖 Epic D**（这些是新能力，应在"共享 ops 纪律"确立后落地，避免又造出反向断层）。**规模**：大。**理由**：抄 OpenCut 架构最值钱的一块，short-video 刚需（漏光/聚光/形状揭示）。

**Epic H — 单渲染器收敛 + 帧量化 + overlap 不变量**（P2，地基）
- 目标：一致性回归 gate（预览 vs 导出单帧 PNG 比对，G-10）；ops 层 `snapToFrame` 量化（G-26）；`refineTrack` 同轨 overlap 校验（G-25）。
- 涉及面：render-pipeline、`composition.ts` refineTrack、共享 ops、测试。
- 依赖：无（但为顺延项的前置）。**规模**：中。**理由**：WYSIWYG 长期约束 + 双驱动 determinism 地基。

### 顺延（附硬依赖理由，非工作量借口）

| 顺延项 | 硬依赖理由（非工作量） |
|---|---|
| 持久 groupId / linked A/V（G-29 家族、C4/C5） | **硬依赖 Epic D 落地稳定**：linkId/groupId 的编辑联动传播逻辑要穿过 every 编辑动词（move/trim/split/delete）；在共享 ops 纪律确立前引入，等于把传播逻辑在 store 和 ops 两处各写一遍，Epic D 落地后必然重写——先后倒置会双倍返工。 |
| 整数帧 tick 全链路迁移（G-26 完整版） | **硬依赖 Epic H 的渲染收敛**：完整 branded-tick 迁移要求 schema 成为唯一时间源、所有 Remotion/ffmpeg 换算都路由过它（OpenCut `eea6d43c` 是 79 文件端到端改动）；在单渲染器收敛（H）之前做，会因导出侧仍有独立 ffmpeg 时间换算而变成双迁移。v0.2.0 先做 op 边界的 `snapToFrame` 量化（捕获 90% 正确性收益），完整迁移待 H 稳定后。 |
| graph editor UI（G-15 可视化部分） | **无 agent-path 依赖**：bezier **数据模型**进 Epic G（agent 必需），但可视化 graph editor 是纯人侧 ergonomics，零双驱动依赖——离散 easing + 裸 bezier 参数已给 agent 完整表达力，缺 UI 不阻塞任何双驱动能力。这是"无 agent 依赖"而非"没时间"。 |
| 细粒度 undo/redo CLI（G-39） | **有充分替代**：`checkpoint create/restore` 是有效的粗粒度 agent undo（内容 hash 去重），且 chat bridge 已做每 turn 自动 checkpoint。合并双快照栈为单栈是内部质量项，无 issue 驱动、有替代路径。 |
| 浏览器本地 WebCodecs 导出、Rust/WASM 合成层（`gaps/render-export.md` §G13 / §G14——**注意此处 §G13/§G14 是 render-export 维度内部编号，与本报告合并矩阵的 G-13=blend / G-14=adjustment 层无关，勿混淆**） | **命题冲突，永不做**：与 agent-headless / 服务端批渲染 / 专业音频后处理正面冲突（浏览器本地渲染无法被 CLI 驱动）；WASM 合成收益是速度非能力。这是架构立场，不是排期。 |
| video shapes/stickers（G-23）、webm 导出（G-24）、subtitle import（G-20）、duplicate（G-27）、text background（G-19）、smart-reframe 修复（G-30）、asset CLI（G-28 邻近） | **无硬依赖，纯优先级排布**：均有替代路径（overlay 贴 PNG / mp4 已够抖音 / ASR 生成 / comp put / 手动 crop / curl REST），且不在三 issue 关键路径。若 Epic A–H 提前收敛，这些应尽量拉进本版（boil the ocean）——列此是排布而非放弃。 |

---

## 8. 附录：材料文件索引

所有路径相对仓库根 `/Users/nanjiayan/Desktop/AutoViral/autoviral`。

**盘点（inventory）**
- `docs/竞品/analysis/inventory/opencut-timeline-core.md` — OpenCut Timeline 编辑核心（命令模式、ripple、placement 不变量、MediaTime tick）
- `docs/竞品/analysis/inventory/opencut-effects-animation.md` — OpenCut 效果/动画/关键帧/mask 系统
- `docs/竞品/analysis/inventory/opencut-text-captions-audio.md` — OpenCut 文本/字幕/贴纸/音频/变速
- `docs/竞品/analysis/inventory/opencut-media-project-persistence.md` — OpenCut 媒体库/项目/持久化（本地优先 IndexedDB+OPFS）/面板布局
- `docs/竞品/analysis/inventory/opencut-rewrite-direction.md` — OpenCut rewrite（main）架构方向：抛弃了什么、路线图六能力全未实现
- `docs/竞品/analysis/inventory/autoviral-ai-bridge.md` — AutoViral AI↔Studio 桥接面现状（CLI×REST/WS 完整命令表）
- `docs/竞品/analysis/inventory/opencut-preview-render-export.md` — OpenCut 预览/渲染/导出引擎（单渲染器 WYSIWYG、Rust MediaTime/wgpu Compositor，同日补齐）
- `docs/竞品/analysis/inventory/autoviral-render-pipeline.md` — AutoViral 渲染管线现状（#93 根因逐端点核实，同日补齐）
- `docs/竞品/analysis/inventory/autoviral-studio-timeline.md` — AutoViral Studio 时间线与 composition 表达力（写路径三分裂证据，同日补齐）

**差距矩阵（gaps）**
- `docs/竞品/analysis/gaps/editing-operations.md` — 剪辑操作能力（timeline 交互与编辑动词，A/B/C/D/E 分层）
- `docs/竞品/analysis/gaps/effects-visual.md` — 效果/转场/文本/字幕视觉能力（A–G）
- `docs/竞品/analysis/gaps/render-export.md` — 预览/渲染/导出架构（G1–G16 + 抄/不抄清单）
- `docs/竞品/analysis/gaps/ai-studio-bridge.md` — AI↔Studio 打通（灵魂维度，A/B/C/D + 打通优先级表）

**issue 原文**
- `docs/竞品/analysis/issue-93.md` — cinematic 转场端点全 500（geq 表达式 bug）
- `docs/竞品/analysis/issue-94.md` — Studio 承载不了 agent 剪辑（五 blocker）
- `docs/竞品/analysis/issue-95.md` — autoviral skill 操作手册缺口（七 recipe/gotcha）
