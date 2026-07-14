# 0014 · WYSIWYG 焊死与剪辑能力对标（issue slices）

> Parent: [docs/prd/0014-wysiwyg-editing-parity.md](0014-wysiwyg-editing-parity.md)
> 本文件是这批 issue 的事实源（docs-only tracker，绝不开 GitHub Issue）。triage：全部 `ready-for-agent`，全部 AFK。
> **测试先行（.claude/rules/test-first.md）**：每片「预设测试」必须在实现代码动笔前落盘并**证红**——这是每片 Acceptance criteria 的第一项，不逐片重复。测外部行为不测实现细节；先 grep 最近的测试先例照抄模式（repo 371+ 测试文件几乎覆盖所有形态）。
> **执行约定（用户 2026-07-14 立规）**：每片由 **Claude Opus 实现**，**codex (GPT-5.6) review**；分歧以测试/浏览器证据裁决。
> **实施顺序（串行 TDD，vitest 绝不并发）**：S1 → S2 → S4 → S6 → S7 → S8 → S5 → S3 → S12 → S15 → S13 → S14 → S9 → S10 → S11 → S16 → S17 → S18 → S19。凡碰 `src/shared/composition*`/ops/store 的片（S7/S8/S5/S3/S12/S15/S13/S14）已排成连续链，避免 schema 文件反复冲突。
> **E2E 铁律**：S18 经 Workflow 多纬度 subagent（≥5 纬 + completeness-critic），主 agent 不亲点浏览器；浏览器纬度用 Claude subagent（codex 无浏览器 MCP）。
> **调研前置**：实现者开工前先读 parent PRD + [研究报告](../research/2026-07-14-opencut-parity-ai-studio-gap.md)；9 份盘点 + 4 份 gap 矩阵（含全部 file:line 证据链）在 `docs/竞品/analysis/`，OpenCut 参考源码在 `docs/竞品/OpenCut-pre-rewrite/`，勿重复调查。
> **server/shared 改动纪律**：任何碰 `src/server`/`src/shared` 的片，E2E/手验前必须 `npm run build:backend` + 重启 daemon（dist 进程启动即冻结）。

---

## S1 · 修四个 cinematic 转场端点 + CI 纯色 smoke test

**What**：修 `src/server/render/transitions.ts` 的三种坏法：① glitch-cut（:280 起）`geq` 内小写 `t` → 大写 `T`（geq 只认 `T`），`alpha(X,Y)` → `a(x,y)` 或 `format=rgba` 后正确取法，拆掉 `p(X+(if(...)),Y)` 的非法嵌套（把 `if` 提出到独立表达式或用 `st()/ld()`）；② domain-warp（:339 起）同款 `t` 缺陷；③ grav-lens 把时间表达式塞进 `lenscorrection` 静态 option——改用支持逐帧求值的滤镜或按帧参数化。四端点 `POST /api/transitions/{glitch,light-leak,domain-warp,grav-lens}` 全部对真实 clip 渲染成功。新增 CI smoke：用 ffmpeg `color=` 源生成两条 2s 纯色 clip，四端点各渲一遍断言 exit 0 + 产物时长 ≈ clipADuration + clipB 剩余（容差 0.2s）。
**禁**：只修 glitch 不修其余三个；smoke test 依赖网络素材。

**预设测试**（先落盘证红）：
- server 测试：`buildGlitchCutFilterGraph`/`buildDomainWarpFilterGraph`/grav-lens 构图函数产出的 filtergraph 字符串不含 `between(t,`（小写 t 断言）、不含 `alpha(X,Y)`；再用管理 ffmpeg 对两条 `color=c=red/blue:d=2` 实渲（integration，跳过条件：ffmpeg 不可用）断言 exit 0——当前四个全红。
- 路由测试：POST 四端点（注入临时 work + 纯色 clip fixture）断言 200 + 输出文件存在。

**Acceptance criteria**：
- [ ] 预设测试证红后转绿；`npm run test:server` 全绿。
- [ ] 四端点真实 mp4 手验各出一条正常成片（无花屏/黑帧），产物帧数正确。

**Blocked by**：None - can start immediately。
**Code-area hints**：`src/server/render/transitions.ts:280,339`（亲验锚点）；`runTransitionEndpoint` 统一错误包装；ffmpeg 路径用 `ffmpeg-paths.ts` 的 managed 解析。

---

## S2 · stylize 转场家族进 Remotion 注册表（WYSIWYG by construction）

