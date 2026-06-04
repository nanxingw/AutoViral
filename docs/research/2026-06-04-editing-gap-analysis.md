<!-- 自动生成：workflow av-editing-gap-research (run wf_ceea7a13-104)，17 agents / 1.86M tok / 2026-06-04。结构化原始数据见同名 .data.json -->

# AutoViral v0.1.3 剪辑能力调研报告

## 1. 执行摘要

**一句话定位**：AutoViral 在浏览器里是一台**真正可用的多轨 NLE**（split/trim/ripple/跨轨移动/转场/关键帧/调色/混音全是真实现、preview 与 export 同走 Remotion 因而 WYSIWYG），但它的**核心命题「任意 CLI agent 经 `autoviral` CLI 驱动剪辑」在写路径上只覆盖了一小块**——富功能几乎全是 built-but-human-only，agent 够不着。

**与竞品的总体差距**：
- 对 **剪映 / CapCut**（消费级基本盘 + AI 上限）：缺整片基础能力——crop/fit-fill/翻转/倒放/定格/绿幕抠像/蒙版/曲线调色/特效库/贴纸库/花字/文字模板/踩点/人声分离/降噪/一键成片/自动字幕落轨。差距属于**基本盘级**，不是边角。
- 对 **OpenShot**（开源剪辑器基准）：AutoViral 时间线能力相当甚至更强（keyframe 引擎、转场 WYSIWYG），但缺 OpenShot 都有的 crop/chroma key/LUT/序列帧导出/FCPXML 互通。
- 对 **AI 原生工具**（Descript/Opus/Captions/Veed/Runway）：这是 AutoViral **命题最同源、也最该赢的战场**（自然语言 agent 驱动），但目前**反而最弱**——无 transcript editing、无 clip-anything 切片、无 viral score、无 auto-reframe（脚本已删）、无 B-roll、无去 filler/静音、无 dubbing/lip-sync（全 stub）。竞品是「下指令→引擎执行」，AutoViral 是「agent 自己当编辑引擎手搓 JSON」。
- 对 **专业三巨头**（Premiere/FCP/Resolve）：缺四种精修 trim、七种插入编辑、节点调色、混音台、多机位、代理工作流——多数对 agent 命题非基本盘，可延后。

**最关键的 5 个结论**：

1. **agent 触达面是系统性落空，不是个别缺口**。bridge 只有 `clip add/set/remove` + `carousel add-slide/set-layer` + `ui-*` + `export/snapshot`。**没有任何** split/trim/transition/keyframe/track/scene/variable/move-to-track 意图级动词。store.ts 里 ~25 个成熟意图级 action 全是 UI-only。

2. **`clip set` 对所有嵌套字段静默失效**——这是最隐蔽的硬伤。flat-key 解析器（`clip.ts:62`）只能传顶层标量，PATCH 浅合并 + zod 默认 strip，导致 `clip set vc1 --scale 2` 返回 `ok:true` 但画面纹丝不动。agent 改图最常动的 transform/filter/style/position/keyframes/fade/ducking **全部碰不到**。

3. **官方 recipe 教 agent 跑一条 100% 会失败的命令**。`crossfade-between-clips.md:56` 自己写了「schema expects an array」，紧接着 `:70` 却给出 `clip set --keyframes '<json>'`——这条必报 HTTP 400。文档撒谎，浪费整个 agent 会话预算。

4. **"改完不刷新" 的最后一公里再次断裂**。五个 composition/carousel 写盘端点没有一个 broadcast `composition-changed`，全靠脆弱的 `fs.watch`。这与历史 asset-added bug 同源——agent 收到 200 以为成功，用户却「什么都没看到」。

5. **AutoViral 名字直指的能力（自动爆款切片）零实现**。`/api/audio/beats` 返 410、reframe 返 501、ASR captions 后端完整但前端零 UI、clip-anything/viral-score 从未存在。命名承诺与实现的落差是品牌级风险。

---

## 2. 能力现状盘点

标注：✅完整 / 🟡部分 / 🟥缺失或 stub / 🔌仅 UI（agent 经 CLI 够不着）

### 2.1 Timeline 时间线编辑

| 能力 | 存在性 | agent 可达 | 备注 |
|---|---|---|---|
| Split 分割（keyframe 重基） | ✅ | 🔌 | store.ts:543 真实；agent 无 split 动词 |
| Trim 双边（邻接 cap + min-dur + keyframe rebase） | ✅ | 🔌 | store.ts:451；`clip set` 只能盲设 in/out，无 cap/clamp/rebase |
| Ripple delete（合拢空隙） | ✅ | 🔌 | `clip remove` 是 plain delete 留空隙，非 ripple |
| 跨轨移动 | ✅ | 🔌 | 3 条 UI 路径；PATCH 永远原地改不跨轨 |
| 多轨 add/remove/reorder/rename/mute/hide/volume/language | ✅ | 🔌 | bridge **无任何 /track 端点**；mute/hide 还绕过 undo |
| Collapse gaps / in-track reorder | ✅ | 🔌 | in-track reorder 甚至无 UI caller（孤儿）|
| 磁吸 snapping / zoom | ✅ | n/a | 纯交互，agent 用绝对秒无需触达 |
| click-to-seek / 选中 | ✅ | ✅ | `autoviral seek/select` 真可用 |
| add clip（library→track） | ✅ | 🟡 | CLI 可加 video/audio/text；**overlay 被显式拒绝** |
| Copy/paste/duplicate · group · markers | 🟥 | 🟥 | 全仓不存在 |
| Track solo · lock | 🟥 | 🟥 | grep 零命中 |
| Undo/redo | 🟡 | 🔌 | 仅 track-op 级；clip 操作全不入栈；无 Cmd+Z 键位 |
| Ripple insert / 三四点插入编辑 | 🟥 | 🟥 | addClip 只 push 不推邻，静默 overlap |

### 2.2 转场 / 滤镜 / 特效 / 关键帧 / 变速

