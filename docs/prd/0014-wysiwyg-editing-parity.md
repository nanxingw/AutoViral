# PRD-0014 · WYSIWYG 焊死与剪辑能力对标：承载 agent 亲手剪的完整短视频

**Status: Proposed (2026-07-14) · triage: `ready-for-agent` · 目标版本：v0.2.0**

> Source: GitHub issues #93/#94/#95（用户 2026-07-14 用本产品实战产出 3 分钟科普成片后提出，全部有当日复现证据）+ OpenCut 全能力对标研究 [docs/research/2026-07-14-opencut-parity-ai-studio-gap.md](../research/2026-07-14-opencut-parity-ai-studio-gap.md)（16-agent workflow 产出 80 条差距矩阵，关键锚点经主线亲验；9 份盘点 + 4 份 gap 矩阵归档在 `docs/竞品/analysis/`，gitignored）。
> Issue 切片：随 `to-issues` 落 [docs/prd/0014-wysiwyg-editing-parity-issue-slices.md](0014-wysiwyg-editing-parity-issue-slices.md)（docs-only tracker，绝不开 GitHub Issue）。
> **执行约定（用户 2026-07-14 立规）**：所有切片由 **Claude Opus 实现**，**codex (GPT-5.6) review**；测试先行纪律不变（.claude/rules/test-first.md）；E2E 走 Workflow 多纬度 subagent（.claude/rules/e2e-testing.md）。
> **本版核心验收（用户原话）**："完美达到所见即所得的效果，并充分充实剪辑能力"——预览即导出（WYSIWYG）是灵魂验收，每个新能力必须天生双驱动（agent CLI + 人 UI 收敛到同一份 composition）。

---

## Problem Statement

用户是全职创作者，日常由 AI agent 在 AutoViral 工位里完成"生成素材 → 剪辑 → 导出"的闭环，Studio 是用户唯一的视觉入口。2026-07-14 的实战（39 个生成镜头、42 拍原生速度快切、变奏转场、ducking BGM、烧录中文字幕的 3 分钟成片）暴露出：**整片被迫用裸 ffmpeg 在 Studio 之外拼装，Studio 时间线从头到尾停在错误的旧慢动作版本**。逐层拆解为十个问题组：

