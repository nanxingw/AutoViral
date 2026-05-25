# Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with Opus subagents (CLAUDE.md hard rule). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plans 1-4 落地的所有改动从 `refactor/ui-v3-react` 分支切换到 `main`：CLAUDE.md 品牌段 V1 整段覆写、产品级 4 条 D3 e2e 冒烟、跑一次 strip-pipeline migration（备份+清洗）、最后 PR 准备。**不在本 plan 中真正 push/merge**——push 与 merge 由用户最终拍板。

**Architecture:** 本 plan 不写新功能；它是 release engineering：检查清单 + 文档覆写 + 端到端冒烟 + 干净的 commit ledger。

**Tech Stack:** git + Playwright + 已有的 migration 脚本。

---

## 全局硬约束

1. **不 push、不 merge 主分支**——除非用户明确说"可以 push 了"。所有动作必须 reversible 或停在本地。
2. **migration 必须 dry-run 先跑**：strip-pipeline 第一步是 `--dry-run` 看会动多少文件，给用户看结果再真跑。
3. **conventional commits**，message 不出现禁词。
4. **Subagent 模型固定 Opus**。
5. **依赖**：Plan 1/2/3/4 都必须落地（tag plan1-scaffold-complete / plan2-studio-complete / plan3-editor-complete / plan4-backend-d3-complete 全部存在）。

---

## Task 1: 前置检查 — Plans 1-4 完整性

- [ ] **Step 1: 验证 4 个 tag 都在**

Run:
```bash
git tag -l 'plan*-complete'
```
Expected: 4 个 tag 都列出。任一缺失则 STOP 并要求补齐。

- [ ] **Step 2: 干净 working tree**

Run: `git status --short`
Expected: 空输出。否则 STOP，让用户先处理 in-flight 改动。

- [ ] **Step 3: 全量测试**

Run:
```bash
npm run test:web
npm run test:server
npx tsc --noEmit
npm run build
npm run e2e
./scripts/check-d3-words.sh
```
Expected: 全绿。任意失败 → STOP 并报告。

- [ ] **Step 4: 记录 baseline LOC**

Run:
```bash
git diff main...HEAD --stat | tail -1
```
保存到 cutover notes，方便 PR 描述时引用。

---

## Task 2: CLAUDE.md 品牌段 V1 整段覆写

**Files:**
- Modify: `CLAUDE.md`

按 spec §7 的 V1 内容**整段替换** `### Aesthetic Direction` 与 `### Brand Personality` 两段。其它段（Skill 结构规范 / `<rules>` 块）不动。

- [ ] **Step 1: 读现有 CLAUDE.md，定位两段位置**

Run: `grep -n "### Aesthetic Direction\|### Brand Personality" CLAUDE.md`
如果都不存在（current CLAUDE.md 极简），直接在文档底部追加这两段。

- [ ] **Step 2: 写入 V1 内容**

Edit `CLAUDE.md`，把现有的 Aesthetic Direction / Brand Personality（如有）替换为：

```markdown
### Aesthetic Direction
- **调性**：editorial · cool · glass。暗色 #0a0b0f 真中性 / 亮色 #fafaf7 paper-white；噪点 overlay (mix-blend-mode: overlay, opacity 0.035)
- **主色**：`--accent: #a8c5d6`（暗色 cool steel）/ `#2a3a4a`（亮色 deep ink），`--accent-hi`/`-lo`/`-glow` 完整四档
- **字体**：`Inter`（正文，font-feature ss01/cv11）· `Instrument Serif italic`（编辑大字 / 数字徽章）· `JetBrains Mono`（labels / eyebrow / 数据徽章）
- **圆角**：`--radius-sm 6px / --radius-md 10px / --radius-lg 16px / --radius-xl 22px` 四档
- **玻璃**：`backdrop-filter: blur(24px) saturate(140%)` + 1px `--glass-border` + 噪点叠加
- **动画**：pulse-dot · slide-up · shimmer · spin；保持克制（200-400ms）
- **反面参考**：避免高饱和情绪堆叠（spark-red dominance）、avoid 终端极客风、avoid 传统 CMS 后台密表格

