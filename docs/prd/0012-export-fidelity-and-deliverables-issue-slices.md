# 0012 · 导出保真与成品管理（issue slices）

> Parent: [docs/prd/0012-export-fidelity-and-deliverables.md](0012-export-fidelity-and-deliverables.md)
> 本文件是这批 issue 的事实源（docs-only tracker，绝不开 GitHub Issue）。triage：全部 `ready-for-agent`。
> **测试先行（.claude/rules/test-first.md）**：每片「预设测试」小节必须在实现代码动笔前落盘并**证红**——这是每片 Acceptance criteria 的第一项，不再逐片重复。测外部行为不测实现细节；先 grep 最近的测试先例照抄模式（render-pipeline 的 spawn-mock **必须沿用 drain-until-settled 模式**，勿回退固定轮数）。
> **调查前置**：实现者开工前先读 `docs/issues/026-export-backward-frame-jitter.md`（帧级取证 + file:line 根因链）与 `027-exports-mixed-with-assets.md`，勿重复调查。取证 work：`w_20260708_2330_5c1`。
> **实施顺序**：S1 → S2 是关键路径；S3/S4/S5 可并行；S6 依赖 S4；S7 收尾。改 `src/server`/`src/shared` 的片，E2E 前先 `build:backend` + 重启 daemon。
> **E2E 铁律**：S7 经 Workflow 多纬度 subagent 执行（≥3 纬 + completeness-critic），主 agent 不亲点浏览器。

---

## S1 · jitter-scan 帧级倒跳取证工具入库（验收标尺先行）

**What**：把调查用的帧级倒跳检测收编为仓库 QA 工具。纯核（灰度指纹序列 → 倒跳事件列表：与前 1 帧差异 > 运动阈值且与前 k∈[2,12] 帧差异 < 近同阈值）放进可被 vitest 测的 src 模块；薄 CLI 包装（ffmpeg 抽 32×18 灰度 rawvideo → 调纯核 → 打印事件表）放 `scripts/`，用法写进脚本头注释。026 里有完整参考实现。

**预设测试**（先落盘证红）：
- `src/domain/__tests__/backward-jump-scan.test.ts`：合成帧序列（线性运动无倒跳 → 0 事件；插入"回跳 k 帧"片段 → 事件命中且 k 正确；静止画面不误报；相邻冻结帧统计正确）。

**Acceptance criteria**：
- [ ] 预设测试证红后转绿；既有套件不破。
- [ ] CLI 包装对 `w_20260708_2330_5c1` 现有成片跑出 ≥30 处事件、对源片跑出 0 处（复现调查结论 = 工具自身校准）。

**Blocked by**：None — can start immediately。
**Code-area hints**：`src/domain/`（纯核）、`scripts/`（CLI 包装，经 dist 或独立 mjs）。

---

## S2 · 渲染环境分支：导出用 OffthreadVideo、预览保持 Video（核心修复）

**What**：视频轨渲染组件按 `getRemotionEnvironment().isRendering` 分支——服务端渲染（默认与 streaming 两条入口同覆盖）用 `<OffthreadVideo>`（ffmpeg 抽帧、帧精确），浏览器预览保持 `<Video>`（2026-05-08 解码器预算优化不回退）；`acceptableTimeShiftInSeconds`/`pauseWhenBuffering` 等预览专属 props 只在预览分支下发。修正组件内"Server render path is unaffected"的错误注释。可选加固：render 入口显式设 `offthreadVideoCacheSizeInBytes` 保守值。

**预设测试**：
- `web/src/features/studio/composition/tracks/VideoTrackRenderer.render-branch.test.tsx`：mock `getRemotionEnvironment` —— isRendering=true 渲染 OffthreadVideo 且不带预览专属 props；isRendering=false 渲染 Video 且带 `acceptableTimeShiftInSeconds`；speed/trim/transition 等既有 props 两分支等价传递。
- 既有 VideoTrackRenderer / phase 集成测试全部不破（组件对外契约不变）。

**Acceptance criteria**：
- [ ] 对 `w_20260708_2330_5c1` 重新导出（本地渲染零 API 花费），S1 工具扫描：**倒跳事件 = 0**。
- [ ] 浏览器预览播放不回退（无解码器预算型卡顿——归 S7 预览纬实证）。

**Blocked by**：S1（验收依赖取证工具）。
**Code-area hints**：`web/src/features/studio/composition/tracks/VideoTrackRenderer.tsx`、`src/server/remotion-renderer.ts` / `src/server/render/remotion-bridge.ts`（可选缓存参数）。

---

## S3 · ffmpeg 预处理关键帧归一（拆潜伏雷）

**What**：裁剪/翻转、timewarp、变速三个预处理的 ffmpeg 重编码统一补 `-g <fps> -keyint_min <fps>`（对齐 Seedance 入库归一 `normalizeVideoForBrowser` 先例），防止过 pre-pass 的 clip 被 libx264 默认 ~10s GOP 抹掉 1s 归一、放大 seek 误差。

**预设测试**：
- 预处理各自的 spawn/argv 测试（先例：`transforms-ffmpeg` / `speed-ramp-ffmpeg` 既有参数断言测试）：argv 含 `-g` 与 `-keyint_min` 且值 = 帧率；无预处理字段的 clip 不触发（现状不变）。