**What**：把 stylize 转场做成 Remotion presentation：`TRANSITION_PRESET_META`（`src/shared/transitions.ts`）新增 `glitch`、`light-leak`、`whip-pan-left`、`whip-pan-right`、`zoom-in`、`zoom-out`（motion 家族顺手补齐 G-18），每个 preset 对应一个 Remotion 组件（复用 #54 `@remotion/transitions` WYSIWYG-by-construction 模式；stylize 效果用 CSS filter/transform/keyframe 插值实现，不做 ffmpeg 对偶）。预览与导出走同一组件。四个旧 REST 烘焙端点标 deprecated（响应头 + manual 注明 v0.3 移除），不删。
**禁**：`@remotion/transitions` 版本漂移（必须 exact-pin，#54 教训）；新 preset 绕开注册表单独接线。

**预设测试**：
- 注册表 sweep（照 #54 的 preset 枚举测试先例）：枚举 `TRANSITION_PRESET_META` 全部 preset（含新 6 个）断言各自 presentation 组件可解析、duration 合法——新 preset 未注册时红。
- 渲染树测试：composition 带 `glitch` transition 的两 clip，Remotion 渲染树含对应 presentation 节点（照既有 transition 渲染测试模式）。
- CLI：`transition add --preset glitch` 经共享 op 写入并通过 refine 校验。

**Acceptance criteria**：
- [ ] 证红转绿；`test:web` + `test:server` 全绿。
- [ ] Studio 预览与导出的 glitch 转场肉眼一致（S16 会机器化，此处先渲染两帧人工比对留档）。

**Blocked by**：None（与 S1 并行概念上可，按串行序在 S1 后）。
**Code-area hints**：`src/shared/transitions.ts:14-33`（既有 13 preset）、`:43`（stylize "Phase 2" 注释自认孤儿）；web 端 transition 渲染组件跟随既有 dissolve/flip 的挂载点。

---

## S4 · 变速导出真实生效（预览=导出的第一根柱子）

**What**：`src/server/speed-ramp-ffmpeg.ts` 的 v1 限制（多值 speed keyframe → warn + 1×）替换为真实实现：按 speed keyframe 把源片切段，段内恒速 `setpts=PTS/k` + `atempo=k`（k 超 [0.5,2] 时 comma-chain），`concat` 拼接；产物进既有 pre-pass 缓存（沿用 PRD-0011 缓存三角纪律：cache key 覆盖 speed 曲线内容）。AudioClip 的静态 speed 走 `atempo` 生效（撤掉 `composition.ts:161-163` 的"被忽略"注释并实现）。删除 "ships in 8.3.5" 空头承诺注释。
**禁**：改预览侧行为（`playbackRate` 已正确）；变速段边界丢帧（段切点必须帧对齐）。

**预设测试**：
- 纯函数测试：speed keyframe 曲线 → 分段计划（段数/每段速率/段边界帧对齐）——照 speed-ramp-ffmpeg.test.ts 既有模式扩展；多值曲线当前红（现状返回 unchanged）。
- integration（ffmpeg 实渲，可跳过）：4s 纯色 clip + speed 2→1 两段曲线，导出产物 `ffprobe` 时长 ≈ 3s（2s@2× + 2s@1×）——当前红（回退 1× 得 4s）。
- AudioClip speed=1.5 → 产物音频时长缩至 2/3。

**Acceptance criteria**：
- [ ] 证红转绿；`test:server` 全绿。
- [ ] 同一 composition 预览播放时长与导出产物时长一致（±1 帧）。

**Blocked by**：None。
**Code-area hints**：`src/server/speed-ramp-ffmpeg.ts:229-235`（warn+回退现场）；pre-pass 缓存机制见 render-pipeline Stage 0/0.4/0.5；PRD-0011 的 pre-pass 缓存三角 gotcha 见 memory/研究报告。

---

## S6 · `clip import`：成片回填时间线一等动词

**What**：新增共享 op `importClip`（probe 结果 → 构造 VideoClip + Asset 登记 + ProvenanceEdge(op:"import")）+ server 端 ffprobe 封装 + bridge 端点 + CLI `clip import <path> [--track <id>] [--replace-timeline] [--at <sec>]`。`--replace-timeline`：清空全部 video 轨 clips、放单 clip 于 0 点。产物经既有 WS 广播刷新 Studio。UI 侧：素材库对 work 内 mp4 的"添加到时间线"按钮复用同一 op（若已有 `useAddAssetToTimeline` #78 则收敛到共享 op）。
**禁**：probe 失败静默放置（无时长的 clip 会毁时间线——必须报错）；绕过 Asset/Provenance 登记。