1. **cinematic 转场唯一通路断裂**（#93）。四个转场端点全 HTTP 500：glitch-cut 与 domain-warp 的 `geq` 表达式用小写 `t`（geq 只认大写 `T`），且把 `if(between(...))` 嵌进 `p(X+(...),Y)` 令 eval 解析崩；grav-lens 则在 `lenscorrection` 的静态 option 里塞时间表达式（`src/server/render/transitions.ts:280` 起，三种坏法经主线亲验）。即便修好，产物也是烘焙 MP4，游离在 composition 之外——Studio 既预览不了也管理不了。
2. **composition schema 表达不了真实快切**（#94 blocker 2）。快切每一拍需要"入场转场"，但 `VideoClip` 无 `transitionIn` 字段；变速更糟——`speed` 是一等 keyframe property，预览里 `<OffthreadVideo playbackRate>` 真在动，导出侧 `speed-ramp-ffmpeg` 对多值曲线 `console.warn` 后**静默回退 1×**，AudioClip 的 speed 被直接忽略。"预览里动、导出里死"是最恶性的 WYSIWYG 裂缝。
3. **成片无法回填时间线**（#94 blocker 3）。没有"把这个 mp4 放成一条 clip / flatten 到时间线"的一等动词：`clip add` 不 probe 时长、不清旧 clip、不登记 Asset/Provenance，agent 连让 Studio *显示*交付物都做不到。
4. **字幕没有一等样式烧录路径**（#94 blocker 4，#95 §3/§5）。独立 libass 烧字 adapter 已删除但 manual 仍宣称可用（死路径+误导双重伤害）；host Homebrew ffmpeg 缺 libass；ASR 在干净 TTS 音轨上"时间准但文本错"（内存条→那村调），没有"ASR timing + 已知台词文本对齐替换 + 中文短行分割"的工作流。
5. **render 对 agent 是可发现性黑盒**（#94 blocker 5，经查为误判但暴露真缺口）。状态端点其实存在（`GET /api/render/jobs/:id`，含 progress），但 skill/manual 没写，agent 猜错 URL 后放弃；CLI `export` 同步阻塞绕过队列，没有 enqueue/status/cancel/history 动词，也没有"渲染中第 N 帧快照自检"的廉价 ground-truth。
6. **三层不对齐：十余个编辑动词只活在 React store**。AutoViral 有 schema / 共享 ops / store-only action 三层，仅约 11 个动词做到 store↔bridge 共享 op 真收敛；`rippleDeleteClip`、`collapseGaps`、`updateTransition`、`removeKeyframe`/`updateKeyframe`、`renameTrack`/`setTrackLanguage`/`setTrackVolume`、多选框选全部 store-only，agent 经 CLI 够不着——直接违反"agent 经 CLI 驱动 = 人在 UI 点，两条路产出一致"的产品命题。历史教训：转场系统上线时 add 做了双驱动、update 只做了 UI，此病灶反复发生。
7. **视觉表达力整块缺失**。无 mask/matte（连 letterbox 黑边都表达不了）、无 blendMode、filters 是扁平三旋钮不可堆叠不可排序、无跨 clip 的 adjustment 层、keyframe easing 只有 4 个离散枚举无 bezier。对标 OpenCut pre-rewrite：9 种 mask、17 种 blend、有序 effect 栈、bezier handle + graph editor 数据模型。
8. **WYSIWYG 没有地基**。预览（Remotion Player）与导出（Remotion headless + ffmpeg 五级流水线）之间，ffmpeg 私有分支（变量变速/reverse/ducking/loudnorm）不进预览且无任何一致性回归 gate；时间字段全是浮点秒（agent 可写任意亚帧 offset，多次 trim/split 累积 round 误差）；`refineTrack` 不校验同轨 clip 重叠（agent 可静默写出重叠 clip）。OpenCut 的答案是单渲染器 + 整数 MediaTime tick——架构性免疫这一整族 bug。
9. **生成韧性缺陷造成真金白银泄漏**（#95 §4 的工程半边）。客户端超时不取消服务端生成 → 为孤儿 clip 付费；批量生成无 manifest 幂等，中断重跑会重复下单。与历史 #63（work-delete 孤儿 render）/#62（export 双发）同族。
10. **操作手册缺口让 agent 每次现场重新发明轮子**（#95 其余六条）。旁白/画面解耦、beat 原生速剪辑、封面生成、成本旋钮、managed ffmpeg 等操作机制没进 `skills/autoviral`。

## Solution

v0.2.0 = **三根 WYSIWYG 柱子 + 一条双驱动纪律 + 两块能力扩展 + 一组韧性/文档修复**，按报告 Epic A–H 落地：

**A · 转场复活并进注册表（P0）**：修三种 geq/lenscorrection 坏法 + CI 四转场纯色 clip smoke test；把 stylize 家族（glitch/light-leak/whip 等）重做成 Remotion presentation 组件进 `TRANSITION_PRESET_META` 注册表——与既有 13 个 cut-point preset 同框，预览=导出天然一致，淘汰 ffmpeg 烘焙端点。
**B · schema 承载真实快切（P0）**：`VideoClip.transitionIn`（preset+duration+easing，渲染复用 A 的注册表）；变速导出真实生效（按 keyframe 分段 setpts/atempo → concat 的导出 pre-pass，AudioClip 至少匀速 atempo）；`VideoClip.sourceAudio`（enabled+volume）+ `detachAudio` 共享 op + CLI `clip detach-audio`（拉原声成独立 A 轨供 ducking）；`clip reframe` 语义糖（crop+scale keyframe 组合，消除 punch-in 的可发现性断层）。
**C · 成片回填（P0）**：`clip import <mp4> [--replace-timeline]` 一等动词——ffprobe 探测 → 登记 Asset+Provenance(import) → 放置/替换时间线 → 广播刷新。
**D · 共享 ops 纪律 + 反向断层批量下沉（P1，双驱动灵魂）**：ripple/collapse、keyframe delete/move、transition update、多选、track set、duplicate 全部提成共享 op + CLI 动词 + bridge 端点；store 改为调共享 op；立 lint/测试 gate："新编辑动词必须先落共享 ops 层"。
**E · 字幕闭环 + 生成韧性 + 文档纠偏（P1）**：纠正 manual 的 libass 死路径、主推 overlay+CaptionModel 烧录；`captions generate --script <file>`（ASR timing + 台词真值对齐 + `--max-cjk-chars`）；CLI `export --caption-tracks`；服务端生成 job 断连即取消 + manifest 幂等去重（G-41）；#95 六条 recipe 落 `skills/autoviral`。
**F · 渲染可观测性（P1）**：render 队列 CLI 全生命周期（enqueue/status/cancel/history）+ `/api/render/jobs/:id` 写进 manual；`render snapshot --frame N` 单帧 PNG 自检动词。
**G · 视觉表达力扩展（P2）**：`VideoClip.mask`（rect/ellipse 起步 + feather/inverted + letterbox preset）；`blendMode` 五枚举；`filters` → 有序 `effects` 栈（grade 收编现有 + blur/vignette/grain，旧字段向后兼容投影）；adjustment 轨（时间窗内作用下层轨）；bezier easing 数据模型（graph editor UI 顺延）。全部三件套双驱动落地。
**H · WYSIWYG 地基（P2）**：预览 vs 导出单帧 PNG 比对的一致性回归 gate；ops 层 `snapToFrame` 帧量化；`refineTrack` 同轨 overlap 校验（video 轨 error、overlay 轨放行做 PiP）。