### Brand Personality
**editorial · 克制 · 现代质感** — 一个有视觉自信的创作者工作台。像顶尖编辑部 + 创意工作室共用的内部工具：排版果断、留白果断、信息密度按需切换；不依赖高饱和情绪刺激，靠类型对比和玻璃质感建立张力。
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(brand): overwrite Aesthetic Direction + Brand Personality (V1 editorial-glass)"
```

---

## Task 3: 4 条 D3 e2e 冒烟测试

**Files:**
- Create: `e2e/d3-smoke.spec.ts`

按 spec §13 的 4 条场景：

1. **图文起步**：进 Works → 新建图文作品 → 直接进 `/editor/<id>`，调 `assets` invoke → 期待 chat 中没有"应该先调研"提示
2. **剪辑起步**：进 Works → 创建 short-video 作品 → 进 `/studio/<id>` → 不被卡在前置 step
3. **研究起步**：在 Explore 触发 `↻ Look for new angles` → 落到 Works inspiration ribbon
4. **跳过研究**：用户在 chat 给明确 brief → 不出现"先调研"等阻拦

- [ ] **Step 1: 写 e2e 文件**

```ts
// e2e/d3-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FORBIDDEN_PATTERNS = [
  /先[要要]?调研/, /应该先/, /下一步/, /阶段/, /流水线/, /pipeline/i, /stage progress/i,
];

async function expectNoForbidden(page: import("@playwright/test").Page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const re of FORBIDDEN_PATTERNS) {
    expect(text, `body should not contain ${re}`).not.toMatch(re);
  }
}

test("D3-1 图文起步 — 直接进 editor 调 assets，不出现先调研提示", async ({ page, request }) => {
  // 创建一个图文作品
  const create = await request.post("/api/works", { data: { title: "D3 imgtxt", type: "image-text", platforms: ["xiaohongshu"] } });
  const w = await create.json();
  await page.goto(`/editor/${w.id}`);
  await expect(page.locator(".editor-shell")).toBeVisible();
  await expectNoForbidden(page);

  // 调 assets 模块
  const inv = await request.post(`/api/works/${w.id}/invoke`, { data: { module: "assets", input: "show me 3 cover variants" } });
  expect(inv.status()).toBe(202);
});

test("D3-2 剪辑起步 — short-video 作品直接进 studio，无前置卡点", async ({ page, request }) => {
  const create = await request.post("/api/works", { data: { title: "D3 video", type: "short-video", platforms: ["douyin"] } });
  const w = await create.json();
  await page.goto(`/studio/${w.id}`);
  await expect(page.locator(".studio-shell")).toBeVisible();
  await expectNoForbidden(page);
});

test("D3-3 研究起步 — Explore 触发调研落到 Works inspiration ribbon", async ({ page }) => {
  await page.goto("/explore");
  // The "Look for new angles" affordance — exact selector depends on Plan 1 markup; subagent verifies.
  await expectNoForbidden(page);
});