**预设测试**：
- op 纯函数：给定 probe 结果构造 clip（in/out=0..duration、offset 正确）+ replace 语义（video 轨清空、audio/text 轨保留）——照共享 ops 既有测试模式。
- 路由测试：POST bridge import 端点（fixture mp4）→ composition 里出现新 clip + assets 表新 entry + provenance 边存在；probe 失败（坏文件）→ 4xx 带 errorCode。
- CLI 测试：`clip import` 命令解析 + 透传（照 cli.test.ts 命令表模式）。

**Acceptance criteria**：
- [ ] 证红转绿；`test:server` + `test:web` 全绿。
- [ ] 手验：对一个真实 work `autoviral clip import output/xxx.mp4 --replace-timeline` 后浏览器时间线出现该 clip 且可播放（build:backend + 重启 daemon 后验）。

**Blocked by**：None。
**Code-area hints**：Asset/Provenance schema 在 `src/shared/composition.ts:93-137`；ffprobe 已有封装先例（grep `ffprobe` in `src/server`）；#78 `useAddAssetToTimeline` 的 per-kind buildClip。

---

## S7 · 共享 ops 下沉 I：ripple / collapse / duplicate / track set + sweep matrix gate

**What**：把 store-only 动词提升为共享 op 并三端接线：`rippleDeleteClip`（删 clip + 同轨后续 clips 前移）、`collapseGapsOnTrack`、`duplicateClip`（新 id、offset 顺延或 `--offset`）、`setTrackProps`（label/language/volume/muted/hidden 部分更新）。store 改为薄包装调共享 op（外部行为不变）；CLI 新增 `clip remove --ripple`、`track collapse <id>`、`clip duplicate <id> [--offset <sec>]`、`track set <id> --label/--language/--volume/--muted`；bridge 路由对应补齐。**同时落 sweep matrix gate 测试**：枚举 store 的全部编辑类 action（白名单豁免纯 UI 态如 selection/viewport），断言每个在 `src/shared/composition/ops` 有对应导出——本片起该 gate 常驻，防止未来再造 store-only 动词。
**禁**：改动词的外部语义（ripple 的"后续前移"范围 = 被删 clip 右侧同轨全部）；gate 用 eslint 插件实现（用测试实现，简单可控）。

**预设测试**：
- ops 纯函数：ripple 删中间 clip → 右侧 clips offset 各减 duration；collapse 三 clip 两缝 → 缝闭合顺序保持；duplicate → 新 id ≠ 原 id、字段深拷贝（cloneDeep 纪律）；setTrackProps 部分更新不碰兄弟字段（spread-guard 纪律，#81 教训）。
- sweep gate：故意留一个未下沉动词时红（先证红），全下沉后绿。
- store 回归：既有 store.test.ts 的 ripple/collapse 行为测试不改动仍绿（外部行为锁定）。
- CLI 命令表测试 4 条新动词。

**Acceptance criteria**：
- [ ] 证红转绿；`test:web` + `test:server` 全绿；sweep gate 常驻。
- [ ] UI 的 ripple delete（Shift+Backspace）与 `clip remove --ripple` 对同一 composition 产出逐字节一致。

**Blocked by**：None。
**Code-area hints**：`web/src/features/studio/store.ts:140-144,581-603`（store-only 现场）；`web/src/features/studio/panels/Timeline/toolbar/collapseGaps.ts`；共享 ops 目录 `src/shared/composition/ops/`（已收敛的 11 动词是接线范本）。

---

## S8 · 共享 ops 下沉 II：keyframe remove/move + transition update + 多选协议 + reframe 语义糖

**What**：续 S7：`removeKeyframe`/`moveKeyframe`（改时间点，值不变）、`updateTransition`（in-place 改 preset/duration）下沉为共享 op 三端接线（CLI `clip keyframe remove/move`、`transition set <id> --preset --dur`）；`select` 协议扩多目标（`select clips <id...>`，bridge frame 广播数组，UI 高亮多 clip——复用 PRD-0013 多选 store 态）；`clip reframe <id> --aspect 9:16 [--punch-in <scale>] [--from <sec> --to <sec>]` 语义糖：组合写 crop + scale/x/y keyframe（复用既有 op，不引新 schema）。
**禁**：reframe 引入新 schema 字段（它是纯组合糖）；多选广播破坏既有单选消费方（向后兼容：单 id 仍可用）。

