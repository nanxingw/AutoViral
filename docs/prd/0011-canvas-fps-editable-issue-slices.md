# 0011 · 画布帧率可改（issue slices）

> Parent: [docs/prd/0011-canvas-fps-editable.md](0011-canvas-fps-editable.md)
> 本文件是这批 issue 的事实源（docs-only tracker，绝不开 GitHub Issue）。triage：全部 `ready-for-agent`。
> **测试先行（.claude/rules/test-first.md）**：每片「预设测试」小节必须在实现代码动笔前落盘并**证红**——这是每片 Acceptance criteria 的第一项，不再逐片重复。测外部行为不测实现细节；先 grep 最近的测试先例照抄模式。
> **实施顺序**：F1 → F2 → F3 是主链；F4/F5 可并行随时开工；F6 依赖 F2 定名；F7 收尾。改 `src/server`/`src/shared` 的片，E2E 前先 `build:backend` + 重启 daemon。
> **E2E 铁律**：F7 经 Workflow 多纬度 subagent 执行，主 agent 不亲点浏览器。

---

## F1 · 共享 `setFps` op 纯核

**What**：composition ops 核（ADR-009）新增 `setFps` 意图：校验目标值 ∈ {24,25,30,60}（复用 schema 字面量联合），写 `comp.fps`；非法值抛带错误码的 CompositionOpError；同值重设为无害幂等。前端 store 与 bridge 路由后续都只调它。

**预设测试**（先落盘证红）：
- `src/shared/composition/ops/setFps.test.ts`（先例：`setAspectRatio` / `setDuration` 的既有单测）：四档合法值各一例；非法值（0、23、23.976、120、负数、NaN）→ CompositionOpError 且 comp 未变；同值幂等；不触碰 scenes/assets/tracks 等无关字段。

**Acceptance criteria**：
- [ ] 预设测试证红后转绿；既有 shared/ops 套件不破。

**Blocked by**：None — can start immediately。
**Code-area hints**：`src/shared/composition/ops/`。

---

## F2 · bridge `POST /comp/fps` + CLI `autoviral comp fps`

**What**：bridge 新增 per-intent 路由（镜像 `/comp/aspect` 先例，ADR-012）：请求体 `{fps}`，走 mutateCompositionFor 链（zod 校验 → 原子写 → `composition-changed` 广播），错误映射 400+code:4。CLI 新增 `autoviral comp fps <24|25|30|60>` verb，帮助文案标注四档与"Seedance 源推荐 24"。

**预设测试**：
- bridge 路由测试（先例：`/comp/aspect`、`/comp/duration` 既有测试）：合法值写盘 + 广播；非法值 400 + code:4 + 盘未动；无 work 上下文的错误路径。
- `cli/autoviral` 命令测试（先例：`comp aspect` 命令测试）：参数解析、落点 URL、非法值前端拒绝并给四档提示。

**Acceptance criteria**：
- [ ] `autoviral comp fps 24` 实测改盘并触发 Studio 刷新（无刷新反映归 F7 CLI 纬实证）。

**Blocked by**：F1。
**Code-area hints**：`src/server/bridge/routes.ts`、`cli/autoviral/src/commands/comp.ts`。

---

## F3 · TweaksPanel「画布帧率」控件

**What**：Studio 设置抽屉新增「画布帧率」分节：四档 segmented control 展示当前值，24 档标注推荐说明（Seedance 源）；点击经 store action 走 F2 路由提交（与 CLI 同路收敛）。数据无损、随时可改回，不做 Reframe 式确认弹窗，控件旁一行说明文案（"影响播放帧钟与导出帧率"）。i18n 中英文。

**预设测试**：
- `web/src/features/studio/panels/Tweaks/` 组件测试（先例：PlatformPresetSection 测试）：渲染当前 fps 高亮档；点击 24 → 发出 bridge 提交（mock fetch 断言 body `{fps:24}`）；提交失败展示错误行；非 video 类作品不渲染该分节（若 TweaksPanel 对 carousel 也挂载）。

**Acceptance criteria**：
- [ ] 抽屉切档后预览 Player 用新帧钟重新初始化、字幕对位不变（归 F7 UI 纬实证）。

**Blocked by**：F2。
**Code-area hints**：`web/src/features/studio/panels/Tweaks/`、`web/src/features/studio/store.ts`、`web/src/i18n/messages.ts`。

