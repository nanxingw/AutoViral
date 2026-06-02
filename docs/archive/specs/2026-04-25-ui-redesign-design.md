# AutoViral · UI Redesign Spec (v3 · editorial-glass)

**Status**: Approved (decisions Q1–Q8 confirmed by user 2026-04-25)
**Scope**: Frontend full rewrite (`web/`) + agent prompt rewrite + brand override in CLAUDE.md. Backend (`src/server/`, `src/ws-bridge.ts`) functionally unchanged except for endpoint rename and prompt template.
**Mode**: R1 Big Bang — Studio + Image Editor + 三个非编辑器页面同时交付才发布。

---

## 1. Decisions captured

| # | 决定 | 备注 |
|---|---|---|
| Q1 | **React 18 + TypeScript** 替换 Svelte 5 | 后端不动 |
| Q2 | **Vite 5 SPA**（不引入 Next.js） | dev/prod 拓扑与现状一致 |
| Q3 | Works hero 改为 **"pick up where you left off"**——拟人化叙事拆除，autonomy 优先 | 不再展示 cron 调研结果 |
| Q4 | 渲染权 **P2 客户端 WYSIWYG** — Remotion + WaveSurfer + react-konva | 后端 ffmpeg pipeline 仍服务于素材预处理 + 最终质量门 |
| Q5 | **R1 Big Bang** 一并交付，旧 `web/` 一次性切换 | 中间不混栈 |
| Q6 | 阶段概念 **D3 深层清除** + 用户限定：模块作为软思维保留 | "plan / 素材生成 / 成品" 是 agent 思维标签，不是 UI/数据/API 顺序 |
| Q7 | 基础设施：vanilla CSS tokens + CSS Modules / Zustand + TanStack Query / react-router-dom v6 / Radix headless / Remotion + WaveSurfer + react-konva + dnd-kit | 全部用推荐组合 |
| Q8 | Brand: **V1 完整覆盖** CLAUDE.md 视觉段为 editorial / glass / cool-steel | 单 brand，不并存 |

## 2. Hard constraints (实施前置 + 不变量)

1. **Skill 改动前置**：任何 `skills/autoviral/**` 措辞或结构调整，必须先 fetch 最新 https://github.com/obra/superpowers + https://github.com/garrytan/gstack 内容并对照其 imperative voice / red flags / process-flow / flexible-entry 模式后再动手。
2. **后端 API surface**：除以下两项外完全不变。
   - `POST /api/works/{id}/step/{key}` 重命名为 `POST /api/works/{id}/invoke`，payload `{module: 'research'|'planning'|'assets'|'assembly', input?: any}`，无顺序约束。
   - 删除 `interval`/`autoRun`/`cron` 调度路径与字段。
3. **Subagents 用 Opus 模型驱动**（CLAUDE.md 规则继承）。
4. **模块作为能力，不作为顺序**：UI 绝不暴露"下一步""阶段进度""评审通过"任何顺序词；agent system prompt 同步重写。
5. **后端 ffmpeg 脚本继续保留**：`subtitle_burn.py` `audio/mix` `beat_sync_edit.py` `caption_generate.py` 等仍是 Remotion 渲染前/后的工具，不删。
6. **数据迁移一次性**：现有 Work 对象的 `pipeline` 字段被一次性脚本抹除，不保留兼容字段。

## 3. Repository layout (after)