**预设测试**：
- ops：removeKeyframe 删指定 property 指定时间点、其余保留；moveKeyframe 时间点改变值不变、越界 clamp；updateTransition 改 preset 后 refine 仍过。
- CLI 命令表 4 新动词；reframe 产出的 composition 含预期 crop + keyframe 组（断言帧对齐值）。
- bridge select 多目标 frame 结构测试 + 单 id 向后兼容。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿；sweep gate（S7）覆盖新动词自动通过。
- [ ] `transition set` 与 UI Inspector 改转场产出一致。

**Blocked by**：S7（同文件域连续链 + gate 已存在）。
**Code-area hints**：store `removeKeyframe/updateKeyframe:938-954`、`updateTransition:490`；多选 store 态见 PRD-0013 S8③④ 交付（`MarqueeSelection`）。

---

## S5 · `VideoClip.sourceAudio` + `detachAudio`：原声拆轨

**What**：schema 新增 `VideoClip.sourceAudio?: {enabled: boolean, volume?: number}`（缺省 = enabled:true，向后兼容现状）；渲染两侧消费：enabled:false 时预览静音该 clip 源声、导出 mux 时丢弃源声轨；volume 作用于源声。共享 op `detachAudio(clipId)`：生成同源 AudioClip（src/in/out/offset 对齐、落 audio 轨，无 audio 轨则建）+ 原 clip `sourceAudio.enabled=false`，原子两步。CLI `clip detach-audio <id>`；Inspector 视频 clip 节新增"原声"开关 + 音量 + Detach 按钮。
**禁**：detach 后源声双份出声（预览/导出都要验证互斥）；schema 变更破坏存量 yaml（无字段 = enabled）。

**预设测试**：
- schema：无 sourceAudio 的存量 clip 解析后语义等于 enabled:true（快照回归）；refine 对 volume 范围校验。
- op：detachAudio 产出 AudioClip 字段对齐断言 + 原 clip 开关翻转 + 幂等性（二次调用报错或 no-op，定义清楚）。
- 渲染消费：Remotion 渲染树中 enabled:false 的 clip 无音频节点（照渲染树测试先例）；导出侧 ffmpeg 参数含对应静音/丢轨（纯函数断言构图字符串）。
- CLI + Inspector 组件测试（开关触发 op）。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。
- [ ] 手验：detach 后预览里源声消失、新 A 轨出声、对 A 轨调 ducking 生效。

**Blocked by**：S8（schema/ops 连续链）。
**Code-area hints**：`VideoClipObjectSchema`（`src/shared/composition.ts:202-236`）；ducking 混音链在 render-pipeline Stage 2；OpenCut 对标 `ToggleSourceAudioSeparationCommand`（`docs/竞品/OpenCut-pre-rewrite/.../commands/timeline/element/toggle-source-audio-separation.ts`）。

---

## S3 · `VideoClip.transitionIn`：入场转场进 composition（快切的表达根基）

**What**：schema 新增 `VideoClip.transitionIn?: {preset, durationSec, easing?}`（preset 取值 = S2 注册表全集；refine 校验 durationSec ≤ clip 有效时长）；渲染：Remotion 在 clip 头部套 presentation 组件（复用 S2 注册表，预览=导出同源）；共享 op `setTransitionIn(clipId, spec|null)`；CLI `clip set <id> --transition-in glitch:0.4`（`preset:durationSec` 语法，`--transition-in none` 清除）；Inspector 视频 clip 节新增入场转场选择器（preset 下拉 + 时长）。
**禁**：transitionIn 与相邻 cut-point transition 合并语义（正交共存）；UI 单侧接线（必须走共享 op——sweep gate 会抓）。

**预设测试**：
- schema/refine：超长 durationSec 拒绝；未知 preset 拒绝；合法写入回读一致。
- 渲染树：带 transitionIn 的 clip 头部含对应 presentation 节点、时长换算帧数正确。
- op + CLI 语法解析（`glitch:0.4`/`none`）+ Inspector 组件（选择触发 op）。
- 存量 yaml 无字段回归。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。
- [ ] 手验：42 拍式快切样例（脚本生成 5 clip 各带不同 transitionIn）预览逐拍有转场、导出一致。

**Blocked by**：S2（注册表）+ S5（schema 连续链）。
**Code-area hints**：refine 逻辑在 `refineTrack`（`composition.ts:357-398`）旁；CLI clip set 已有 flag 家族先例。

---

## S12 · bezier easing 数据模型