| 能力 | 存在性 | agent 可达 | 备注 |
|---|---|---|---|
| 13 时间线转场 preset（WYSIWYG） | ✅ | 🔌 | transitions.ts 完整；bridge 无 /transition |
| 转场参数（duration/easing） | ✅ | 🔌 | **alignment 是死参数**（渲染端不读）|
| 风格化转场（light-leak/glitch/...） | 🟡 | 🟥 | 真 ffmpeg，但产独立 mp4 旁路，不入时间线、无 CLI |
| 关键帧引擎（7 属性 + bezier） | ✅ | 🔌 | 引擎真实；CLI `--keyframes` **坏的**（见诚实修正）|
| 基础调色（brightness/contrast/saturation） | ✅ | 🔌 | CSS filter 真渲染；CLI 嵌套写不进 |
| LUT 调色 | 🟥 | 🟥 | **schema 有字段、全仓零消费=死字段**（虚假可达）|
| 变换（scale/x/y/rotation/opacity） | ✅ | 🔌 | 真渲染；嵌套 CLI 够不着 |
| 静态变速 | ✅ | 🔌 | export 经 ffmpeg setpts/atempo 真重采样 |
| 可变变速 | 🟡 | 🔌 | **preview 有、export 静默回 1×**（WYSIWYG 破裂）|
| crop · 倒放 · 定格 · 翻转/镜像 · fit-fill 模式 · 画布比例切换 | 🟥 | 🟥 | 全缺（fit-fill/比例切换/翻转为复核新增遗漏）|
| 帧插值/超分/lip-sync | 🟥 stub | 🟥 | 三 processor 无模型→copyFile |
| reframe 智能裁切 | 🟥 stub | 🟥 | 脚本已删，运行时 501 |
| 绿幕/抠像/蒙版/稳定/运动追踪/混合模式 | 🟥 | 🟥 | 完全不存在 |
| 文字动画 4 预设 / 通用动画预设库(Ken Burns) | ✅ / 🟥 | 🔌 / 🟥 | 文字动画真渲染但 CLI 够不着；无组合预设 |

### 2.3 音频

| 能力 | 存在性 | agent 可达 | 备注 |
|---|---|---|---|
| per-clip volume / fadeIn/fadeOut | ✅ | ✅ | `clip set --volume/--fadeIn` 顶层标量真可达 |
| keyframe volume | ✅ | 🔌 | 数组字段 CLI 写不进 |
| Ducking | 🟡 | 🔌 | 触发硬编码 voiceover；attack/release 被丢；CLI 嵌套写不进 |
| per-track dB / mute | ✅ | 🔌 | 无 /track 端点 |
| 多轨混音 amix / loudnorm | ✅ | 🟡 | 经 HTTP 可达；无专用 CLI 动词 |
| 波形可视化 | ✅ | n/a | 服务端预烤 + WebAudio fallback |
| TTS 配音 | ✅ | ✅ | **最强 agent 路径** `autoviral preprocess tts` |
| ASR 自动字幕 | 🟡 | 🟥 | **后端完整、前端零 UI、无 CLI**（built-not-wired）|
| BGM / AI 音乐 | 🟥 stub | 🟥 | 指向已删 music_generate.py |
| 踩点 / beat sync | 🟥 | 🟥 | /api/audio/beats 返 410 |
| 降噪 / EQ / 混响 / 变声 / 人声分离 / 录音 / 音频提取 | 🟥 | 🟥 | 全缺 |

### 2.4 文字 / 字幕 / 图文 carousel

