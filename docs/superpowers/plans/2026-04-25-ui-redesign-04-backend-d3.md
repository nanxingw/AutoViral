# Backend D3 + Skill Refit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with Opus subagents (CLAUDE.md hard rule). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把后端的"阶段/流水线/评审 gate/auto-research cron"概念深层清除（D3），把 `step/{key}` + `pipeline/advance` 双端点合并为一个无顺序的 `POST /api/works/:id/invoke {module}` 端点，重写 ws-bridge agent prompt 为"模块即能力"，并把 `skills/autoviral/**` 措辞同步对齐。

**Architecture:** 后端只动 4 个文件（`src/server/api.ts` / `src/ws-bridge.ts` / `src/work-store.ts` / 新增 `migrations/strip-pipeline.ts`）+ 6 个 skill 文档。所有 stage-coupled 数据字段（`pipeline` / `evaluationMode` / `evalSessionIds` / `evalAttempts`）从 `Work` 类型中移除。`evaluator` 从 gate 降级为 agent 可调用的只读 rubric tool。删除 `/api/config` 的 `researchEnabled` / `researchCron` 字段对外暴露（cron 在后端从未真正实现，配置只是占位）。

**Tech Stack:** Node + Hono + TypeScript（strict）+ Vitest 后端测试。skill 文档为 markdown。

---

## 全局硬约束

1. **TDD**：每条行为变更先写失败测试再实现。后端测试用 vitest，新增 spec 落在 `src/server/__tests__/` 或同名 `*.test.ts` 旁置。
2. **每完成一个 task 就 commit**，使用 conventional commits（`feat:` / `refactor:` / `chore:` / `test:` / `docs:`）。Commit message **禁止**包含 `step` `stage` `phase` `pipeline` `阶段` `流水线` 字样（描述移除该概念时可写 "drop pipeline field" 但禁止描述新行为时使用）。
3. **Skill 改动前置**（spec §2.1 / CLAUDE.md:32）：在改任何 `skills/autoviral/**` 文件前，subagent 必须先用 WebFetch 拉 `https://github.com/obra/superpowers` 与 `https://github.com/garrytan/gstack` 的 README 与典型 SKILL.md 模板，对照其 imperative voice / red flags / process flow / flexible-entry 模式。
4. **D3 词典**：UI / API / prompt 三处禁止出现"下一步""阶段进度""评审通过""请等待"任何顺序词。模块名 `research/planning/assets/assembly` 仍保留，但**作为能力词典**而非顺序。
5. **不破坏现有 e2e**：Plan 1 落地的 3 条 Playwright e2e 必须仍然通过。
6. **Subagent 模型固定 Opus**。

## 文件结构（after）

```
src/
├─ server/
│  ├─ api.ts                  # /api/works/:id/invoke 替换 step/{key} + pipeline/advance；evaluator 改 rubric 工具；删 researchEnabled/Cron 字段
│  ├─ __tests__/
│  │  ├─ invoke.test.ts       # 新：invoke 端点行为
│  │  ├─ legacy-routes.test.ts # 新：确认 step/{key} & pipeline/advance 已 410
│  │  └─ config.test.ts       # 新：确认 researchEnabled/Cron 不再出现在响应里
├─ ws-bridge.ts               # getSystemPrompt 重写；删除 currentStep / step_divider / eval_divider 事件
├─ ws-bridge.test.ts          # 新：getSystemPrompt 不含禁词；不会再发 step_divider
├─ work-store.ts              # Work 类型删 pipeline/evaluationMode/evalSessionIds/evalAttempts；删 defaultPipeline / saveStepHistory / loadStepHistory / saveEvalResult / loadEvalResult
└─ work-store.test.ts         # 新：createWork 不再带 pipeline；strip 字段确认

migrations/
└─ strip-pipeline.ts          # 新：一次性脚本，遍历 dataDir/works/**/work.yaml，先 dump 备份再抹掉 pipeline/evaluationMode/eval* 字段

skills/autoviral/
├─ SKILL.md                            # 措辞清洗
├─ taste/00-prime-directive.md         # 校验
├─ taste/05-creative-schema.md         # 移除暗示流程顺序的字段名
└─ modules/{research,planning,assets,assembly}/SKILL.md  # 4 份措辞清洗
```

---

## Task 1: 准备工作 — fetch 业界 skill 权威 + D3 词典 sweep

**目的**：在动 skill 文件前完成强约束的 fetch；同时把"禁词清单"写成 grep 表达式，方便后面任务做自检。

**Files:**
- Create: `docs/superpowers/notes/2026-04-27-skill-references.md`（subagent 读后留下的指南摘要，便于后续任务复用，不参与产品代码）
- Create: `scripts/check-d3-words.sh`（一行脚本，CI 不接，供 task 内手动跑）

- [ ] **Step 1: WebFetch obra/superpowers + garrytan/gstack 的 README 与典型 SKILL.md**

```bash
# subagent 内部执行（不走 Bash，用 WebFetch 工具）
WebFetch https://raw.githubusercontent.com/obra/superpowers/main/README.md  -> 摘要
WebFetch https://raw.githubusercontent.com/obra/superpowers/main/skills/using-superpowers/SKILL.md  -> imperative voice 范例
WebFetch https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md  -> 流程图风格
WebFetch https://raw.githubusercontent.com/garrytan/gstack/main/README.md   -> 摘要
```

把 4 段 fetch 结果浓缩成 ≤ 80 行 markdown，写进 `docs/superpowers/notes/2026-04-27-skill-references.md`，包含：imperative voice 例子、red flags 模板、process-flow `dot` 示例、flexible-entry 模式。

- [ ] **Step 2: 写 D3 禁词检查脚本**