**What**：`KeyframeEasingSchema` 从 4 离散枚举扩为 `枚举 ∪ {type:"cubic-bezier", p:[x1,y1,x2,y2]}`（x 域 [0,1] 校验）；预览/导出插值统一走 `Easing.bezier`（Remotion）；CLI `clip keyframe add/set --easing "cubic-bezier(0.4,0,0.2,1)"` 解析；Inspector easing 选择器加"自定义 bezier"项（四数字输入）。
**禁**：graph editor 可视化（顺延）；离散枚举语义漂移（既有 4 值行为不变）。

**预设测试**：
- schema：合法/越界 p 值校验；离散枚举回归。
- 插值纯函数：cubic-bezier(0.4,0,0.2,1) 在 t=0.5 的输出与 Remotion Easing.bezier 一致（数值断言）。
- CLI 解析（字符串→结构/报错）；存量 yaml 回归。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。

**Blocked by**：S3（schema 连续链）。
**Code-area hints**：`KeyframeEasingSchema`（`composition.ts:145`）；keyframe 插值消费点 grep `easing`。

---

## S15 · `snapToFrame` 帧量化 + 同轨 overlap 校验（双驱动 determinism 地基）

**What**：① 共享 ops 层入口统一量化：所有写 offset/in/out/durationSec 的 op 过 `snapToFrame(sec, fps)`（round 到最近帧边界；fps 取 composition）；② `refineTrack` 增同轨 clip 重叠检测（半开区间 `start < otherEnd && end > otherStart`，照 OpenCut placement 模型）：video/audio 轨 error（含 clip id 对与重叠区间的结构化信息），overlay 轨放行（PiP 合法）；③ CLI/bridge 写入路径报错透传。
**禁**：在 store/UI 层各写一份量化（只在 ops 层）；把既有合法重叠数据（若有）炸掉——先跑一遍存量 fixture 确认，必要时 preflight 降级 warning 一个版本。

**预设测试**：
- snapToFrame 纯函数（30fps：0.034→0.0333…=1 帧；负值/NaN 拒绝）；每个写时间的 op 各一条"亚帧输入落帧边界"断言（sweep 式循环全 op 家族）。
- refineTrack：video 轨重叠 → error 带两 id；overlay 重叠 → 通过；恰好首尾相接（end==start）→ 通过（半开区间）。
- 存量 fixture 全量 refine 回归不炸。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。
- [ ] agent 写 `--at 1.23456` 后回读 offset 是帧对齐值。

**Blocked by**：S12（ops/schema 连续链尾）。
**Code-area hints**：`refineTrack`（`composition.ts:357-398`）；OpenCut 对标 `.../timeline/placement/overlap.ts`。

---

## S13 · mask + letterbox preset

**What**：schema 新增 `VideoClip.mask?: {type:"rect"|"ellipse", feather?: 0..1, inverted?: boolean, rect?: {x,y,w,h 归一化}}`；渲染：Remotion 侧 SVG clipPath + feather 用 blur 边缘（预览=导出同一组件，不写 ffmpeg 对偶）；letterbox 做成 preset（CLI `clip mask <id> --preset letterbox-2.35`，展开为 rect+inverted）；共享 op `setClipMask`；CLI `clip mask <id> --shape ellipse --feather 0.2 [--inverted]` / `--none`；Inspector mask 节（shape/feather/inverted 控件）。
**禁**：mask 参数 keyframe 化（本版明确不做）；ffmpeg 侧对偶实现。

**预设测试**：
- schema/refine：归一化范围校验、preset 展开值断言。
- 渲染树：带 ellipse mask 的 clip 渲染树含 clipPath 节点、feather>0 时含 blur；inverted 的 path 方向正确（可断言生成的 SVG path 字符串）。
- op + CLI + Inspector 组件测试。
- 一致性预备：mask 渲染组件在 `renderMedia` 单帧下不抛（为 S16 铺路）。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。
- [ ] 手验：ellipse+feather 在暗亮两主题预览正常、导出帧与预览帧肉眼一致。

**Blocked by**：S15（schema/ops 连续链）。
**Code-area hints**：OpenCut mask 参考 `.../masks/types.ts`（9 种，本版只抄 rect/ellipse + feather/inverted）；Remotion clip 渲染组件挂载点跟随 transforms/crop 消费处。

---

## S14 · blendMode + 有序 effects 栈 + adjustment 轨