用户视角的最终状态：agent 剪一支 42 拍快切，每一拍的转场/变速/punch-in/字幕全部活在 composition 里，Studio 时间线实时反映真实成片，人可以接手任何一个 clip 微调，预览里看到什么导出就是什么；agent 与人的每个动作都收敛在同一份 `composition.yaml`。

## User Stories

**创作者（人在 Studio UI）**

1. As a 创作者, I want 预览里的 glitch/light-leak 转场和导出成片完全一致, so that 我不用导出后才发现转场不对再返工。
2. As a 创作者, I want agent 剪完的成片完整呈现在时间线上（每拍一个 clip、转场/变速/字幕可见）, so that 我能接手微调任何一拍而不是面对一个黑盒 mp4。
3. As a 创作者, I want 给 clip 设置的变速曲线在导出里真实生效, so that 预览认可的节奏就是成片的节奏。
4. As a 创作者, I want 在 Inspector 里给 clip 加 ellipse/rect 蒙版和羽化, so that 我能做聚光/暗角式的视觉引导。
5. As a 创作者, I want 一键给画面加 2.35:1 电影黑边（letterbox preset）, so that 不用手动叠黑色矩形。
6. As a 创作者, I want 给叠加层选 screen/multiply 等混合模式, so that 漏光/纹理叠加有专业效果。
7. As a 创作者, I want 按顺序堆叠多个效果（调色+暗角+噪点）并单独开关, so that 我能像专业 NLE 一样组织效果链。
8. As a 创作者, I want 一条 adjustment 轨对时间窗内所有下层轨统一调色, so that 全片风格统一不用逐 clip 复制 filters。
9. As a 创作者, I want ripple delete 删 clip 后自动闭合空隙, so that 快切时间线不会留缝。
10. As a 创作者, I want 中文字幕按 ≤14 字断行、带样式烧录进成片, so that 抖音观众看到的字幕专业可读。
11. As a 创作者, I want 时间线上拖动 trim/移动 clip 时落点吸附到帧, so that 不产生亚帧漂移和导出抖动。
12. As a 创作者, I want 视频 clip 的原声可以拆成独立音轨, so that 我能对原声和 BGM 分别做音量/ducking。
13. As a 创作者, I want 导出进行中能看到真实进度和中间帧, so that 长渲染不再是焦虑黑盒。
14. As a 创作者, I want 我在 UI 做的每个操作 agent 都能看到并接着改, so that 人机接力不丢状态。

**AI agent（经 `autoviral` CLI / bridge）**