**Acceptance criteria**：
- [ ] 三个预处理 argv 断言全绿；既有 render-pipeline 套件不破。

**Blocked by**：None — can start immediately。
**Code-area hints**：`src/server/transforms-ffmpeg.ts`、`src/server/speed-ramp-ffmpeg.ts`；先例 `src/providers/video/seedance.ts:29-56`。

---

## S4 · 素材库「成品」分组 + 中间产物过滤（纯前端）

**What**：素材分组逻辑把 `output/` 下成片（`final-*`）与代理（`proxy-*`）拆为独立「成品」分组（置于 CLIPS 之前或之后，带成片徽章 + mono 导出时间）；渲染中间产物（`autoviral-export-*`、`*-ducked/-burned/-normalized` 等）加入既有 `PIPELINE_INTERNAL` 过滤器不再展示。分组判定为纯函数可隔离测试。i18n 补中英文分组名。

**预设测试**：
- `web/src/queries/assets` 分组纯函数测试（先例：`isPipelineInternal` 既有单测）：`output/final-*.mp4` → 成品组；`output/proxy-*.mp4` → 成品组（带代理标记）；`output/autoviral-export-*.mp4`、`output/x-ducked.mp4` 等 → 被过滤；`assets/**.mp4` → CLIPS 不变。
- `LibraryTab` 组件测试：成品组独立渲染、条目带徽章与时间、空成品组隐藏（沿用空组隐藏先例）。

**Acceptance criteria**：
- [ ] 取证 work 的素材库：成品组只见 final/proxy，中间产物不可见，源片仍在 CLIPS。
- [ ] 一次导出后素材库新增条目 ≤2。

**Blocked by**：None — can start immediately。
**Code-area hints**：`web/src/queries/assets.ts`（主落点）、`web/src/features/studio/panels/AssetSidebar/LibraryTab.tsx`、`web/src/i18n/messages.ts`。

---

## S5 · 渲染中间产物清理（服务端）

**What**：渲染管线成功产出最终文件（final/proxy）后，删除本次派生的中间 mp4（Stage1 输出与各 stage 的 `-ducked/-burned/-normalized`）；任一 stage 失败则保留全部现场以便诊断。清理是 best-effort：删除失败只告警不影响导出成功语义。

**预设测试**：
- `src/server/render-pipeline.test.ts` 扩展（沿用既有 mock 网 + drain-until-settled）：成功路径断言中间文件的 `rm`/`unlink` 被调且 final 不被删；失败路径（某 stage reject）断言零清理调用；rm 抛错不改变管线返回值。

**Acceptance criteria**：
- [ ] 实际导出一次后 `output/` 只新增 final（+proxy），无中间 mp4 残留。

**Blocked by**：None — can start immediately（与 S4 并行，两者共同达成"≤2 条目"）。
**Code-area hints**：`src/server/render-pipeline.ts`。

---

## S6 · 导出历史（list-jobs 端点 + UI 找回入口）

**What**：渲染队列补"按 work 列历史 job"端点（store 已有 `output_path` 等全部数据，现仅有按 id 查单个）；UI 在导出入口旁提供历史列表（时间、preset、状态、文件），每条复用 ExportProgress 已有的下载 / 在 Finder 显示 / 预览三入口。关掉进度弹窗后成片永远找得回。

**预设测试**：
- server 路由测试（先例：render 路由既有测试 + `:memory:` SQLite 注入的 render-queue 模式）：list 端点按 work 过滤、按时间倒序、含 output_path/preset/status；不存在的 work → 空列表非 500。
- UI 组件测试：历史列表渲染 N 条、三入口 href/handler 正确、空历史空态文案。

**Acceptance criteria**：
- [ ] 导出→关弹窗→从历史列表重新下载同一成片的路径可走通（归 S7 成品查找纬实证）。

**Blocked by**：S4（成品组与历史入口的信息架构先定型，避免两处入口打架）。
**Code-area hints**：`src/server/routes/render.ts`、`src/server/render-queue/store.ts`、`web/src/features/studio/render-status/`、`web/src/features/studio/panels/TopBar.tsx`。

---

## S7 · E2E 多纬验收 Workflow

**What**：对 0012 全量做用户视角验收。Workflow fan-out ≥4 纬 Opus subagent + completeness-critic，每纬截图 + DOM/数据二确：① **导出纬**——真实导出取证 work，ffprobe + S1 工具判定倒跳=0（backend artifact 不算数，但本纬的 source of truth 恰是文件级取证 + UI 完成态截图）；② **预览纬**——预览播放流畅性不回退（rAF 心跳门控下观察播放，无周期性倒带）；③ **成品查找纬**——导出→关弹窗→素材库成品组找到成片→历史列表下载，全程截图；④ **中间产物纬**——导出后素材库新增条目 ≤2、output/ 无中间残留。

**预设测试**：本片即验收执行，纬度清单如上预写；各 subagent 遵守 e2e-testing.md 全部 Hard rules（tabs_context→tabs_create、rAF 门控、DOM 二确、blocked≠fail）。

**Acceptance criteria**：
- [ ] 四纬全 pass + critic 无 CRITICAL 漏测；fail 项回流为新 issue。

**Blocked by**：S2, S4, S5, S6。
**Code-area hints**：无（编排片）。