**What**：① `VideoClip/OverlayClip.blendMode?: "normal"|"screen"|"multiply"|"overlay"|"add"`，Remotion 侧 CSS `mix-blend-mode`（导出同源）；② `filters`（扁平 grade+lut）→ `effects: [{id,type,params,enabled}]` 有序栈：读时旧 `filters` 自动投影为一个 grade entry（写回新格式），内置 type：`grade`（收编现有三旋钮+lut）、`blur`、`vignette`、`grain`；共享 op `addEffect/removeEffect/reorderEffect/toggleEffect/updateEffectParams`（对标 OpenCut 命令族）；③ 新增 `kind:"adjustment"` 轨：clip 携带 effects 栈，渲染时包裹其时间窗内 z 序更低的轨输出。CLI `clip effects add/remove/reorder/toggle/set`、`clip set --blend screen`、`track add --kind adjustment`；Inspector effects 栈列表（增删/开关/排序）+ blend 下拉。
**禁**：丢弃旧 `filters` 数据（读时投影必须无损）；blend/effects 只接 UI 不接 CLI（sweep gate 抓）。

**预设测试**：
- schema 迁移：含旧 `filters` 的 yaml 载入 → effects 含等价 grade entry、回写新格式、二次载入幂等（快照回归）。
- ops 族：add/remove/reorder/toggle/updateParams 各自外部行为 + 顺序稳定性。
- 渲染树：blend=screen 的 clip 样式含 mix-blend-mode；effects 栈按序生成滤镜包裹；adjustment 轨包裹下层、时间窗外不作用。
- CLI 命令族 + Inspector 组件测试。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。
- [ ] 手验：漏光素材 screen 混合 + 全片 adjustment 调色在预览/导出一致。

**Blocked by**：S13（schema/ops 连续链尾片）。
**Code-area hints**：`FiltersSchema`（`composition.ts:65`）；OpenCut effect 命令族 `.../commands/timeline/element/effects/`；adjustment 对标 `EffectElement`→sceneEffect。

---

## S9 · 字幕闭环：`--script` 台词对齐 + `export --caption-tracks` + manual 纠偏

**What**：① `captions generate --script <file> [--max-cjk-chars 14]`：ASR 出词级 timing → 与台词真值文本粗对齐（LCS 级，按句/短语锚定）→ 替换文本 → CJK 按上限分行 → 产出 CaptionModel（不再只出裸 TextClips）；② CLI `export --caption-tracks zh[,en]` 透传渲染队列 body（能力已在 queue，只补 CLI 面）；③ manual 纠偏：删 libass 独立烧字死路径段落（`burnSubtitles` 无条件 throw 的僵尸文档），改写为 overlay+CaptionModel 主路径 + managed ffmpeg gotcha。
**禁**：逐词强制对齐到 ASR 错词边界（粗对齐即可，字幕行级 timing 准就够）；恢复 libass adapter（明确退役）。

**预设测试**：
- 对齐纯函数：ASR 词序列（含错词"那村调"）+ 真值台词 → 输出行文本 = 真值、行 timing 来自 ASR（fixture 驱动，照 captions 既有 fixture 流解析先例）；CJK 分行 ≤14 字且不断词组边界（给定分词假设）。
- CLI：`--script` 缺文件报错；`export --caption-tracks` body 透传断言（照 export 既有测试）。
- manual 纠偏：docs-drift 测试（若 `docs-drift.test.ts` 覆盖 manual，更新其快照）断言 libass 死路径描述已移除。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。
- [ ] 手验：对一段真实中文 TTS 音轨 `captions generate --script`，产出字幕文本与台词逐字一致、烧录导出可读。

**Blocked by**：None（不碰 schema 链，排 S14 后只为串行节奏）。
**Code-area hints**：`captions` 命令现状（ASR→TextClips）；`src/domain/audio-tools.ts::burnSubtitles`（throw 现场）；stable-whisper 环境 gotcha 见 memory（venv、stable-ts 包名）。

---

## S10 · 生成韧性：断连取消 + manifest 幂等（堵孤儿计费）

**What**：① 生成路由（video/image/audio 生成端点族）接入 request abort：客户端断连/显式 abort → 服务端取消对上游 provider 的进行中 job（能取消的调 provider cancel；不能取消的停止入账后续轮询并标记 orphaned，记入 cost-ledger 备注）——对齐 #63 `cancelInFlightRenders` 先于释放的模式；② 批量生成 manifest：work 目录内 `generation-manifest.json`（key = 内容 hash（prompt+params），value = {status, assetPath}），生成入口先查 manifest：done 跳过、in-flight 拒绝重复下单、failed 允许重试；③ CLI/资产生成路径全部过 manifest。
**禁**：把"宽松超时"当修复（那是 recipe 侧，工程侧必须真取消）；manifest 用时间戳当 key（必须内容寻址才幂等）。