```
autoviral/
├─ src/                              # 后端 — 不变
│  ├─ server/
│  │  ├─ index.ts                    # 静态目录指向 web/dist；删除 cron scheduler
│  │  └─ api.ts                      # step/{key} → invoke；删除评审 gate；保留 evaluator-as-tool
│  └─ ws-bridge.ts                   # 重写 getSystemPrompt（移除 currentStep / 流水线）
├─ skills/autoviral/                 # skill 措辞 D3 同步
│  ├─ SKILL.md                       # 删除任何"阶段"暗示
│  ├─ taste/                         # 不动（除 05/06 中残留措辞）
│  └─ modules/{research,planning,assets,assembly}/SKILL.md
├─ web/                              # 全部重写
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.ts                 # proxy /api /ws
│  ├─ tsconfig.json
│  ├─ public/
│  └─ src/
│     ├─ main.tsx
│     ├─ App.tsx                     # Layout shell
│     ├─ pages/{Works,Explore,Analytics,Studio,Editor}.tsx
│     ├─ features/
│     │  ├─ studio/                  # Remotion compositions + Timeline + Tweaks
│     │  ├─ editor/                  # react-konva canvas + Slides nav + Inspector
│     │  ├─ chat/                    # ws client + StreamBlock components
│     │  ├─ trends/ analytics/ works/
│     ├─ stores/                     # Zustand
│     ├─ queries/                    # TanStack Query hooks
│     ├─ lib/                        # api / ws / format / time
│     ├─ ui/                         # Radix-based primitives
│     ├─ styles/{tokens,globals,typography}.css
│     └─ assets/
└─ docs/superpowers/specs/           # this file
```

旧 `web/src/`（Svelte）切换日整目录删除。git 历史足够保存。**不保留 `web-svelte-archive/` 备份目录**——历史在 git 里。

## 4. Build & run topology

- **Dev**: `pnpm --filter web dev` 启动 Vite 5173；后端 `pnpm dev` 保持现端口；Vite proxy 转发 `/api` `/ws` 给后端。
- **Prod**: `vite build` → `web/dist/`；`src/server/index.ts` 静态目录指向它（一行配置）。
- **依赖管理器**：保留与项目当前一致（pnpm/npm 看 `package.json` 现状；不强制切换）。

## 5. Page surfaces (5 routes)

| 路由 | 页面 | 主要构成 |
|---|---|---|
| `/` | Works | Hero（"pick up where you left off"）· 最近作品 grid · Latest Inspiration ribbon（手动触发版） |
| `/explore` | Explore | 4 平台 tab（YouTube / TikTok / 小红书 / 抖音）· Trending feed · Hot topics · 3 AI angles 推荐 |
| `/analytics` | Analytics | KPI hero · profile · 年龄/性别/地区分布 · research overview · insights list |
| `/studio/:workId` | Video Studio | TopBar · Preview（Remotion `<Player>`）· Timeline（多轨）· Tweaks Panel · Chat |
| `/editor/:workId` | Image-Text Editor | TopBar · SlidesNav · Konva Canvas · Inspector（design/copy/ai 三标签）· Filmstrip tray |

**Hero (Works)** 文案模板：
```
Pick up where you left off — *3 drafts*, *2 ideas* in queue, and *one* unfinished payoff scene.
```
所有数字来自真实数据：`useDrafts()`、`useInspirations()`、`useWorkAt(lastEditedId)`。无任何"过去 X 小时"措辞。

**Latest Inspiration 触发**：右上浮按钮 `↻ Look for new angles` → 触发一次 explicit 调研对话；删除任何 `EVERY 1H` chip / `AUTO` toggle / `Research config` 卡。

## 6. Stage concept removal (D3) — 7 锚点全部清除

| # | 锚点 | 处理 |
|---|---|---|
| ① | Studio shell rail UI（52px 行） | grid-template-areas 重排，rail 行删除；增加垂直空间给 timeline |
| ② | ChatPanel `eval_divider` 渲染分支 | StreamBlock 组件的 eval_divider type 完全移除；遇到旧消息 fallback 当成普通文本 |
| ③ | `PipelineBar.svelte` | 不在新 React 树中重建 |
| ④ | `ws-bridge.ts:getSystemPrompt` | 重写：移除 `currentStep`、移除"阶段记录"措辞；新版本明确说 "modules are capabilities, not stages; you may invoke any module at any time based on user intent" |
| ⑤ | Work.pipeline 数据字段 | 一次性 migration 脚本抹除；类型定义中删除字段 |
| ⑥ | `POST /api/works/{id}/step/{key}` | 改 `POST /api/works/{id}/invoke`，payload `{module, input}` |
| ⑦ | 评审 gate 中间件 | 评审从 gate 降级为 tool：agent 可主动调用打分，不可阻断；`api.ts:1773` 改为简单返回 rubric 内容供 agent 阅读 |

