# PRD-0011 · 画布帧率可改（fps 一等公民化）

**Status: Proposed (2026-07-09) · triage: `ready-for-agent` · 目标版本：下一阶段（v0.1.10 候选）**

> Source: 2026-07-08 工位 agent 实证——用户的 Seedance 素材全部是 24fps，而画布建在 30fps，播放时原生 `<video>` 与 Remotion 帧钟异速前进、累积错位后触发 ~3s 硬回拉（周期性"倒带"）。工位 agent 用 `comp put`（整份写回的 escape hatch）把 fps 30→24 后重渲染实证：成片 `r_frame_rate=24/1`，14 clip / 13 转场 / 37 字幕 / BGM / 106.31s 全量无损，漂移之根消除，且省掉了 30fps 渲染对 24fps 源片的复制帧。
> 代码现状核查（2026-07-09 全链路调查）：**"fps locked at create-time" 只存在于 skill 手册文案里，代码从未强制**——写入 schema 只限 `{24,25,30,60}` 四档字面量，任何路由都不比对既有值；甚至 UI 的平台 preset 应用路径本来就在整份覆写 fps（8 个内置 preset 恰好全是 30 才无人察觉）。所有 clip/keyframe/字幕时间字段均为秒（float），改 fps 零数据破坏。
> Issue 切片：随 `to-issues` 落 `docs/prd/0011-canvas-fps-editable-issue-slices.md`（docs-only tracker，绝不开 GitHub Issue）。

---

## Problem Statement

用户（创作者，素材主要来自恒定 24fps 的 Seedance 生成管线）面对三个叠加的损耗：

1. **播放漂移**。画布默认 30fps、源片 24fps，Studio 预览时原生 `<video>` 与画布帧钟异速前进，错位累积到阈值后 Remotion 硬 seek 回拉——用户看到周期性"倒带"，无法信任预览。
2. **画质浪费**。30fps 渲染 24fps 源片要复制帧（每 5 帧插 1 帧重复），成片帧率虚高、体积变大、运动不如 1:1 干净。
3. **改不了，只能绕**。fps 没有任何正式修改入口：UI 里没有控件，CLI 没有 per-intent 命令，手册还宣称它"create-time 锁定"。工位 agent 只能用 `comp put` 整份写回绕过——这条路没有护栏（无确认、无广播语义保证），且违背产品的 agent-人平权命题：agent 能做到的事，用户在 UI 里做不到。
4. **改了也守不住（隐藏陷阱）**。导出时若带平台 preset，preset 携带的 fps（8 个内置 preset 全是 30）会静默压过画布 fps；Studio 里应用平台 preset 也会整份覆写 fps。也就是说即使把画布改成 24，只要套一次「抖音」preset，帧率就静默回到 30、复制帧卷土重来——漂移根治等于白做。

## Solution

把画布 fps 从"文档谎称锁定、实则裸奔"升级为**一等可编辑画布参数**，与 aspect（画幅）同级同构：

1. **正式修改入口，agent-人同路**：共享 ops 核新增 `setFps` 意图（ADR-009），bridge 新增 per-intent 路由（镜像既有的 `/comp/aspect` 先例，ADR-012），CLI 新增 `autoviral comp fps <24|25|30|60>`，Studio 设置抽屉（TweaksPanel）新增「画布帧率」四档控件。四条入口收敛到同一个 op、同一份 composition.yaml、同一个 `composition-changed` 广播。
2. **preset 与 fps 解耦**：平台 preset 应用不再触碰 fps；导出路径不再用 preset.fps 压过画布 fps。fps 只归画布控件 / CLI 管——改一次，处处生效，谁也压不回去。
3. **源头消 mismatch**：新建 video 类作品默认 24fps（主力生成管线 Seedance 恒定 24，provider 层已 ffprobe 实证）；显式指定 fps 的种子路径（如 YouTube ingest）保持自己的值不受影响。
4. **手册纠偏**：删除 skill 手册中"fps locked at create-time"的不实文案，文档化新命令与语义（fps=播放/渲染帧钟，时间数据全为秒、改 fps 无损）。