**预设测试**：
- 路由测试：模拟客户端 abort（AbortController）→ provider mock 的 cancel 被调 / 轮询停止（spawn-mock / provider mock 先例）；未 abort 正常完成不受影响。
- manifest 纯函数 + 集成：同 key 二次请求被跳过（返回既有 asset）；failed 后重试放行；并发同 key 第二个拒绝（useRef/锁纪律的服务端版）。
- cost-ledger 断言：orphaned 标记入账备注。

**Acceptance criteria**：
- [ ] 证红转绿；`test:server` 全绿。
- [ ] 手验：发起生成后立即断开 CLI，provider mock 侧收到取消；同 prompt 重跑不重复下单。

**Blocked by**：None。
**Code-area hints**：生成路由族 grep `openrouter-image|seedance|generate`；provider 抽象在 `src/providers/`；cost-ledger 在 `src/server/cost-ledger/`。

---

## S11 · render 队列 CLI 全生命周期 + `render snapshot --frame`

**What**：CLI 新增 `render enqueue [--preset --proxy --caption-tracks]`（走队列 REST 返回 jobId）、`render status <jobId>`（含 progress）、`render cancel <jobId>`、`render history`、`render snapshot --frame N [--out <png>]`（走 `remotion-still` 单帧渲染，agent 的廉价 ground-truth 自检点）。既有 `export` 同步语义保留。manual 补 render 端点文档（`GET /api/render/jobs/:id` —— #94 blocker 5 的可发现性修复）。
**禁**：改队列 REST 契约（只补 CLI 面）；snapshot 走全量导出（必须单帧路径）。

**预设测试**：
- CLI 命令表 5 新动词（照 cli.test.ts 模式，REST mock 断言路径/body/输出格式）。
- snapshot 集成（可跳过）：对 fixture composition 渲第 30 帧出 PNG、文件头验证。
- manual 文档 drift 测试更新。

**Acceptance criteria**：
- [ ] 证红转绿；全套件绿。
- [ ] 手验：`render enqueue` → `status` 看到 progress 演进 → 产物存在；`snapshot --frame` 出图。

**Blocked by**：None。
**Code-area hints**：队列 REST `src/server/routes/render.ts:103-120`（status/cancel 亲验存在）；`remotion-still.ts`（单帧能力已有）。

---

## S16 · 预览=导出一致性回归 gate（WYSIWYG 的机器化验收）

**What**：测试基建：给定 composition + 帧号，A 路走 Remotion 渲染器直出单帧 PNG（代表预览），B 路走导出管线（含 pre-pass）后 ffmpeg 抽同帧 PNG，逐像素比对（容差阈值：均值 ΔE 或逐通道差 ≤ 阈值，排除编码噪声）。fixture 族覆盖：transitionIn（S3）、多值 speed（S4）、mask（S13）、blend/effects/adjustment（S14）、freeze/reverse（存量高危）。作为 `test:server` 内 integration 族（ffmpeg 缺失跳过），并入 CI。
**禁**：容差调到掩盖真实裂缝（阈值要能抓住"回退 1×"级别的差异——用 S4 修复前的行为做校准：故意注入旧回退逻辑必须红）。

**预设测试**（本片交付物本身是测试，先行体现为）：
- 先写 gate 框架 + freeze/reverse 两条存量 fixture 证明框架能跑（绿）；
- 再写"人为制造不一致"的自检 case（mock 导出侧跳过 speed pre-pass）断言 gate 红——证明 gate 有牙。

**Acceptance criteria**：
- [ ] gate 对 7 类 fixture 全绿；自检 case 证明能抓不一致。
- [ ] CI 接入（ffmpeg available 的 runner 上跑）。

**Blocked by**：S3 + S4 + S13 + S14（被测能力齐备）。
**Code-area hints**：`remotion-still.ts`（A 路）；render-pipeline（B 路）；PNG 比对不引重依赖（node 内置 + pngjs 级别足够，先 grep 仓内既有图像比对先例）。

---

## S17 · skill recipes 六条 + 操作手册补全