**软概念保留**：plan / 素材生成 / 成品 在 agent prompt 里以"思维标签"出现一次，明确说"these are mental buckets you may use; users may also skip them"。

## 7. Brand override (CLAUDE.md replacement diff)

### 替换段位置：CLAUDE.md `### Aesthetic Direction` 段

### 新内容（V1 整段覆盖）

```markdown
### Aesthetic Direction
- **调性**：editorial · cool · glass。暗色 #0a0b0f 真中性 / 亮色 #fafaf7 paper-white；噪点 overlay (mix-blend-mode: overlay, opacity 0.035)
- **主色**：`--accent: #a8c5d6`（暗色 cool steel）/ `#2a3a4a`（亮色 deep ink），`--accent-hi`/`-lo`/`-glow` 完整四档
- **字体**：`Inter`（正文，font-feature ss01/cv11）· `Instrument Serif italic`（编辑大字 / 数字徽章）· `JetBrains Mono`（labels / eyebrow / 数据徽章）
- **圆角**：`--radius-sm 6px / --radius-md 10px / --radius-lg 16px / --radius-xl 22px` 四档
- **玻璃**：`backdrop-filter: blur(24px) saturate(140%)` + 1px `--glass-border` + 噪点叠加
- **动画**：pulse-dot · slide-up · shimmer · spin；保持克制（200-400ms）
- **反面参考**：避免高饱和情绪堆叠（spark-red dominance）、avoid 终端极客风、avoid 传统 CMS 后台密表格
```

### Brand Personality 同步调整

```markdown
### Brand Personality
**editorial · 克制 · 现代质感** — 一个有视觉自信的创作者工作台。像顶尖编辑部 + 创意工作室共用的内部工具：排版果断、留白果断、信息密度按需切换；不依赖高饱和情绪刺激，靠类型对比和玻璃质感建立张力。
```

## 8. Frontend stack (locked)

| 层 | 选型 | 用途 |
|---|---|---|
| 视图 | React 18.3 | hook + Suspense |
| 构建 | Vite 5 + TS 5.4 | dev / prod |
| 样式 | vanilla CSS + CSS Modules + `clsx` | tokens.css / globals.css / typography.css |
| 状态（UI） | Zustand 4.x | chat、studio timeline、editor canvas、theme |
| 状态（远程） | TanStack Query 5.x | works / trends / analytics / memory |
| 路由 | react-router-dom 6.x | 5 顶层路由 |
| 原语 | Radix UI Primitives | Tabs / Dialog / Tooltip / Slider / Switch / DropdownMenu |
| 视频 | Remotion 4.x（`@remotion/player` + `@remotion/renderer`） | 浏览器内合成 + 服务端渲染等价输出 |
| 音频 | wavesurfer.js 7.x + Web Audio API | 多轨波形、混音 |
| 画布 | react-konva（Konva 9.x） | 4:5 carousel layered canvas |
| 拖拽 | @dnd-kit/core + @dnd-kit/sortable | timeline 切片排序、filmstrip 排序 |
| 工具 | zod, date-fns, immer | 校验 / 时间 / 不可变更新 |
| 测试 | Vitest + React Testing Library + Playwright | unit / 集成 / 端到端 |

## 9. Studio (video) 详细设计

### Shell grid（删 rail 后）

```
grid-template-columns: 360px 1fr 300px;
grid-template-rows: 56px 1fr 320px;          /* timeline 加高至 320px（rail 释放的 52px + 余量） */
grid-template-areas:
  "top top top"
  "chat preview aside"
  "chat timeline aside";
```

### Timeline 数据模型

```ts
interface Composition {
  id: string;
  workId: string;
  fps: 30;
  width: 1080;
  height: 1920;          // 9:16 默认；可切换 1:1 / 16:9
  duration: number;      // seconds
  tracks: Track[];
}
type Track =
  | VideoTrack          // clips: VideoClip[]
  | AudioTrack          // clips: AudioClip[], type: 'bgm'|'voice'|'sfx'
  | TextTrack           // clips: TextClip[]   subtitle / overlay
  | OverlayTrack;       // konva-style image/shape overlays