```bash
cat > scripts/check-d3-words.sh <<'SH'
#!/usr/bin/env bash
# D3 sweep — fail if forbidden words appear in production code or skill docs.
# Allow them ONLY in: spec/plan files (docs/superpowers/), notes/, archived comments tagged NEGATIVE, this script itself,
# and migration scripts whose explicit purpose is to remove the field.
set -e
PATTERN='step_divider|eval_divider|pipeline/advance|currentStep|阶段|流水线'
EXCLUDES=(
  ":(exclude)docs/superpowers"
  ":(exclude)scripts/check-d3-words.sh"
  ":(exclude)migrations/strip-pipeline.ts"
  ":(exclude)*.test.ts"   # tests may reference legacy names in 410 assertions
)
HITS=$(git grep -nE "$PATTERN" -- "${EXCLUDES[@]}" || true)
if [ -n "$HITS" ]; then
  echo "D3 forbidden words found:"
  echo "$HITS"
  exit 1
fi
echo "D3 sweep clean."
SH
chmod +x scripts/check-d3-words.sh
```

- [ ] **Step 3: 跑一次 sweep 看现状**

Run: `./scripts/check-d3-words.sh`
Expected: **fail**（应该看到 ws-bridge.ts / api.ts 大量命中，证明任务还没开始就有大量 anchors 待清除）。把命中列表保存到 notes 文件中作为 baseline 进度对照表。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-04-27-skill-references.md scripts/check-d3-words.sh
git commit -m "chore(plan4): add D3 sweep tooling and capture obra/gstack skill references"
```

---

## Task 2: Backend test scaffolding — `src/server/__tests__/` 目录初始化

**目的**：建立后端 vitest 跑测试的入口（之前后端没有 unit test 设施），让后续 task 的 TDD 步骤有处可写。

**Files:**
- Modify: `package.json:scripts`（增 `test:server` 命令）
- Modify: `vitest.config.ts`（顶层配置；如不存在则新建一份服务端独立 config `vitest.server.config.ts`）
- Create: `src/server/__tests__/.gitkeep`
- Create: `src/server/__tests__/_helpers.ts`（共享 fixture 工厂）

- [ ] **Step 1: 检查现有 vitest 配置**

Run: `cat web/vitest.config.ts && cat vitest.config.ts 2>/dev/null || echo "no top-level vitest config"`
Expected: 当前只有 `web/vitest.config.ts`（jsdom env）。后端测试需要 node env，不能复用。

- [ ] **Step 2: 创建服务端 vitest 配置**

Create `vitest.server.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["web/**", "e2e/**", "node_modules/**"],
    pool: "forks",       // hono + fs 测试需要独立子进程，避免 mock 串扰
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 3: 添加 npm script**

Edit `package.json`:

```diff
   "scripts": {
     ...
     "test:web": "vitest run --config web/vitest.config.ts",
     "test:web:watch": "vitest --config web/vitest.config.ts",
+    "test:server": "vitest run --config vitest.server.config.ts",
+    "test:server:watch": "vitest --config vitest.server.config.ts",
     ...
   }
```

- [ ] **Step 4: 创建测试 helpers**

Create `src/server/__tests__/_helpers.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create an isolated dataDir per test so config/works files don't leak. */
export async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-test-"));
  // Set env var BEFORE importing api.ts via vi.resetModules in caller
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

/** Build a Hono request with JSON body. */
export function jsonReq(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}
```

- [ ] **Step 5: 验证 dataDir 支持环境变量**

Run: `grep -n "dataDir\|AUTOVIRAL_DATA_DIR" src/config.ts`
Expected: 看 `dataDir` 是不是从 env 读。如果不是，task 内追加一条小修：让 `dataDir` 优先读 `process.env.AUTOVIRAL_DATA_DIR`。subagent 自行决定如何加（最少改动原则）。

- [ ] **Step 6: smoke test — 跑一个空套件确认 config 正确**

Create `src/server/__tests__/_smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTempDataDir } from "./_helpers.js";

describe("server vitest scaffolding", () => {
  it("withTempDataDir provides isolated path", async () => {
    await withTempDataDir(async (dir) => {
      expect(dir).toBeTruthy();
      expect(process.env.AUTOVIRAL_DATA_DIR).toBe(dir);
    });
  });
});
```