| 能力 | 存在性 | agent 可达 | 备注 |
|---|---|---|---|
| 视频 TextClip 样式（字体/字号/字重/斜体/色/字间距） | ✅ | 🔌 | 嵌套 style CLI 写不进 |
| 视频字幕对齐 | 🟡 | 🟥 | **渲染写死 center，schema 无 align 字段** |
| 视频字幕描边 | 🟡 | 🔌 | UI 叫"描边"实为 textShadow 发光，非真轮廓 |
| 视频字幕阴影 / 行距 | 🟥 | 🟥 | 无独立字段；lineHeight 是孤儿 schema |
| 视频字幕动画 4 预设 | ✅ | 🔌 | 真渲染；CLI 够不着 |
| 图文 TextLayer 样式 | ✅ | ✅ | `carousel set-layer` 整对象写入（缺 italic/tracking flag）|
| 图文形状/贴纸层 | ✅ / 🟡 | ✅ | 贴纸=纯图片层，无内置素材库 |
| 图文布局模板(3) / 调色板(5) | ✅ | 🔌 | 重排/重着色逻辑只在 store action，整 PUT 不触发 |
| 海报背景/grain/gradient | ✅ | 🟡 | sharpen 是死字段(#70) |
| 自动字幕落轨 / kinetic 字幕样式 | 🟡 | 🟥 | 渲染器完整但**无生成入口** |
| 双语字幕 | 🟡 | 🟡 | 无一等公民功能，靠两轨/两行拼 |
| YouTube ingest（转写+翻译） | ✅ | ✅ | 唯一打通的转写+翻译流 |
| 字幕 burn/sidecar 导出 | ✅ | 🔌 | CLI export 无 --captions |
| 花字/艺术字 · 文字模板库 · emoji/贴纸库 · 标题卡/下三分之一 | 🟥 | 🟥 | 全缺（标题卡/下三分之一为复核新增）|

### 2.5 渲染 / 导出 / 平台预设

| 能力 | 存在性 | agent 可达 | 备注 |
|---|---|---|---|
| 5-stage 导出管线 | ✅ | ✅ | `autoviral export` → 同步阻塞 |
| 分辨率 / fps | ✅ | ✅ | 经 comp.width/height/fps；agent 可改 |
| 平台预设（8 个） | 🟡 | 🔌 | **硬编码在前端组件，agent 拿不到** |
| --preset / body.preset / presetId | 🟥 stub | 🟥 | **三处接收从不读取，静默忽略**（dead-control）|
| 码率 / codec / 质量档 | 🟡 | 🔌 | 只来自 exportPresets[0] |
| 响度 LUFS 目标 | ✅ | 🔌 | /export body 不接受，永远落 -14 |
| GPU 编码器探测 | ✅ | 🟥 | 仅 encode 阶段用到，**而该阶段需要 preset**（见诚实修正）|
| snapshot 视频静帧 | ✅ | ✅ | agent 视觉自检核心；依赖 host ffmpeg |
| snapshot carousel | 🟡 | 🟡 | 文字/形状/贴纸层不合成，最常见路径直接 throw |
| carousel 图文导出 | ✅ | 🔌 | 纯浏览器 toDataURL，agent 完全够不着 |
| 批量变量导出 / proxy 快速预览 / reveal | ✅ | 🟡 | 变量批量 agent 可达 |
| 渲染队列(并发/取消/jobId) | ✅ | 🟥 | 只服务人类路径，agent /export 同步阻塞无 job 模型 |
| GIF / 序列帧 / ProRes / WebM/MOV | 🟥 | 🟥 | 恒 h264 mp4；h265/vp9/av1 路径存在但零暴露 |
| 水印 / HDR / 多机位 / 编辑代理 / FCPXML 互通 | 🟥 / 🟡 | 🟥 | 全缺 |

### 2.6 数据模型 & agent 改图心智模型

| 能力 | 存在性 | agent 可达 | 备注 |
|---|---|---|---|
| Schema 设计质量（asset/provenance 分离 + default 齐全） | ✅ | ✅ | pneuma 式，agent-friendly |
| 意图级原子抽象（store.ts 25 action） | ✅ | 🔌 | **最大 built-but-human-only 缺口** |
| `clip add/set/remove` | 🟡 | 🟡 | 窄：3/4 种轨道、仅顶层标量 |
| 全量 PUT /api/works/:id/composition | ✅ | 🟥 | **CLI 硬编码 /api/bridge/v1 前缀够不到**（见诚实修正）|
| carousel add-slide/set-layer | 🟡 | 🟡 | 比视频好但仍缺删/复制/重排/globals |
| dry-run / schema 预检 | 🟥 | 🟥 | lint/validate 是 a11y 质检，非 schema 校验 |

---

## 3. 差距清单（核心）

### 3.1 Table-stakes（基本盘缺失 / agent 命题落空 — 必须正视）

| 功能 | AutoViral 状态 | 谁有 | 对 agent 命题的影响 | 证据 |
|---|---|---|---|---|
| **意图级编辑命令全缺**（split/trim/transition/keyframe/track/move/scene/variable） | 🟥 无 CLI/bridge 动词 | AI-native（Captions/Veed/Descript 下指令即执行） | 命题根本缺口：要做转场/关键帧/跨轨移动只能手搓整 comp JSON 再 PUT，等于在 prompt 里重写 store.ts 25 个 action | bridge routes.ts 仅 /clip+/carousel；routes.ts:524 注释自认需 client-side 组合 |
| **嵌套字段经 CLI 全不可达**（transform/filter/style/position/fade/ducking） | 🔌 静默丢 | 所有竞品的内置可调项 | agent 能调的只有 in/out/offset/volume/duration/text 几个标量；其余 UI 完整也够不着 | clip.ts:59-63 flat 解析；routes.ts:740 浅合并；composition.ts 均嵌套 |
| **时间线转场 agent 不可加** | 🔌 | 剪映/OpenShot(400+)/三巨头 | "在这两段间加叠化"无一等命令 | transitions.ts 13 preset 完整；bridge 无 /transition |
| **关键帧 agent 经 CLI 不可达**（recipe 还教坏命令） | 🔌 + 文档撒谎 | 剪映/OpenShot/三巨头 | recipe 明确教 `clip set --keyframes`，实际必 400 | clip.ts:62 无 JSON.parse；composition.ts:162 期望 array |
| **Track 全操作 agent 不可达** | 🔌 | 剪映/OpenShot/三巨头 | 加 BGM 轨/某轨静音/调 lane 增益全够不着 | bridge 无 /track；CLI 无 track.ts |
| **Split/trim/跨轨移动/collapse agent 不可达** | 🔌 | 剪映/OpenShot/三巨头 | "把这段从第 5 秒切开"最基本指令都无命令 | store.ts:543/451/289/433 全 UI-only |
| **平台预设 + preset 参数双重断裂** | 🔌 + 🟥 stub | 剪映/OpenShot(400 profile)/AI-native/三巨头 | "导成抖音规格"核心分发意图直接落空，--preset 被静默吞 | PlatformPresetSection.tsx 硬编码；render-pipeline.ts:575 只读 exportPresets[0] |
| **ASR 自动字幕落轨：前端零 UI + 无 CLI** | 🟥 built-not-wired | 全员 | 最高频诉求，后端俱全却断在最后一公里 | audio.ts:145 端点真实；fetchCaptions 零调用方 |
| **crop 显式裁剪** | 🟥 | 剪映/OpenShot(3.4)/三巨头 | "裁掉画面左 1/3"无法表达 | TransformsSchema 无 crop；VideoTrackRenderer.tsx:105 objectFit:cover |
| **倒放 reverse** | 🟥 | 剪映/OpenShot/三巨头 | speed 下限 0.1×>0，无负速 | SPEED_MIN=0.1；无 ffmpeg reverse |
| **clip 复制/粘贴/复制** | 🟥 | 剪映/OpenShot(3.4)/三巨头 | agent 无 copy-with-props 原语，clip add 丢全部样式 | grep 仅命中 Chat 附件剪贴板 |
| **fit/fill 填充模式（contain/letterbox/blur-bg）**〔复核新增〕 | 🟥 | 剪映/CapCut（核心交互） | 素材比例≠画布比例时一律强制裁切，无适配选项 | VideoTrackRenderer.tsx:105 硬编码 objectFit:cover |
| **画布比例一键切换**〔复核新增〕 | 🟥 | 剪映/CapCut/三巨头 | 9:16→1:1→16:9 换比例只能手改 comp 数字 | grep resizeCanvas/setCompositionSize 零命中 |
| **Undo/redo（clip 级 + Cmd+Z）** | 🟡 | 全员 | 人改错一个 clip 无法撤销 | undoTrackOp 仅快照 tracks；useShortcuts 无 Cmd+Z |
| **贴纸/PiP overlay agent 不可加** | 🔌 | 剪映(PiP)/三巨头 | bridge 显式 throw "overlay not supported"，CLI 表面却列 overlay | routes.ts:592-593 |

### 3.2 Important（区分度 / 高频 / agent 高契合）

| 功能 | AutoViral 状态 | 谁有 | 对 agent 命题的影响 | 证据 |
|---|---|---|---|---|
| 绿幕 chroma key 抠像 | 🟥 | 剪映/OpenShot/AI-native/三巨头 | schema/render/CLI 三层皆无，要补需全栈扩 | grep chroma/colorkey 零命中 |
| 智能抠像（AI rotoscope 去背景） | 🟥 | 剪映/Descript/Veed/Runway | "把人抠出来叠新背景"高频意图无后端 | 无 matting/segment 实现 |
| 蒙版 mask（9 形可移可反转） | 🟥 | 剪映(9形)/OpenShot/三巨头 | reveal 转场/局部调色/二次曝光全锁死 | VideoTrackRenderer 无 mask/clip-path |
| auto-reframe 智能横转竖 + 主体追踪 | 🟥 stub | 剪映/Opus(招牌)/Captions | 命题最该有（母片出多比例），但 501 | generate.ts:358 脚本已删 |
| 一级色轮 / RGB·Luma 曲线 / 特效库 | 🟥 | 剪映/三巨头 | 调色是认真剪辑核心维度，agent 无字段 | FiltersSchema 仅 3 标量 |
| LUT 调色 | 🟥 假实现 | 剪映/OpenShot/三巨头 | 字段在但零渲染消费，agent 写了无变化（虚假可达） | composition.ts:17 零消费 |
| 画面防抖稳定 | 🟥 | 剪映/三巨头 | 手持素材基本清理工序缺失 | grep vidstab/deshake 零命中 |
| 可变变速导出保真 | 🟡 | 剪映(6预设)/OpenShot/三巨头 | export 静默回 1×，骗过 agent 视觉自检 | speed-ramp-ffmpeg.ts:188 |
| 通用动画预设库（Ken Burns/入场出场） | 🟥 | 剪映(固定 tab)/OpenShot/三巨头 | "给图加 Ken Burns"本应一条命令，现既无预设也写不进 keyframe | 无 applyAnimationPreset |
| 局部打码/马赛克（可跟踪）〔复核新增〕 | 🟥 | 剪映/CapCut（隐私刚需） | 遮人脸/车牌/水印高频，无区域+跟踪能力 | grep mosaic/censor 零命中 |
| 长视频自动切片找爆点 + viral score | 🟥 | Opus(招牌) | **AutoViral 名字直指**却零实现 | 无 clip-anything/viral-score |
| 一键成片（文案/链接→自动成片） | 🟡 | 剪映(招牌)/Captions/Descript | 命题正面战场，靠 chat-agent 临时编排无管线 | 仅 ingest-youtube bootstrap |
| 自动去 filler / 去静音 | 🟥 | Descript/Veed/Captions | agent 极契合，后端只差把 silencedetect 接 ripple-cut | audio-tools.ts:107 仅测量 |
| 人声分离 / 降噪 / EQ | 🟥 | 剪映/Descript/三巨头 | 口播刚需，AI 剪辑器人人有 | 混音链仅 volume/delay/fade/sidechain |
| BGM / AI 音乐 | 🟥 stub | 剪映(百万曲库)/Captions | 音乐是短视频核心，路径破损指向已删脚本 | dispatchGeneration.ts:301 |
| 音乐踩点 beat sync | 🟥 | 剪映/三巨头 | Reels/Shorts 刚需，端点已退役 | audio.ts /beats 返 410 |
| Ducking 缩水 + CLI 不可设 | 🟡 | 剪映/三巨头 | 触发硬编码 voiceover，attack/release 被丢 | render-pipeline.ts:299；audio-tools.ts:268 |
| 花字/艺术字 + 文字模板库 + 真描边/对齐/字体库 | 🟥/🟡 | 剪映/三巨头 | 短视频文字基本盘，两套系统都只支持纯色 | carousel.ts:36 单色；tokens.css 仅 3 字体 |
| emoji/贴纸素材库 | 🟥 | 剪映/AI-native | "加个笑哭 emoji"无法满足 | StickerLayer 仅 src 字段 |
| 字幕翻译/双语一键流 | 🟡 | 剪映(15+)/Captions(100+)/Veed(130+) | 唯一转写+翻译只针对 YouTube 源 | 无非-YT 双语流 |
| 在线模板库 / 一键套模板 | 🟥 | 剪映(海量)/Opus | 消费级核心获客点，新作从空白起 | 无 template 注册表 |
| GIF / 序列帧 / ProRes 导出 | 🟥 | OpenShot/三巨头 | GIF 是社媒常见交付 | 恒 h264 mp4 |
| 码率/codec/响度 LUFS agent /export 不可设 | 🔌 | 剪映/OpenShot/三巨头 | 微信(-16) 等规格 agent 无法达成 | render-pipeline.ts:575/388 |
| carousel 图文导出 agent 够不着 + snapshot 文字不合成 | 🔌 | 剪映(图文) | agent 既导不出图文也无法自检文字布局 | useExport.ts:74；snapshot.ts:199 |
| 渲染队列 agent 无 jobId/取消/进度 | 🟥 | Premiere/Resolve | 长任务失明，连接断即丢结果 | /export 同步直调 routes.ts:646 |
| 版权素材库（stock 视频/曲库） | 🟥 | 剪映/Descript/Opus | agent 无合规素材可引用 | 无 stock 集成 |
| AI 脚本/标题/Hook 生成〔复核新增〕 | 🟥 | 剪映/Opus/Captions | 命题极契合（"写个爆款脚本再成片"），只有改写无生成 | 仅 carousel text-rewrite |
| schema 感知 dry-run | 🟥 | agent 工具链特性 | 每次试错一个完整渲染往返 | check.ts:58 是 a11y 质检 |
| dynamic-caption 模板/关键词高亮/auto-emoji 无生成入口 | 🔌 | 剪映/Opus(招牌)/Captions | 渲染器完整(hyperframes 移植)但无入口、无样式面板 | CaptionsLayer.tsx full 但 data-driven 无入口 |
| 自定义/可保存导出预设 + 品牌套件〔复核新增〕 | 🟥 | Opus/CapCut | 连"保存我的预设"单机能力都没有 | grep savePreset 零命中 |

### 3.3 Nice-to-have（可延后 / 专业进阶 / 与 agent 命题正交）

| 功能 | 状态 | 谁有 |
|---|---|---|
| 四种精修 trim（ripple/roll/slip/slide）+ 七种插入编辑 | 🟡/🟥 | 三巨头 |
| 嵌套序列/Compound Clip · clip 分组多选 · 时间线 markers · track lock | 🟥 | 三巨头 |
| HSL Qualifier / 调节层 / 节点调色 / 运动追踪 / 混合模式 | 🟥 | 三巨头/剪映 |
| AI 补帧 / 超分 / lip-sync | 🟥 stub | 剪映/Runway/Captions |
| 帧步进 / JKL shuttle / skimming 掠览 | 🟡/🟥 | OpenShot/三巨头/FCP |
| 混音台 / 自动化包络 / 音频转场曲线 / 变声 / 录音 / 音频提取 | 🟥/🟡 | 三巨头/剪映 |
| 声音克隆 Overdub · 数字人 avatar · eye-contact · dubbing lip-sync | 🟥 | 剪映/Descript/Captions/Veed |
| transcript editing（改字即改视频）· Magic Cut 中间档〔复核新增〕 | 🟥 | Descript/Veed |
| 说话人识别配色〔复核新增〕· auto-hook 包装〔复核新增〕 | 🟥 | Opus/Descript |
| Motion Brush / inpainting / Act-One / 4K-60s 生成 | 🟡/🟥 | Runway |
| 多机位 / 编辑代理工作流 / 场景剪切检测 / 素材元数据 | 🟡/🟥 | 三巨头/Resolve |
| Fusion 节点合成 / 3D / 粒子 · 屏幕录制 | 🟥 | Resolve/OpenShot/Descript |
| FCPXML/EDL 互通 · 多人协作/云项目 · 发布调度 API | 🟥/🟡 | OpenShot/Opus/Runway |
| 美颜美体 · 去文字/去人 inpainting · 水印 · HDR/4K60 | 🟥/🟡 | 剪映/Runway |
| 标题卡/下三分之一模板〔复核新增〕· 移动端形态〔复核新增〕 | 🟥 | FCP/Premiere；剪映 mobile-first |

---

## 4. 诚实修正（被说大的能力）

用户特别要求的诚实性一节。以下是材料 1/差距清单里**偏乐观或文档撒谎**的地方，附 file:line 与真实状态：

| 被说大的点 | 表面声称 | 真实状态 | 证据 file:line |
|---|---|---|---|
| **能力图大量 Timeline 能力标 "full + api"** | agentReachable=api（暗示 agent 可经 HTTP 达成） | 对**纯 autoviral CLI agent 是 none**：client.ts:37 把 bridgeRequest 硬编码到 `/api/bridge/v1`，而唯一能写整 comp 的 PUT 在 `/api/works`，CLI 够不到。agent 必须绕过 CLI 自己发 raw curl 才行 | client.ts:37；works.ts:208 |
| **`clip set --keyframes` 标 agentReachable=cli** | 命令存在=可达 | 对嵌套对象/数组功能为 **0**：clip.ts:62 无 JSON.parse 把 JSON 当字符串发 → routes.ts:741 盲 spread → zod 期望 array → 400。真实应为 none（仅顶层标量 cli 可达） | clip.ts:62；routes.ts:741；composition.ts:162 |
| **crossfade recipe** | `:70` 给出可执行 `clip set --keyframes` | **自相矛盾且必 400**：`:56` 自己写"can't express keyframes through a single clip set flag — schema expects array"，`:70` 却照给。文档教 agent 跑已知坏命令 | crossfade-between-clips.md:56,70 |
| **CLI help / clip add 列 overlay 为合法 --track** | `[--track video\|audio\|text\|overlay]` | **运行时必 throw**：bridge routes.ts:593 对 overlay 直接 "not yet supported in Phase 3"。CLI 文案 overclaim | cli.ts:103；clip.ts:16；routes.ts:593 |
| **audio.ts:140 源码注释** | "Studio's caption import button calls this to populate the text track" | **假承诺**：grep fetchCaptions 仅 captions.ts:13 自身定义，零调用方，不存在任何 caption import button。注释把 built-not-wired 说成 wired | audio.ts:140；captions.ts:13 |
| **GPU 加速导出标 has-it** | 已具备能力（非差距） | 对 agent 实质 **unreachable**：pickEncoder 仅在 runEncodeStage 调用，而该 stage 需 exportPresets[0]（agent 够不着预设）；Stage1 永远是 Remotion h264 软渲染。对"agent 驱动"命题更接近 ui-only | render-pipeline.ts:343,575-580 |
| **非破坏编辑/快照标 has-it + "agent 用它代替 clip 级 undo"** | agent 友好的 undo 替代 | **agent 可达性未经验证（推断）**：snapshot 出 PNG 是真的，但"创建命名 checkpoint / restore"是否有 agent CLI 动词从未给出证据——bridge routes.ts 无 checkpoint 路由、CLI 无 checkpoint 命令（grep NONE）。把它当 agent undo 替代是 overclaim | ws-bridge.ts:1124（每 turn 建）；CLI/bridge 均无 restore 动词 |
| **carousel snapshot 标 has-it 顺带说得过好** | 项目版本/快照完整 | carousel snapshot 文字/形状/贴纸**从不服务端合成**，textLayersComposited:false，最常见路径(渐变背景+文字)直接 throw。has-it 需配合此限制读 | snapshot.ts:199-209 |
| **「agent 只能 raw HTTP PUT 全量 comp」这个逃生口本身** | 反复作为 fallback 通路提及 | 对纯 CLI agent **连逃生口都不在工具箱里**：client.ts:37 钉死前缀，CLI dispatch(cli.ts:42-55) 无 `http`/`comp put` 命令。built-but-human-only 在 agent 维度进一步收紧 | client.ts:37；cli.ts:42-55 |
| **dispatchGeneration TTS 路径** | （差距清单只点了 BGM 死路） | **TTS-dispatch 是 BGM 的孪生死路**：dispatchGeneration.ts:302 仍指向已删 `tts_generate.py`（虽另有真实 /api/works/:id/tts 直调路径），chat-agent 编排路径同样断头 | dispatchGeneration.ts:302 |

**总评**：差距清单与能力图整体诚实度很高，绝大多数 stub/missing/ui-only 判定经源码核对属实，未发现把 stub/missing 谎报成 has-it 的硬性 overclaim。修正集中在**二级偏差**——状态值没错但 agentReachable=cli/api 偏乐观（根因是 client.ts:37 把 CLI 钉死在 /api/bridge/v1），以及**三处文档级假承诺**（caption button / crossfade --keyframes / overlay 可加）。核心命题在数据模型/时间线/轨道/转场/关键帧层的落空是真实且系统性的，悲观判定是对的。

---

## 5. agent 驱动剪辑的代码硬伤

按 severity 排序。这是 v0.1.3 工程攻坚的直接 backlog。

| # | 标题 | 问题 | 为何对 agent 致命 | 证据 file:line | 建议修法 |
|---|---|---|---|---|---|
| 1 | **写盘端点不广播 composition-changed** | 5 个写端点（POST/PATCH/DELETE /clip、carousel slide/layer）无一 broadcast，全靠脆弱 fs.watch（dir 不存在时 silently return 永不重试，macOS 原子 rename 事件不稳） | agent 闭环"改→用户看到→自检"断裂：HTTP 200 但 preview 不刷新，agent 误判成功而用户"什么都没看到"，违反 e2e 硬规则；fs.watch 竞态让失败间歇性最难排查 | routes.ts:537,604,730,768,807；composition-watcher.ts:46-50；useBridgeEvents.ts:107 | 落盘成功后由写端点直接 broadcast(workId,'composition-changed')（仿 asset-added），把刷新做成写路径显式契约；fs.watch 仅留兜底 |
| 2 | **官方 recipe 教必败的 `clip set --keyframes`** | flat 解析器把 JSON 当字符串 → 浅合并 → zod 期望 array → 必 400；变速复用同通道也一起死 | agent 高度信任 recipe（唯一操作手册），照做 100% 失败，错误是 zod dump 难反推根因，浪费整会话预算 | crossfade...md:56,70；clip.ts:60-63；routes.ts:740-742；composition.ts:119-125 | (a) clip set 对已知嵌套键做 JSON.parse 失败再退字符串；或 (b) 加 `clip keyframe add/set` 动词。修好前立即把 recipe 改走 PUT 整份回写 |
| 3 | **错误码契约两端皆破** | /clip 的 400 不带 code:4（carousel 带了）；client.ts 又把所有失败塌成 exit 3，从不读 json.code | agent 想据 $? 分支决策（"我 patch 不合法 vs 服务挂了"），契约教它 case 4 实际永远拿不到，所有按错误码做控制流的 recipe 失效，只能解析 stderr 自然语言 | error-codes.md:11-12,64-72；client.ts:46-56；routes.ts:599,618,747 vs 796,813,842 | client.ts 失败分支 `exit(json.code ?? 3)`；给 /clip 三端点 400 补 code:4；固定 4xx→4/5xx→3 映射 |
| 4 | **`clip set` 改嵌套属性静默无操作** | 嵌套字段经 flat 解析+浅合并+zod 默认 strip（无 .strict()），`--scale 2` 写顶层被 strip，返回 ok:true 但真实 transforms.scale 不变 | 比报错更糟：200 成功 + comp diff 看不出变化 → agent 自信交付一个根本没改的作品（silent-leak 家族在写路径的体现） | clip.ts:59-63；routes.ts:736-744；composition.ts:8-13（全文件无 .strict()） | PATCH 对被 strip 的未知键检测并返 400 拒绝静默丢弃；理想支持点路径/deep-merge + per-kind 白名单 |
| 5 | **意图级能力只在 store.ts，agent 经 CLI/bridge 够不着** | ~25 个意图级 action 全 UI；bridge 无 /transition /keyframe /track /split /move /scene /variable；逃生口 PUT 又在 CLI 钉死前缀外 | 命题在写路径只覆盖一小块：要做转场/关键帧/跨轨移动得手搓整份合法 comp（自维护 trk_/transition 非末/speed 范围/keyframe 重基），等于 prompt 里重写 store.ts | store.ts:543/289/330/418/180；routes.ts:524；client.ts:37 | 先把"整份 comp 回写"封成一等 CLI 动词 `autoviral comp put`（允许打 /api/works）写进 manual；中期把高频意图补成 bridge 路由 + CLI 动词，语义下沉 @shared 避免双实现漂移 |
| 6 | **carousel 层无服务端合成，agent snapshot 自检盲区** | snapshotCarousel 只返回罕见已导出页或背景图(textLayersComposited:false)，最常见"渐变背景+文字"直接 throw | 图文是两大交付物之一，文字排版恰是最易错部分；agent 看不到自己排的版=盲改，违反 e2e | snapshot.ts:171-212（:209 throw）；snapshot.ts:76-79 | 加 headless 渲染器服务端合成 Konva 层（复用 exportPng 逻辑跑 node-canvas/Puppeteer），与 video snapshot 保真度对齐 |
| 7 | **导出对 agent 是同步阻塞单 HTTP，无 jobId/poll/cancel** | /export 同步 await 数分钟才返回；进度只广播浏览器；render-queue（并发/取消/去重）不经 bridge 暴露 | 长任务失明：无进度、不能取消跑错渲染（白烧算力 #62/#63 隐患）、连接抖动即丢结果，批量场景致命 | routes.ts:646-693；render-pipeline.ts:385；render-queue/；export.ts:156 | render-queue 经 bridge 暴露：/export 返 jobId + GET/DELETE /render/job/:id；CLI `--watch` 轮询流进度 + `render cancel` |
| 8 | **无 agent 可达回滚，尽管每 turn 都建 checkpoint** | checkpoint 每 chat turn 创建但 CLI/bridge 零 restore 动词；restore 只能人 UI 点；carousel 连 .previous 都没有 | agent 必会犯错（尤其手搓 JSON 场景），无协议级 undo 只能脆弱手工逆向 → 不敢大胆编辑或越改越烂 | ws-bridge.ts:1124；CLI/bridge 无 checkpoint（grep NONE）；carousel-ops 无 diff | 暴露 bridge GET /checkpoints + POST /restore + CLI `checkpoint list/restore`（restore 前先建当前态 checkpoint，见 #68 教训）；carousel 加 .previous+diff |
| 9 | **无候选 patch 的 dry-run，validate 只跑已落盘 comp** | 写端点无 --dry-run；质检读 on-disk yaml=事后检查；inspect/validate 是 a11y/对比度近似；carousel 侧连 lint 都没有 | 想渲染前确认合法只能写盘试错，又污染用户正看的 comp（配合 #1 更乱）；手搓场景每次 PUT→400→改 昂贵循环 | routes.ts:309-390；lint.ts:1-31；inspect.ts/validate.ts；写端点无 dryRun | 加 POST /comp/validate（body=候选 comp，safeParse+lint 不落盘返 issues）+ CLI `comp validate`；写端点加 ?dryRun=true；carousel 补 validate |
| 10 | **preset 三处接收从不读取 + 变量变速静默回 1×** | --preset/body.preset/presetId 三处接收，render-pipeline 只读 exportPresets[0]；变量变速 preview 有 export 回 1× | 两个"设了系统假装接受结果不生效"的最坏交互：preset 让 agent 以为切了竖屏/响度其实没；变量变速骗过 agent 视觉自检产出错成品 | export.ts:119,156；routes.ts:650；render-pipeline.ts:575；speed-ramp-ffmpeg.ts:12-14 | 平台预设表移 @shared 单一事实源，pipeline 按 preset 查表应用；或 /export 校验未知 preset 直接 400 别静默吞；变量变速要么实现要么 export 时 warn 给 agent |
| 11 | **UI 命令纯 fire-and-forget，无连接静默蒸发** | select/seek/toast/progress 立即返 ok；UiEventBus 无订阅者 no-op；无 buffered replay | agent 用 toast/progress 引导用户注意力是主要协作手段，无连接全部蒸发又返 200，agent 自信说"已给你进度"用户什么都没看到 | routes.ts:199-243；ui-events.ts；event-stream.md:134 | 响应回 `{delivered: subscriberCount>0}` 让 agent 判断有没有人在看；或加短 TTL 缓冲浏览器连上回放 |
| 12 | **无乐观并发/版本守卫，人机共编静默互相覆盖** | mutateCompositionFor 整文件 read-modify-write last-write-wins 无 etag；composition-changed 只发浏览器 agent 不订阅 | 人机共编是命题：agent 基于 5 秒前快照算 patch，期间用户拖了 clip，agent PUT 整份抹掉用户改动，双方都无冲突提示 | composition-ops.ts；useBridgeEvents.ts:107 | comp show 返 version/mtime，写端点接受 If-Match，不符返 409 让 agent 重读重试；给 agent 订阅 composition-changed 通道 |
| 13 | **POST /clip 拒 overlay + 只命中第一条同 kind 轨** | overlay 直接 throw；clip add 用 `find(t=>t.kind===body.track)` 永远命中第一条 | "新建 A2/overlay 轨放配音或贴纸"第一步就断；多轨场景无法指定写哪条具体轨（A2·VO vs A1·BGM 都是 audio） | routes.ts:553,592-593；store.ts:180 | POST /clip 支持按 trackId 定位并去掉 overlay 硬拒绝；补 `track add/remove` bridge 路由 + CLI 动词 |
| 14 | **ASR 后端完整但前端零消费 + 无 CLI** | POST /api/audio/captions 完整可用，fetchCaptions 零调用方，无 captions 动词 | "自动配字幕"最高频，后端俱全断在最后一公里；agent 只能 clip add 手敲文本丢时间码与样式 | audio.ts:145-219；captions.ts:13 | 加 `autoviral captions generate` bridge 路由（包端点把 segments 写成 text track）+ Studio"生成字幕"按钮 |
| 15 | **schema invariant 是手搓 JSON 的隐形地雷 + 拼错 key silent-noop** | trk_ id 写路径不兜底、transition.afterClipId 同轨非末、speed 0.1-4.0、slides≥1；拼错 key（`--scal 2`）被 strip 既不报错也不生效 | 富功能逼 agent 手搓整 comp，invariant 从"读路径自动兜底"变"写路径硬陷阱"；不读源码不知约束，只能 PUT→读 zod dump→猜循环 | composition.ts:284,314-350,131-148；carousel.ts:134；routes.ts:741 | manual 集中文档化全部 invariant + 暴露 newTrackId/newClipId mint helper；配合 #9 dry-run + #4 拒绝静默 strip |

---

## 6. v0.1.3 建议优先级

综合差距严重度 × agent 影响 × 实现成本。原则：**先修"假承诺/静默失败"（信任崩塌成本最高、修复成本最低）→ 再补"命题落空"（agent 写路径）→ 再做差异化护城河**。

### 必做基本盘（Must — 信任与命题的地基）

这批的共同点：**成本低、对 agent 命题致命、且很多是"已建未接"或"文档撒谎"**——边际成本接近零，不补就是 silent leak。

1. **修文档撒谎与 dead-control 三连**（硬伤 #2/#10 + 诚实修正全部）：crossfade recipe 改走 PUT、CLI help 删 overlay 假承诺、audio.ts:140 注释删除、preset 未知值返 400 不静默吞、变量变速 export warn。**成本极低，立即止血**。
2. **写路径显式 broadcast composition-changed**（#1）：一行 broadcast 解决"改完不刷新"最后一公里，这是 e2e 硬规则的地基。
3. **`clip set` 嵌套字段支持 + 拒绝静默 strip**（#2/#4/#15）：JSON 感知解析 + 被 strip 返 400 + per-kind 白名单。让 agent 能改 transform/filter/style/keyframe——这是"agent 改图"的核心能力，目前等于全废。
4. **整份 comp 回写封成一等 CLI 动词 `autoviral comp put`**（#5）：CLI 解除 /api/bridge/v1 前缀钉死，允许打 /api/works，写进 manual 作万能逃生口。这是在补意图级动词前**唯一能让 agent 做富改动的现实通路**。
5. **dry-run / comp validate**（#9）+ **错误码契约修复**（#3）：让手搓 JSON 的 agent 写前预检、按 $? 分支决策，把"PUT→400→猜"的昂贵循环砍掉。
6. **ASR 自动字幕接通**（#14）：后端完整，加 CLI `captions generate` + Studio 按钮。最高频诉求、最低补全成本（built-not-wired）。
7. **意图级 bridge 动词补 split / move-to-track / transition add / track add-remove**（#5/#13）：把 store.ts 高频语义下沉 @shared 复用。这是命题落空的正面战场，成本中等但回报最高。
8. **基础画面操作 crop / fit-fill 填充模式 / 画布比例切换 / 翻转镜像 / 倒放 / 定格**（差距 3.1）：剪映/OpenShot 都有的基本盘，schema + render + CLI 全栈补。fit-fill 与比例切换是"素材比例≠画布"的最高频交互，目前一律强制裁切。
9. **clip 级 undo + Cmd+Z**（差距 3.1）+ **checkpoint restore 暴露给 agent**（#8）：人和 agent 都需要安全网才敢大胆编辑。

### 差异化护城河（Should — 把命题做成别人没有的）

AutoViral 的命题（agent 驱动 + 人机共编）本应在 AI-native 战场赢，目前反而最弱。这批是"补完命题就甩开消费级"的方向：

1. **auto-reframe 复活**（差距 3.2）：母片自动出多比例（抖音/小红书/YouTube），是"agent 驱动多平台分发"的杀手锏，Opus 招牌。先恢复 smart-crop 脚本再接 reframe 端点。
2. **平台预设 agent 可达 + 多平台批量导出**（#10 + 差距 3.2）：预设表移 @shared，pipeline 按 id 查表，CLI 一条命令导成三平台规格。这是分发命题的核心。
3. **长任务 job 模型**（#7）：render-queue 经 bridge 暴露 jobId/poll/cancel + `--watch`。批量自动化场景的前提。
4. **人机并发守卫**（#12）：If-Match + composition-changed 订阅。这是"人机共编工位"区别于所有竞品的命题，数据无声丢失会直接毁掉它。
5. **AI 自动化套件**（差距 3.2）：自动去 filler/静音（silencedetect 已有，只差接 ripple-cut）、长视频切片找爆点 + viral score（AutoViral 名字直指）、AI 脚本/标题/Hook 生成、B-roll 自动配镜头。这批与 agent 命题高度契合，是"AutoViral"之名的兑现。
6. **carousel 服务端合成**（#6）：headless Konva 渲染器，让 agent 能 snapshot 自检图文文字布局，并导出图文成品（目前 agent 完全够不着）。
7. **真调色（一级色轮 / LUT 真消费 / 曲线）+ 绿幕抠像**（差距 3.2）：LUT 字段已在 schema 只差渲染消费，先把死字段救活；调色与抠像是认真剪辑的门槛。

### 可延后（Could — 专业进阶 / 与 agent 命题正交 / 高成本）

- 四种精修 trim、七种插入编辑、嵌套序列、多机位、编辑代理工作流、节点调色、混音台/自动化包络（专业 NLE 进阶，对 agent 非基本盘）
- AI 补帧/超分/lip-sync（已 stub，需真实模型权重落地）、声音克隆、数字人 avatar、eye-contact、Motion Brush/inpainting（重 AI 投入）
- transcript editing（Descript 范式，需重构编辑器心智）、说话人识别配色、Magic Cut
- FCPXML/EDL 互通、多人协作/云项目、发布调度、品牌套件、移动端形态（结构性/团队特性）
- 美颜美体、水印、HDR/4K60、屏幕录制、场景剪切检测、素材元数据（小工具/低优先）

---

**一句话收尾**：v0.1.3 的最高杠杆不是"加新功能"，而是**把已经建好的浏览器 NLE 接通到 agent**——修掉 3 处文档撒谎、4 处静默失败、把 `clip set` 嵌套字段和整份回写打通，AutoViral 的核心命题就从"PPT 上成立、实测处处落空"变成"agent 真能驱动剪辑"。这批边际成本最低、信任回报最高，应在任何新功能之前完成。