interface VideoClip {
  id: string;
  src: string;           // 本地路径 / OSS url
  in: number; out: number;     // 源裁切（秒）
  trackOffset: number;          // 在 timeline 上的起点
  transforms: { scale: number; x: number; y: number; rotation: number };
  filters: { lut?: string; brightness: number; contrast: number; saturation: number };
}
interface AudioClip {
  id: string;
  src: string;
  in: number; out: number;
  trackOffset: number;
  volume: number;        // 0-1.5 (dB curve UI)
  fadeIn: number; fadeOut: number;
  ducking?: { ratio: number; attack: number; release: number };
}
interface TextClip {
  id: string;
  text: string;
  trackOffset: number; duration: number;
  style: { font: string; size: number; weight: number; italic: boolean; tracking: number; color: string; stroke?: { width: number; color: string } };
  position: { anchor: 'top'|'center'|'bottom'; xPct: number; yPct: number };
  animation?: 'kinetic-pop'|'typewriter'|'slide-up'|'fade';
}
```

### Remotion composition

每个 Composition 渲染为一个 `<RemotionComposition>` React 组件树。`<Player>` 接受同一份 props 在浏览器中实时回放；`@remotion/renderer` 在服务端用同样的代码 render 为 mp4，**像素级一致**。

### 工具链分工

| 阶段 | 工具 | 何时调用 |
|---|---|---|
| 素材生成 | Dreamina / Jimeng / OpenRouter / Lyria（保留现状） | agent 在 chat 中触发 |
| 客户端实时预览 | Remotion `<Player>` | 用户拖滑杆即时反馈 |
| 字幕 ASR + 烧录 | `caption_generate.py` (ASR) → 写入 TextTrack | 烧录由 Remotion 直接渲染（不再用 subtitle_burn.py 在导出时叠） |
| 多轨混音 | client：Web Audio API 实时；server：现有 `/api/audio/mix` 在导出时复算 | 双端等价 |
| 节拍对齐 | `beat-sync/detect_beats.py` 仍用于检测；切点应用在 client 层 | 检测后端，应用前端 |
| 调色 LUT | client Remotion filter; server ffmpeg LUT 等价 |  |
| 最终导出 | `@remotion/renderer`（服务端 headless Chromium） | 导出按钮触发 |

### Tweaks Panel（右侧 300px）

设计稿 `tweaks-panel.jsx` 给出多变体；本设计**保留单一变体**（避免风格漂移）：

- **Section 1 · Theme**：dark/light + accent 5 种（steel/violet/cyan/coral/lime）
- **Section 2 · Density**：balanced / compact / comfy
- **Section 3 · Selected layer**：动态根据当前选中 clip 类型展开（Video / Audio / Text）的所有参数 sliders
- **Section 4 · Composition**：fps / aspect ratio / total duration

### Chat（左侧 360px）

- WS connection via `useChatSocket(workId)` hook（TanStack Query 不管 WS，自己做）
- StreamBlock types 简化为：`text | thinking | tool_use | tool_result | user`（去掉 `step_divider` `eval_divider` `ask_question`——保留 ask_question 仅作可选）
- Quick-action 按钮（语境化）：用户选中某 clip 时显示"重新生成此片段 / 调整节奏 / 换 BGM 风格"

## 10. Image-Text Editor 详细设计

### Shell grid

```
grid-template-columns: 320px 1fr 340px;
grid-template-rows: 56px 1fr 124px;
grid-template-areas:
  "top top top"
  "left canvas right"
  "left tray right";