Run: `npm run test:server`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add vitest.server.config.ts package.json src/server/__tests__/
git commit -m "test(server): scaffold vitest node config and shared helpers"
```

---

## Task 3: 新增 `POST /api/works/:id/invoke` 端点（红 → 绿）

**目的**：用一条无顺序、无前置依赖的端点替换全部 `step/{step}` 路由。payload `{module: 'research'|'planning'|'assets'|'assembly', input?: any}`。

**Files:**
- Create: `src/server/__tests__/invoke.test.ts`
- Modify: `src/server/api.ts`（追加路由；不动旧 step/{step}，下个 task 删）

- [ ] **Step 1: 写失败测试**

Create `src/server/__tests__/invoke.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("POST /api/works/:id/invoke", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 202 and triggers a session for a valid module", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const work = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${work.id}/invoke`, { module: "research", input: "topic X" }),
      );
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json).toMatchObject({ triggered: true, workId: work.id, module: "research" });
    });
  });

  it("rejects unknown module with 400", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const work = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${work.id}/invoke`, { module: "publish" }),
      );
      expect(res.status).toBe(400);
    });
  });

  it("rejects missing work with 404", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/nope/invoke`, { module: "research" }),
      );
      expect(res.status).toBe(404);
    });
  });

  it("does NOT enforce ordering — assembly module callable first", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${work.id}/invoke`, { module: "assembly", input: "render now" }),
      );
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.module).toBe("assembly");
    });
  });
});
```

- [ ] **Step 2: 运行测试确认 fail**

Run: `npm run test:server -- src/server/__tests__/invoke.test.ts`
Expected: 4 failed (route 不存在, 全部 404 / 500)。

- [ ] **Step 3: 实现 invoke 端点**

Edit `src/server/api.ts`，在文件尾部 `apiRoutes.post("/api/works/:id/step/:step")` 之**前**插入新路由：

```ts
const KNOWN_MODULES = ["research", "planning", "assets", "assembly"] as const;
type ModuleName = (typeof KNOWN_MODULES)[number];

// POST /api/works/:id/invoke — module-as-capability dispatcher (no ordering)
apiRoutes.post("/api/works/:id/invoke", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ module?: string; input?: unknown }>();
  const mod = body.module as ModuleName | undefined;
  if (!mod || !KNOWN_MODULES.includes(mod)) {
    return c.json({ error: `module must be one of ${KNOWN_MODULES.join("|")}` }, 400);
  }

  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);

  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WS bridge not initialised" }, 500);

  const session = wsBridge.ensureSession(id);
  // Prompt = neutral capability invocation. The agent's system prompt (ws-bridge) defines what each module means.
  const userBrief = typeof body.input === "string"
    ? body.input
    : body.input ? JSON.stringify(body.input) : "(no extra brief)";
  wsBridge.sendUserMessage(session, [
    `请使用 \`${mod}\` 模块的能力处理当前作品。`,
    `用户附带的输入：${userBrief}`,
    `这是一次能力调用，不是阶段推进——按你判断完成本次工作即可，不需要"进入下一步"。`,
  ].join("\n"));

  return c.json({ triggered: true, workId: id, module: mod }, 202);
});
```

> **注**：`getWsBridge()` / `wsBridge.ensureSession` / `wsBridge.sendUserMessage` 是已有 ws-bridge 的公开方法名；如果当前实际 API 不同，subagent 需读 `src/ws-bridge.ts` 找等价 API 并对齐（不要随便加新 export，最小改动）。文中的中文 brief 短语必须**不出现** `step` `阶段`。

- [ ] **Step 4: 跑测试到全绿**

Run: `npm run test:server -- src/server/__tests__/invoke.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/__tests__/invoke.test.ts src/server/api.ts
git commit -m "feat(api): add module-as-capability /api/works/:id/invoke endpoint"
```

---

## Task 4: 删除 `step/{step}` + `pipeline/advance` 双端点（绿 → 410）

**目的**：把旧端点替换成 410 Gone，避免任何客户端残留代码静默走老路径。

**Files:**
- Create: `src/server/__tests__/legacy-routes.test.ts`
- Modify: `src/server/api.ts`

- [ ] **Step 1: 写失败测试**

Create `src/server/__tests__/legacy-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("legacy stage routes are gone", () => {
  beforeEach(() => vi.resetModules());

  it("POST /api/works/:id/step/:key returns 410", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(jsonReq("POST", `/api/works/${w.id}/step/research`, {}));
      expect(res.status).toBe(410);
      const j = await res.json();
      expect(j.error).toMatch(/invoke/i);
    });
  });

  it("POST /api/works/:id/pipeline/advance returns 410", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(jsonReq("POST", `/api/works/${w.id}/pipeline/advance`, {
        completedStep: "research", nextStep: "planning",
      }));
      expect(res.status).toBe(410);
    });
  });

  it("PATCH /api/works/:id/evaluation-mode returns 410 (eval gate gone)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(jsonReq("PATCH", `/api/works/${w.id}/evaluation-mode`, {}));
      expect(res.status).toBe(410);
    });
  });
});
```

- [ ] **Step 2: 删除并替换路由**

Edit `src/server/api.ts`：

1. 删除整段 `apiRoutes.post("/api/works/:id/step/:step", ...)`（约 1070-1520 行——一次性 cut）
2. 删除整段 `apiRoutes.post("/api/works/:id/pipeline/advance", ...)`（约 1820-1910 行）
3. 删除 `evaluation-mode` PATCH 路由
4. 删除 `broadcastPipelineUpdate` 函数及其所有调用点（如有）
5. 删除 evaluator 相关 helper：`runEvaluator` / `buildEvaluatorPrompt` 等（如果它们只被被删的路由调用）
6. 删除 `import { evaluateWork } from "../test-evaluator.js"`（仅当只被被删代码用）
7. 用以下 410 stub 取而代之：

```ts
// Legacy stage-coupled routes — removed in D3 cleanup. Always 410 Gone.
// Migration target: POST /api/works/:id/invoke {module, input}
const D3_GONE_BODY = {
  error: "This endpoint was removed (D3). Use POST /api/works/:id/invoke {module, input} instead.",
};