15. As an agent, I want `POST /api/transitions/*` 不再 500, so that 我能给快切加 cinematic 转场而不必裸 ffmpeg。
16. As an agent, I want 用 `clip set <id> --transition-in glitch:0.4` 把入场转场写进 composition, so that 转场跟 clip 走、Studio 能预览、导出必然一致。
17. As an agent, I want `clip import output/final.mp4 --replace-timeline`, so that 我在外部工具产出的成片能一键回填时间线给用户看。
18. As an agent, I want `clip detach-audio <id>`, so that 我能把 i2v 原声拉出来做 ducking 或替换成锁定音色的 TTS 轨。
19. As an agent, I want `clip remove <id> --ripple` 和 `track collapse <id>`, so that 我删拍后时间线自动闭合，快切不留缝。
20. As an agent, I want `clip keyframe remove/move`, so that 我能修正而不只是叠加关键帧。
21. As an agent, I want `transition set <id> --preset dissolve --dur 0.5`, so that 调转场不用先删再加。
22. As an agent, I want `select clips <id1> <id2> ...` 多选协议, so that 我能引导用户注意一组相关 clip。
23. As an agent, I want `track set <id> --label/--language/--volume/--muted`, so that 轨道管理不用绕全量 `comp put`。
24. As an agent, I want `clip duplicate <id> [--offset]`, so that 复用同一素材的多拍不用重新 add + 配置。
25. As an agent, I want `clip reframe <id> --aspect 9:16 --punch-in 1.2`, so that "用源第 4–8 秒并逐渐推近"一条命令表达。
26. As an agent, I want `render enqueue/status/cancel/history`, so that 我能异步管理渲染而不是同步阻塞干等。
27. As an agent, I want `render snapshot --frame N` 得到单帧 PNG, so that 我能廉价自检"第 N 帧到底长什么样"再向用户汇报。
28. As an agent, I want `captions generate --script script.txt --max-cjk-chars 14`, so that 字幕拿 ASR 的时间戳、用我已知的台词真值文本。
29. As an agent, I want `export --caption-tracks zh`, so that 烧字幕导出不用手动 curl 渲染队列 REST。
30. As an agent, I want 给 keyframe 写 cubic-bezier easing 参数, so that 动画节奏不受 4 个离散枚举限制。
31. As an agent, I want `clip mask/blend/effects` 系列动词, so that 视觉表达力扩展对我和 UI 同时生效。
32. As an agent, I want 客户端断连后服务端自动取消进行中的生成 job, so that 不为孤儿 clip 付费。
33. As an agent, I want 批量生成走 manifest 幂等（同 key 不重复下单、已完成跳过）, so that 会话中断重跑不烧双倍钱。
34. As an agent, I want skill manual 教我 render 状态端点、managed ffmpeg、旁白解耦、beat 剪辑等操作机制, so that 我不用每次实战重新推导。
35. As an agent, I want 写入重叠 clip 时得到明确校验错误, so that 我能立即修正而不是导出时才踩雷。

**开发维护者**

36. As a 维护者, I want 四个转场在 CI 里对两条纯色 clip 各渲一遍的 smoke test, so that 滤镜表达式坏了立即 fail fast 而不是用户实战才发现。
37. As a 维护者, I want 预览 vs 导出单帧 PNG 比对的一致性回归 gate, so that 任何"预览动导出死"的裂缝在 PR 阶段被拦下。
38. As a 维护者, I want "新编辑动词必须落共享 ops 层"的 lint/测试 gate, so that `updateTransition` 式的单侧实现不再发生。
39. As a 维护者, I want 旧 `filters` 字段向后兼容投影到新 effects 栈, so that 存量 composition.yaml 不炸。

## Implementation Decisions