---

## F4 · 平台 preset 与 fps 解耦（修陷阱）

**What**：平台 preset 应用的原子翻转从 {aspect,width,height,fps,exportPresets[0]} 中移除 fps；导出路由不再把 preset.fps 折叠进 comp（渲染帧率以 comp.fps 为准）。export preset schema 的 fps 字段保留为记录值（避免 schema 破坏性变更）。fps 从此只归画布控件 / CLI 管。

**预设测试**：
- `web/src/features/studio/store` applyPlatformPreset 测试扩展（先例：既有 preset 测试）：应用任意 preset 前后 `comp.fps` 不变（画布 24 时套「抖音」仍 24）——这是陷阱修复的钉子测试。
- server export 路由测试：带 `--preset` 导出时下发渲染的 fps === comp.fps 而非 preset.fps。

**Acceptance criteria**：
- [ ] 画布 24fps + 套平台 preset 导出，成片 `r_frame_rate=24/1`（归 F7 导出纬 ffprobe 实证）。

**Blocked by**：None — can start immediately。
**Code-area hints**：`web/src/features/studio/store.ts`、`src/server/routes.ts`（export 折叠处）。

---

## F5 · video 作品默认 24fps 种子

**What**：video 内容类型的种子路径默认 fps 24（Seedance 恒定 24，provider 层已 ffprobe 实证）；`makeEmptyComposition` 工厂显式传值语义不变，YouTube ingest 继续显式 30。梳理所有种子调用点确保只有 video 默认值变化。

**预设测试**：
- content-type registry / seed 路径测试（先例：registry seedFactory 既有测试）：video 类首次种子后 `comp.fps === 24`；显式传 fps 的调用（ingest-youtube 30）不受影响；carousel 类不涉及。
- 排查既有测试对默认 30 的隐性依赖（grep `fps: 30` / `fps).toBe(30)`），逐个改为显式传值或更新断言——**不许为凑绿把新默认改回去**。

**Acceptance criteria**：
- [ ] 新建 video 作品（UI 与 CLI 两路）fps=24（归 F7 默认值纬实证）。

**Blocked by**：None — can start immediately。
**Code-area hints**：`src/shared/content-types/registry.ts`、`src/server/bridge/composition-ops.ts`、`src/server/routes/generate.ts`、`src/shared/composition.ts`（工厂默认参数）。

---

## F6 · skill 手册纠偏

**What**：删除手册中"fps is locked at create-time"的不实文案（composition-schema 章 + conventions 章两处），改为文档化 `autoviral comp fps` verb、四档取值、"时间字段全为秒，改 fps 无损"的语义，与 `comp aspect` 的文档形态对齐。纯文档变更（test-first 例外，commit message 注明）。

**预设测试**：无（不可测变更例外）；若 repo 有 docs-CLI 一致性测试（`autoviral docs` 输出源）则跑既有套件确认不破。

**Acceptance criteria**：
- [ ] 手册两处"locked"文案清除；`autoviral docs _shared/03-cli-reference` 能查到新 verb。

**Blocked by**：F2（verb 定名后再写文档）。
**Code-area hints**：`skills/autoviral/manual/video/02-composition-schema.md`、`skills/autoviral/manual/_shared/05-conventions.md`、`skills/autoviral/manual/_shared/03-cli-reference.md`。

---

## F7 · E2E 多纬验收 Workflow

**What**：对 0011 全量做用户视角验收。Workflow fan-out ≥4 纬 Opus subagent + completeness-critic：① **CLI 纬**——`autoviral comp fps 24` 后 Studio 无刷新反映（抽屉高亮档 + Player 帧钟，DOM 二确）；② **UI 纬**——抽屉切档即时生效、字幕/时间轴对位不变（computed 层二确）；③ **导出纬**——画布 24 + 套平台 preset 导出，ffprobe `r_frame_rate=24/1`；④ **默认值纬**——新建 video 作品 fps=24（UI 与 CLI 双路）。

**预设测试**：本片即验收执行，纬度清单如上预写；遵守 e2e-testing.md 全部 Hard rules。

**Acceptance criteria**：
- [ ] 四纬全 pass + critic 无 CRITICAL 漏测；fail 项回流为新 issue。

**Blocked by**：F3, F4, F5。
**Code-area hints**：无（编排片）。