apiRoutes.all("/api/works/:id/step/:step", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/pipeline/advance", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/evaluation-mode", (c) => c.json(D3_GONE_BODY, 410));
```

> 评论里出现 `pipeline/advance` 与 `step/:step` 是为了说明"被替换的旧路径"——这是允许的，sweep 脚本已 exclude 测试与本注释行（subagent 注意：注释里**只有这一处**允许，其它地方仍禁用）。

- [ ] **Step 3: 运行测试**

Run: `npm run test:server -- src/server/__tests__/legacy-routes.test.ts && npm run test:server -- src/server/__tests__/invoke.test.ts`
Expected: 7 passed (3 legacy + 4 invoke)。

- [ ] **Step 4: 类型与构建检查**

Run: `npx tsc --noEmit`
Expected: 0 errors. 如有类型错误（很可能是删了 import 后某个 helper 不存在）一并修复。

- [ ] **Step 5: Commit**

```bash
git add src/server/__tests__/legacy-routes.test.ts src/server/api.ts
git commit -m "refactor(api): remove legacy step/pipeline-advance routes; keep 410 stubs"
```

---

## Task 5: Evaluator 从 gate 降级为 read-only rubric 工具

**目的**：spec §6 第 ⑦ 锚点。`evaluator` 不再阻断推进；agent 可以**主动**调用一个只读端点拿到 rubric 文本，自己决定要不要打分。

**Files:**
- Modify: `src/server/api.ts`（新增 `GET /api/works/:id/rubric/:module`）
- Create: `src/server/__tests__/rubric.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/server/__tests__/rubric.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("GET /api/works/:id/rubric/:module — read-only rubric tool", () => {
  beforeEach(() => vi.resetModules());

  it("returns rubric markdown for a known module", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(new Request(`http://localhost/api/works/${w.id}/rubric/research`));
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j.module).toBe("research");
      expect(typeof j.rubric).toBe("string");
      expect(j.rubric.length).toBeGreaterThan(50);  // taste/06-rubric.md is non-trivial
    });
  });

  it("returns 404 for unknown module", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(new Request(`http://localhost/api/works/${w.id}/rubric/publish`));
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: 实现端点**

在 `src/server/api.ts` 加入：

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../config.js";   // 如果不存在该 export，subagent 需读 config.ts 找等价根目录变量

apiRoutes.get("/api/works/:id/rubric/:module", async (c) => {
  const mod = c.req.param("module");
  if (!KNOWN_MODULES.includes(mod as any)) return c.json({ error: "Unknown module" }, 404);

  const work = await getWork(c.req.param("id"));
  if (!work) return c.json({ error: "Work not found" }, 404);

  const generic = await readFile(join(repoRoot, "skills/autoviral/taste/06-rubric.md"), "utf-8").catch(() => "");
  // 模块特定 rubric 是可选的；缺失就只返回 generic
  const moduleSpecific = await readFile(
    join(repoRoot, `skills/autoviral/taste/evaluator-criteria/${mod}.md`),
    "utf-8",
  ).catch(() => "");

  const rubric = [generic.trim(), moduleSpecific.trim()].filter(Boolean).join("\n\n---\n\n");
  return c.json({ module: mod, rubric });
});
```

> 这个端点是 **read-only**——agent 调用它只是获取 rubric 文本，不写状态、不阻断。spec §6 ⑦ 要求实现。

- [ ] **Step 3: 跑测试**

Run: `npm run test:server -- src/server/__tests__/rubric.test.ts`
Expected: 2 passed。如果 `taste/06-rubric.md` 不存在，subagent 需先验证文件位置（`ls skills/autoviral/taste/`）并写一个最小占位文件（≥ 80 字节）以让测试通过——但这不是本任务真正目的，正常路径文件应该已存在。

- [ ] **Step 4: Commit**

```bash
git add src/server/__tests__/rubric.test.ts src/server/api.ts
git commit -m "feat(api): add read-only rubric tool endpoint (evaluator demoted from gate)"
```

---

## Task 6: `/api/config` 删除 researchEnabled / researchCron 字段

**目的**：UI Plan 1 已经不再读这些字段；后端继续暴露会让 stage 概念藏在配置里。

**Files:**
- Create: `src/server/__tests__/config.test.ts`
- Modify: `src/server/api.ts`（GET / PUT 两处）
- Modify: `src/config.ts`（如果 schema 里仍有 `research` 字段，保留 schema 但不再从 API 暴露——保留是为了让旧 config.yaml 不报错；后续 Plan 5 cutover 再清 schema）

- [ ] **Step 1: 写失败测试**

```ts
// src/server/__tests__/config.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("/api/config — D3 cleanup", () => {
  beforeEach(() => vi.resetModules());

  it("GET response does not contain researchEnabled / researchCron", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(new Request("http://localhost/api/config"));
      const j = await res.json();
      expect(j).not.toHaveProperty("researchEnabled");
      expect(j).not.toHaveProperty("researchCron");
    });
  });

  it("PUT silently ignores legacy researchEnabled / researchCron fields", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("PUT", "/api/config", {
        researchEnabled: true,
        researchCron: "0 9 * * *",
      }));
      expect(res.status).toBe(200);
      const after = await (await apiRoutes.fetch(new Request("http://localhost/api/config"))).json();
      expect(after).not.toHaveProperty("researchEnabled");
      expect(after).not.toHaveProperty("researchCron");
    });
  });
});
```

- [ ] **Step 2: 修改 GET / PUT**

在 `src/server/api.ts` GET `/api/config` 中删除：

```diff
-    researchEnabled: config.research?.enabled ?? false,
-    researchCron: config.research?.schedule ?? "0 9 * * *",
```

PUT `/api/config` 中删除两个 `body.researchEnabled` / `body.researchCron` 分支。

- [ ] **Step 3: 跑测试**

Run: `npm run test:server -- src/server/__tests__/config.test.ts`
Expected: 2 passed。

- [ ] **Step 4: Commit**

```bash
git add src/server/__tests__/config.test.ts src/server/api.ts
git commit -m "refactor(config): drop researchEnabled/researchCron from API surface"
```

---

## Task 7: 重写 `ws-bridge.ts` `getSystemPrompt`（modules-as-capabilities）

**目的**：spec §6 ④。把当前 prompt 中的"当前阶段=X""阶段记录""下一步"措辞全部清掉，换成"modules are capabilities, you may invoke any of them based on user intent"，并保留 plan / 素材生成 / 成品 作为**可选的思维标签**。

**Files:**
- Create: `src/ws-bridge.test.ts`（新增 — getSystemPrompt unit test）
- Modify: `src/ws-bridge.ts`

- [ ] **Step 1: 把 getSystemPrompt 暴露成纯函数**

读现状（`src/ws-bridge.ts:120-240` 区间）。如果 `getSystemPrompt` 是类的私有方法，把它**抽出来**变成 `export function buildSystemPrompt(work: Work, opts: { port: number }): string`。这一步是为了让它能被 unit test。

- [ ] **Step 2: 写失败测试**

Create `src/ws-bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./ws-bridge.js";