用户视角的最终状态：新建作品默认就和 Seedance 源片同帧率，不再漂移；老作品在设置抽屉里点一下（或 agent 一条命令）即可切 24，预览立即用新帧钟播放，导出成片帧率与画布一致，套平台 preset 也不会被偷偷改回去。

## User Stories

1. As a 创作者, I want 在 Studio 设置抽屉里直接切换画布帧率（24/25/30/60）, so that 我的画布帧钟能匹配素材源帧率，预览不再周期性倒带。
2. As a 创作者, I want 帧率切换即时生效（预览 Player 自动用新帧钟重新初始化，无需刷新页面）, so that 我能立刻验证漂移是否消失。
3. As a 工位 agent, I want 一条 per-intent CLI 命令 `autoviral comp fps 24`, so that 我不必用 `comp put` 整份写回这种无护栏的方式去改一个字段。
4. As a 工位 agent, I want CLI 与 UI 改 fps 走同一个共享 op 和校验, so that 两条路径的产出严格一致（agent-人平权不变量）。
5. As a 创作者, I want 新建的 video 作品默认就是 24fps, so that 用 Seedance 生成素材时从一开始就没有帧率 mismatch。
6. As a 创作者, I want 应用平台 preset（画幅/尺寸）时我的画布帧率保持不变, so that 我为消除漂移做的设置不会被 preset 静默改写。
7. As a 创作者, I want 带平台 preset 导出时成片帧率仍等于画布帧率, so that 导出物不会偷偷回到 30fps 产生复制帧。
8. As a 创作者, I want 传入非法帧率（如 23、120）时得到明确的四档取值错误提示, so that 我不会把 composition 写坏。
9. As a 工位 agent, I want 改 fps 后收到与其他 comp 修改一致的 `composition-changed` 广播, so that Studio 各面板（预览/时间轴/字幕）同步重算，无需用户手动刷新。
10. As a 创作者, I want 时间轴、字幕、关键帧在帧率切换后位置完全不变（时间语义以秒为准）, so that 我已经对好的字幕和动画不会因为改帧率而错位。
11. As a 创作者, I want 改 fps 不会把任何已生成素材标记为过期/需重生, so that 我不会因为一个播放参数的调整而误以为要花钱重新生成。
12. As a 阅读手册的 agent, I want 手册如实描述"fps 可改、时间数据全为秒", so that 我不会被"create-time 锁定"的过时文案误导而绕远路。
13. As a 开发者, I want fps 修改与画幅修改共享同一套 per-intent 路由/op/错误码惯例, so that 后续再加画布级参数（如色彩空间）时有清晰的模板可循。
14. As a 创作者, I want 设置抽屉里的帧率控件展示当前值并标注推荐档（24 · Seedance 源）, so that 我不用理解帧率理论也能做出正确选择。
15. As a 工位 agent, I want `comp put` 整份写回仍然保留（escape hatch 不移除）, so that 既有脚本与批量迁移路径不被破坏。

## Implementation Decisions

- **共享 ops 核新增 `setFps` 意图**（ADR-009 惯例）：纯函数，校验目标值 ∈ {24,25,30,60}（复用 composition schema 的字面量联合），写 `comp.fps`，非法值抛带错误码的 CompositionOpError。这是本 PRD 的深模块——前端 store 与 bridge 路由都只调它，不各写一份。
- **bridge 新增 per-intent 路由**（ADR-012 惯例）：请求体 `{fps}`，走既有的 mutateCompositionFor 链（zod 校验 → 原子写 → `composition-changed` 广播），错误映射对齐 `/comp/aspect` 先例。
- **CLI 新增 verb**：`autoviral comp fps <value>`，落点即上述路由；帮助文案标注四档合法值与 Seedance=24 的推荐语。
- **TweaksPanel 新增「画布帧率」分节**：四档 segmented control，应用即调 store action（内部走同一 `setFps` op 经 bridge 提交）。**不做 Reframe 式确认弹窗**——fps 修改数据无损、随时可改回，确认摩擦不成比例；控件旁一行说明文案即可。
- **平台 preset 与 fps 解耦**：preset 应用的原子翻转从 {aspect, width, height, fps, exportPresets[0]} 中移除 fps；导出路由不再把 preset.fps 折叠进 comp。export preset schema 中的 fps 字段保留但降级为"记录值"，渲染以 comp.fps 为准（避免 schema 破坏性变更）。
- **video 类作品默认 24fps**：内容类型种子路径对 video 类传入 fps 24；`makeEmptyComposition` 工厂本身的默认参数保持向后兼容语义（显式传值者不受影响，YouTube ingest 继续显式 30）。
- **改 fps 不触发 stale**：fps 是播放/渲染帧钟参数，不改变任何已生成素材的内容语义；分镜/素材的 status 不因此变化。
- **手册两处纠偏**：composition-schema 章与 conventions 章删除"locked at create-time"，改为"经 `comp fps` 修改；时间字段全为秒，改 fps 无损"。
- **代理渲染的 24 上限逻辑保持不变**（proxy 渲染已有 fps≥24 时 clamp 到 24 的既有行为，与本 PRD 正交）。

