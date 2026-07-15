# PRD-0014 S18 · 多纬度 E2E 终验汇总报告（completeness-critic）

> 编排：Workflow 六纬度 subagent（全 Opus 驱动）+ 本 completeness-critic 汇总。
> 日期：2026-07-14 · 对标 [parent PRD](../0014-wysiwyg-editing-parity.md) User Stories 1–39 + [slices S18](../0014-wysiwyg-editing-parity-issue-slices.md#L361)。
> 通过标准（e2e-testing.md 铁律）：用户视角（浏览器可见 + DOM/computed-style 二确）是唯一 source of truth；backend artifact 不算数。

---

## 总体裁定

**六纬 5 pass / 1 fail。不满足 S18 Acceptance criteria 第 1 项（"≥6 纬全 pass 或 fail 项全部修复后复验 pass"）。**

- **灵魂验收（预览即导出 WYSIWYG）的"预览"侧成立**（D3 用 `osascript activate` 破遮挡后，转场/变速/mask 三处在浏览器可见并 computed-style 二确），**但"导出"侧断裂**：含变速 clip 的导出在渲染前即挂（**已在源码级确认的真 bug**），这是 PRD 用户原话核心验收"预览认可的节奏就是成片的节奏"（User Story 3）的导出一方，判 **fail**。
- **产品命题核心（agent-CLI ↔ 人-UI 双驱动收敛同一份 composition）由 D2 真正双向验证成立**——这是最该被独立纬度盯住的命题，D2 做到了（详见 Q3）。
- **但覆盖面有系统性缺口**：Epic G 的 effects 栈 / adjustment 轨（S14）、letterbox preset（S13）、四个 cinematic 转场 REST 端点（S1/#93 根因）、S15 已知 residual（UI 拖拽帧对齐）**没有任何纬度碰过**。critic 判定存在 CRITICAL 漏测，需补跑一轮才算 S18 收口。

---

## 每纬 verdict

| 纬 | 命题 | verdict | 关键证据 | 失败/跳过 |
|---|---|---|---|---|
| **D1** | 重演 #94 快切化剪辑全程走 Studio 表达 + S17 文档吃狗粮 | **pass**（1 项 harness 受限） | work `w_20260714_1749_1c5`；import/--replace-timeline、transition-in glitch/whip、speed keyframe、reframe --punch-in、ellipse mask+feather、blend screen、detach-audio 全 exit0 且 Inspector/时间线 DOM 二确；`autoviral select` 驱动 UI 选中；截图 ss_167982csw/ss_8107d8tvm/ss_30531pn5t/ss_0632d1tk3 | 预览非黑帧 [fail]：tab 恒 hidden→media 加载被延迟，属 harness 遮挡（四路交叉证明非产品缺陷，且 D3 已破解，见 Q1） |
| **D2** | 驱动方一致性：人 UI ↔ agent CLI 双向变更同步 | **pass** | work `w_20260714_1807_ab5`；UI→CLI 三处（mask rect+feather0.5 / Shift+Backspace ripple delete / transitionIn zoom-in）→ `comp show` 逐条断言全绿；CLI→浏览器五处（track set --label / transition add / transition set --preset wipe-left / seek / select）全程**未刷新**靠 WS 广播在 DOM 实时反映 + 截图二确 | 预览黑屏 [skipped]（同 harness 遮挡，非本纬命题） |
| **D3** | 三方一致（预览/快照/导出）transitionIn+变速+mask | **fail** | work `w_20260714_1825_95a`；预览↔快照 WYSIWYG 全绿并 computed-style 二确（转场=0.5 透明度包裹层 / 变速=playbackRate2+源 currentTime2.0+像素匹配 / mask=内联 SVG-data-URI CSS mask）；截图 ss_17520ysn7/ss_9824ep61a/ss_5383u53o0；暗/亮主题 ss_2440mjps8/ss_2063792w6 computed-style 二确 | **导出 leg 不可交付**：①变速导出渲染前即挂（相对路径 bug，**critic 已源码级确认**）；②no-speed 导出 encode 阶段 videotoolbox -12900（**与 D5/D6 成功导出矛盾，PLAUSIBLE**）；③手册 schema 漂移 4 处 Required |
| **D4** | 失败/边界：结构化拒绝·无静默降级·UI 无脏状态 | **pass**（1 项 skip） | work `w_20260714_1854_916`；5/6 边界显式拒绝（重叠 preflight warning + lint error 带双 clip id+区间 / 超长 transitionIn 400 / 坏文件 PROBE_FAILED / 未知 preset / bezier 越界），CLI exit=4 + errorCode，UI DOM 二确无脏状态（transitionEls=0/keyframeEls=0）；重叠 180px DOM geometry 二确 | T5 生成取消→orphaned→409 [skipped]（付费弃单风险 + 立即中断落 clean-cancel 非 orphaned；契约仅代码级+单测覆盖） |
| **D5** | render 队列全生命周期 CLI 驱动 + UI 同步 | **pass** | work `w_20260714_1902_a86`；enqueue/status(真实 progress 演进)/history/cancel/re-enqueue(fresh id 证 S11 竞态修复)/snapshot(frame30 YAVG=124.8 非黑) 全通；UI 成品区 DOM productTitles 与 6 个成功 job outputPath 精确匹配；导出模态 DOM 抓到中途 64% + 5 段 stage 流水线；截图 ss_2974scufa/ss_1039gh2p2 | 无 |
| **D6** | TTS 中文旁白→captions --script 对齐→预览字幕→导出烧录 | **pass**（含 1 HIGH doc bug） | work `w_20260714_1913_fa3`；字幕 DOM textContent 级=台词真值（预览 grp_000/grp_002 + 导出抽帧双证）；cjk=[14,1,14,1] 皆≤14；TTS 走真实 gemini；overlay preview=export 成立；截图 ss_9905v8taw/ss_7425ikljc + export_frame_1p5s/5p0s.png | canonical recipe `captions generate --script` 不带 `--language` 时 **500 崩**（asr-captions.ts:97 JSON.parse 被 whisper "Detected language" 行污染）——S9/S17 文档吃狗粮真 finding |

---

## critic 五问回答

### Q1 · 哪个纬度没跑全（blocked/skipped 步骤）

- **D1「预览非黑帧」[fail]、D2「预览黑屏」[skipped]**：均为 harness 遮挡（tab 恒 `visibilityState=hidden` → Chrome 延迟所有 media-element 网络加载 → 预览画布恒黑）。**关键澄清**：这不是"预览 WYSIWYG 未被验证"——**D3 用 `osascript activate` 激活自己的 tab 突破了该限制**，在浏览器里拿到非黑预览（暗红转场帧 / 红粉变速帧 / 绿椭圆黑外 mask 帧），并逐帧 computed-style 二确。故预览侧 WYSIWYG **有浏览器可见证据**；D1/D2 只是没应用 activate workaround。→ 沉淀教训：**E2E subagent 截图前必须先 `osascript activate` 自己的 tab**（对齐 MEMORY「遮挡 tab rAF/media 节流」），否则预览假黑会污染 finding。
- **D3 四个 [fail]**：手册 schema 漂移、变速导出挂、相对路径根因、no-speed encode 挂——不是"没跑全"而是**跑到并抓到了真 bug**（见下上报清单）。
- **D4「T5 orphaned→409」[skipped]**：合理跳过（真实付费 provider 弃单会烧用户额度，无用户同意不做）。但**生成韧性整族（US32 断连取消 / US33 manifest 幂等）因此零 E2E 覆盖**——列入漏测。

### Q2 · 哪个 "pass" 靠 backend artifact 撑（无效 pass）

**无一纬构成"backend-only 无效 pass"** ——五个 pass 纬全部带浏览器截图 + DOM/computed-style 二确：
- D2 双向：UI→CLI 侧用 `comp show`（backend 读）作断言对象是**合理的**——因为它验证的是"UI 动作是否落进 composition"，对侧证据本就在 backend；CLI→UI 侧全用 DOM 读 + 截图。双向各自的"对侧"都取到了，成立。
- D4：结构化错误码来自 API/CLI（backend），但"UI 无脏状态"用 DOM 二确（元素计数 + composition.yaml grep），非 backend-only。
- D5：导出 progress 用 DOM textContent 抓，成品区用 DOM productTitles，非 backend-only。
- **唯一需警示**：D1 声称的"快切成片呈现"其时间线/Inspector 有 DOM 二确（有效），但 D1 自己的"预览"环是 render snapshot（backend PNG YAVG=122）佐证——**该环的浏览器证据由 D3 补上**，单看 D1 则预览侧确实缺浏览器证据。

### Q3 · 驱动方一致性（D2 UI↔CLI 双向）是否真验证了

**真验证了，且是本轮最强证据。** D2 做到了教科书级双向：
- **UI→CLI**：浏览器真实 `select onChange`/`input change`/`Shift+Backspace` 派发三处变更 → `autoviral comp show` 逐条断言（mask==rect/feather0.5、clip2 removed、clip3 trackOffset 帧对齐前移、transitionIn={zoom-in,0.5}）全绿。
- **CLI→浏览器**：**全程不刷新页面**，靠 WS `composition-changed` 广播，五种 CLI 写/广播（track set --label / transition add / transition set --preset / seek / select）在 DOM 实时反映，每处 `getComputedStyle`/`textContent`/`select.value` 二确 + 截图。
- 这正是 PRD 命题核心"agent 经 CLI 驱动 = 人在 UI 点，两条路产出一致"。**验证有效，判定可信。**
- **但覆盖的动词面窄**：D2 只覆盖 mask/ripple-delete/transitionIn/track-label/transition-add/transition-set 六个。**未做双向的双驱动动词**：keyframe remove/move、clip duplicate、collapse gaps、effects 栈族、blendMode、adjustment、多选 select、track set 的 language/volume/muted、合法 bezier easing——这些"新编辑动词必须双驱动"是 Epic D 灵魂纪律，却没被独立纬度盯住其 UI↔CLI 收敛。

### Q4 · S15 residual（store 拖拽直写时间字段绕过 snapToFrame）是否被观察

**没有任何纬度观察到——明确漏测，且 slices S18 明文要求"S18 E2E 需注意此路径"（[slices L221](../0014-wysiwyg-editing-parity-issue-slices.md#L221)）。**
- 全六纬的时间字段变更**都走 CLI 或走共享 op**（D2 的 ripple delete 是 `Shift+Backspace`→共享 op，帧对齐正确；D1 的 offset 全 CLI 写入）——**没有一个纬度在 UI 里用鼠标拖拽 clip 移动 / 拖左缘 trim，再回读 offset 检查是否产生亚帧漂移**。
- 这是 **User Story 11**（"拖动 trim/移动 clip 落点吸附到帧"）的直接验收路径，且 S15 review F1 已诚实登记该路径"仍直写时间字段绕过 snapToFrame"**尚未修复**。E2E 本应确认此 residual 的用户可见影响（拖一次是否真写出 off-grid offset → 导出抖动）。**必须补一纬。**

### Q5 · 还有什么用户可见能力没被任何纬度碰过（逐条扫 User Stories）

对照 39 条 User Stories，**已覆盖**：US2/4/9/10/12/13/14/16/17/18/21/25/26/27/28/35（+US3 仅预览侧、US23 仅 label）。**零覆盖或严重欠缺**：

| US | 能力 | 覆盖状态 |
|---|---|---|
| **US1 / US15** | 四个 cinematic 转场端点（glitch/light-leak/domain-warp/grav-lens）**不再 500** | **零覆盖**——issue #93 根因、Epic A P0。D1 设的 glitch transitionIn 走的是 S2/S3 Remotion 注册表路径，**不是 S1 修复的 REST 端点**。没有任何纬度 POST 这四个端点验证 500 已修 |
| **US3** | 变速曲线导出真实生效 | **导出侧 fail**（D3 相对路径 bug），预览侧 pass |
| **US5** | 一键 2.35:1 letterbox preset（`clip mask --preset letterbox-2.35`） | **零覆盖** |
| **US6** | screen/multiply blendMode 视觉混合 | **仅存在性**（D1/D3 写了 blend screen + Inspector select.value=screen），**混合渲染在预览/导出的视觉效果未验** |
| **US7 / US31** | 有序 effects 栈（grade+blur+vignette+grain）增删/开关/排序 | **零覆盖**（整个 S14 effects 族） |
| **US8** | adjustment 轨（时间窗内作用下层轨） | **零覆盖** |
| **US11** | UI 拖拽 trim/move 帧吸附 | **零覆盖**（= Q4 的 S15 residual） |
| **US19** | CLI `clip remove --ripple` / `track collapse` | **部分**：D2 走 UI ripple；**CLI ripple 动词 + collapse gaps 未直接跑** |
| **US20** | keyframe remove/move | **零覆盖**（D1 只做 add，D4 只验 add 拒绝非法） |
| **US22** | 多选 `select clips <id...>` | **零覆盖**（D1/D2 只用单 `select clip`） |
| **US23** | track set --language/--volume/--muted | **部分**（仅 --label 验过） |
| **US24** | clip duplicate | **零覆盖** |
| **US29** | export --caption-tracks flag | **部分**（D6 用 plain export 自动烧 overlay，flag 透传路径未显式验） |
| **US30** | 合法 cubic-bezier easing 写入+渲染 | **部分**（D4 只验拒绝越界 x1=1.5；合法 bezier 双驱动/渲染未验） |
| **US32 / US33** | 生成断连取消 / manifest 幂等 | **零 E2E**（D4 T5 skipped，仅单测覆盖） |
| **US39** | 旧 filters→effects 向后兼容投影 | **零覆盖**（effects 族整体没碰） |

---

## 需上报的 bug / finding（按严重度）

1. **[CRITICAL · 已确认]** 变速导出不可交付。`src/server/speed-ramp-ffmpeg.ts:690/710` `processVideoSpeed` 把 workspace-相对 `c.src` 直接喂 `probeAudio`/`runVariableSpeedPass`/`runSpeedRampPass`，只有 cachePath 用了 `workDir`；而 Stage 0 speed 预处理在 `render-pipeline.ts:442` 运行，**早于** `rewriteClipSrcsToAbsolute`（`:549`）→ daemon cwd≠workDir 时 ffprobe "No such file or directory"。**critic 已源码级复核确认**（非仅 D3 断言）。同型隐患：`transforms-ffmpeg.ts` crop/flip/timewarp 预处理（D3 记 :501/521/611）。→ 修：预处理入口先 join workDir 再 probe/pass。
2. **[CRITICAL · 零覆盖]** 四个 cinematic 转场 REST 端点（S1/#93/US15）是否仍 500 **无任何 E2E 验证**——Epic A P0、issue #93 直接根因，必须补 POST 四端点纯色 clip 冒烟。
3. **[HIGH · PLAUSIBLE]** no-speed 导出 encode 阶段 `h264_videotoolbox Error setting bitrate property:-12900`（D3，1280x720 / bitrate 8000000）。**与 D5（多个 final-*.mp4 成功）/ D6（final-1784081958577.mp4 1080x1920 成功）矛盾** → 非普遍导出阻断，疑为特定 resolution/bitrate-preset 或本机 videotoolbox 瞬态，需用 shipping preset 复验。
4. **[HIGH · 已确认]** captions canonical recipe 破。`burn-subtitles-asr-aligned.md` 默认调用 `captions generate --script <file>` 不带 `--language` 时 500（asr-captions.ts:97 `JSON.parse(stdout)` 被 whisper "Detected language" 行污染）。加 `--language zh` 即全绿。→ 修：recipe 标 --language 必填，或 asr python `verbose=False`/只取末行 JSON。
5. **[LOW · 已确认]** 手册 schema 漂移。`manual/video/02-composition-schema.md` 与真实 zod schema 不符：assets 用 `uri` 非 `path`、provenance 用 `toAssetId` 非 `assetId`、tracks 需 `displayOrder`、顶层需 `updatedAt`——照文档写 `comp validate` 直接 4 处 Required 报错（D3 亲踩）。
6. **[LOW · 文档]** `POST /api/works` 的 type 合法枚举（short-video/image-text）未写进 manual quickstart（D1/D6 均靠读 registry.ts 才知 `video` 非法）；CLI 顶层 `--help` 漏列 `clip reframe`/`clip detach-audio`/`clip mask`/`captions --script`/`--max-cjk-chars`（源码与 03-cli-reference 有述，help 过时）。
7. **[记录 · 非缺陷]** Studio 无内置 lint 面板：agent 写入重叠 clip 时，结构化错误只在 API 层（preflight/lint 端点），UI 侧仅把重叠 clip 真实渲染出来、不给用户任何警示（D4 发现）。US35 agent 视角满足，但人 UI 侧无 overlap 可见性。

---

## 下一轮必补漏测清单（S18 收口前）

**CRITICAL（阻断 S18 收口）**
- [ ] 修复 speed-ramp 相对路径 bug 后，**复验变速导出端到端**（含 clip import 素材 → 变速曲线 → 导出成品 mp4 → 抽帧像素 vs 预览帧比对）——US3 灵魂验收。
- [ ] **四个 cinematic 转场 REST 端点冒烟**（POST /api/transitions/{glitch,light-leak,domain-warp,grav-lens} 对纯色 clip 渲染 exit0 无 500）——US15/#93。
- [ ] **effects 栈 + adjustment 轨**（S14/US7/8/31/39）双驱动 + 预览=导出：`clip effects add/remove/reorder/toggle` + `track add --kind adjustment` + 旧 filters 投影 —— 整块零覆盖。

**HIGH**
- [ ] **UI 拖拽 trim/move clip 后回读 offset 是否帧对齐**（US11 / S15 residual，slices 明文要求）——鼠标真拖，非共享 op。
- [ ] **letterbox preset**（US5）预览+导出可见电影黑边。
- [ ] **blendMode screen/multiply 视觉混合**在预览/导出的实际渲染效果（US6，非仅 select value）。
- [ ] no-speed 导出 videotoolbox encode 用 **shipping preset 复验**是否复现 -12900（澄清 D3↔D5/D6 矛盾）。

**MEDIUM**
- [ ] clip duplicate（US24）；keyframe remove/move（US20）；多选 select clips（US22）；合法 cubic-bezier easing 写入+渲染（US30）——四个双驱动动词零/半覆盖。
- [ ] CLI `clip remove --ripple` / `track collapse` 动词直接跑（US19，D2 只走 UI ripple）。
- [ ] track set `--language/--volume/--muted`（US23 剩余三 flag）；`export --caption-tracks zh` flag 透传（US29）。
- [ ] 生成韧性 US32（断连取消，可用 provider stub 模式 GET /api/providers 切 stub 后跑，规避付费）+ US33（manifest 幂等）。

**已沉淀教训（写进 e2e 纪律）**
- E2E subagent **截图/读预览前必须 `osascript activate` 自己的 tab**——否则 hidden tab 的 media 加载被 Chrome 延迟，预览假黑污染 finding（D1/D2 踩、D3 破解）。
- 视觉判断一律以 computed-style/textContent 为准（六纬均遵守，D3 的黑/亮主题、变速像素、mask SVG-data-URI 二确是范本）。

---

## demo work 留存（未 push / 未删他人 work / 未动 git）
- D1 `w_20260714_1749_1c5`、D2 `w_20260714_1807_ab5`、D3 `w_20260714_1825_95a`、D4 `w_20260714_1854_916`、D5 `w_20260714_1902_a86`、D6 `w_20260714_1913_fa3`
- 证据目录：`scratchpad/e2e/{parity,export,D4,D6}/*.png` + 各纬截图 ID（见每纬表）

---

# 第二轮补验（S18 收口前漏测销账）

> 日期：2026-07-14 · 编排：Workflow 三纬 subagent（全 Opus 驱动）+ 本 completeness-critic 汇总。
> 目标：逐条销账第一轮「下一轮必补漏测清单」（M1–M11）与 US15/#93 端点冒烟；evidence 真实性抽查（无截图/DOM/verbatim 的 pass 一律不认）。
> 三纬 work：D3 复验 `w_20260714_1957_61c`（+diag `w_20260714_2005_a79`）；视觉销账 `w_20260714_2019_634`（+legacy `w_20260714_2031_3d0`）；verbs `w_20260714_2035_12f`。

## 销账表

| # | 第一轮 missing | 严重度 | R2 纬 | 判定 | 关键证据（evidence 真实性已抽查） |
|---|---|---|---|---|---|
| **M1** | 修复 speed-ramp 路径 bug 后复验变速导出端到端（US3 灵魂） | CRITICAL | D3 | **仍 FAIL** | `job_776e960` failed@render prog0『Compositor error: Invalid data found when processing input』；curl 构造 URL `.../output/...speedvar.mp4`→HTTP200 **text/html 1655B（SPA index.html）**；daemon.log `proxy?src=...%2FUsers%2F...`500。旧 ENOENT 已消（S18 A `de38975` 令 cache 能产出），**新根因替代**：`rewriteSpeedBaked` 写绝对 FS 路径→`resolveOne` 见 `/` 开头当页绝对 URL→SPA catch-all 返 HTML→Remotion 解码 HTML『Invalid data』。CONFIRMED（curl+daemon.log 双证）。5 轮消融（full/notrans/nomask/speedonly/dur2.7 全 fail）排除 effects 与时长错配，唯一共因=speed 预处理 rewrite |
| **M2** | 四个 cinematic 转场 REST 端点冒烟（US15/#93） | CRITICAL | 视觉 | **销账 PASS** | glitch/light-leak/domain-warp/grav-lens 对含音轨 clip **4/4 → 200** + 产物 mp4 落盘（时长 3.168s≈3.2 容差内）；RFC9745 `Deprecation:@1783987200`(sf-date)+`Link` successor-version 每响应皆带；产物帧视觉二确 RGB-shift 色差/暖色漏光条（`frame_*_1p5s.png` 200-260KB 真内容）。S1 视频滤镜修复（大写 T/`ld,st`/无 `alpha(X,Y)`/无静态 lenscorrection）确已落地 |
| **M3** | effects 栈 + adjustment 轨（S14/US7/8/31）双驱动 + 预览=导出 | CRITICAL | 视觉 | **销账 PASS** | effects 栈有序 `[grade,vignette]`（`comp show` + Inspector innerText『效果栈\ngrade\n↑↓●✕\nvignette』）；预览 wrapper 嵌套 `vignette CONTAINS grade`(data-effect-type)；reorder→WS 广播无 reload→嵌套翻 `grade CONTAINS vignette` + 列表翻 DOM 二确；adjustment 轨 `data-kind='adjustment'` + 独立紫 kind token `rgb(154,146,172)` vs video `rgb(168,197,214)`；grade 经 `backdrop-filter='contrast(2) saturate(1.2)'` 作用合成 |
| **M39** | 旧 filters→effects 向后兼容投影（US39） | (随 S14) | 视觉 | **销账 PASS** | `comp put` 旧 filters`{b:0.3,c:0.4,s:-0.5}` 无 effects→读回 `effects=[eff_legacy_grade grade{...}]`+filters 重置 neutral（无色数据丢失）；render snapshot frame24→163KB 真帧（投影 grade 提亮/去饱和），不炸 |
| **M4** | UI 拖拽 trim/move clip 后回读 offset 帧对齐（US11/S15 residual） | HIGH | verbs | **销账 PASS（已观察）** | 真实鼠标 `left_click_drag` clip2→回读 `offset=8.116666666666667`（×30=**243.5 非整数=OFF-GRID**）；DOM x 891→1198 二确。residual 复现=slices 明文预期，转 S19 known-issue（SINK_PENDING）。**反面亮点**：ripple/collapse 派生 offset 都做了 snapToFrame（ripple 把 clip2 从 243.5 拉回 on-grid 154 帧）——证 S15 finding2 已修 |
| **M5** | letterbox preset（US5）预览+导出可见电影黑边 | HIGH | 视觉 | **销账 PASS** | `clip mask --preset letterbox-2.35`→`mask=rect{y:0.38032,w:1,h:0.23936}`；数学核对 h=(1080/2.35)/1920=0.23936 ✓ y=(1-h)/2=0.38032 ✓；预览 SVG-mask `path='M0 730.21H1080V1189.79H0Z'`（上下黑边各 38%）；render snapshot frame72 像素显居中蓝带+上下黑边 |
| **M6** | blendMode screen/multiply 视觉混合（US6） | HIGH | 视觉 | **PASS（screen）· multiply 留 S19** | blend screen 精确落在 overlay 自身 `<img>`(srcIsClipA=true)，inline style 含 `mix-blend-mode:screen`（预览唯一该元素）。multiply 同码路未单独抽验（低残留，转 S19） |
| **M7** | no-speed 导出 videotoolbox -12900 shipping preset 复验 | HIGH | D3(+verbs) | **销账 PASS（矛盾澄清）** | daemon.log『h264_videotoolbox Error setting bitrate property:-12900』+『[render] hardware encoder h264_videotoolbox failed; retrying with software libx264』；`final-1784085111743.mp4` ffprobe h264/1280x720/30fps/120 帧/4.05s/~5.6M——**libx264 自动降级吃下 8Gbps 目标**，deliverable 真落地（S18 C `d7d9bf5`）。verbs 纬 proxy 6s mp4 亦经软件 fallback 正常产出。D3↔D5/D6「矛盾」澄清：-12900 确会发生但 retry 软件成功 |
| **M8** | clip duplicate/keyframe move-remove/多选 select/合法 bezier | MEDIUM | verbs | **销账 PASS** | duplicate→fresh id `e83278ff` trackOffset=5，WS 广播 DOM 3 clips dup@x=1011；keyframe add×2→move 2→1.5→remove@0→`comp show keyframes=[{time:1.5,value:0}]`；多选 select 两 clip `boxShadow=rgb(168,197,214) 0 0 0 1px`(=--accent)，第三 clip `boxShadow=none` 负对照；bezier `cubic-bezier(0.4,0,0.2,1)` 存为结构化对象 `{type,p:[...]}` 非裸字符串 |
| **M9** | CLI clip remove --ripple / track collapse 直接跑（US19） | MEDIUM | verbs | **销账 PASS** | remove --ripple→clip2 @8.1167 左移 removedDur(3)→snapToFrame→5.133333（×30=154 帧对齐），clip1@0 不动；collapse→clip2 5.1333→精确 3s（=clip1 dur, cursor 契合） |
| **M10** | track set --language/--volume/--muted（US23）+ export --caption-tracks（US29） | MEDIUM | verbs | **销账 PASS** | `track set` `comp show {language:'zh',volume:0.5,muted:true}` 三字段生效；轨头 mute btn `title='取消静音' aria-pressed='true' data-active='true'`；`export --caption-tracks zh` proxy 捕获 body `captionTracks:['zh']`；抽帧 `cap_frame_t1='字幕透传测试ZH'`/`t4='第二段字幕'` 双段 zh 烧入 |
| **M11** | 生成韧性 US32 断连取消 / US33 manifest 幂等 runtime E2E | MEDIUM | — | **有意不跑（非遗漏）** | 编排层决策：真实付费 provider 弃单会烧用户额度，无用户同意不做；S10 已有完整单测 + 代码级确认。如实标注为 intentional skip，转 S19 known-issues |

## evidence 真实性抽查

11 个销账 PASS 项全部带**截图 + DOM/computed-style verbatim 或 comp-show/ffprobe 结构化读**，无一构成「无证据的空 pass」：M2 带 RFC9745 header verbatim `@1783987200` + 抽帧 PNG 尺寸；M3 带 Inspector innerText verbatim + 嵌套 data-effect-type + token rgb 值；M5 带 SVG-mask path verbatim + 数学核对；M6 带 inline mix-blend-mode 落点元素 src；M8/M9/M10 带 comp-show JSON + boxShadow rgb 负对照 + proxy body verbatim + 抽帧字幕 textContent。M1 FAIL 侧带 curl HTTP200/text/html/1655B + daemon.log 行号，CONFIRMED。

## 附带新发现（非本轮销账命题，转 S19 复核）

- **[LOW]** 无音轨 clip（裸 `color=`/`testsrc2` 无 anullsrc）打四转场端点仍 500：`applyFn` filtergraph 无条件 `[0:a][1:a]acrossfade` 而端点只探视频流→『Stream specifier :a matches no streams』。**非 #93 视频滤镜根因**（已修确认），与 CI smoke fixture 含 anullsrc 契约一致；建议端点按有无音频流条件构建音轨链。
- **[LOW]** CLI `clip move <id> --to-track <当前所在轨> --offset N` 静默 no-op（两次 exit0，trackOffset 不变）；跨轨/UI-drag 重定位路径均正常。建议复核 `moveClipToTrack` 同轨 offset 分支（PLAUSIBLE）。
- **[LOW]** `comp set --duration auto` 忽略变速收缩（effectiveClipDuration=2.747 却回 4s）；已排除为 M1 主因（裁到 2.7 仍不修导出）。
- **[LOW]** blend `multiply` 视觉未单独抽验（同 screen 码路）。
- **[环境·非缺陷]** 遗留 runaway ffmpeg PID56317（light-leak 转场 smoke，444%CPU/3587min）非本 session 产生，已 flag 未擅杀。

## 第二轮裁定

**M2/M3/M39/M4/M5/M7/M8/M9/M10 = 9 项销账 PASS；M6 = screen 销账（multiply 转 S19 低残留）；M11 = 有意不跑（intentional，S10 单测覆盖）。M1（变速导出·CRITICAL·US3 灵魂）仍 FAIL。**

- **收口标准（S18 AC1：critic 无 CRITICAL 漏测 / fail 项修复后复验 pass）未达成**：M1 的旧 ENOENT 根因虽已修（S18 A `de38975`），但故障后移到 Remotion 下载层（`rewriteSpeedBaked` 绝对路径→`resolveOne` 误判页绝对 URL→SPA fallback 返 HTML），变速导出仍不可交付，且 curl+daemon.log 双证 CONFIRMED。US3「预览认可的节奏=成片节奏」的**成片一方仍未兑现**（预览侧 snapshot 时钟 3.33/3.96 证变速真生效，导出侧断裂）。
- **同型 family 隐患未消**：静态变速分支同样 `return {...c, src:cachePath}` 写绝对路径；`transforms-ffmpeg` time-warp/crop-flip 预处理（Stage0.4/0.5）也写 cache 到 `output/` 并经同一 `resolveOne` 误包→凡 ffmpeg 预处理的导出都会中招（非 speed 的 D5/D6 不走 cache 故正常）。
- **修向**：`resolveOne` 对 `/` 分支先排除真实 FS 绝对路径（仅 `/api/...` 或 assets 前缀当 URL），或 `rewriteSpeedBaked` 改写 work-相对 `output/clip-...`（需资源路由 serve `output/`）。
- **其余覆盖面已闭合**：第一轮 12 项漏测（M2–M11+M39）除 M1 外全部销账或转 S19 低残留；M11 为编排层有意 skip（付费弃单风险，S10 单测覆盖），如实标注非遗漏。

**结论：S18 仍差一个 CRITICAL 修复方可收口——修复 M1 变速导出路径 bug + 复验后，S18 达 AC1。** 遗留第一轮未销的独立 bug（captions recipe `--language` 缺省 500·HIGH、manual schema 漂移·LOW）R2 未重测，仍需在 S19 发布前处理。

---

# 第三轮定点复验（M1 CRITICAL + captions HIGH 销账）

> 日期：2026-07-14 · 编排：Workflow 定点复验 subagent（Opus 驱动）+ 本 completeness-critic 收口判官独立复核。
> 目标：判定第二轮 still_missing 的 M1（变速导出·CRITICAL·US3 灵魂）是否被真正销账——**成品 ffprobe 数值 + 抽帧非 HTML + 浏览器可见三证齐全才算**；并确认 captions `--language` HIGH 复验闭合。
> 复验 work：`w_20260714_2118_335`（short-video · fps24 · 1080×1920）；已保留未删。
> 判官二次独立取证：非仅读 subagent 断言，`ffprobe`/`file`/`blackdetect`/直接读帧 PNG 皆由本判官在最终产物上重跑。

## R2→R3 修复落地核对（git 提交实证）

| 修复 | commit | 命题 | R3 复验状态 |
|---|---|---|---|
| **A** 变速/变换预处理相对路径断裂（旧 ENOENT） | `de38975` | Stage0 speed 预处理 join workDir 再 probe/pass | 已消（R2 已证旧 ENOENT 不再复现） |
| **M1** 变速导出 served-URL 误判（新根因） | `7d1fd96` | `resolveOne` 对 `/` 分支排除真实 FS 绝对路径，不再误当页绝对 URL→SPA fallback 返 HTML | **本轮销账证据核心** |
| **B** captions 默认路径 500（whisper stdout 污染） | `e4f63e5` | `parseAsrStdout` 自底向上扫首个可解析 JSON + python `redirect_stdout(sys.stderr)` | **本轮闭合** |
| **C** 硬件编码器失败自动降级 libx264 | `d7d9bf5` | videotoolbox −12900 → 软件兜底 | R2 已证（M7） |
| **D** manual 02-schema 与真实 zod 对齐 + quickstart type 枚举 | `eb6f3a5` | 第一轮 LOW #5/#6 文档项 | 已修（核对下方文档项） |
| M-low-1 无音轨 clip 四转场端点 500 | `39ec54f` | R2 附带 LOW | 已落 fix（本轮未再 E2E） |
| M-low-2 clip move 同轨 --offset 静默 no-op | `8a0e9a8` | R2 附带 LOW | 已落 fix（本轮未再 E2E） |
| M-low-3 comp set --duration auto 变速感知 | `efdef10` | R2 附带 LOW | **R3 复验：4→2.9797s 收缩生效** |

## M1 变速导出销账 —— 三证齐全（判官独立复核）

复验设计：建 short-video work → import 4s 时钟素材（ffmpeg testsrc2+timecode+F 计数，**每帧自带源时间码，是变速收缩的可视化标尺**）→ 授 **变速+glitch 转场+椭圆遮罩**三属性同 clip（正是 R1/R2 两轮失败的组合）→ `comp set --duration auto`（变速真实收缩）→ enqueue render → 轮询终态 → 三证取。

1. **成品 ffprobe 数值（判官重跑）**：`~/.autoviral/works/w_20260714_2118_335/output/final-1784089287155.mp4` → `file` = **ISO Media MP4 Base Media v1**（**非** R2 那个 text/html 1655B SPA index.html）；`ffprobe` 视频流 **h264 1080×1920 24fps `nb_frames=72` `duration=3.000000`**。vs `comp.duration` render-time 值 **2.9797s（71.51f@24）→ 差 0.49 帧，在 ±1 内**。源 4s/96f 被 1→2 ramp 真实收缩至 3s/72f。`speedvar` 预 pass `clip-vc_29197212-speedvar-6a38a90f1e.mp4` = 720×1280 `nb_frames=72`（源 96f→72f），佐证变速渲染路径真跑。
2. **抽帧非 HTML（判官读帧）**：`export_frame40.png` `file` = **PNG 1080×1920 8-bit RGB**（真图非 HTML）；判官直接读该 PNG——**画面为时钟色条真内容**，右上时间码 **`00:00:02.208` / `F 53`**（导出 frame40 = 输出 1.667s 处，源已跑到 2.208s → 源速率 >1×，**变速收缩的直接可视证据**）；**椭圆遮罩四角纯黑（mask 命中）**；对角 RGB-shift 线 + 棋盘噪块（**glitch 转场落地**）——三属性同帧齐现。`blackdetect` 全片 **0 段黑帧**（判官在 final.mp4 上重跑）。
3. **浏览器可见（subagent 截图 + DOM 二确）**：截图 `ss_33181oa1a` 素材库「成品·1」tab 见 `final-1784089287155.mp4` 卡 + 成片 badge；DOM `productNameInDOM=true` / `chengpinBadge=true`。时间线 5 轨可见（V1 clock4s / A1 tts / A2 VO / CC1 字幕 / OV1 overlay），Inspector DOM 二确三属性 `select.value`：入场转场=glitch / 蒙版=ellipse / 2×speed easing=easeInOut。

**销账裁定：M1 = PASS（CRITICAL 已闭合）。** R2 的确切故障签名（curl 返 text/html SPA fallback → Remotion 「Invalid data」）在 R3 彻底消失：`file` 判 ISO Media、`ffprobe` 解出合法 h264 流、抽帧是真色条内容。同型 family 隐患（`resolveOne` 误包）由 `7d1fd96` 从 URL 解析层根治，故变速/变换预处理产物统一受益。诚实备注：`comp.duration` 渲染后因加入 5.8s TTS 音轨 grow 到 5s（store 只增），但 render-time 记录值 2.9797s 在加音轨前，±1 帧断言基于该时点，成立。

## captions `--language` HIGH 闭合

- `captions generate --script --max-cjk-chars 14`（**不带 `--language`**）→ **EXIT_CODE=0（非 500）**，输出段数 `2`；`captionStrategy=overlay`。修复 `e4f63e5`（`parseAsrStdout` 忽略 whisper banner + python 重定向 stdout→stderr）落地生效。
- comp captions 文本 = 台词真值：26 段重建 = `今天我们来聊聊人工智能它正在悄悄改变每个人的生活方式`（MATCHES lines.txt），CJK 分组 2 组（14+12 字，皆 ≤14）。
- **闭合裁定：HIGH = CLOSED。** canonical recipe 默认路径不再 500。

## 附带补验（本轮顺带二确，非 M1 命题）

- **blend `multiply`**（R2 转 S19 低残留）：本轮 DOM 二确——全页**唯一** `mixBlendMode='multiply'` 元素 = overlay `oc_491645` 的 `<img>`（在 `.__remotion-player` 内，`inPreview=true` / `inAssetLib=false`），inline + computed 皆 `multiply`。**预览落点已闭合**；导出侧像素级混合仍未抽帧（转 S19 LOW）。
- **M-low-3 `comp set --duration auto` 变速感知**（`efdef10`）：R3 复验 duration 4→2.9797623s（=71.51f@24），avg 速率 ~1.34，源 4s 收缩至 ~2.98s——已修生效。

## 第一轮 LOW 文档项核对（S19 前须清）

| 第一轮 LOW | 修复 | 状态 |
|---|---|---|
| #5 manual 02-composition-schema 与 zod 漂移（assets uri / provenance toAssetId / track displayOrder / 顶层 updatedAt） | `eb6f3a5` | **已修** |
| #6 quickstart 缺 POST /api/works type 枚举（short-video/image-text） | `eb6f3a5` | **已修** |
| #6 CLI `--help` 漏列 reframe/detach-audio/mask/duplicate/keyframe/effects/--script/--max-cjk-chars | `e4f63e5` | **已修** |

→ 三个第一轮 LOW 文档项**全部闭合**，无文档残留。

---

# 最终收口结论（S18 CLOSED）

**S18 达成 AC1：completeness-critic 无 CRITICAL 漏测；两轮唯一 still-missing 的 M1（变速导出·CRITICAL·US3 灵魂）经 R3 三证齐全销账 PASS；captions `--language` HIGH 闭合；M7 videotoolbox HIGH 已由 R2 软件降级证明。无 critical/high 残留。**

- **CRITICAL 全清**：M1（变速导出，R3 三证）+ M2（四转场端点，R2）+ M3/M39（effects 栈 + 向后兼容，R2）。
- **HIGH 全清**：captions `--language`（R3）+ M7 videotoolbox（R2 libx264 降级）+ M4 S15 residual（R2 复现并登记）+ M5 letterbox（R2）+ M6 blend screen（R2）。
- **US3 灵魂验收兑现**：预览侧（R1/R2/R3 snapshot 时钟证变速真生效）+ **成片侧（R3 final.mp4 72f/3.000s ≈ comp 71.51f，抽帧源时码 2.208s@输出 1.667s 证收缩，椭圆+glitch 同帧齐现）** 双侧一致——「预览认可的节奏 = 成片节奏」两侧齐全。
- **第一轮全部 12 项漏测（M2–M11+M39）+ 文档 LOW（#5/#6）+ R2 三附带 LOW 修复全部落地或转 S19 低残留。**

## 转 S19 的 medium/low 残留（CHANGELOG known-issues 直接引用）

1. **[KNOWN-ISSUE · 已登记]** S15：UI 真实鼠标拖 clip 移动/trim 落点写 off-grid offset（绕过 `snapToFrame`），R2 M4 复现（offset×fps 非整数）；slices 明文预期、S15 review F1 登记未修。派生 offset（ripple/collapse）已 `snapToFrame` 吸附。导出可能微抖。
2. **[INTENTIONAL-SKIP]** 生成韧性 US32 断连取消 / US33 manifest 幂等无 runtime E2E（真实付费 provider 弃单会烧用户额度，编排层有意跳过，无用户同意不做）；S10 单测 + 代码级覆盖（`721c670`/`314baac`）。
3. **[LOW]** blend screen/multiply 导出侧像素级混合未抽帧；预览侧已 DOM 二确落点元素 + inline/computed `mix-blend-mode`（R3 multiply / R2 screen）。
4. **[LOW]** Studio 无内置 overlap lint 面板：agent 写入重叠 clip 时结构化错误仅在 API 层（preflight/lint 端点），人-UI 侧无 overlap 警示可见性（US35 agent 侧满足）。

> R2 三附带 LOW（无音轨 clip 四转场端点 500 / clip move 同轨 --offset no-op / duration-auto 变速感知）已落 fix 提交（`39ec54f`/`8a0e9a8`/`efdef10`）；其中 duration-auto 经 R3 复验，前两者依赖 fix commit 未再 E2E——非 known-issue，仅记录待随手回归。