const baseWork = (overrides = {}) => ({
  id: "w_test", title: "T", type: "short-video" as const, status: "draft" as const,
  platforms: ["douyin"], createdAt: "2026-04-25T00:00:00Z", updatedAt: "2026-04-25T00:00:00Z",
  ...overrides,
});

describe("buildSystemPrompt", () => {
  const FORBIDDEN = ["currentStep", "当前步骤", "当前阶段", "阶段", "流水线", "下一步", "评审通过"];

  it("contains no forbidden stage/pipeline words", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271 });
    for (const w of FORBIDDEN) {
      expect(p, `prompt should not contain "${w}"`).not.toContain(w);
    }
  });

  it("declares modules as capabilities, not as stages", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271 });
    expect(p).toMatch(/research/);
    expect(p).toMatch(/planning/);
    expect(p).toMatch(/assets/);
    expect(p).toMatch(/assembly/);
    expect(p).toMatch(/能力|capabilities/i);
  });

  it("mentions plan / 素材 / 成品 as optional mental buckets", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271 });
    expect(p).toMatch(/思维|mental bucket/i);
  });

  it("references the new /invoke endpoint, not the old step/{key}", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271 });
    expect(p).toMatch(/\/api\/works\/[^/]+\/invoke/);
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/step\//);
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/pipeline\/advance/);
  });

  it("works for image-text type without referencing video-only modules", () => {
    const p = buildSystemPrompt(baseWork({ type: "image-text" }) as any, { port: 3271 });
    expect(p).toMatch(/图文|image[- ]text/i);
  });
});
```

- [ ] **Step 3: 跑测试确认 fail**

Run: `npm run test:server -- src/ws-bridge.test.ts`
Expected: 5 failed（旧 prompt 含禁词、提到旧端点）。

- [ ] **Step 4: 重写 buildSystemPrompt**

替换 `src/ws-bridge.ts` 中 `getSystemPrompt`（旧实现，约 line 100-240）为以下纯函数。**禁词清单**：subagent 实现完后用 `expect(p).not.toContain(w)` 自检。

```ts
export function buildSystemPrompt(work: Work, opts: { port: number }): string {
  const { port } = opts;
  const isVideo = work.type === "short-video";
  const typeLabel = isVideo ? "短视频 (short-video)" : "图文 (image-text)";

  return `你是 AutoViral 的创作 agent，正在协助用户完成一个 ${typeLabel} 作品。

## 工作方式
你拥有 4 个**能力模块**——它们是工具集，不是顺序：
- **research**：阅读趋势、对标账号、用户已有素材；产出参考资料
- **planning**：把意图转成可执行 brief（脚本/分镜/版式）
- **assets**：生成或获取图/视频/音乐/字体素材（Dreamina / Jimeng / OpenRouter / Lyria / yt-dlp）
- **assembly**：把素材拼装成成片（剪辑 / 字幕 / 混音 / 节拍 / 调色 / 排版）

任意能力都可以**直接调用**，没有前置依赖、没有顺序约束、没有评审门禁。

## 思维标签（可选）
你在内部组织工作时可以借用 **plan / 素材生成 / 成品** 三个思维 bucket 帮自己想清楚——这些是你的 mental bucket，不是面向用户的进度条。用户随时可能跳过其中任意一个：例如他们提供了完整 brief，你应直接进 assets/assembly；他们要试一个素材想法，你也可以只跑 assets。

## 用户意图优先
- 用户说"先看看趋势" → research 能力
- 用户说"我已经有想法了，开始做图" → assets 能力
- 用户说"把这两段视频拼起来加个字幕" → assembly 能力
- 用户说"帮我捋一下叙事" → planning 能力
不要反问"我们应该先做哪一步"，按用户意图直接动手。

## 调用约定
触发新一轮工作请用：
\`POST http://localhost:${port}/api/works/${work.id}/invoke\` \`{module, input}\`

需要参考评审 rubric 时（自评，不强制）：
\`GET http://localhost:${port}/api/works/${work.id}/rubric/<module>\`

作品 ID：${work.id}。作品类型：${typeLabel}。
作品工作目录：data/works/${work.id}/（research/ plan/ assets/ output/ 子目录）

## 风格约束
- 中文优先；技术名词保留英文
- 不向用户讲述"我现在在做哪一步"——直接给结果或问具体问题
- 不输出"流程""阶段""下一步"等顺序词

完成本轮工作后，把产物写入 data/works/${work.id}/ 对应子目录，然后用一句话告诉用户做了什么、看哪里。`;
}
```

注意：函数中**不要**出现禁词（自检：`grep -E '当前步骤|当前阶段|流水线|下一步|评审通过|pipeline/advance' src/ws-bridge.ts` → 0 hits in this function range）。

把原 `getSystemPrompt` 调用点改成 `buildSystemPrompt(work, { port })`。

- [ ] **Step 5: 跑测试**

Run: `npm run test:server -- src/ws-bridge.test.ts`
Expected: 5 passed。

- [ ] **Step 6: Commit**

```bash
git add src/ws-bridge.ts src/ws-bridge.test.ts
git commit -m "refactor(ws-bridge): rewrite system prompt as modules-as-capabilities"
```

---

## Task 8: 删除 ws-bridge 中的 stage 状态广播 / step_divider 事件

**目的**：spec §6 ② / ④ 后半。删除 `currentStep`、删除 `step_divider` / `eval_divider` 事件类型与所有发送点、删除 `loadStepHistory/saveStepHistory` 调用。

**Files:**
- Modify: `src/ws-bridge.ts`
- Modify: `src/ws-bridge.test.ts`（追加测试）
- Modify: `src/work-store.ts`（删除 saveStepHistory/loadStepHistory，假设没别处用——subagent 须 grep 确认）

- [ ] **Step 1: grep 全代码库找残余引用**

Run: `git grep -nE "step_divider|eval_divider|currentStep|saveStepHistory|loadStepHistory|broadcastPipelineUpdate"`
Expected: 列出所有引用点。subagent 须把每一处都处理（可能 ws-bridge.ts 多处，可能还包括 work-store.ts 自身）。

- [ ] **Step 2: 写失败测试**

追加到 `src/ws-bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ALLOWED_STREAM_TYPES } from "./ws-bridge.js";  // 需要 export 一份白名单