```

### Slide 数据模型

```ts
interface Carousel {
  id: string; workId: string;
  width: 1080; height: 1350;     // 4:5
  globals: { headlineFont: 'serif'|'sans'|'mono'; palette: PaletteId; layout: 'centered'|'left'|'split'; effects: { grain: number; gradient: number; sharpen: number } };
  slides: Slide[];
}
interface Slide {
  id: string;
  bg: { type: 'gradient'|'image'|'solid'; value: string };
  layers: Layer[];                // konva 层
}
type Layer = TextLayer | ImageLayer | ShapeLayer | StickerLayer;
```

### Inspector 三标签

- **Design**：headline font / size / palette (5 preset) / layout (3 preset) / effects (3 sliders)
- **Copy**：headline / body / caption 三个 textarea + "✨ 让 AI 改写一版"
- **AI**：style prompt + 6 quick style buttons + "重新生成全部 N 张"

### Filmstrip + AI 建议

- 底部 124px tray：缩略图横排，dnd-kit 排序，"DRAG TO REORDER" microcopy
- 左下角 AI 建议卡（如"第 4 张密度低，建议插入新页"）

### 导出

- 客户端 Konva `stage.toCanvas()` 出图，单张 png
- 批量导出：循环每张 slide → png；可选 zip 打包

## 11. Skill content adjustments (D3 同步)

按 §2 第 1 条硬约束执行（先 fetch superpowers/gstack）。改动文件：

| 文件 | 改动类型 |
|---|---|
| `skills/autoviral/SKILL.md` | 移除任何"阶段"暗示词；明确 modules 为能力词典 |
| `skills/autoviral/taste/00-prime-directive.md` | 验证措辞已对齐 |
| `skills/autoviral/taste/05-creative-schema.md` | 移除 schema 中暗示流程顺序的字段名（如有） |
| `skills/autoviral/modules/research/SKILL.md` | 删除"先调研，再…"措辞 |
| `skills/autoviral/modules/planning/SKILL.md` | 同上 |
| `skills/autoviral/modules/assets/SKILL.md` | 同上 |
| `skills/autoviral/modules/assembly/SKILL.md` | 同上 |

## 12. Backend changes

| 文件 | 改动 |
|---|---|
| `src/server/index.ts` | 静态目录指 `web/dist`（已是这个状态）；删除任何 cron / scheduler 启动代码 |
| `src/server/api.ts` | `step/{key}` 路由重命名为 `invoke`；payload 改 module；删除 `interval`/`autoRun` 配置 endpoint；评审改为只读 rubric 工具 |
| `src/ws-bridge.ts` | `getSystemPrompt()` 完全重写：移除 `currentStep` 与"阶段"措辞；新版本约 80 行，明确 modules-as-capabilities |
| `migrations/strip-pipeline.ts` | 一次性脚本：遍历所有 work，删除 `pipeline` 字段 |

## 13. Testing strategy

### Unit (Vitest + RTL)

- Stores（Zustand）：reducer 行为
- Pure helpers（time format, EDL serialization, palette resolution）
- Critical hooks（`useChatSocket`, `useTimeline`）

### Integration

- Studio：Timeline → Remotion `<Player>` 同步；拖一个 clip 即时看到预览更新
- Editor：增删 slide、拖拽排序、Inspector 调字号实时反映在 Konva canvas
- Chat：发消息 → WS → StreamBlock 渲染 → tool_use 折叠/展开

### E2E (Playwright)

四条冒烟脚本（D3 验证）：
1. **图文起步**：进 Works → 新建图文作品 → 直接调用 assets module 生成图 → 不出现"应该先调研"提示
2. **剪辑起步**：进 Works → 上传一段视频 → 直接进 Studio → 不被卡在前置 step
3. **研究起步**：在 Explore 触发一次趋势调研 → 落到 Works inspiration ribbon
4. **跳过研究**：用户给出明确 brief → agent 直接进入 assets/assembly

### 视觉回归（可选）

Playwright 截图对比即可覆盖；Storybook + Chromatic 不作为本次 scope 的硬要求，仅在视觉回归发现问题再考虑引入。

## 14. Migration & cutover

### 开发期（≈4-6 周）

- 旧 `web/`（Svelte）保持 git 历史中可访问
- 新代码在分支 `refactor/ui-v3-react`（或类似）上**直接覆盖** `web/` 目录
- 主分支（`main`）始终能 checkout 出旧版本继续构建运行
- 后端改动（端点改名、prompt 重写、cron 删除）也在同一分支推进，避免双方主分支与重构分支后端协议漂移
- 切换日合并分支即上线

### 切换日 checklist

1. 全套测试通过（unit + integration + e2e + 视觉回归）
2. 跑一次 `migrations/strip-pipeline.ts` 抹除所有 work 的 pipeline 字段
3. 部署后端新版本（含 `/api/works/{id}/invoke` 端点）
4. 部署前端新版本（`web/dist`）
5. 冒烟测试 4 条 D3 场景在生产环境跑一遍
6. 旧分支保留 30 天 rollback 窗口

### Rollback

如生产事故：
1. 回滚后端镜像
2. 回滚前端静态资源
3. （需要时）从备份恢复 work.pipeline 字段——此项依赖 §11 migration 脚本是否做了备份；spec 强制要求 migration 脚本必须先 dump 备份再删字段

## 15. Risks & open questions

| 风险 | 影响 | 缓解 |
|---|---|---|
| Remotion 学习曲线 + 性能（长 timeline） | 高 | 先用一个最小 spike（5 clips + 1 audio + 字幕）验证 60s 视频实时回放无卡顿；不通过则退到 P3 |
| ws-bridge 客户端用 React 重写时丢消息 | 中 | 重写时附 reconnect + replay 缓冲；e2e 测试覆盖断网恢复 |
| 4 平台 trends 数据源（YouTube / TikTok / 小红书 / 抖音） | 中 | 现有抖音/小红书已通；YouTube/TikTok 后端先 stub，UI 先 placeholder，后续补 |
| Analytics 人口统计字段（年龄/性别/地区） | 中 | 现有 `/api/analytics/creator` 不含；先 stub mock 数据，标记 known-mock；二期补真实数据源 |
| 旧 work 数据 pipeline 字段删除后回访旧版本 UI 异常 | 低（旧 UI 不再上线） | migration 备份 + rollback 路径 |
| 视频客户端导出对低端机 OOM | 低 | 客户端只做预览，导出走 `@remotion/renderer` 服务端 |

### Open questions（不阻塞 spec，标记给实施期）

1. ChatPanel 的 quick-action 按钮枚举具体清单（"重新生成此片段"等）由 agent prompt 决定还是前端 hardcode？建议 prompt 决定，前端从消息 metadata 读
2. Tweaks Panel 的 5 种 accent 是否暴露给最终用户，还是仅 dev/admin 可见？建议仅设置面板可切，不在常规 UI 暴露
3. Image Editor 是否支持导出为 PDF / 视频幻灯片格式？建议只 PNG，PDF/视频后续

---

## 16. Appendix · Q&A 决策追溯

| Q | 选项 | 用户决定 | 我推荐 | 一致 |
|---|---|---|---|---|
| 1 | A/B/C 技术栈 | B (React 18) | A (Svelte) → 修正后推 B | ✓ 修正后一致 |
| 2 | A/B/C 应用框架 | A (Vite) | A | ✓ |
| 3 | A/B/C/D Hero 叙事 | A (autonomy first) | A | ✓ |
| 4 | P1/P2/P3 渲染权 | P2 | P2 | ✓ |
| 5 | R1/R2/R3/R4 节奏 | R1 (Big Bang) | R2 | 用户偏向更激进 |
| 6 | D1/D2/D3 阶段清理 | D3 + 软思维保留 | D3 | ✓ + 用户加了限定 |
| 7 | bundle | 全用推荐 | 推荐 bundle | ✓ |
| 8 | V1/V2/V3 brand | V1 | V1 | ✓ |

---

**Spec 完结。下一步**：调用 superpowers `writing-plans` skill，把本 spec 拆成可被 subagent（Opus 模型）逐步执行的实施计划，落地到 `docs/superpowers/plans/2026-04-25-ui-redesign-plan.md`。