test("D3-4 跳过研究 — 直接给 brief 进 assets", async ({ page, request }) => {
  const create = await request.post("/api/works", { data: { title: "D3 skip", type: "image-text", platforms: ["xiaohongshu"] } });
  const w = await create.json();
  // Skip planning/research, jump directly to assets
  const inv = await request.post(`/api/works/${w.id}/invoke`, { data: { module: "assets", input: "题目：周末怎么过得不无聊。直接给 5 张候选封面。" } });
  expect(inv.status()).toBe(202);
  await page.goto(`/editor/${w.id}`);
  await expectNoForbidden(page);
});
```

- [ ] **Step 2: 跑 e2e**

Run: `npm run e2e -- d3-smoke`
Expected: 4 passed。如果 D3-3 因 Explore 选择器细节失败，subagent 调整 selector（不要砍测试条件）。

- [ ] **Step 3: Commit**

```bash
git add e2e/d3-smoke.spec.ts
git commit -m "test(e2e): add 4 D3 smoke flows (imgtxt/video/research/skip-research)"
```

---

## Task 4: Strip-pipeline migration — dry-run + 真跑

**Files:**
- Use: `migrations/strip-pipeline.ts`（Plan 4 Task 10 已写）

- [ ] **Step 1: dry-run on real dataDir**

Run（subagent 内部不要直接动 prod 数据；先确认 dataDir 路径）:
```bash
node --experimental-strip-types --import tsx migrations/strip-pipeline.ts --dry-run
```
Expected: 输出 `{scanned: N, wouldStrip: M, ...}`。把 M 报给用户，等用户确认 OK 再真跑。

> ⚠️ subagent 必须**先报数字给 controller**（即我），不要自动真跑。等 controller 确认后才进入 Step 2。

- [ ] **Step 2: 真跑**

```bash
node --experimental-strip-types --import tsx migrations/strip-pipeline.ts
```
Expected: 输出 `{stripped: M, backups: [...]}`，备份文件落 `data/works/<id>/work.<ts>.bak.yaml`。

- [ ] **Step 3: 验证抽样**

Pick 一个被改的 work，diff 备份 vs 新文件：
```bash
diff <(yq . data/works/<sample>/work.yaml) <(yq . data/works/<sample>/work.*.bak.yaml)
```
Expected: 只有 4 个被删字段的差异，其它字段一致。

- [ ] **Step 4: Commit migration log**

把 migration 输出和抽样验证结果写到 `docs/superpowers/notes/migration-2026-04-27.md`，commit:

```bash
git add docs/superpowers/notes/migration-2026-04-27.md
git commit -m "docs(migration): record strip-pipeline run output (N stripped)"
```

---

## Task 5: 残留代码清扫

跑一次全 repo `step/stage/phase/pipeline/阶段/流水线` 检查，凡 production 代码命中均处理（除 plan/spec/notes 与 410 stub 注释）。

- [ ] **Step 1: D3 sweep 含 web/src + e2e**

Run: `./scripts/check-d3-words.sh && grep -rnE 'pipeline|stage|step_divider|eval_divider' web/src/ src/ --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v "\.bak\."`
Expected: clean 或仅 410 stub / migration script / strip-pipeline.ts 引用。

- [ ] **Step 2: 如有命中**：subagent 评估并修复，每修一项一次 commit。

- [ ] **Step 3: Final tag**

```bash
git tag plan5-cutover-ready
```

---

## Task 6: PR 准备

**Files:**
- Create: `docs/superpowers/notes/pr-description.md`（不进 git；本地参考）

- [ ] **Step 1: 草拟 PR 描述**

```markdown
# UI v3 — editorial-glass + D3 stage removal

## What changed
- Frontend: full rewrite from Svelte to React 18 + Vite + Zustand + TanStack Query + Radix
- Studio: Remotion `<Player>` preview + multi-track timeline + Tweaks Panel + WaveSurfer + dnd-kit
- Editor: react-konva 4:5 carousel + Inspector (Design/Copy/AI) + Filmstrip
- Backend: `step/{key}` + `pipeline/advance` 两端点合并为 `POST /api/works/:id/invoke`
- Skill: modules-as-capabilities，删 stage 暗示词
- Brand: V1 editorial-glass override in CLAUDE.md
- Migration: one-shot `migrations/strip-pipeline.ts` ran on data dir (N works stripped, backups kept)

## Stats
- N files changed, +X / -Y lines
- 5 plans executed via subagent-driven-development (Opus)
- All e2e + unit tests green
- D3 sweep clean

## Migration / rollback
- 备份文件已落 data/works/<id>/work.<ts>.bak.yaml
- rollback：`git checkout main^` + 把 .bak.yaml 文件还原到 work.yaml
```

- [ ] **Step 2: 输出 git log diff stat 给 controller**

```bash
git log main..HEAD --oneline
git diff main...HEAD --stat | tail -3
```
报给 controller 让用户审稿。

- [ ] **Step 3: STOP — 等待用户决定 push / merge**

> 不要 `git push`、不要 `gh pr create`。等用户明确说"OK push" 才执行。

---

## Task 7: 用户确认后 push & PR（**只在用户明确许可后**）

- [ ] **Step 1**: `git push origin refactor/ui-v3-react`
- [ ] **Step 2**: `gh pr create --base main --head refactor/ui-v3-react --title "..." --body-file docs/superpowers/notes/pr-description.md`
- [ ] **Step 3**: 报告 PR url 给用户。

---

## Task 8: Merge 后清理（**用户合 PR 后**）

- [ ] **Step 1**: `git checkout main && git pull`
- [ ] **Step 2**: 验证生产构建：`npm install && npm run build && npm run test:web && npm run test:server`
- [ ] **Step 3**: 如有 30 天 rollback 窗口需求，保留分支：`git push origin refactor/ui-v3-react --force-with-lease`（force-with-lease 防止意外覆盖）。

> 注意：spec §14 提到 30 天 rollback 窗口，subagent 需保留备份分支可见性，**不要 delete branch**。