describe("WS event types — D3", () => {
  it("does not include step_divider or eval_divider", () => {
    expect(ALLOWED_STREAM_TYPES).not.toContain("step_divider");
    expect(ALLOWED_STREAM_TYPES).not.toContain("eval_divider");
  });
});
```

- [ ] **Step 3: 修改 ws-bridge.ts**

1. 把 `type: "user" | "text" | ... | "step_divider" | "eval_divider"` 改成只剩 `"user" | "text" | "thinking" | "tool_use" | "tool_result"`
2. 顶部 export `export const ALLOWED_STREAM_TYPES = ["user","text","thinking","tool_use","tool_result"] as const;`
3. 删除所有 `wss.send({type:"step_divider", ...})` / `eval_divider` 发送
4. 删除所有 `currentStep` / `Object.entries(work.pipeline)` 计算
5. 删除所有 `saveStepHistory` / `loadStepHistory` 调用——历史记录改为整段 chat（已有 saveWorkChat）

- [ ] **Step 4: 删除 work-store.ts 中的 saveStepHistory / loadStepHistory**

```bash
# subagent 在 work-store.ts 删除以下两个函数（约 line 283-298）
# 同时确认 import 链：grep -rn "saveStepHistory\|loadStepHistory" src/ web/
```

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `npm run test:server && npx tsc --noEmit`
Expected: all green。

- [ ] **Step 6: Commit**

```bash
git add src/ws-bridge.ts src/ws-bridge.test.ts src/work-store.ts
git commit -m "refactor(ws): drop step_divider/eval_divider events and step history I/O"
```

---

## Task 9: 从 `Work` 类型抹掉 stage-coupled 字段

**目的**：spec §6 ⑤。删除 `pipeline` / `evaluationMode` / `evalSessionIds` / `evalAttempts` 4 个字段；保留 `cliSessionId`（不是 stage）。

**Files:**
- Modify: `src/work-store.ts`
- Create: `src/work-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/work-store.test.ts
import { describe, it, expect } from "vitest";
import { withTempDataDir } from "./server/__tests__/_helpers.js";

describe("work-store — D3 type cleanup", () => {
  it("createWork no longer attaches pipeline / evaluationMode / eval* fields", async () => {
    await withTempDataDir(async () => {
      const { createWork, getWork } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      expect(w).not.toHaveProperty("pipeline");
      expect(w).not.toHaveProperty("evaluationMode");
      expect(w).not.toHaveProperty("evalSessionIds");
      expect(w).not.toHaveProperty("evalAttempts");

      const reloaded = await getWork(w.id);
      expect(reloaded).not.toHaveProperty("pipeline");
    });
  });

  it("updateWork strips legacy pipeline if passed in", async () => {
    await withTempDataDir(async () => {
      const { createWork, updateWork } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      // Simulate old caller still sending pipeline — should be ignored, not stored
      const out = await updateWork(w.id, { pipeline: { research: { name: "x", status: "done" } } } as any);
      expect(out).not.toHaveProperty("pipeline");
    });
  });
});
```

- [ ] **Step 2: 修改 Work 接口与 createWork / updateWork**

```diff
 export interface Work {
   id: string;
   title: string;
   type: WorkType;
   contentCategory?: ContentCategory;
   videoSource?: VideoSource;
   videoSearchQuery?: string;
   status: WorkStatus;
   platforms: string[];
-  pipeline: Record<string, PipelineStep>;
   cliSessionId?: string;
   coverImage?: string;
   topicHint?: string;
-  evaluationMode?: boolean;
-  evalSessionIds?: Record<string, string>;
-  evalAttempts?: Record<string, number>;
   createdAt: string;
   updatedAt: string;
 }
```

删除 `defaultPipeline()` 函数；createWork 不再调用它。

updateWork 做白名单：

```ts
const STRIP_KEYS = ["pipeline", "evaluationMode", "evalSessionIds", "evalAttempts"] as const;
export async function updateWork(id: string, updates: Partial<Work>): Promise<Work | undefined> {
  const work = await readWorkFile(id);
  if (!work) return undefined;
  const cleaned: any = { ...updates };
  for (const k of STRIP_KEYS) delete cleaned[k];
  const updated: Work = { ...work, ...cleaned, id, updatedAt: new Date().toISOString() };
  // ...rest unchanged
}
```

`PipelineStep` interface 整段删除（spec §6 ⑤ 数据字段一次性 migration 抹除）。注意：`saveEvalResult` / `loadEvalResult` / `EvalResult` 仍保留，因为它们对应 §6 ⑦ 中"agent 主动调用 evaluator 当工具"的产物存档——但路径从 stage-bound 变为 agent 自主写。subagent 自行评估保留与否；保留的话不再被 task 7 的 evaluator gate 调用。

- [ ] **Step 3: 跑测试 + 全量类型检查**

Run: `npm run test:server && npx tsc --noEmit`
Expected: 全绿；如果 tsc 报别处用了 `work.pipeline`，subagent 全部修掉。

- [ ] **Step 4: Commit**

```bash
git add src/work-store.ts src/work-store.test.ts
git commit -m "refactor(work-store): drop pipeline/evaluation fields from Work type"
```

---

## Task 10: Migration 脚本 `migrations/strip-pipeline.ts`

**目的**：一次性把 `data/works/**/work.yaml` 中已存在的 4 个字段抹掉，**先 dump 备份再 strip**（spec §14 强制要求）。Plan 5 cutover 时执行；现在只写脚本和测试。

**Files:**
- Create: `migrations/strip-pipeline.ts`
- Create: `migrations/strip-pipeline.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// migrations/strip-pipeline.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { withTempDataDir } from "../src/server/__tests__/_helpers.js";