## Testing Decisions

- **好测试的定义**：只测外部行为——"op 拒绝 23 接受 24"、"路由返回 400+错误码 4"、"preset 应用后 fps 不变"、"导出参数里帧率等于画布值"；不测内部实现（不断言函数内部怎么写字段）。
- **`setFps` op 单测**：四档合法值各一例 + 非法值（0、23、120、负数、非数字）错误码断言 + 幂等（同值重设不报错）。先例：共享 ops 核里 `setAspectRatio` / `setCompositionDuration` 的既有单测。
- **bridge 路由测试**：合法/非法请求体、广播触发、错误码映射。先例：`/comp/aspect`、`/comp/duration` 的路由测试。
- **CLI 命令测试**：参数解析与落点。先例：`comp aspect` 命令测试。
- **preset 解耦回归**：应用平台 preset 前后 comp.fps 不变（这是"陷阱修复"的钉子测试）；带 preset 导出时下发的渲染参数帧率 = comp.fps。先例：store 的 applyPlatformPreset 测试、export 路由测试。
- **默认 24 种子测试**：video 类作品首次种子后 comp.fps === 24；显式传 fps 的路径不受影响。先例：content-type registry 的 seedFactory 测试。
- **TweaksPanel 组件测试**：控件展示当前值、点击档位后 store action 被调、非 video 类作品不渲染该分节（若适用）。先例：PlatformPresetSection 组件测试。
- **E2E 验收纬度预写**（实施后按 e2e-testing.md 派 Workflow，主 agent 不亲跑）：① agent-CLI 纬——`autoviral comp fps 24` 后 UI 无刷新反映新值；② 人-UI 纬——抽屉切档后预览 Player 帧钟变化（DOM 二确 Player fps 相关属性）+ 字幕对位不变；③ 导出纬——套平台 preset 导出，ffprobe 成片 `r_frame_rate` = 画布值；④ 默认值纬——新建 video 作品 fps=24。

## Out of Scope

- **可变帧率 / 四档之外的取值**（23.976、50、120 等）：schema 字面量联合不扩，有真实需求再议。
- **按源片自动推断 fps**（ingest 时 ffprobe 源片帧率反写画布）：有价值但独立成题，本 PRD 只做手动修改 + 默认值。
- **Player 播放路径自身的残余漂移治理**（逐帧回拉 currentTime 等播放器内在问题）：工位 agent 已指出若 fps 对齐后仍有漂移则属此类，单独 diagnose，不混入本 PRD。
- **移除 `comp put` escape hatch 或给它加 fps 特殊拦截**：escape hatch 语义保持（ADR-009 明确保留）。
- **carousel（图文）类作品**：无帧率概念，不涉及。

## Further Notes

- 工位 agent 的 30fps 备份在 `/tmp/comp_backup.json`，属临时文件，PRD 实施与否都不依赖它。
- 本 PRD 是"agent 实践倒逼产品能力"的范例：escape hatch 先证明了需求与安全性（数据全秒、无损），产品再把它铺成正路。实施时按 test-first 规则先落预设测试证红。
- 与 [ADR-009](../adr/ADR-009-shared-composition-ops-core.md)（共享 ops 核）、[ADR-012](../adr/ADR-012-scenes-as-plan-layer.md)（agent-人平权的 per-intent 路由）一致；无需新 ADR——本 PRD 没有引入新架构决策，只是把既有惯例应用到一个新字段。