- **转场架构决策**：stylize 转场从"ffmpeg 烘焙独立 MP4 的 REST 端点"迁移为"Remotion presentation 组件 + `TRANSITION_PRESET_META` 注册表条目"。注册表是 preview 与 export 的共同事实源——这是 WYSIWYG by construction（PRD-0011 #54 的既有哲学延续）。四个旧端点修好 geq/lenscorrection 表达式后保留一个版本周期（标 deprecated），供尚未迁移的外部脚本过渡。
- **`transitionIn` 语义**：挂在 clip 上（`{preset, durationSec, easing?}`），渲染时作用于 clip 头部；与既有 cut-point transition（挂在轨道相邻 clip 之间）是两个正交概念，共存不合并。校验：durationSec 不得超过 clip 有效时长。
- **变速导出策略**：导出 pre-pass 按 speed keyframe 把源片切段，每段恒速 `setpts`/`atempo`（atempo 超界时 comma-chain），段间 concat；产物进既有 pre-pass 缓存（沿用 PRD-0011 的缓存三角纪律）。预览侧继续 `playbackRate`。AudioClip 恒速走 `atempo`。放弃"Remotion 时间重映射"备选（帧插值质量不可控）。
- **`sourceAudio` / detachAudio 语义**：`VideoClip.sourceAudio: {enabled, volume}` 默认 enabled（向后兼容 = 现状：视频自带声播放）。`detachAudio` op 生成同源 AudioClip（src 指向同一 asset、in/out/offset 对齐）并把原 clip 的 sourceAudio.enabled 置 false，是可组合的两步原子 op。
- **import 动词语义**：`clip import` = probe（ffprobe 时长/分辨率/fps）→ 登记 Asset（kind: video）+ ProvenanceEdge（op: import）→ 追加或 `--replace-timeline`（清空 video 轨放单 clip）。不做自动"逆向拆 beat"（成片是烘焙的，拆不回；flatten 方向由 agent 用 beats 数据正向重建）。
- **共享 ops 纪律**：`src/shared/composition/ops` 是唯一编辑动词层。本版把 6.2 反向断层清单全部下沉：store 动作改为薄包装调共享 op；bridge/CLI 直调同一 op。gate 用测试实现（枚举 store 编辑动作，断言各自有对应共享 op 导出——sweep matrix gate 模式），不引入自定义 eslint 插件。
- **mask 决策**：起步 rect/ellipse 两种 + `feather(0–1)`/`inverted`，letterbox 做成 mask preset（rect + inverted + 定比高度）。预览 Remotion 用 SVG clipPath + blur 羽化；导出侧同一 React 组件经 Remotion headless 渲染，不写 ffmpeg 对偶实现（保持单渲染器原则）。mask 参数本版不可 keyframe（OpenCut 也不可）。
- **effects 栈决策**：`filters`（扁平 grade+lut）→ `effects: [{id, type, params, enabled}]` 有序数组；载入时旧 `filters` 自动投影为一个 grade entry（读时迁移，写回新格式）；内置 type 起步：grade（收编现有）、blur、vignette、grain。
- **blendMode**：`normal | screen | multiply | overlay | add` 五枚举，Remotion 侧 CSS `mix-blend-mode`；导出走同一 Remotion 渲染，无 ffmpeg 对偶。
- **adjustment 层**：新增 `kind: "adjustment"` 轨，clip 携带 effects 栈，渲染时作用于其时间窗内 z 序更低的轨。
- **bezier easing**：`KeyframeEasingSchema` 扩展为离散枚举 ∪ `{type:"cubic-bezier", p:[x1,y1,x2,y2]}`；Remotion `Easing.bezier` 消费。graph editor UI 不在本版。
- **帧量化**：共享 ops 层入口对 offset/in/out/durationSec 做 `snapToFrame(sec, fps)` 量化（去掉 90% 亚帧漂移收益）；不做全链路整数 tick 迁移（硬依赖单渲染器收敛，见 Out of Scope）。
- **overlap 校验**：`refineTrack` 增同轨重叠检测——video/audio 轨 error、overlay 轨放行（PiP 是合法用例）。
- **一致性 gate**：测试基建——同一 composition 分别走 Remotion Player 帧提取与导出管线单帧提取，PNG 逐像素比对（容差阈值）；先覆盖 transitionIn、speed、mask、blend、effects 五个新能力 + freeze/reverse 两个存量高危。
- **生成韧性（G-41）**：生成路由接入 request abort 信号，断连即取消上游 provider job（对齐 #63 `cancelInFlightRenders` 先于释放的既有模式）；批量生成 manifest（work 目录内 JSON：key→status），同 key 幂等跳过。
- **render CLI**：`export` 保留同步语义（向后兼容），新增 `render enqueue/status/cancel/history/snapshot` 走既有队列 REST；`--caption-tracks` 透传队列 body。
- **captions --script**：ASR 出词级 timing → 与台词文本做对齐替换（最长公共子序列级别的粗对齐即可，字幕不要求逐词精确到 ASR 错词边界）→ `--max-cjk-chars` 分行 → 产出 CaptionModel。
- **文档/skill 纠偏**：manual 删 libass 独立烧字段落，改写为 overlay+CaptionModel 主路径 + managed ffmpeg gotcha；新增 recipes：旁白解耦、beat 剪辑、ASR 字幕对齐、生成韧性、封面、成本旋钮。
- **版本**：0.1.11 → 0.2.0（minor bump，0.x 期间允许行为变化；`filters`→`effects` 有读时兼容，无破坏）。