describe("strip-pipeline migration", () => {
  beforeEach(() => vi.resetModules());

  it("strips pipeline + evaluationMode + eval* and dumps a backup .bak.yaml first", async () => {
    await withTempDataDir(async (dir) => {
      const wDir = join(dir, "works", "w_old");
      await mkdir(wDir, { recursive: true });
      const old = {
        id: "w_old", title: "Legacy", type: "short-video", status: "draft", platforms: ["douyin"],
        pipeline: { research: { name: "调研", status: "done" } },
        evaluationMode: true, evalSessionIds: { research: "s1" }, evalAttempts: { research: 2 },
        createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z",
      };
      await writeFile(join(wDir, "work.yaml"), yaml.dump(old), "utf-8");

      const { run } = await import("./strip-pipeline.js");
      await run({ dataDir: dir, dryRun: false });

      // Verify cleaned
      const cleaned = yaml.load(await readFile(join(wDir, "work.yaml"), "utf-8")) as any;
      expect(cleaned).not.toHaveProperty("pipeline");
      expect(cleaned).not.toHaveProperty("evaluationMode");
      expect(cleaned).not.toHaveProperty("evalSessionIds");
      expect(cleaned).not.toHaveProperty("evalAttempts");
      expect(cleaned.title).toBe("Legacy");

      // Verify backup exists
      const files = await readdir(wDir);
      expect(files.some((f) => f.endsWith(".bak.yaml"))).toBe(true);
    });
  });

  it("dryRun=true does not modify files", async () => {
    await withTempDataDir(async (dir) => {
      const wDir = join(dir, "works", "w_dry");
      await mkdir(wDir, { recursive: true });
      const old = { id: "w_dry", title: "D", pipeline: { x: { name: "x", status: "done" } } } as any;
      await writeFile(join(wDir, "work.yaml"), yaml.dump(old), "utf-8");

      const { run } = await import("./strip-pipeline.js");
      const report = await run({ dataDir: dir, dryRun: true });

      const after = yaml.load(await readFile(join(wDir, "work.yaml"), "utf-8")) as any;
      expect(after).toHaveProperty("pipeline");  // untouched
      expect(report.wouldStrip).toBe(1);
    });
  });
});
```

- [ ] **Step 2: 实现脚本**

Create `migrations/strip-pipeline.ts`:

```ts
import { readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";

const STRIP_KEYS = ["pipeline", "evaluationMode", "evalSessionIds", "evalAttempts"] as const;

export interface RunOpts { dataDir: string; dryRun?: boolean; }
export interface RunReport { scanned: number; wouldStrip: number; stripped: number; backups: string[]; }

export async function run({ dataDir, dryRun = false }: RunOpts): Promise<RunReport> {
  const worksDir = join(dataDir, "works");
  let entries: string[] = [];
  try { entries = await readdir(worksDir); } catch { return { scanned: 0, wouldStrip: 0, stripped: 0, backups: [] }; }

  const report: RunReport = { scanned: 0, wouldStrip: 0, stripped: 0, backups: [] };

  for (const id of entries) {
    const file = join(worksDir, id, "work.yaml");
    let raw: string;
    try { raw = await readFile(file, "utf-8"); } catch { continue; }
    report.scanned++;

    const obj = yaml.load(raw) as Record<string, unknown> | null;
    if (!obj) continue;
    const hasLegacy = STRIP_KEYS.some((k) => k in obj);
    if (!hasLegacy) continue;

    if (dryRun) { report.wouldStrip++; continue; }

    // 1) backup
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = join(worksDir, id, `work.${ts}.bak.yaml`);
    await copyFile(file, bak);
    report.backups.push(bak);

    // 2) strip
    for (const k of STRIP_KEYS) delete obj[k];
    await writeFile(file, yaml.dump(obj, { lineWidth: -1, sortKeys: false }), "utf-8");
    report.stripped++;
  }

  return report;
}

// CLI entry: `tsx migrations/strip-pipeline.ts [--dry-run]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = process.env.AUTOVIRAL_DATA_DIR ?? "./data";
  const dryRun = process.argv.includes("--dry-run");
  run({ dataDir, dryRun }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
```

- [ ] **Step 3: 跑测试**

Run: `npm run test:server -- migrations/strip-pipeline.test.ts`
Expected: 2 passed。

- [ ] **Step 4: Commit**

```bash
git add migrations/strip-pipeline.ts migrations/strip-pipeline.test.ts
git commit -m "feat(migration): one-shot strip-pipeline script with backup-first semantic"
```

---

## Task 11: Skill 措辞清洗（强约束：先读 obra/superpowers + garrytan/gstack）

**目的**：spec §11。改 6 个 skill 文档：
- `skills/autoviral/SKILL.md`
- `skills/autoviral/taste/00-prime-directive.md`（如有 stage 暗示）
- `skills/autoviral/taste/05-creative-schema.md`
- `skills/autoviral/modules/research/SKILL.md`
- `skills/autoviral/modules/planning/SKILL.md`
- `skills/autoviral/modules/assets/SKILL.md`
- `skills/autoviral/modules/assembly/SKILL.md`

**Files:** 上述 6 个文档；不创建新文件。

- [ ] **Step 1: 读已 fetch 的业界 skill 模板**

Subagent 必须打开 `docs/superpowers/notes/2026-04-27-skill-references.md`（Task 1 产物），把里面摘要的 imperative voice / red flags / process flow 模板放在心里再动笔。

- [ ] **Step 2: grep 找当前 stage 暗示词**

Run: `grep -rn "阶段\|流水线\|step\|stage\|phase\|pipeline\|下一步\|先.*然后\|第一步\|下一阶段" skills/autoviral/SKILL.md skills/autoviral/taste/00-prime-directive.md skills/autoviral/taste/05-creative-schema.md skills/autoviral/modules/*/SKILL.md`

把命中表保存为 baseline。

- [ ] **Step 3: 编辑每个文件**

**通用编辑规则**：
- 任何"先 research 再 planning"等顺序句改写为"按用户意图调用对应模块"
- 模块定义保留为"做什么 / 何时用 / 怎么用"三段
- 加一段 "When NOT this module" 段，鼓励横跳
- 顶部 description（YAML frontmatter）必须包含 "use when" 句式（superpowers 风格）

**示例重写（research/SKILL.md description 行）**：

```yaml
---
name: research
description: Use when the user wants references — viral patterns, competitor analysis, audience signals, hot topics on a specific platform. Do NOT use this as a "first step"; if the user already has a brief, skip directly to planning or assets.
---
```

**示例重写（modules/research/SKILL.md 主体首段）**：

```markdown
# research — 参考资料能力

研究模块产出参考资料，不产出最终内容。它存在的目的是让你（agent）在模糊意图面前快速建立对标基础。

## 何时调用
- 用户说 "看看现在什么火"
- 用户说 "对标账号有没有共性"
- 用户说 "我想做个 X 主题，先了解一下"

## 何时不调用
- 用户已给出具体 brief / 脚本 → 直接 planning 或 assets
- 用户已上传素材 → 直接 assembly
- 用户只是想"快速试一版"→ 直接 assets

## 工具
- 平台 trending：/api/trends/:platform
- 用户记忆：/api/memory/profile
- 长文搜索：WebFetch + WebSearch

输出落 \`data/works/<id>/research/\`，纯 markdown，每篇 ≤ 200 字摘要 + 链接。
```

类似地改 `planning/SKILL.md`、`assets/SKILL.md`、`assembly/SKILL.md`。每个模块的 "何时不调用" 段是新增的横跳引导。

`skills/autoviral/SKILL.md` 主入口顶层段移除任何"流程"图，把它改成"4 个能力（capabilities）+ 7 篇 taste 内化读物"的描述图：

```markdown
## 调用模式
modules/ 下 4 个能力是**正交**的：
- research（参考） / planning（brief） / assets（素材） / assembly（成片）

任何能力都能做起点。判断顺序的依据**只有用户意图**，不是流程。

## 思维 bucket（可选）
内部组织时你可以用 plan / 素材生成 / 成品 三个标签帮自己想清楚——这些是 mental bucket，不是 UI 进度，更不暴露给用户。
```

`taste/05-creative-schema.md` 中如有 `phase`/`step` 字段名，改为 `note` / `intent` 等中性词。

- [ ] **Step 4: 自检 D3 词典**

Run: `./scripts/check-d3-words.sh`
Expected: skill 目录下 0 hits（除被允许的 spec/plan 文档外）。

- [ ] **Step 5: 类型检查不变（skill 是文档不影响构建）**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 6: Commit**

```bash
git add skills/autoviral/SKILL.md skills/autoviral/taste/ skills/autoviral/modules/
git commit -m "docs(skills): rewrite as modules-as-capabilities (D3); add When-NOT sections"
```

---

## Task 12: D3 sweep 全量验证 + Plan 1 e2e 不回退

**目的**：把禁词 sweep、单元测试、构建、e2e 全跑一遍，证明本 plan 没有回退。

- [ ] **Step 1: D3 sweep**

Run: `./scripts/check-d3-words.sh`
Expected: `D3 sweep clean.`

- [ ] **Step 2: 后端 unit + 前端 unit + 类型 + 构建**

Run:
```bash
npm run test:server
npm run test:web
npx tsc --noEmit
npm run build      # 或 vite build for web; subagent 自行匹配项目脚本
```

Expected: 全绿。

- [ ] **Step 3: 跑 Plan 1 的 3 条 Playwright e2e**

Run: `npm run e2e`
Expected: 3/3 通过。如果某条需要 backend 起，subagent 用 `npm run dev &` 后台跑，跑完 kill。

- [ ] **Step 4: tag**

```bash
git tag plan4-backend-d3-complete
```

- [ ] **Step 5: Commit ledger sanity**

Run: `git log --oneline plan1-scaffold-complete..HEAD`
Expected: 11-12 commits，全部 conventional commits 格式，无禁词。

---

## Task 13: 最终 review

调度 final code-reviewer subagent 对整个 Plan 4 落地做一次端到端 review，重点检查：
- D3 词典是否真的零残留
- evaluator demote 后是否仍有死代码（test-evaluator.ts 是否被用到）
- ws-bridge 重写后 prompt 是否仍能在真实 chat 中产生合理输出（subagent 跑一次本地起 + curl `POST /api/works/<id>/invoke`）
- migration 脚本备份策略是否覆盖 corner case（空 works 目录、损坏 yaml）

review 通过后本 plan 完结。
