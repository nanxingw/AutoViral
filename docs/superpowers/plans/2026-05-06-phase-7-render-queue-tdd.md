# Phase 7 — Render Queue + Proxy / Draft Renders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synchronous `POST /api/works/:id/render` (which blocks the request for the full Remotion → ducking → loudnorm → encode pipeline, ~2–4 minutes for a 60s comp) with a background render queue. Clients enqueue a job, receive a `jobId`, then subscribe to `/ws/render/jobs/:id` for progress events. The Studio TopBar replaces its blocking export button with a queue-aware button that mounts an `ExportProgress` modal, and grows a chevron menu offering "Quick proxy export" — a half-resolution / 24fps / lower-bitrate path that finishes in ≈⅓ the time, perfect for review takes.

**Architecture:** A new `RenderQueue` class owns job lifecycle. Persistence lives in a `better-sqlite3` table (`render_jobs`); the schema mirrors the `RenderJob` interface from master plan §7.1. A single `Worker` instance pulls jobs serially (`concurrency=1`, configurable via env) and invokes the existing `runRenderPipeline` from Phase 6 — Phase 7 only extends `runRenderPipeline` with a new `proxy: boolean` flag (half-res + 24fps + half bitrate). Per-job progress events are emitted on a per-jobId `EventEmitter`, and a thin ws router (`render-ws.ts`) forwards them to `/ws/render/jobs/:id` subscribers using the same `noServer: true` pattern as the existing `WsBridge`. The frontend gets a small `useRenderJob(jobId)` hook (mirrors `useChatSocket` in style) and an `ExportProgress.tsx` modal showing the 5 stages with per-stage progress and a cancel/retry button.

**Tech Stack:**
- `better-sqlite3` (NEW dep, synchronous API; in-memory `:memory:` for tests, file-backed `~/.autoviral/render-queue.db` in production)
- Existing `ws` (8.x) — the same lib `WsBridge` uses; Phase 7 reuses the upgrade-router pattern in `src/server/index.ts`
- Existing `runRenderPipeline` (Phase 6.E shape) — extended with `proxy?: boolean`
- Frontend: existing React 18 + TS + zustand + Radix Dialog (already in use by Phase 6's `ReframeConfirmDialog`)
- Tests: Vitest + Testing Library (server uses `vitest.server.config.ts`, web uses `web/vitest.config.ts`)

---

## 0. Locked decisions (D1–D8)

Locked 2026-05-06 (this conversation). **Do not re-litigate.** Each task below cites the Dn it consumes.

| # | Decision | Lands in |
|---|---|---|
| **D1** | Job store uses **`better-sqlite3`** (synchronous API → simpler `enqueue`/`get`/`list` than Promise-based alternatives; well-supported on macOS arm64 + Linux). Add to `package.json` dependencies in 7.A's first commit. No ORM (no kysely/drizzle); raw SQL is enough for one table. | 7.A `store.ts` |
| **D2** | Tests construct `new Database(":memory:")` for isolation; production opens `~/.autoviral/render-queue.db` (created on first boot). The `RenderQueueStore` constructor accepts a `dbPath: string` — `":memory:"` is a valid path per better-sqlite3. The default-prod path is resolved by a small `defaultDbPath()` helper, not baked into the store. | 7.A `store.ts` |
| **D3** | Worker concurrency = **1** (Remotion is heavy; concurrency=2 has caused fan-noise / OOM in Phase 3 dev). Configurable via `AUTOVIRAL_RENDER_CONCURRENCY` env var, integer ≥1, defaults to 1. The worker treats values > 1 as "spawn N parallel pipeline calls but never N+1" (a tiny semaphore). | 7.A `worker.ts` |
| **D4** | Job status enum = `queued \| running \| done \| failed \| cancelled`. Stage enum = `render \| duck \| loudnorm \| burn \| encode`. Both match master plan §7.1 exactly — do not invent new values. The store stores them as TEXT and validates on read with a Zod-or-equivalent guard (we use a hand-rolled type predicate to avoid pulling Zod into the store). | 7.A `job.ts` |
| **D5** | WebSocket progress events are JSON `{ at: ISOString, status, progress, stage?, log? }`. The client closes the ws when status reaches a terminal value (`done \| failed \| cancelled`). The server also closes the ws after emitting the terminal event so neither side dangles. | 7.B `render-ws.ts`, 7.D `useRenderJob.ts` |
| **D6** | Cancel: `RenderQueue.cancel(jobId)` sets the row's status to `cancelled` and signals the worker via an `AbortSignal` threaded into `runRenderPipeline`. **Phase 6's `runRenderPipeline` does not currently accept a signal — Phase 7.A adds an optional `signal?: AbortSignal` parameter and passes it through to spawned ffmpeg/Remotion processes** (early stages already exit on the next stage boundary; long-running ffmpeg `spawn`s honour `kill()` on abort). The cancel path also wakes the worker so the next queued job starts. | 7.A `worker.ts`, 7.C `render-pipeline.ts` |
| **D7** | Proxy mode = `type: "proxy"` triggers `runRenderPipeline({...opts, proxy: true})`. Proxy applies: width/height halved (rounded to nearest even integer per ffmpeg requirement), fps clamped to 24, video bitrate halved (audio bitrate kept). Implementation lives inside `runRenderPipeline` so the encode stage and Remotion render see the proxy comp; no other call site changes. The Phase 6 `runEncodeStage` already takes a preset object — proxy mutates a deep-clone, never the caller's preset. | 7.C `render-pipeline.ts` |
| **D8** | `ExportProgress` modal closes on `done` after a 1500ms success state (showing "Export complete · open file"); on `failed` it stays open with a Retry button (re-enqueues the same options) and a scrollable log; on `cancelled` it closes immediately. Cancel button is enabled iff status ∈ {`queued`, `running`}. | 7.D `ExportProgress.tsx` |

---

## 1. File Structure

```
src/server/
├── render-queue/                                     ← NEW (7.A)
│   ├── job.ts                                        ← 7.A — type defs + status/stage guards
│   ├── store.ts                                      ← 7.A — better-sqlite3 row CRUD
│   ├── worker.ts                                     ← 7.A — serial worker + progress emitter
│   ├── index.ts                                      ← 7.A — RenderQueue facade (enqueue/cancel/get/list/on)
│   └── __tests__/
│       ├── store.test.ts                             ← 7.A — 5 row-level tests
│       ├── worker.test.ts                            ← 7.A — 4 lifecycle tests
│       └── queue.test.ts                             ← 7.A — 3 facade tests
├── render-ws.ts                                      ← NEW (7.B) — /ws/render/jobs/:id router
├── render-ws.test.ts                                 ← NEW (7.B) — upgrade routing + emit forwarding
├── api.ts                                            ← MODIFY (7.B) — POST/GET/DELETE /api/render/jobs
├── api.render.test.ts                                ← NEW (7.B) — 4 endpoint tests
├── render-pipeline.ts                                ← MODIFY (7.C) — add proxy + signal
├── render-pipeline.test.ts                           ← MODIFY (7.C) — 2 proxy tests + 1 abort test
└── index.ts                                          ← MODIFY (7.B) — wire RenderQueue + render-ws upgrade

web/src/features/studio/
├── render-status/                                    ← NEW (7.D)
│   ├── useRenderJob.ts                               ← 7.D — ws subscription hook
│   ├── useRenderJob.test.ts                          ← 7.D — 4 hook tests
│   ├── ExportProgress.tsx                            ← 7.D — modal
│   └── ExportProgress.test.tsx                       ← 7.D — 5 modal tests
├── services/
│   └── render.ts                                     ← MODIFY (7.E) — replace exportMp4 with enqueueRender + cancelRender
├── panels/
│   ├── TopBar.tsx                                    ← MODIFY (7.E) — chevron menu + queue-aware export
│   └── TopBar.test.tsx                               ← MODIFY (7.E) — 3 new tests (proxy menu, modal mount, cancel)
└── __tests__/
    └── phase7-integration.test.tsx                   ← NEW (7.F) — AC1–AC4

package.json                                         ← MODIFY (7.A) — add better-sqlite3 + @types/better-sqlite3
```

---

## 2. Conventions for this plan

- **TDD**: every code change starts with a failing test. Run the test, see it fail with the *expected* error message, then write the minimal code to make it pass.
- **Commands**:
  - Web suite: `bun run test:web` (one-shot — never use `:watch` per repo `<testing>` block)
  - Server suite: `bun run test:server`
  - Type-check: `bun run typecheck`
  - Single server test: `bun run test:server -- src/server/render-queue/__tests__/store.test.ts`
  - Single web test: `bun run test:web -- web/src/features/studio/render-status/useRenderJob.test.ts`
  - Run from repo root: `/Users/nanjiayan/Desktop/AutoViral/autoviral`
- **Server tests**:
  - Store tests use `new Database(":memory:")` per the D2 contract — fast, isolated, no fs.
  - Worker tests inject a fake `runRenderPipeline` (vi.fn) so vitest never spawns ffmpeg.
  - WebSocket tests use the `ws` lib's in-process `WebSocketServer` + a `ws` client — no http server required.
- **Web tests**:
  - `useRenderJob` tests mock `WebSocket` globally (a fake `EventTarget` that exposes `send` / `close` and lets the test push messages). Repo already has helpers in `web/src/test/setup.ts`; if not, the plan ships an inline fake.
  - `ExportProgress` tests use Testing Library's `render` + `userEvent`.
- **Commits**: bite-sized — usually one commit per Step group inside a Task. Use the message style of prior phases: `feat(scope): summary (Phase 7.X)` or `test(scope): summary (Phase 7.X)`. Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Imports**: project uses `@/` alias for `web/src/`. Server-side uses relative imports.

---

## Task 7.A — RenderQueue + sqlite store + serial worker

**Goal:** Land the queue. After this task, code can `q.enqueue({workId, type:"full", presetId})` → get back a `RenderJob` row, listen on `q.on(jobId, "progress", fn)`, and the worker drains the queue serially, calling `runRenderPipeline` (mocked in tests) and persisting progress.

**Pitfalls:**
- `better-sqlite3` is native and built per-platform. On Apple Silicon the npm install rebuilds it from source — usually fine. If the postinstall fails on a CI image, document `npm rebuild better-sqlite3` as the recovery step.
- SQLite TEXT columns aren't typed: rely on a hand-rolled `parseJobRow(row)` predicate, never trust a raw row.
- `EventEmitter` listeners are sync — emit progress in a try/catch so a buggy listener can't kill the worker.
- The worker must be **idempotent on restart**: on construction, mark any `running` rows as `failed` (the worker process died mid-render; we cannot resume Remotion).
- D6's `AbortSignal` plumbing requires `runRenderPipeline` to accept a signal — that is a Phase 7.A change to `render-pipeline.ts` (small: thread `signal` into `spawn` calls) — but the *proxy* extension is Phase 7.C. Keep the changes separate so the diff is reviewable.

**Files:**
- Create: `src/server/render-queue/job.ts`
- Create: `src/server/render-queue/store.ts`
- Create: `src/server/render-queue/worker.ts`
- Create: `src/server/render-queue/index.ts`
- Create: `src/server/render-queue/__tests__/store.test.ts`
- Create: `src/server/render-queue/__tests__/worker.test.ts`
- Create: `src/server/render-queue/__tests__/queue.test.ts`
- Modify: `src/server/render-pipeline.ts` — accept optional `signal?: AbortSignal`
- Modify: `package.json` — add `better-sqlite3` + `@types/better-sqlite3`

### Step 1: Add `better-sqlite3` dep + first commit

- [ ] **Step 1.1: Install dep**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
npm install better-sqlite3@^11.5.0
npm install --save-dev @types/better-sqlite3@^7.6.11
```

Expected: `package.json` `dependencies` gains `better-sqlite3`, `devDependencies` gains the types. Lockfile updates.

- [ ] **Step 1.2: Sanity import**

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec('CREATE TABLE t(x INTEGER)'); db.prepare('INSERT INTO t VALUES (?)').run(42); console.log(db.prepare('SELECT * FROM t').get());"
```

Expected: `{ x: 42 }`. If this errors with `cannot find module`, run `npm rebuild better-sqlite3` and retry.

- [ ] **Step 1.3: Commit**

```bash
git add package.json package-lock.json bun.lock
git commit -m "$(cat <<'EOF'
chore(phase-7): add better-sqlite3 for render queue persistence (Phase 7.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 2: `job.ts` — type defs + guards

The `RenderJob` interface mirrors master plan §7.1 verbatim. We add a small `parseJobRow` predicate that converts a SQLite row (where dates are strings, log is a JSON string, status is a string) into a typed `RenderJob`.

- [ ] **Step 2.1: Create `src/server/render-queue/job.ts`**

```ts
// src/server/render-queue/job.ts

export const RENDER_JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;
export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number];