## Testing Decisions

- **测试先行铁律**：每片实现前预设测试落盘证红（.claude/rules/test-first.md）；只测外部行为——"transitionIn 写入后 refine 通过且渲染树含转场组件"，不测内部数据结构。
- **单元/集成先例**：schema/refine 测试照 `src/shared/composition` 既有 domain 测试；ops 层照共享 ops 既有测试；CLI 照 cli.test.ts 的命令表模式；渲染队列照 render-queue `:memory:` SQLite 注入模式；路由照 api.render.test.ts；store 薄包装照 store.test.ts。
- **sweep matrix gate**（feedback_contract_test_sweep_gate 模式）：枚举 store 全部编辑动作 × 断言对应共享 op 存在；枚举 `TRANSITION_PRESET_META` 全部 preset × 断言 Remotion 组件可解析渲染。
- **CI ffmpeg smoke**：两条纯色 clip 对四个（修复后的）转场端点各渲一遍，断言 exit 0 + 输出时长正确——滤镜表达式回归即红。
- **一致性 gate**：新增"预览帧 vs 导出帧"PNG 比对测试族，是本版 WYSIWYG 验收的机器化形态。
- **E2E**：全部切片合入后按铁律派 Workflow 多纬度 subagent（≥5 纬 + completeness-critic）：agent-CLI 全链路剪一支迷你快切→人 UI 接手微调→导出比对预览、字幕烧录中文路径、失败边界（重叠 clip / 超长 transitionIn / 断连生成取消）、渲染队列生命周期、视觉表达力（mask/blend/effects 在暗亮主题下 DOM 二确）。浏览器纬度用 Claude subagent（codex 无浏览器 MCP）。
- **vitest 资源纪律不变**：worker 封顶、一次性运行、绝不并发双 vitest。

## Out of Scope

- **浏览器本地 WebCodecs 导出、Rust/WASM 合成层**：与 agent-headless / 服务端批渲染 / 专业音频后处理命题正面冲突——架构立场，永不做。
- **graph editor 可视化 UI**：bezier 数据模型本版落地（agent 必需），可视化编辑是纯人侧 ergonomics，零双驱动依赖，顺延。
- **持久 groupId / linked A/V**：联动传播逻辑要穿过所有编辑动词，硬依赖本版共享 ops 纪律（Epic D）落地稳定，先做会双倍返工，顺延到 v0.2.x。
- **整数帧 tick 全链路迁移**：硬依赖单渲染器收敛；本版以 ops 边界 `snapToFrame` 捕获主要收益。
- **细粒度 undo/redo CLI**：`checkpoint create/restore` 是有效替代，无 issue 驱动。
- **mask keyframe 化、SoundTouch 变调、字体 catalog、track lock**：无三 issue 关键路径依赖，若 A–H 提前收敛可拉进（boil the ocean 纪律：这是排布不是放弃）。

## Further Notes

- **OpenCut rewrite 启示**（报告 §3）：竞品刚在纸上规划 MCP/Editor API/headless，AutoViral 双驱动已经能跑——本版每个新能力坚持三件套（共享 op + CLI 动词 + UI），守住先发优势。OpenCut 自己抛弃的坑（全局 singleton、业务逻辑滞留 UI 层、巨型 hooks、时间单位散落、命令隐式改 selection）在实现中主动规避。
- **AutoViral 已领先项不投入追赶**：cut-point 转场 13 preset、文本/字幕动画、freeze/reverse 导出、ducking + LUFS loudnorm、provenance 图、变速数据模型——本版只补"导出侧真实生效"，不重做。
- **依赖顺序**：Epic B 硬依赖 A（transitionIn 复用注册表）；G 软依赖 D（新能力在 ops 纪律确立后落地）；其余可并行。切片文件给出精确波次。