**What**：`skills/autoviral` 落 #95 的操作机制（纯文档片）：`recipes/video/decouple-narration.md`（单 TTS 轨锁 voice + 静音画面）、`recipes/video/beat-cutting.md`（4–5s 原生速切拍、一短语一画面、禁 setpts 慢放填时、同源段连续）、`recipes/video/burn-subtitles-asr-aligned.md`（指向 S9 新命令）、`recipes/video/generate-cover.md`（中文标题 prompt 模式）、生成韧性 gotcha（指向 S10 的 manifest/取消 + 前台单 clip 存活率）、成本旋钮（720p vs 1080p 价格表）+ managed ffmpeg gotcha（05-conventions）+ render 队列/快照端点文档（S11 交付的动词）。同步 `autoviral docs` 输出源。
**禁**：写成审美教学（taste 归 sibling skill——只写操作机制）；引用未交付的动词。

**预设测试**：
- docs-drift / skill-sync 测试更新（manual 内容源与 `autoviral docs` 输出一致的既有机制）。
- 每条 recipe 引用的 CLI 动词 grep 断言真实存在（防"注释承诺未接线"病灶）。

**Acceptance criteria**：
- [ ] 全套件绿；`autoviral docs` 能列出新 recipes。

**Blocked by**：S9 + S10 + S11（引用其交付动词）。
**Code-area hints**：`skills/autoviral/manual/`、`recipes/`；skill-sync 机制（managed COPY，别手编 `~/.claude/skills` 侧）。

---

## S18 · 多纬度 E2E 终验（Workflow 编排，主 agent 不亲点浏览器）

**What**：全部功能片合入后，按 .claude/rules/e2e-testing.md 派 Workflow：≥6 纬度——① agent-CLI 全链路（生成/import 素材 → 快切 5 拍带 transitionIn/变速/mask → captions --script → render enqueue→status→产物）；② 人-UI 接手纬度（在 agent 产物上 Inspector 改 mask/blend/转场，行为与 CLI 一致）；③ WYSIWYG 纬度（预览截图 vs 导出帧抽查比对，含暗亮主题 DOM 二确）；④ 失败边界纬度（重叠 clip 校验报错、超长 transitionIn 拒绝、断连生成取消、probe 失败 import 报错）；⑤ 渲染队列生命周期纬度（enqueue/status/cancel/snapshot）；⑥ 字幕中文路径纬度（≤14 字分行、样式烧录可读）。+ completeness-critic 汇总。每纬 subagent 带截图 + DOM 二确证据；浏览器纬度 Claude subagent。前置：`build:backend` + 重启 daemon + 前端 build 新鲜度检查（stale dist 教训）。
**禁**：backend artifact 当通过证据；单 agent 跑全部纬度。

**Acceptance criteria**：
- [ ] ≥6 纬全 pass 或 fail 项全部修复后复验 pass；critic 无 CRITICAL 漏测。
- [ ] 产出 e2e-report 归档 `docs/prd/0014-recon/`（或 slices 同级）。

**Blocked by**：S1–S17 全部。

---

## S19 · CHANGELOG + version bump 0.2.0 + 发布准备

**What**：CHANGELOG 按 Keep a Changelog 写 `## [0.2.0]` 全量条目（Added/Fixed/Changed/Deprecated——四转场端点 deprecated 要列）；version bump 整仓 0.1.11 → 0.2.0；README/docs 引用版本处同步；`docs/prd/README.md` 登记 0014。commit 序列干净（每片一 commit 已随片走，本片收尾 chore(release) commit）。**不打 tag 不 push**（等用户醒来验收后决定）。
**预设测试**：无（纯文档/版本，commit message 注明豁免理由）。

**Acceptance criteria**：
- [ ] `npm run test:web` + `test:server` + `build:backend` + 前端 build 全绿（发布级绿门）。
- [ ] CHANGELOG 条目覆盖 S1–S17 全部用户可见变更。

**Blocked by**：S18。

---

## 波次总览

| 波 | 片 | 说明 |
|---|---|---|
| W1 | S1 → S2 | 转场根因 + 注册表（Epic A） |
| W2 | S4 → S6 | 变速导出 + 成片回填（独立域） |
| W3 | S7 → S8 → S5 → S3 → S12 → S15 → S13 → S14 | schema/ops/store 连续链（Epic D+B+G+H，严格串行防冲突） |
| W4 | S9 → S10 → S11 | 字幕/韧性/渲染 CLI（Epic E+F） |
| W5 | S16 → S17 | 一致性 gate + 文档（依赖前序交付） |
| W6 | S18 → S19 | E2E 终验 + 发布准备 |