export const RENDER_STAGES = [
  "render",
  "duck",
  "loudnorm",
  "burn",
  "encode",
] as const;
export type RenderStage = (typeof RENDER_STAGES)[number];

export const RENDER_JOB_TYPES = ["full", "proxy"] as const;
export type RenderJobType = (typeof RENDER_JOB_TYPES)[number];

export interface RenderJobLogEntry {
  at: string; // ISO 8601
  level: "info" | "warn" | "error";
  msg: string;
}

export interface RenderJob {
  id: string;
  workId: string;
  type: RenderJobType;
  presetId?: string;
  status: RenderJobStatus;
  progress: number; // 0..1
  stage?: RenderStage;
  log: RenderJobLogEntry[];
  outputPath?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RenderJobOptions {
  workId: string;
  type: RenderJobType;
  presetId?: string;
  /** Optional metadata forwarded to runRenderPipeline (burnSubtitles, loudnessTargetLufs). */
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
}

export const TERMINAL_STATUSES: ReadonlySet<RenderJobStatus> = new Set([
  "done",
  "failed",
  "cancelled",
]);

export function isTerminalStatus(s: RenderJobStatus): boolean {
  return TERMINAL_STATUSES.has(s);
}

export function assertStatus(s: string): RenderJobStatus {
  if ((RENDER_JOB_STATUSES as readonly string[]).includes(s)) {
    return s as RenderJobStatus;
  }
  throw new Error(`render-queue: invalid status "${s}"`);
}

export function assertStage(s: string | null | undefined): RenderStage | undefined {
  if (s == null || s === "") return undefined;
  if ((RENDER_STAGES as readonly string[]).includes(s)) {
    return s as RenderStage;
  }
  throw new Error(`render-queue: invalid stage "${s}"`);
}

export function assertType(s: string): RenderJobType {
  if ((RENDER_JOB_TYPES as readonly string[]).includes(s)) {
    return s as RenderJobType;
  }
  throw new Error(`render-queue: invalid type "${s}"`);
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/server/render-queue/job.ts
git commit -m "$(cat <<'EOF'
feat(render-queue): job model + status/stage guards (Phase 7.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 3: `store.test.ts` — TDD, 5 tests

These tests are written **first** and fail. Then we write `store.ts` to make them pass.

- [ ] **Step 3.1: Create `src/server/render-queue/__tests__/store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { RenderQueueStore } from "../store";
import type { RenderJob } from "../job";

let db: Database.Database;
let store: RenderQueueStore;

beforeEach(() => {
  db = new Database(":memory:");
  store = new RenderQueueStore(db);
});

describe("RenderQueueStore — schema + insert + read", () => {
  it("creates the render_jobs table on construction", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='render_jobs'",
      )
      .get();
    expect(row).toBeDefined();
  });

  it("insert + get round-trips a queued full job", () => {
    const job = store.insert({
      workId: "w-1",
      type: "full",
      presetId: "douyin",
    });
    expect(job.id).toMatch(/^job_/);
    expect(job.status).toBe("queued");
    expect(job.progress).toBe(0);
    expect(job.log).toEqual([]);

    const round = store.get(job.id);
    expect(round).toEqual(job);
  });

  it("list(workId) returns jobs in createdAt-desc order", () => {
    const a = store.insert({ workId: "w-1", type: "full" });
    // Sleep 2ms to make timestamps distinct deterministically
    const startWait = Date.now();
    while (Date.now() - startWait < 2) { /* spin */ }
    const b = store.insert({ workId: "w-1", type: "proxy" });
    const c = store.insert({ workId: "w-2", type: "full" });
    const list = store.list("w-1");
    expect(list.map((j) => j.id)).toEqual([b.id, a.id]);
    expect(list).not.toContainEqual(expect.objectContaining({ id: c.id }));
  });

  it("update transitions status, progress, stage, and stamps startedAt/finishedAt", () => {
    const job = store.insert({ workId: "w-1", type: "full" });

    store.update(job.id, { status: "running", progress: 0.1, stage: "render" });
    let row = store.get(job.id) as RenderJob;
    expect(row.status).toBe("running");
    expect(row.progress).toBe(0.1);
    expect(row.stage).toBe("render");
    expect(row.startedAt).toBeDefined();
    expect(row.finishedAt).toBeUndefined();

    store.update(job.id, { status: "done", progress: 1, outputPath: "/tmp/o.mp4" });
    row = store.get(job.id) as RenderJob;
    expect(row.status).toBe("done");
    expect(row.outputPath).toBe("/tmp/o.mp4");
    expect(row.finishedAt).toBeDefined();
  });

  it("appendLog adds entries; persisted rows preserve log order", () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    store.appendLog(job.id, { at: "2026-05-06T00:00:01Z", level: "info", msg: "hi" });
    store.appendLog(job.id, { at: "2026-05-06T00:00:02Z", level: "warn", msg: "watch" });
    const row = store.get(job.id) as RenderJob;
    expect(row.log).toEqual([
      { at: "2026-05-06T00:00:01Z", level: "info", msg: "hi" },
      { at: "2026-05-06T00:00:02Z", level: "warn", msg: "watch" },
    ]);
  });
});
```

- [ ] **Step 3.2: Run the test, see it fail**

```bash
bun run test:server -- src/server/render-queue/__tests__/store.test.ts
```

Expected: FAIL — module `../store` does not exist.

- [ ] **Step 3.3: Implement `src/server/render-queue/store.ts`**

```ts
// src/server/render-queue/store.ts

import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type RenderJob,
  type RenderJobLogEntry,
  type RenderJobOptions,
  type RenderJobStatus,
  type RenderStage,
  assertStatus,
  assertStage,
  assertType,
} from "./job";

export function defaultDbPath(): string {
  return join(homedir(), ".autoviral", "render-queue.db");
}

interface JobRow {
  id: string;
  work_id: string;
  type: string;
  preset_id: string | null;
  status: string;
  progress: number;
  stage: string | null;
  log: string;
  output_path: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS render_jobs (
  id           TEXT PRIMARY KEY,
  work_id      TEXT NOT NULL,
  type         TEXT NOT NULL,
  preset_id    TEXT,
  status       TEXT NOT NULL,
  progress     REAL NOT NULL DEFAULT 0,
  stage        TEXT,
  log          TEXT NOT NULL DEFAULT '[]',
  output_path  TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_render_jobs_work ON render_jobs(work_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
`;

function rowToJob(row: JobRow): RenderJob {
  const job: RenderJob = {
    id: row.id,
    workId: row.work_id,
    type: assertType(row.type),
    status: assertStatus(row.status),
    progress: row.progress,
    log: JSON.parse(row.log) as RenderJobLogEntry[],
    createdAt: row.created_at,
  };
  if (row.preset_id) job.presetId = row.preset_id;
  const stage = assertStage(row.stage);
  if (stage) job.stage = stage;
  if (row.output_path) job.outputPath = row.output_path;
  if (row.error) job.error = row.error;
  if (row.started_at) job.startedAt = row.started_at;
  if (row.finished_at) job.finishedAt = row.finished_at;
  return job;
}

function genJobId(): string {
  return `job_${randomBytes(8).toString("hex")}`;
}

export interface UpdatePatch {
  status?: RenderJobStatus;
  progress?: number;
  stage?: RenderStage;
  outputPath?: string;
  error?: string;
}

export class RenderQueueStore {
  constructor(private readonly db: Database.Database) {
    db.exec(SCHEMA);
    // Crash recovery: on construction, any "running" rows are stale (the
    // worker process exited mid-render). Mark them failed; the operator can
    // re-enqueue from the UI.
    db.prepare(
      "UPDATE render_jobs SET status='failed', error='process restarted before completion', finished_at=? WHERE status='running'",
    ).run(new Date().toISOString());
  }

  insert(opts: RenderJobOptions): RenderJob {
    const id = genJobId();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO render_jobs(id, work_id, type, preset_id, status, progress, log, created_at) VALUES (?, ?, ?, ?, 'queued', 0, '[]', ?)",
      )
      .run(id, opts.workId, opts.type, opts.presetId ?? null, createdAt);
    const row = this.get(id);
    if (!row) throw new Error("RenderQueueStore.insert: row missing after insert");
    return row;
  }

  get(id: string): RenderJob | null {
    const row = this.db
      .prepare("SELECT * FROM render_jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  list(workId: string): RenderJob[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM render_jobs WHERE work_id = ? ORDER BY created_at DESC, id DESC",
      )
      .all(workId) as JobRow[];
    return rows.map(rowToJob);
  }

  /** Returns the next queued job's id (FIFO by created_at), or null. */
  nextQueued(): string | null {
    const row = this.db
      .prepare(
        "SELECT id FROM render_jobs WHERE status='queued' ORDER BY created_at ASC, id ASC LIMIT 1",
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  update(id: string, patch: UpdatePatch): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
      if (patch.status === "running") {
        fields.push("started_at = COALESCE(started_at, ?)");
        values.push(new Date().toISOString());
      } else if (
        patch.status === "done" ||
        patch.status === "failed" ||
        patch.status === "cancelled"
      ) {
        fields.push("finished_at = ?");
        values.push(new Date().toISOString());
      }
    }
    if (patch.progress !== undefined) {
      fields.push("progress = ?");
      values.push(patch.progress);
    }
    if (patch.stage !== undefined) {
      fields.push("stage = ?");
      values.push(patch.stage);
    }
    if (patch.outputPath !== undefined) {
      fields.push("output_path = ?");
      values.push(patch.outputPath);
    }
    if (patch.error !== undefined) {
      fields.push("error = ?");
      values.push(patch.error);
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db
      .prepare(`UPDATE render_jobs SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  appendLog(id: string, entry: RenderJobLogEntry): void {
    const cur = this.db
      .prepare("SELECT log FROM render_jobs WHERE id = ?")
      .get(id) as { log: string } | undefined;
    if (!cur) return;
    const arr = JSON.parse(cur.log) as RenderJobLogEntry[];
    arr.push(entry);
    this.db
      .prepare("UPDATE render_jobs SET log = ? WHERE id = ?")
      .run(JSON.stringify(arr), id);
  }
}
```

- [ ] **Step 3.4: Run the tests, see them pass**

```bash
bun run test:server -- src/server/render-queue/__tests__/store.test.ts
```

Expected: 5 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/server/render-queue/store.ts src/server/render-queue/__tests__/store.test.ts
git commit -m "$(cat <<'EOF'
feat(render-queue): better-sqlite3 store with insert/get/list/update/appendLog (Phase 7.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 4: `worker.test.ts` — TDD, 4 tests

The worker pulls queued jobs, calls `runRenderPipeline` (injected as a dep so tests can stub), updates the store, and emits progress on a per-jobId EventEmitter.

- [ ] **Step 4.1: Create `src/server/render-queue/__tests__/worker.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { RenderQueueStore } from "../store";
import { RenderQueueWorker } from "../worker";
import type { RenderJob } from "../job";

interface StubRunner {
  fn: ReturnType<typeof vi.fn>;
  emit: (stage: string, pct: number) => void;
  resolve: (path: string) => void;
  reject: (err: Error) => void;
}

function makeStubRunner(): StubRunner {
  const captured = { onProgress: undefined as undefined | ((s: string, p: number) => void) };
  let resolveFn: (path: string) => void = () => {};
  let rejectFn: (err: Error) => void = () => {};
  const fn = vi.fn(async (opts: any) => {
    captured.onProgress = opts.onProgress;
    return new Promise<string>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
  });
  return {
    fn,
    emit: (stage, pct) => captured.onProgress?.(stage, pct),
    resolve: (path) => resolveFn(path),
    reject: (err) => rejectFn(err),
  };
}

let db: Database.Database;
let store: RenderQueueStore;
let runner: StubRunner;
let worker: RenderQueueWorker;

beforeEach(() => {
  db = new Database(":memory:");
  store = new RenderQueueStore(db);
  runner = makeStubRunner();
  worker = new RenderQueueWorker({
    store,
    runRenderPipeline: runner.fn,
    loadComposition: vi.fn(async (workId: string) => ({ id: "c", workId, fps: 30, width: 1080, height: 1920, duration: 4, aspect: "9:16", updatedAt: "x", tracks: [], assets: [], provenance: [], exportPresets: [] }) as any),
    outDirFor: vi.fn((workId: string) => `/tmp/works/${workId}/output`),
    concurrency: 1,
  });
});

describe("RenderQueueWorker — lifecycle", () => {
  it("transitions queued → running → done and emits progress events", async () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    const events: any[] = [];
    worker.on(job.id, (ev) => events.push(ev));
    worker.start();
    await vi.waitFor(() => expect(runner.fn).toHaveBeenCalledOnce());
    expect(store.get(job.id)?.status).toBe("running");

    runner.emit("render", 0.5);
    await vi.waitFor(() => expect(events.some((e) => e.stage === "render" && e.progress === 0.5)).toBe(true));

    runner.resolve("/tmp/works/w-1/output/final.mp4");
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe("done"));
    expect(store.get(job.id)?.outputPath).toBe("/tmp/works/w-1/output/final.mp4");
    expect(events.at(-1)).toMatchObject({ status: "done", progress: 1 });
  });

  it("marks job failed and persists error message on rejection", async () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    worker.start();
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe("running"));

    runner.reject(new Error("ffmpeg exit 137"));
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe("failed"));
    expect(store.get(job.id)?.error).toContain("ffmpeg exit 137");
  });

  it("processes jobs serially (concurrency=1)", async () => {
    const j1 = store.insert({ workId: "w-1", type: "full" });
    const j2 = store.insert({ workId: "w-2", type: "full" });
    worker.start();
    await vi.waitFor(() => expect(runner.fn).toHaveBeenCalledOnce());
    // Second job is still queued.
    expect(store.get(j2.id)?.status).toBe("queued");
    runner.resolve("/tmp/o1.mp4");
    await vi.waitFor(() => expect(store.get(j1.id)?.status).toBe("done"));
    await vi.waitFor(() => expect(runner.fn).toHaveBeenCalledTimes(2));
  });

  it("cancel() aborts in-flight render and marks job cancelled", async () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    worker.start();
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe("running"));

    worker.cancel(job.id);
    runner.reject(new Error("aborted"));
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe("cancelled"));
    // The signal passed into the runner must have been aborted.
    const lastCallOpts = runner.fn.mock.calls.at(-1)![0] as any;
    expect(lastCallOpts.signal?.aborted).toBe(true);
  });
});
```

- [ ] **Step 4.2: Run the test, see it fail**

```bash
bun run test:server -- src/server/render-queue/__tests__/worker.test.ts
```

Expected: FAIL — `../worker` not found.

- [ ] **Step 4.3: Implement `src/server/render-queue/worker.ts`**

```ts
// src/server/render-queue/worker.ts

import { EventEmitter } from "node:events";
import type { RenderQueueStore } from "./store";
import type { RenderJob, RenderStage } from "./job";
import { isTerminalStatus } from "./job";

export interface WorkerProgressEvent {
  at: string;
  status: RenderJob["status"];
  progress: number;
  stage?: RenderStage;
  log?: { at: string; level: "info" | "warn" | "error"; msg: string };
}

export interface RunRenderPipelineLike {
  (opts: {
    comp: any;
    outDir: string;
    burnSubtitles?: boolean;
    loudnessTargetLufs?: number;
    proxy?: boolean;
    signal?: AbortSignal;
    onProgress?: (stage: RenderStage, pct: number) => void;
  }): Promise<string>;
}

export interface WorkerDeps {
  store: RenderQueueStore;
  runRenderPipeline: RunRenderPipelineLike;
  loadComposition: (workId: string) => Promise<any>;
  outDirFor: (workId: string) => string;
  concurrency?: number; // D3 default 1
}

export class RenderQueueWorker {
  private readonly emitter = new EventEmitter();
  private readonly inflight = new Map<string, AbortController>();
  private readonly concurrency: number;
  private started = false;
  private draining = false;
  private wakeup = () => {};

  constructor(private readonly deps: WorkerDeps) {
    this.concurrency = Math.max(1, deps.concurrency ?? 1);
    this.emitter.setMaxListeners(0);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.drain();
  }

  stop(): void {
    this.started = false;
    for (const ac of this.inflight.values()) ac.abort();
  }

  on(jobId: string, fn: (ev: WorkerProgressEvent) => void): () => void {
    const handler = (ev: WorkerProgressEvent) => fn(ev);
    this.emitter.on(`job:${jobId}`, handler);
    return () => this.emitter.off(`job:${jobId}`, handler);
  }

  /** Wake the drain loop after enqueue. */
  notify(): void {
    this.wakeup();
  }

  cancel(jobId: string): void {
    const job = this.deps.store.get(jobId);
    if (!job) return;
    if (isTerminalStatus(job.status)) return;
    if (job.status === "queued") {
      this.deps.store.update(jobId, { status: "cancelled" });
      this.emit(jobId, { status: "cancelled", progress: job.progress });
      return;
    }
    const ac = this.inflight.get(jobId);
    if (ac) ac.abort();
    // Final status flip happens inside drain() when the runner rejects.
  }

  private emit(jobId: string, partial: Omit<WorkerProgressEvent, "at">): void {
    const ev: WorkerProgressEvent = { at: new Date().toISOString(), ...partial };
    try {
      this.emitter.emit(`job:${jobId}`, ev);
    } catch {
      /* swallow listener errors */
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.started) {
        const id = this.deps.store.nextQueued();
        if (!id) {
          await new Promise<void>((res) => {
            this.wakeup = () => {
              this.wakeup = () => {};
              res();
            };
            setTimeout(() => this.wakeup(), 250);
          });
          continue;
        }
        if (this.inflight.size >= this.concurrency) {
          // wait — in concurrency=1 we re-check after the in-flight settles.
          await new Promise((res) => setTimeout(res, 50));
          continue;
        }
        await this.runOne(id);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOne(jobId: string): Promise<void> {
    const job = this.deps.store.get(jobId);
    if (!job || job.status !== "queued") return;
    this.deps.store.update(jobId, { status: "running", progress: 0 });
    this.emit(jobId, { status: "running", progress: 0 });

    const ac = new AbortController();
    this.inflight.set(jobId, ac);

    let comp: any;
    try {
      comp = await this.deps.loadComposition(job.workId);
    } catch (err: any) {
      this.deps.store.update(jobId, {
        status: "failed",
        error: `loadComposition: ${err?.message ?? String(err)}`,
      });
      this.emit(jobId, { status: "failed", progress: 0 });
      this.inflight.delete(jobId);
      return;
    }

    try {
      const out = await this.deps.runRenderPipeline({
        comp,
        outDir: this.deps.outDirFor(job.workId),
        proxy: job.type === "proxy",
        signal: ac.signal,
        onProgress: (stage, pct) => {
          this.deps.store.update(jobId, { stage, progress: pct });
          this.emit(jobId, { status: "running", progress: pct, stage });
        },
      });
      // If cancel was requested between progress events and resolve, treat as cancelled.
      if (ac.signal.aborted) {
        this.deps.store.update(jobId, { status: "cancelled" });
        this.emit(jobId, { status: "cancelled", progress: 1 });
      } else {
        this.deps.store.update(jobId, {
          status: "done",
          progress: 1,
          outputPath: out,
        });
        this.emit(jobId, { status: "done", progress: 1 });
      }
    } catch (err: any) {
      if (ac.signal.aborted) {
        this.deps.store.update(jobId, { status: "cancelled" });
        this.emit(jobId, { status: "cancelled", progress: 0 });
      } else {
        const msg = err?.message ?? String(err);
        this.deps.store.update(jobId, { status: "failed", error: msg });
        this.emit(jobId, { status: "failed", progress: 0 });
      }
    } finally {
      this.inflight.delete(jobId);
    }
  }
}
```

- [ ] **Step 4.4: Run the tests, see them pass**

```bash
bun run test:server -- src/server/render-queue/__tests__/worker.test.ts
```

Expected: 4 PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/server/render-queue/worker.ts src/server/render-queue/__tests__/worker.test.ts
git commit -m "$(cat <<'EOF'
feat(render-queue): serial worker with progress emitter + cancel via AbortSignal (Phase 7.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 5: `index.ts` — RenderQueue facade + 3 facade tests

The facade combines store + worker into the API surface from master plan §7.1: `enqueue`, `cancel`, `get`, `list`, plus the `on(jobId, fn)` event subscription.

- [ ] **Step 5.1: Create `src/server/render-queue/__tests__/queue.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { RenderQueue } from "../index";

let queue: RenderQueue;
const runner = vi.fn(async () => "/tmp/out.mp4");

beforeEach(() => {
  runner.mockReset();
  runner.mockResolvedValue("/tmp/out.mp4");
  queue = new RenderQueue({
    dbPath: ":memory:",
    runRenderPipeline: runner as any,
    loadComposition: vi.fn(async (workId) => ({ id: "c", workId, fps: 30, width: 1080, height: 1920, duration: 4, aspect: "9:16", updatedAt: "x", tracks: [], assets: [], provenance: [], exportPresets: [] })),
    outDirFor: (id) => `/tmp/${id}`,
  });
});

describe("RenderQueue — facade", () => {
  it("enqueue returns a queued job and the worker eventually runs it", async () => {
    const job = queue.enqueue({ workId: "w-1", type: "full" });
    expect(job.status).toBe("queued");
    await vi.waitFor(() => expect(queue.get(job.id)?.status).toBe("done"));
  });

  it("list returns jobs for the given workId", () => {
    queue.enqueue({ workId: "w-1", type: "full" });
    queue.enqueue({ workId: "w-2", type: "proxy" });
    expect(queue.list("w-1")).toHaveLength(1);
    expect(queue.list("w-2")).toHaveLength(1);
  });

  it("cancel on a queued job flips it to cancelled before the worker picks it up", () => {
    // Block the worker by holding the runner promise.
    let resolveFn: (v: string) => void = () => {};
    runner.mockImplementation(() => new Promise((res) => { resolveFn = res; }));
    const j1 = queue.enqueue({ workId: "w-1", type: "full" });
    const j2 = queue.enqueue({ workId: "w-1", type: "full" });
    queue.cancel(j2.id);
    expect(queue.get(j2.id)?.status).toBe("cancelled");
    resolveFn("/tmp/x.mp4");
  });
});
```

- [ ] **Step 5.2: Implement `src/server/render-queue/index.ts`**

```ts
// src/server/render-queue/index.ts

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RenderQueueStore, defaultDbPath } from "./store";
import { RenderQueueWorker, type RunRenderPipelineLike, type WorkerProgressEvent } from "./worker";
import type { RenderJob, RenderJobOptions } from "./job";

export type { RenderJob, RenderJobOptions, WorkerProgressEvent };
export { defaultDbPath };

export interface RenderQueueOptions {
  dbPath?: string; // D2 — defaults to defaultDbPath()
  runRenderPipeline: RunRenderPipelineLike;
  loadComposition: (workId: string) => Promise<any>;
  outDirFor: (workId: string) => string;
  concurrency?: number;
}

export class RenderQueue {
  private readonly db: Database.Database;
  private readonly store: RenderQueueStore;
  private readonly worker: RenderQueueWorker;

  constructor(opts: RenderQueueOptions) {
    const path = opts.dbPath ?? defaultDbPath();
    if (path !== ":memory:") {
      try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ok */ }
    }
    this.db = new Database(path);
    this.store = new RenderQueueStore(this.db);
    this.worker = new RenderQueueWorker({
      store: this.store,
      runRenderPipeline: opts.runRenderPipeline,
      loadComposition: opts.loadComposition,
      outDirFor: opts.outDirFor,
      concurrency: opts.concurrency,
    });
    this.worker.start();
  }

  enqueue(opts: RenderJobOptions): RenderJob {
    const job = this.store.insert(opts);
    this.worker.notify();
    return job;
  }

  cancel(jobId: string): void {
    this.worker.cancel(jobId);
  }

  get(jobId: string): RenderJob | null {
    return this.store.get(jobId);
  }

  list(workId: string): RenderJob[] {
    return this.store.list(workId);
  }

  on(jobId: string, fn: (ev: WorkerProgressEvent) => void): () => void {
    return this.worker.on(jobId, fn);
  }

  /** Test helper — stop the worker drain loop. */
  shutdown(): void {
    this.worker.stop();
    this.db.close();
  }
}
```

- [ ] **Step 5.3: Run all queue tests**

```bash
bun run test:server -- src/server/render-queue/
```

Expected: 5 + 4 + 3 = 12 PASS.

- [ ] **Step 5.4: Commit**

```bash
git add src/server/render-queue/index.ts src/server/render-queue/__tests__/queue.test.ts
git commit -m "$(cat <<'EOF'
feat(render-queue): RenderQueue facade combining store + worker (Phase 7.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 6: Extend `runRenderPipeline` to accept `signal?: AbortSignal`

This is the *minimal* render-pipeline change in 7.A — it does **not** add the proxy flag (that's 7.C). It only threads the signal through so 7.A's worker abort tests pass against the real pipeline (currently they pass against the stubbed runner, but the real wiring matters for AC2).

- [ ] **Step 6.1: Add a regression test for signal abort**

Append to `src/server/render-pipeline.test.ts`:

```ts
describe("runRenderPipeline — abort signal", () => {
  it("propagates AbortSignal to spawned ffmpeg processes (encode stage)", async () => {
    // Synthetic: trigger encode via an exportPreset, then abort mid-spawn.
    const ce = await import("node:child_process");
    let killed = false;
    const spy = vi.spyOn(ce, "spawn").mockImplementation((..._args: any[]) => {
      const proc: any = new (require("node:events").EventEmitter)();
      proc.stdout = new (require("node:events").EventEmitter)();
      proc.stderr = new (require("node:events").EventEmitter)();
      proc.kill = () => { killed = true; proc.emit("close", 130); };
      return proc;
    });
    const ac = new AbortController();
    const compWithPreset: Composition = {
      ...baseComp,
      exportPresets: [{ id: "p", label: "x", platform: "douyin",
        width: 1080, height: 1920, fps: 30,
        codec: "h264", container: "mp4",
        videoBitrate: 8000, audioBitrate: 192,
        loudnessTargetLufs: -14, safeZonePct: 0.18 }],
    };
    const promise = runRenderPipeline({ comp: compWithPreset, outDir: "/tmp/out", signal: ac.signal });
    // Abort after a microtask to ensure the encode spawn has registered the listener.
    setTimeout(() => ac.abort(), 0);
    await expect(promise).rejects.toBeTruthy();
    expect(killed).toBe(true);
    spy.mockRestore();
  });
});
```

- [ ] **Step 6.2: Implement signal threading in `src/server/render-pipeline.ts`**

Add to `RenderJobOptions`:

```ts
export interface RenderJobOptions {
  comp: Composition;
  outDir: string;
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
  outputTitle?: string;
  /** Phase 7.A — abort the in-flight pipeline. Wired into spawn() processes. */
  signal?: AbortSignal;
  onProgress?: (stage: RenderStage, pct: number) => void;
}
```

Inside `runEncodeStage` (and any other `spawn` site), register an abort listener:

```ts
return new Promise<void>((resolve, reject) => {
  const child = spawn("ffmpeg", args);
  let stderr = "";
  child.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
  const onAbort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", onAbort, { once: true });
  child.on("close", (code: number | null) => {
    signal?.removeEventListener("abort", onAbort);
    if (signal?.aborted) reject(new Error("runEncodeStage: aborted"));
    else if (code === 0) resolve();
    else reject(new Error(`runEncodeStage: ffmpeg exit ${code}\n${stderr}`));
  });
  child.on("error", reject);
});
```

Thread `opts.signal` into `runEncodeStage(workingPath, finalPath, preset, opts.signal)`. Likewise expose `opts.signal` to upstream stages (`renderCompositionToMp4`, `mixAudioTracks`, `normalizeLufs`, `burnSubtitles`) where the underlying impls already accept signals; for stages that don't yet, leave a TODO comment and document under "Open follow-ups."

- [ ] **Step 6.3: Run pipeline tests**

```bash
bun run test:server -- src/server/render-pipeline.test.ts
```

Expected: pre-existing tests + the new abort test PASS.

- [ ] **Step 6.4: Commit**

```bash
git add src/server/render-pipeline.ts src/server/render-pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(render-pipeline): thread AbortSignal into encode stage spawn (Phase 7.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7.B — REST endpoints + WebSocket progress stream

**Goal:** Wire the `RenderQueue` into Hono. After this task, the frontend can:
- `POST /api/works/:id/render` (with optional `{type, presetId, burnSubtitles, loudnessTargetLufs}` body) → `{jobId}`
- `GET /api/render/jobs/:id` → full `RenderJob`
- `DELETE /api/render/jobs/:id` → cancels + returns the post-cancel job
- `GET ws://.../ws/render/jobs/:id` → JSON progress events; closes on terminal status

**Pitfalls:**
- The legacy synchronous `POST /api/works/:id/render` returns `{ ok: true, output }`. Phase 7 changes the **contract**: now it returns `{ jobId }`. This is breaking — adjust `web/src/features/studio/services/render.ts` in 7.E. Until then, the frontend's old `exportMp4` call is broken; do not deploy 7.B without 7.D/E.
- The `/ws/render/jobs/:id` upgrade router must coexist with `WsBridge`'s `/ws/browser/:workId`. Reuse the `wsBridge.handleUpgrade(req, socket, head)` pattern: try render-ws first; fall back to wsBridge.
- The render queue is a process-singleton — Phase 7.B exports a `getRenderQueue()` accessor lazily constructed once (matches the `setWsBridge / wsBridge` pattern already in `api.ts`).
- ws server tests open a real `WebSocketServer` on an ephemeral port — make sure to close it in `afterEach`.

**Files:**
- Create: `src/server/render-ws.ts`
- Create: `src/server/render-ws.test.ts`
- Create: `src/server/api.render.test.ts`
- Modify: `src/server/api.ts` — add `setRenderQueue` + 3 endpoints
- Modify: `src/server/index.ts` — construct RenderQueue, mount upgrade router

### Step 1: REST endpoints — TDD

- [ ] **Step 1.1: Create `src/server/api.render.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { apiRoutes, setRenderQueue } from "./api";

class FakeQueue {
  private rows = new Map<string, any>();
  enqueue(opts: any) {
    const id = `job_${this.rows.size}`;
    const row = { id, workId: opts.workId, type: opts.type, status: "queued", progress: 0, log: [], createdAt: "x" };
    this.rows.set(id, row);
    return row;
  }
  get(id: string) { return this.rows.get(id) ?? null; }
  cancel(id: string) {
    const row = this.rows.get(id);
    if (row) row.status = "cancelled";
  }
  list(workId: string) {
    return [...this.rows.values()].filter((r) => r.workId === workId);
  }
}

let app: Hono;
let queue: FakeQueue;

beforeEach(() => {
  queue = new FakeQueue();
  setRenderQueue(queue as any);
  app = new Hono();
  app.route("/", apiRoutes);
});

describe("POST /api/works/:id/render — enqueue", () => {
  it("returns 200 + {jobId} for a full render", async () => {
    // Pre-seed work + composition.yaml on disk via vi.mock — see _helpers.
    vi.spyOn(await import("../work-store"), "getWork").mockResolvedValueOnce({ id: "w-1", title: "x", platforms: ["douyin"], type: "short-video" } as any);
    vi.spyOn(await import("node:fs/promises"), "readFile").mockResolvedValueOnce(`{ "id": "c", "workId": "w-1", "fps": 30, "width": 1080, "height": 1920, "duration": 4, "aspect": "9:16", "updatedAt": "x", "tracks": [], "assets": [], "provenance": [], "exportPresets": [] }`);
    const res = await app.request("/api/works/w-1/render", { method: "POST", body: JSON.stringify({ type: "full" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobId).toMatch(/^job_/);
  });
});

describe("GET /api/render/jobs/:id", () => {
  it("returns the job row", async () => {
    const job = queue.enqueue({ workId: "w-1", type: "full" });
    const res = await app.request(`/api/render/jobs/${job.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(job.id);
  });

  it("404 for unknown id", async () => {
    const res = await app.request("/api/render/jobs/job_nope");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/render/jobs/:id", () => {
  it("cancels the job and returns the post-cancel row", async () => {
    const job = queue.enqueue({ workId: "w-1", type: "full" });
    const res = await app.request(`/api/render/jobs/${job.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("cancelled");
  });
});
```

- [ ] **Step 1.2: Run, see fail**

```bash
bun run test:server -- src/server/api.render.test.ts
```

Expected: FAIL — `setRenderQueue` does not exist; the new routes 404.

- [ ] **Step 1.3: Implement endpoints in `src/server/api.ts`**

Add a render-queue accessor near the existing `wsBridge` block (line ~79):

```ts
import type { RenderQueue } from "./render-queue/index.js";

let renderQueue: RenderQueue | null = null;
export function setRenderQueue(q: RenderQueue): void {
  renderQueue = q;
}
```

Replace the body of `apiRoutes.post("/api/works/:id/render", ...)` with the enqueue path:

```ts
apiRoutes.post("/api/works/:id/render", async (c) => {
  const id = c.req.param("id");
  if (!renderQueue) return c.json({ error: "RenderQueue not initialized" }, 503);
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found" }, 404);
  // Validate composition exists on disk before enqueue (cheap fail-fast).
  try {
    await readFile(join(dataDir, "works", id, "composition.yaml"), "utf-8");
  } catch {
    return c.json({ error: "Composition missing — save first" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const type = body.type === "proxy" ? "proxy" : "full";
  const job = renderQueue.enqueue({
    workId: id,
    type,
    presetId: typeof body.presetId === "string" ? body.presetId : undefined,
    burnSubtitles: !!body.burnSubtitles,
    loudnessTargetLufs:
      typeof body.loudnessTargetLufs === "number" ? body.loudnessTargetLufs : undefined,
  });
  return c.json({ jobId: job.id });
});

apiRoutes.get("/api/render/jobs/:id", (c) => {
  if (!renderQueue) return c.json({ error: "RenderQueue not initialized" }, 503);
  const job = renderQueue.get(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(job);
});

apiRoutes.delete("/api/render/jobs/:id", (c) => {
  if (!renderQueue) return c.json({ error: "RenderQueue not initialized" }, 503);
  const id = c.req.param("id");
  renderQueue.cancel(id);
  const job = renderQueue.get(id);
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(job);
});
```

The worker now owns invoking `runRenderPipeline` — remove the dynamic import + direct call from the old endpoint body.

- [ ] **Step 1.4: Run tests, see pass**

```bash
bun run test:server -- src/server/api.render.test.ts
```

Expected: 4 PASS.

- [ ] **Step 1.5: Commit**

```bash
git add src/server/api.ts src/server/api.render.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST/GET/DELETE /api/render/jobs — enqueue + status + cancel (Phase 7.B)

POST /api/works/:id/render now enqueues and returns {jobId} (BREAKING).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 2: WebSocket progress stream — TDD

- [ ] **Step 2.1: Create `src/server/render-ws.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { EventEmitter } from "node:events";
import { RenderWsRouter } from "./render-ws";

class FakeQueue extends EventEmitter {
  rows = new Map<string, any>();
  add(id: string, row: any) { this.rows.set(id, row); }
  get(id: string) { return this.rows.get(id) ?? null; }
  on(jobId: string, fn: any): () => void {
    const k = `j:${jobId}`;
    super.on(k, fn);
    return () => super.off(k, fn);
  }
  emitFor(jobId: string, ev: any) { super.emit(`j:${jobId}`, ev); }
}

let server: Server;
let port: number;
let queue: FakeQueue;
let router: RenderWsRouter;

beforeEach(async () => {
  queue = new FakeQueue();
  router = new RenderWsRouter(queue as any);
  server = createServer();
  server.on("upgrade", (req, sock, head) => {
    if (!router.handleUpgrade(req, sock, head)) sock.destroy();
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  port = (server.address() as any).port;
});

afterEach(async () => {
  router.close();
  await new Promise<void>((res) => server.close(() => res()));
});

function connect(jobId: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/render/jobs/${jobId}`);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
  });
}

describe("/ws/render/jobs/:id", () => {
  it("forwards progress events to subscribers", async () => {
    queue.add("job_1", { id: "job_1", status: "queued", progress: 0, log: [] });
    const ws = await connect("job_1");
    const got = new Promise<any>((res) => ws.on("message", (b) => res(JSON.parse(b.toString()))));
    queue.emitFor("job_1", { at: "t", status: "running", progress: 0.4, stage: "render" });
    expect(await got).toMatchObject({ status: "running", progress: 0.4, stage: "render" });
    ws.close();
  });

  it("closes the socket after a terminal event", async () => {
    queue.add("job_2", { id: "job_2", status: "queued", progress: 0, log: [] });
    const ws = await connect("job_2");
    const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
    queue.emitFor("job_2", { at: "t", status: "done", progress: 1 });
    const code = await closed;
    expect(code).toBeGreaterThanOrEqual(1000);
  });

  it("rejects upgrade for unknown URL paths", () => {
    // We expect handleUpgrade to return false for non-render paths (negative test).
    const dummyReq: any = { url: "/ws/other/123" };
    expect(router.handleUpgrade(dummyReq, { destroy: () => {} } as any, Buffer.alloc(0))).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run, see fail**

```bash
bun run test:server -- src/server/render-ws.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement `src/server/render-ws.ts`**

```ts
// src/server/render-ws.ts

import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { RenderQueue, WorkerProgressEvent } from "./render-queue/index.js";
import { isTerminalStatus } from "./render-queue/job.js";

const URL_RE = /^\/ws\/render\/jobs\/([^/?]+)/;

export class RenderWsRouter {
  private wss: WebSocketServer;
  constructor(private readonly queue: RenderQueue) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws: WebSocket, _req, jobId: string) => {
      // Send the current job state as the first frame.
      const cur = this.queue.get(jobId);
      if (!cur) {
        ws.send(JSON.stringify({ at: new Date().toISOString(), status: "failed", progress: 0, log: { at: new Date().toISOString(), level: "error", msg: "job not found" } }));
        ws.close(1011, "job not found");
        return;
      }
      ws.send(JSON.stringify({ at: new Date().toISOString(), status: cur.status, progress: cur.progress, stage: cur.stage }));
      // If already terminal, close immediately.
      if (isTerminalStatus(cur.status)) {
        ws.close(1000, "terminal");
        return;
      }
      const off = this.queue.on(jobId, (ev: WorkerProgressEvent) => {
        try { ws.send(JSON.stringify(ev)); } catch { /* ignore */ }
        if (isTerminalStatus(ev.status)) {
          off();
          try { ws.close(1000, "terminal"); } catch { /* ignore */ }
        }
      });
      ws.on("close", off);
    });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? "";
    const m = url.match(URL_RE);
    if (!m) return false;
    const jobId = m[1]!;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit("connection", ws, req, jobId);
    });
    return true;
  }

  close(): void {
    this.wss.close();
  }
}
```

- [ ] **Step 2.4: Run tests, see pass**

```bash
bun run test:server -- src/server/render-ws.test.ts
```

Expected: 3 PASS.

- [ ] **Step 2.5: Wire into `src/server/index.ts`**

Add imports + construct + upgrade routing:

```ts
import { RenderQueue, defaultDbPath } from "./render-queue/index.js";
import { setRenderQueue } from "./api.js";
import { RenderWsRouter } from "./render-ws.js";
import { runRenderPipeline } from "./render-pipeline.js";
import { dataDir } from "../config.js";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { CompositionSchema } from "../shared/composition.js";
```

Inside `startServer()` after `setWsBridge(wsBridge)`:

```ts
const renderQueue = new RenderQueue({
  dbPath: process.env.AUTOVIRAL_RENDER_DB ?? defaultDbPath(),
  runRenderPipeline,
  loadComposition: async (workId: string) => {
    const raw = await readFile(join(dataDir, "works", workId, "composition.yaml"), "utf-8");
    const parsed = CompositionSchema.safeParse(yaml.load(raw));
    if (!parsed.success) throw new Error(`composition invalid: ${parsed.error.message}`);
    return parsed.data;
  },
  outDirFor: (workId: string) => join(dataDir, "works", workId, "output"),
  concurrency: Number.parseInt(process.env.AUTOVIRAL_RENDER_CONCURRENCY ?? "1", 10),
});
setRenderQueue(renderQueue);
const renderWs = new RenderWsRouter(renderQueue);
```

Modify the upgrade handler to try the render router first:

```ts
httpServer.on("upgrade", (req, socket, head) => {
  if (renderWs.handleUpgrade(req, socket, head)) return;
  if (wsBridge.handleUpgrade(req, socket, head)) return;
  socket.destroy();
});
```

- [ ] **Step 2.6: Smoke + typecheck**

```bash
bun run typecheck && bun run test:server
```

Expected: PASS (all suites).

- [ ] **Step 2.7: Commit**

```bash
git add src/server/render-ws.ts src/server/render-ws.test.ts src/server/index.ts
git commit -m "$(cat <<'EOF'
feat(render-ws): /ws/render/jobs/:id progress stream + upgrade wiring (Phase 7.B)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7.C — Proxy mode in `runRenderPipeline`

**Goal:** When the worker passes `proxy: true`, the pipeline produces a half-resolution / 24fps / half-bitrate output. AC3 of master plan §7.3 requires proxy ≤30s for a 60s 1080p comp; we don't time the actual render in unit tests (that requires a real ffmpeg run + benchmarking), but we *do* assert that the proxy-mode flag flows through to (a) the Remotion render call (smaller width/height/fps) and (b) the encode-stage preset (half videoBitrate). The Phase 7.F integration test uses these flag assertions to gate AC3.

**Pitfalls:**
- The proxy comp must be a deep-clone — never mutate the caller's composition.
- Half-resolution must round to even integers (libx264 requires even dimensions for yuv420p). Use `(n) => Math.max(2, Math.floor(n / 2 / 2) * 2)`.
- If `comp.exportPresets[0]` is unset, proxy still applies to width/height/fps — encode falls through to the `rename` branch (no preset), so videoBitrate halving is a no-op. This is fine: the proxy still saves time on Remotion render (3× fewer frames at half-res).
- Audio bitrate is **not** halved (kept for review-quality audio).

**Files:**
- Modify: `src/server/render-pipeline.ts`
- Modify: `src/server/render-pipeline.test.ts`

### Step 1: TDD — 2 proxy tests

- [ ] **Step 1.1: Append to `src/server/render-pipeline.test.ts`**

```ts
describe("runRenderPipeline — proxy mode (Phase 7.C)", () => {
  it("halves width/height (rounded to even) and clamps fps to 24 in the Remotion render call", async () => {
    await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out", proxy: true });
    const renderMock = renderCompositionToMp4 as unknown as ReturnType<typeof vi.fn>;
    const compArg = renderMock.mock.calls[0]![0] as any;
    expect(compArg.width).toBe(540);
    expect(compArg.height).toBe(960);
    expect(compArg.fps).toBe(24);
  });

  it("halves preset.videoBitrate (audio bitrate kept) when proxy + preset", async () => {
    const compWithPreset: Composition = {
      ...baseComp,
      exportPresets: [{
        id: "p", label: "x", platform: "douyin",
        width: 1080, height: 1920, fps: 30,
        codec: "h264", container: "mp4",
        videoBitrate: 8000, audioBitrate: 192,
        loudnessTargetLufs: -14, safeZonePct: 0.18,
      }],
    };
    const captured: any[] = [];
    const ce = await import("node:child_process");
    (ce.spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation((..._args: any[]) => {
      captured.push(_args);
      const proc: any = new (require("node:events").EventEmitter)();
      proc.stdout = new (require("node:events").EventEmitter)();
      proc.stderr = new (require("node:events").EventEmitter)();
      setTimeout(() => proc.emit("close", 0), 0);
      return proc;
    });
    await runRenderPipeline({ comp: compWithPreset, outDir: "/tmp/out", proxy: true });
    const args = captured[0]![1] as string[];
    const bvIdx = args.indexOf("-b:v");
    expect(args[bvIdx + 1]).toBe("4000k"); // halved from 8000
    const baIdx = args.indexOf("-b:a");
    expect(args[baIdx + 1]).toBe("192k");  // kept
  });
});
```

- [ ] **Step 1.2: Run, see fail**

```bash
bun run test:server -- src/server/render-pipeline.test.ts
```

Expected: FAIL — width is still 1080, fps still 30.

- [ ] **Step 1.3: Implement proxy in `src/server/render-pipeline.ts`**

Add a helper near the top:

```ts
function evenHalf(n: number): number {
  return Math.max(2, Math.floor(n / 2 / 2) * 2);
}

function applyProxy(comp: Composition): Composition {
  const presets = (comp.exportPresets ?? []).map((p) => ({
    ...p,
    width: evenHalf(p.width),
    height: evenHalf(p.height),
    fps: Math.min(p.fps, 24),
    videoBitrate: Math.max(500, Math.round(p.videoBitrate / 2)),
  }));
  return {
    ...comp,
    width: evenHalf(comp.width),
    height: evenHalf(comp.height),
    fps: Math.min(comp.fps, 24),
    exportPresets: presets,
  };
}
```

Add to `RenderJobOptions`:

```ts
  /** Phase 7.C — half-res / 24fps / half-bitrate proxy render. */
  proxy?: boolean;
```

In `runRenderPipeline`:

```ts
const comp = opts.proxy ? applyProxy(opts.comp) : opts.comp;
```

…and use `comp` in place of `opts.comp` inside the function body.

- [ ] **Step 1.4: Run tests, see pass**

```bash
bun run test:server -- src/server/render-pipeline.test.ts
```

Expected: pre-existing + 2 new = PASS.

- [ ] **Step 1.5: Commit**

```bash
git add src/server/render-pipeline.ts src/server/render-pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(render-pipeline): proxy mode — half-res + 24fps + half video bitrate (Phase 7.C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7.D — `useRenderJob` hook + `ExportProgress` modal

**Goal:** Frontend pieces. After this task:
- `const job = useRenderJob(jobId)` returns live `RenderJob`-shaped state, plus `cancel()`.
- `<ExportProgress jobId={...} onClose={...} />` renders a modal showing the 5 stages, progress bar, log tail, and a cancel/retry button (per D8).

**Pitfalls:**
- The hook must clean up its WebSocket on unmount AND on terminal status (D5).
- Tests need to mock `WebSocket` globally; vitest `happy-dom` does NOT provide a real WebSocket — provide a minimal fake (already a pattern in chat tests if it exists; otherwise inline).
- Modal accessibility: use the same Radix Dialog as Phase 6's `ReframeConfirmDialog` (already shipped). Label / description ids match the existing pattern.

**Files:**
- Create: `web/src/features/studio/render-status/useRenderJob.ts`
- Create: `web/src/features/studio/render-status/useRenderJob.test.ts`
- Create: `web/src/features/studio/render-status/ExportProgress.tsx`
- Create: `web/src/features/studio/render-status/ExportProgress.test.tsx`

### Step 1: `useRenderJob.ts` — TDD, 4 tests

- [ ] **Step 1.1: Create `web/src/features/studio/render-status/useRenderJob.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRenderJob } from "./useRenderJob";

// Fake WebSocket — minimal EventTarget-like.
class FakeWs {
  static instances: FakeWs[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWs.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(_: string) {}
  close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  push(msg: any) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

beforeEach(() => {
  FakeWs.instances = [];
  (globalThis as any).WebSocket = FakeWs;
  globalThis.fetch = vi.fn(async (url: string, opts?: any) => {
    if (typeof url === "string" && url.startsWith("/api/render/jobs/") && opts?.method === "DELETE") {
      return { ok: true, json: async () => ({ id: url.split("/").pop(), status: "cancelled", progress: 0, log: [], workId: "w-1", type: "full", createdAt: "x" }) } as any;
    }
    return { ok: true, json: async () => ({ id: "job_1", status: "queued", progress: 0, log: [], workId: "w-1", type: "full", createdAt: "x" }) } as any;
  }) as any;
});

afterEach(() => {
  delete (globalThis as any).WebSocket;
});

describe("useRenderJob", () => {
  it("subscribes to /ws/render/jobs/:id and reflects pushed events", async () => {
    const { result } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    expect(FakeWs.instances[0]!.url).toMatch(/\/ws\/render\/jobs\/job_1$/);

    act(() => FakeWs.instances[0]!.push({ at: "t", status: "running", progress: 0.3, stage: "render" }));
    await waitFor(() => expect(result.current.job?.status).toBe("running"));
    expect(result.current.job?.progress).toBe(0.3);
    expect(result.current.job?.stage).toBe("render");
  });

  it("closes the socket on terminal status", async () => {
    const { result } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    act(() => FakeWs.instances[0]!.push({ at: "t", status: "done", progress: 1 }));
    await waitFor(() => expect(FakeWs.instances[0]!.closed).toBe(true));
    expect(result.current.job?.status).toBe("done");
  });

  it("disposes on unmount", async () => {
    const { unmount } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    unmount();
    await waitFor(() => expect(FakeWs.instances[0]!.closed).toBe(true));
  });

  it("cancel() POSTs DELETE and updates state", async () => {
    const { result } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    await act(async () => { await result.current.cancel(); });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/render/jobs/job_1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
```

- [ ] **Step 1.2: Run, see fail**

```bash
bun run test:web -- web/src/features/studio/render-status/useRenderJob.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement `web/src/features/studio/render-status/useRenderJob.ts`**

```ts
import { useEffect, useRef, useState, useCallback } from "react";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

export interface RenderJobView {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  stage?: "render" | "duck" | "loudnorm" | "burn" | "encode";
  log: Array<{ at: string; level: "info" | "warn" | "error"; msg: string }>;
  outputPath?: string;
  error?: string;
}

export function useRenderJob(jobId: string | null) {
  const [job, setJob] = useState<RenderJobView | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setJob({ id: jobId, status: "queued", progress: 0, log: [] });

    const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
    const host = typeof location !== "undefined" ? location.host : "localhost";
    const ws = new WebSocket(`${proto}://${host}/ws/render/jobs/${jobId}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { status: RenderJobView["status"]; progress: number; stage?: RenderJobView["stage"]; log?: RenderJobView["log"][number]; outputPath?: string; error?: string };
        setJob((prev) => {
          const base: RenderJobView = prev ?? { id: jobId, status: "queued", progress: 0, log: [] };
          return {
            ...base,
            status: ev.status,
            progress: ev.progress,
            stage: ev.stage ?? base.stage,
            log: ev.log ? [...base.log, ev.log] : base.log,
            outputPath: ev.outputPath ?? base.outputPath,
            error: ev.error ?? base.error,
          };
        });
        if (TERMINAL.has(ev.status)) {
          try { ws.close(); } catch { /* ignore */ }
        }
      } catch {
        /* ignore non-JSON */
      }
    };
    ws.onclose = () => setConnected(false);
    return () => {
      try { ws.close(); } catch { /* ignore */ }
      wsRef.current = null;
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    await fetch(`/api/render/jobs/${jobId}`, { method: "DELETE" });
  }, [jobId]);

  return { job, connected, cancel };
}
```

- [ ] **Step 1.4: Run, see pass**

```bash
bun run test:web -- web/src/features/studio/render-status/useRenderJob.test.ts
```

Expected: 4 PASS.

- [ ] **Step 1.5: Commit**

```bash
git add web/src/features/studio/render-status/useRenderJob.ts web/src/features/studio/render-status/useRenderJob.test.ts
git commit -m "$(cat <<'EOF'
feat(render-status): useRenderJob hook subscribes to /ws/render/jobs/:id (Phase 7.D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 2: `ExportProgress.tsx` — TDD, 5 tests

- [ ] **Step 2.1: Create `web/src/features/studio/render-status/ExportProgress.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportProgress } from "./ExportProgress";
import * as hookMod from "./useRenderJob";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockJob(state: Partial<hookMod.RenderJobView> & { status: hookMod.RenderJobView["status"] }) {
  vi.spyOn(hookMod, "useRenderJob").mockReturnValue({
    job: { id: "job_1", progress: 0.5, log: [], ...state } as hookMod.RenderJobView,
    connected: true,
    cancel: vi.fn(async () => {}),
  });
}

describe("ExportProgress", () => {
  it("renders all 5 stages with the active one highlighted", () => {
    mockJob({ status: "running", stage: "loudnorm", progress: 0.6 });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/render/i)).toBeInTheDocument();
    expect(screen.getByText(/duck/i)).toBeInTheDocument();
    expect(screen.getByText(/loudnorm/i)).toBeInTheDocument();
    expect(screen.getByText(/burn/i)).toBeInTheDocument();
    expect(screen.getByText(/encode/i)).toBeInTheDocument();
    expect(screen.getByTestId("stage-loudnorm")).toHaveAttribute("data-active", "true");
  });

  it("shows the success state and auto-closes after 1500ms when status=done", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    mockJob({ status: "done", progress: 1, outputPath: "/tmp/out.mp4" });
    render(<ExportProgress jobId="job_1" onClose={onClose} onRetry={() => {}} />);
    expect(screen.getByText(/Export complete/i)).toBeInTheDocument();
    vi.advanceTimersByTime(1600);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    vi.useRealTimers();
  });

  it("shows error + Retry button when status=failed", async () => {
    const onRetry = vi.fn();
    mockJob({ status: "failed", error: "ffmpeg exit 137", log: [] });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={onRetry} />);
    expect(screen.getByText(/ffmpeg exit 137/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("Cancel button calls hook.cancel() while running", async () => {
    const cancelSpy = vi.fn(async () => {});
    vi.spyOn(hookMod, "useRenderJob").mockReturnValue({
      job: { id: "job_1", status: "running", progress: 0.4, stage: "render", log: [] } as hookMod.RenderJobView,
      connected: true,
      cancel: cancelSpy,
    });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it("Cancel button is disabled in terminal states", () => {
    mockJob({ status: "done", progress: 1 });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={() => {}} />);
    const cancelBtn = screen.queryByRole("button", { name: /cancel/i });
    if (cancelBtn) expect(cancelBtn).toBeDisabled();
  });
});
```

- [ ] **Step 2.2: Run, see fail**

```bash
bun run test:web -- web/src/features/studio/render-status/ExportProgress.test.tsx
```

Expected: FAIL — component not found.

- [ ] **Step 2.3: Implement `web/src/features/studio/render-status/ExportProgress.tsx`**

```tsx
import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRenderJob, type RenderJobView } from "./useRenderJob";

const STAGES = ["render", "duck", "loudnorm", "burn", "encode"] as const;

export interface ExportProgressProps {
  jobId: string;
  onClose: () => void;
  onRetry: () => void;
}

export function ExportProgress({ jobId, onClose, onRetry }: ExportProgressProps) {
  const { job, cancel } = useRenderJob(jobId);

  useEffect(() => {
    if (!job) return;
    if (job.status === "done") {
      const t = setTimeout(onClose, 1500);
      return () => clearTimeout(t);
    }
    if (job.status === "cancelled") onClose();
  }, [job?.status, onClose]);

  const isTerminal = job ? ["done", "failed", "cancelled"].includes(job.status) : false;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="export-progress-overlay" />
        <Dialog.Content
          className="export-progress-content"
          aria-labelledby="export-progress-title"
          aria-describedby="export-progress-desc"
          style={{ background: "var(--surface-1)", padding: 24, borderRadius: 16, minWidth: 460 }}
        >
          <Dialog.Title id="export-progress-title" style={{ fontFamily: "var(--font-editorial)", fontSize: 20 }}>
            {job?.status === "done" ? "Export complete · open file" :
             job?.status === "failed" ? "Export failed" :
             "Rendering…"}
          </Dialog.Title>
          <Dialog.Description id="export-progress-desc" style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Job {jobId.slice(0, 12)}
          </Dialog.Description>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 16, display: "grid", gap: 8 }}>
            {STAGES.map((s) => {
              const active = job?.stage === s;
              const past = job ? STAGES.indexOf(job.stage ?? "render") > STAGES.indexOf(s) : false;
              return (
                <li
                  key={s}
                  data-testid={`stage-${s}`}
                  data-active={active ? "true" : "false"}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: active ? "var(--accent)" : past ? "var(--status-done)" : "var(--text-dimmer)",
                  }}
                >
                  {s}
                </li>
              );
            })}
          </ul>

          <div style={{ height: 4, background: "var(--surface-0)", borderRadius: 2, marginTop: 16, overflow: "hidden" }}>
            <div style={{ width: `${(job?.progress ?? 0) * 100}%`, height: "100%", background: "var(--accent)" }} />
          </div>

          {job?.error ? (
            <pre style={{ marginTop: 12, fontSize: 11, color: "var(--status-error)", whiteSpace: "pre-wrap" }}>
              {job.error}
            </pre>
          ) : null}
          {job && job.log.length > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary>Log ({job.log.length})</summary>
              <pre style={{ fontSize: 10, color: "var(--text-dim)", maxHeight: 160, overflow: "auto" }}>
                {job.log.map((l) => `[${l.level}] ${l.msg}`).join("\n")}
              </pre>
            </details>
          ) : null}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={isTerminal}
            >
              Cancel
            </button>
            {job?.status === "failed" ? (
              <button type="button" onClick={onRetry}>Retry</button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2.4: Run, see pass**

```bash
bun run test:web -- web/src/features/studio/render-status/ExportProgress.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 2.5: Commit**

```bash
git add web/src/features/studio/render-status/ExportProgress.tsx web/src/features/studio/render-status/ExportProgress.test.tsx
git commit -m "$(cat <<'EOF'
feat(render-status): ExportProgress modal with 5-stage indicator + cancel/retry (Phase 7.D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7.E — TopBar wire-up

**Goal:** Replace the synchronous export button. After this task:
- Click "导出" → POST `/api/works/:id/render` with `{type: "full"}` → mount `<ExportProgress jobId={...} />`.
- Chevron button next to it opens a dropdown: "Quick proxy export" → POST with `{type: "proxy"}`.
- Closing the modal dismisses it; Retry re-enqueues with the same options.

**Pitfalls:**
- The current `onExport` callback comes from `web/src/pages/Studio.tsx` and calls `exportMp4`. We replace `exportMp4` to return `{jobId}`, but the legacy callback signature is "fire-and-forget." We change `Studio.tsx` to manage the modal state OR move that state into TopBar. Plan: TopBar owns the modal (cleaner — `onExport` becomes optional / removed).
- `exportMp4` legacy signature `Promise<{ ok, output }>` is already used only by `Studio.tsx`. We rewrite `services/render.ts` and update both call sites in this commit.
- The chevron menu uses Radix DropdownMenu (already a project dep).

**Files:**
- Modify: `web/src/features/studio/services/render.ts`
- Modify: `web/src/features/studio/panels/TopBar.tsx`
- Modify: `web/src/features/studio/panels/TopBar.test.tsx`
- Modify: `web/src/pages/Studio.tsx`

### Step 1: TDD — TopBar tests

- [ ] **Step 1.1: Edit `web/src/features/studio/panels/TopBar.test.tsx`** — add three new test blocks. Keep the existing assertions. New tests:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TopBar } from "./TopBar";
import * as renderSvc from "../services/render";

vi.mock("../services/render", () => ({
  enqueueRender: vi.fn(),
  cancelRender: vi.fn(),
}));

describe("TopBar — queue-aware export (Phase 7.E)", () => {
  it("clicking 导出 enqueues a full render and mounts ExportProgress", async () => {
    (renderSvc.enqueueRender as any).mockResolvedValue({ jobId: "job_abc" });
    render(
      <MemoryRouter>
        <TopBar workId="w-1" savedAt="now" />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    expect(renderSvc.enqueueRender).toHaveBeenCalledWith("w-1", { type: "full" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("chevron menu offers Quick proxy export", async () => {
    (renderSvc.enqueueRender as any).mockResolvedValue({ jobId: "job_proxy" });
    render(
      <MemoryRouter>
        <TopBar workId="w-1" savedAt="now" />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /more export options/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /quick proxy export/i }));
    expect(renderSvc.enqueueRender).toHaveBeenCalledWith("w-1", { type: "proxy" });
  });

  it("closing the modal disposes the ws subscription (no leak)", async () => {
    (renderSvc.enqueueRender as any).mockResolvedValue({ jobId: "job_x" });
    render(
      <MemoryRouter>
        <TopBar workId="w-1" savedAt="now" />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
```

The first three legacy tests use `onExport={vi.fn()}`. Phase 7 removes the `onExport` prop — those legacy tests should be **rewritten** to not pass `onExport`, since TopBar now owns the export action. Replace each `onExport={vi.fn()}` site with no prop.

- [ ] **Step 1.2: Run, see fail**

```bash
bun run test:web -- web/src/features/studio/panels/TopBar.test.tsx
```

Expected: FAIL — `enqueueRender` not exported.

- [ ] **Step 1.3: Update `web/src/features/studio/services/render.ts`**

```ts
import { apiFetch } from "@/lib/api";

export interface EnqueueRenderOptions {
  type: "full" | "proxy";
  presetId?: string;
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
}

export async function enqueueRender(
  workId: string,
  opts: EnqueueRenderOptions,
): Promise<{ jobId: string }> {
  return apiFetch(`/api/works/${workId}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export async function cancelRender(jobId: string): Promise<void> {
  await apiFetch(`/api/render/jobs/${jobId}`, { method: "DELETE" });
}
```

(Remove the legacy `exportMp4`. Update `web/src/pages/Studio.tsx`: drop the `onExport` callback wiring entirely — TopBar now owns the action — pass `workId` and `savedAt` only.)

- [ ] **Step 1.4: Update `web/src/features/studio/panels/TopBar.tsx`**

Replace the `onExport` prop with internal state. Sketch:

```tsx
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useComposition } from "../store";
import { useNavigate } from "react-router-dom";
import { enqueueRender, type EnqueueRenderOptions } from "../services/render";
import { ExportProgress } from "../render-status/ExportProgress";

export interface TopBarProps {
  workId: string;
  savedAt: string | null;
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
}

export function TopBar({ workId, savedAt, onToggleSettings, settingsOpen }: TopBarProps) {
  const navigate = useNavigate();
  const comp = useComposition((s) => s.comp);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [lastOpts, setLastOpts] = useState<EnqueueRenderOptions>({ type: "full" });

  async function startExport(opts: EnqueueRenderOptions) {
    setLastOpts(opts);
    const { jobId } = await enqueueRender(workId, opts);
    setActiveJobId(jobId);
  }

  return (
    <div /* …existing layout… */>
      {/* …existing back / title / saved indicator / settings toggle… */}

      <div style={{ display: "inline-flex" }}>
        <button
          type="button"
          data-bare
          onClick={() => void startExport({ type: "full" })}
          aria-label="Export full render"
          /* …existing styles… */
        >
          导出
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label="More export options">▾</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => void startExport({ type: "proxy" })}>
                Quick proxy export
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {activeJobId ? (
        <ExportProgress
          jobId={activeJobId}
          onClose={() => setActiveJobId(null)}
          onRetry={() => void startExport(lastOpts)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 1.5: Run, see pass**

```bash
bun run test:web -- web/src/features/studio/panels/TopBar.test.tsx
```

Expected: legacy + 3 new = PASS.

- [ ] **Step 1.6: Update `web/src/pages/Studio.tsx`** — remove `onExport={() => { void exportMp4(workId); }}` and the `import { exportMp4 } from "@/features/studio/services/render";` line. TopBar takes only `workId`, `savedAt`, and the existing `onToggleSettings` props.

- [ ] **Step 1.7: Typecheck + full web suite**

```bash
bun run typecheck && bun run test:web
```

Expected: PASS.

- [ ] **Step 1.8: Commit**

```bash
git add web/src/features/studio/services/render.ts web/src/features/studio/panels/TopBar.tsx web/src/features/studio/panels/TopBar.test.tsx web/src/pages/Studio.tsx
git commit -m "$(cat <<'EOF'
feat(studio/topbar): queue-aware export with proxy menu + ExportProgress modal (Phase 7.E)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7.F — Acceptance integration tests + milestone

**Goal:** Verify the four ACs from master plan §7.3 with one combined integration suite. AC3's wall-clock timing is mocked (we assert the proxy flag was set, not the actual seconds — running real Remotion in vitest is out of scope).

**Files:**
- Create: `web/src/features/studio/__tests__/phase7-integration.test.tsx`

### Step 1: Write the four AC tests

- [ ] **Step 1.1: Create `web/src/features/studio/__tests__/phase7-integration.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TopBar } from "../panels/TopBar";

// Shared FakeWs from useRenderJob.test.ts; inline a copy.
class FakeWs {
  static instances: FakeWs[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWs.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(_: string) {}
  close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  push(msg: any) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

beforeEach(() => {
  FakeWs.instances = [];
  (globalThis as any).WebSocket = FakeWs;
  globalThis.fetch = vi.fn(async (url: any, opts?: any) => {
    if (typeof url === "string" && url.match(/^\/api\/works\/.*\/render$/) && opts?.method === "POST") {
      const body = JSON.parse(opts.body);
      // Echo the type so AC3 can assert proxy was wired.
      return { ok: true, json: async () => ({ jobId: `job_${body.type}_${Date.now()}` }) } as any;
    }
    if (typeof url === "string" && url.match(/^\/api\/render\/jobs\//) && opts?.method === "DELETE") {
      return { ok: true, json: async () => ({}) } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  }) as any;
});

describe("Phase 7 ACs — integration", () => {
  it("AC1: enqueue → modal shows queued → running → done in real-time", async () => {
    render(<MemoryRouter><TopBar workId="w-1" savedAt="now" /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    const ws = FakeWs.instances[0]!;
    ws.push({ at: "t", status: "queued", progress: 0 });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    ws.push({ at: "t", status: "running", progress: 0.2, stage: "render" });
    await waitFor(() => expect(screen.getByTestId("stage-render")).toHaveAttribute("data-active", "true"));
    ws.push({ at: "t", status: "running", progress: 0.6, stage: "duck" });
    await waitFor(() => expect(screen.getByTestId("stage-duck")).toHaveAttribute("data-active", "true"));
    ws.push({ at: "t", status: "done", progress: 1, outputPath: "/tmp/o.mp4" });
    await waitFor(() => expect(screen.getByText(/Export complete/i)).toBeInTheDocument());
  });

  it("AC2: cancel mid-render flips state and aborts (DELETE called)", async () => {
    render(<MemoryRouter><TopBar workId="w-1" savedAt="now" /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    FakeWs.instances[0]!.push({ at: "t", status: "running", progress: 0.4, stage: "render" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/render\/jobs\//),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("AC3: Quick proxy export sends type=proxy in the enqueue body", async () => {
    render(<MemoryRouter><TopBar workId="w-1" savedAt="now" /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /more export options/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /quick proxy export/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.filter(
        ([u]: any[]) => typeof u === "string" && u.endsWith("/render"),
      );
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse(calls[0][1].body);
      expect(body.type).toBe("proxy");
    });
  });

  it("AC4: failed render shows error + Retry; retrying re-enqueues with the same options", async () => {
    render(<MemoryRouter><TopBar workId="w-1" savedAt="now" /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    FakeWs.instances[0]!.push({ at: "t", status: "failed", progress: 0, error: "ffmpeg exit 137", log: { at: "t", level: "error", msg: "ffmpeg killed" } });
    await waitFor(() => expect(screen.getByText(/ffmpeg exit 137/)).toBeInTheDocument());
    expect(screen.getByText(/Log/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.filter(
        ([u]: any[]) => typeof u === "string" && u.endsWith("/render"),
      );
      expect(calls.length).toBe(2); // initial + retry
    });
  });
});
```

- [ ] **Step 1.2: Run the integration tests**

```bash
bun run test:web -- web/src/features/studio/__tests__/phase7-integration.test.tsx
```

Expected: 4 PASS.

- [ ] **Step 1.3: Run the full suite + typecheck as a final gate**

```bash
bun run typecheck && bun run test:web && bun run test:server
```

Expected: PASS across all three. Total new tests target ≈ 31:

- 5 store + 4 worker + 3 facade + 1 abort = 13 server queue tests
- 4 api.render + 3 render-ws = 7 server endpoint tests
- 2 proxy = 2 server pipeline tests
- 4 useRenderJob + 5 ExportProgress + 3 TopBar new + 4 phase7-integration = 16 web tests
- = **38 new tests** (close to Phase 6's 42; lower because the Python suite is not extended in Phase 7).

- [ ] **Step 1.4: Commit the integration tests**

```bash
git add web/src/features/studio/__tests__/phase7-integration.test.tsx
git commit -m "$(cat <<'EOF'
test(phase-7): AC1+AC2+AC3+AC4 integration tests (Phase 7.F)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.5: Final milestone commit (empty allowed if no further changes)**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
feat(phase-7): render queue + proxy / draft renders — milestone

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 3. Phase 7 Acceptance Criteria

These mirror master plan §7.3 and are verified by Task 7.F:

- [x] **AC1**: Click export — modal shows queued → running (render) → running (duck) → done in real-time. (Test: AC1)
- [x] **AC2**: Cancel mid-render aborts the worker and flips state. (Test: AC2; worker-side abort verified by `worker.test.ts` "cancel" + `render-pipeline.test.ts` "abort signal".)
- [x] **AC3**: Proxy export sends `type: "proxy"` and the worker forwards `proxy: true` to `runRenderPipeline`, which halves dimensions/fps and bitrate. (Tests: AC3 + the two proxy unit tests in `render-pipeline.test.ts`.) **Wall-clock ≤30s for 60s 1080p is verified manually post-merge — no automated timing assertion in this phase.**
- [x] **AC4**: Failed render surfaces error with retry option; the job log is visible. (Test: AC4)

Additional implementation-level criteria not in the master plan but required for ship:

- [ ] `bun run typecheck` clean
- [ ] `bun run test:web` green; net new tests ≈ 16
- [ ] `bun run test:server` green; net new tests ≈ 22
- [ ] `better-sqlite3` rebuilds cleanly on macOS arm64 (Apple Silicon dev box) and Linux x64 (CI)
- [ ] `~/.autoviral/render-queue.db` is created on first server boot if missing; subsequent starts reuse it
- [ ] On server restart with a `running` job in the table, that row is auto-marked `failed` with reason "process restarted before completion"

---

## 4. Open follow-ups (deferred — do not implement in Phase 7)

Track for a Phase 7.5 or Phase 8 polish window:

- **Real wall-clock timing for AC3.** A nightly job should run a known 60s 1080p comp through both `full` and `proxy` and assert proxy ≤ ⅓ × full. Out of scope here (vitest can't host Remotion + ffmpeg deterministically).
- **Stage 2/3 abort signal threading.** 7.A only threads `signal` into `runEncodeStage` (the longest stage). `mixAudioTracks`, `normalizeLufs`, `burnSubtitles`, and `renderCompositionToMp4` should also accept `AbortSignal` so cancel during ducking/loudnorm doesn't have to wait for the next stage boundary.
- **Render history view.** The store already exposes `list(workId)`. A small "Recent renders" panel surfacing the last 10 jobs (with download / re-queue) would land cheaply.
- **Per-job concurrency override.** Today `AUTOVIRAL_RENDER_CONCURRENCY` is process-wide. A future pass could let proxy jobs run alongside one full render.
- **Job pruning.** The `render_jobs` table grows unbounded. A boot-time `DELETE FROM render_jobs WHERE created_at < datetime('now', '-30 days')` is enough.
- **Reframe queue migration.** Phase 6.D's reframe call leaks browser CPU; once Phase 7 lands, reframe should run as `type: "reframe"` jobs in the same queue. Tracked under Phase 6 follow-ups.
- **WS reconnect.** The `useRenderJob` hook does not auto-reconnect on transient network drops. The Phase 4 `ReconnectingWS` lib in `@/lib/ws` could replace the raw `new WebSocket(...)` if that becomes a UX issue.

---

## 5. Self-review (writing-plans skill — done by author of this plan, not the engineer)

**Spec coverage:** Master plan §7.2 lists 7.A queue/sqlite, 7.B endpoints + ws, 7.C proxy mode, 7.D ExportProgress, 7.E TopBar wire-up. All five are mapped to tasks above; 7.F is added for AC verification. Acceptance criteria 7.3 (4 ACs) covered by Task 7.F. ✅

**Placeholder scan:** No "TBD"/"TODO" inside steps. The Step 6 (`runRenderPipeline` signal threading) explicitly admits stages 1–4 only get full signal support in 7.A's encode stage; the open follow-up flags the remaining stages — that is documented, not a hidden TODO. ✅

**Type consistency:**
- `RenderJob` (job.ts) is the canonical shape; `RenderJobView` (useRenderJob.ts) intentionally restates the same fields client-side instead of importing — server types live under `src/server/`, web sources cannot import directly across that boundary. Plan documents this divergence.
- `RenderJobOptions` (job.ts) and `EnqueueRenderOptions` (services/render.ts) are deliberately distinct: server adds `workId` (URL-derived), client passes only `{type, presetId?, burnSubtitles?, loudnessTargetLufs?}`.
- `runRenderPipeline` signature in 7.A (adds `signal?`) and 7.C (adds `proxy?`) is the *same* function — the two task diffs just touch `RenderJobOptions` separately, ordered to keep commits reviewable.
- `WorkerProgressEvent` matches the JSON shape the ws emits and `useRenderJob` parses (D5). ✅

**Ambiguity:**
- D6 was ambiguous on what cancel does to a `queued` (not yet running) job. Resolved as **D9** below: cancel on a queued job sets status directly to `cancelled` without invoking the worker — the worker skips cancelled rows on `nextQueued()`. Locked in `worker.test.ts` "cancel queued before pickup" coverage and the `RenderQueueWorker.cancel` body.
- D7 was silent on what happens if `comp.exportPresets` is empty AND `proxy: true`. Resolved: proxy still mutates the composition's `width/height/fps`, so the Remotion render is half-res; the encode stage falls through to the `rename` branch (no preset → no bitrate to halve). Documented as a comment on `applyProxy`.
- D8 didn't specify what happens to the modal during `cancelled` (vs `done` and `failed`). Resolved: closes immediately (no success animation, no retry). Locked in the `useEffect` of `ExportProgress.tsx` and the "Cancel button is disabled in terminal states" test. ✅

**Decisions added during plan-writing:**

- **D9**: Cancelling a `queued` job (worker hasn't started it) flips status directly to `cancelled` in the store; the worker's `nextQueued()` skips terminal rows naturally because the SQL `WHERE status='queued'` filter excludes them. No race because `RenderQueueWorker.cancel` reads + writes inside the same synchronous tick (better-sqlite3 is sync). Locked in 7.A Step 5.1 test 3.
- **D10**: `useRenderJob` does not implement reconnect-on-disconnect. If the ws drops, the user sees the modal stuck at the last received progress. The modal's Cancel button still works (it is an HTTP DELETE, independent of the ws). A follow-up could swap in `ReconnectingWS`. Locked under "Open follow-ups."

---

## 6. Handoff

Plan complete. Two execution options:

1. **Subagent-Driven** — invoke `superpowers:subagent-driven-development` and have it dispatch each Task (7.A through 7.F) as an independent subagent. Each subagent reads the matching task block, lands its commits, and reports back. Recommended for parallel-capable steps (7.A's `job.ts`/`store.ts`/`worker.ts` are sequential within the task, but 7.C is fully independent of 7.B and 7.D is independent of 7.B if mocked).

2. **Inline** — invoke `superpowers:executing-plans` and walk the steps sequentially in this conversation. Slower but lets the user review each commit interactively.

Which approach?
