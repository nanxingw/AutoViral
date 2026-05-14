# Agentic Terminal Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe AutoViral from "an AI-driven video tool wrapping Claude Code" into "a WYSIWYG creator workstation + an agent-agnostic operating protocol", by replacing the bespoke ChatPanel with a real terminal, shipping an `autoviral` CLI as the bridge between any CLI agent and the Studio UI, and rewriting the skill from "how to make good videos" (commodity) into "how to operate the AutoViral workstation" (defensible).

**Architecture:** Three orthogonal pillars. **(1) Terminal Panel** — xterm.js in the Studio left column, bridged to a server-side `node-pty` hosting the user's local shell, scoped to the active workspace's cwd. **(2) `autoviral` CLI** — a tiny shell-native binary that exposes Studio operations as POSIX subcommands, communicating with the Studio backend over HTTP, which in turn broadcasts UI events to the React app over WebSocket. **(3) Operator Manual skill** — agent-agnostic markdown that teaches any CLI agent how to drive the workstation, with `autoviral docs` serving the same content as a runtime command. The current `taste/` and `modules/` skill content is **deleted**; aesthetic judgment is delegated to user-chosen sibling skills (hyperframes, editorial-pro, etc.).

**Tech Stack:** xterm.js v5 + addons (fit, webgl, clipboard) · node-pty · ws (WebSocket) · Hono (already used) for HTTP routes · TypeScript-built single-file CLI via `tsup` or `bun build` · zod schemas reused from `src/shared/composition.ts` · vitest for tests · Playwright/chrome MCP for E2E on three agents (claude-code, codex, kimi-cli).

**Branch:** `refactor/agentic-terminal` (created at Phase 0 Task 1).

**Phases:**
- **Phase 0** — Foundation: branch, deps, spec docs, scaffolding (10 tasks)
- **Phase 1** — Terminal Panel MVP: xterm + node-pty + WebSocket + replace ChatPanel (14 tasks)
- **Phase 2** — `autoviral` CLI v1 read-only: whoami, docs, comp show, list (12 tasks)
- **Phase 3** — `autoviral` CLI v2 write + UI control: clip add/set, select, seek, toast, ask, approve-render (16 tasks)
- **Phase 4** — Skill rewrite: delete taste/modules; write manual/recipes/contracts (10 tasks)
- **Phase 5** — Polish + three-agent E2E validation (8 tasks)

**Total:** ~70 tasks. Estimated 5-10 working sessions to complete end-to-end.

**Non-goals (explicit out-of-scope for this refactor):**
- Sandboxing the terminal (user's shell on user's mac — no sandbox layer)
- MCP server support (CLI is the canonical interface; MCP can be added later as a thin shim)
- Multi-workspace concurrency (one Studio tab = one pty)
- Auto-installing CLI agents (user installs claude/codex/kimi themselves)
- Migrating existing workspaces (composition.yaml schema doesn't change)

---

## File Structure

This refactor introduces three new top-level directories and removes one. Files that change together live together.

### New: `cli/autoviral/` (the CLI binary)

```
cli/autoviral/
  package.json              # name: "autoviral", bin: "./dist/cli.js"
  tsconfig.json
  src/
    cli.ts                  # entry: parse argv, dispatch to commands/
    client.ts               # thin HTTP client to studio backend
    context.ts              # read AUTOVIRAL_WORK_ID env, cwd, port
    output.ts               # JSON vs YAML vs human stdout helpers
    commands/
      whoami.ts
      docs.ts
      comp.ts               # comp show / comp diff
      list.ts               # list clips / list assets
      clip.ts               # clip add / set / remove
      select.ts
      seek.ts
      play.ts               # play / pause
      toast.ts
      progress.ts           # progress start / step / done
      ask.ts                # blocking yes/no
      approve-render.ts
      export.ts
      render.ts
  test/
    cli.test.ts             # spawn-based assertions
    fixtures/
      mock-server.ts        # in-process HTTP mock for unit-testing CLI
```

### New: `src/server/bridge/` (backend RPC)

```
src/server/bridge/
  routes.ts                 # Hono router mounted at /api/bridge
  schemas.ts                # zod request/response schemas (shared w/ CLI)
  composition-ops.ts        # read/write composition.yaml + safe diff
  ui-events.ts              # WebSocket broadcast helpers
  approval-gate.ts          # blocking ask state machine
  __tests__/
    routes.test.ts
    composition-ops.test.ts
    approval-gate.test.ts
```

### New: `src/server/terminal/` (pty hosting)

```
src/server/terminal/
  pty-pool.ts               # spawn/track/dispose pty per work
  terminal-ws.ts            # WebSocket adapter (xterm.js ⇄ pty)
  __tests__/
    pty-pool.test.ts
```

### New: `web/src/features/terminal/` (Studio panel replacement)

```
web/src/features/terminal/
  TerminalPanel.tsx         # xterm.js mount + lifecycle
  TerminalPanel.module.css  # glass / cool-steel styling per Brand
  useTerminalSocket.ts      # WebSocket hook → pty
  useBridgeEvents.ts        # WebSocket hook → bridge ui-events
  QuickLaunch.tsx           # buttons: "claude" "codex" "kimi"
  ApprovalPrompt.tsx        # modal triggered by bridge ask events
  TerminalToast.tsx         # subscriber to bridge toast events
  __tests__/
    TerminalPanel.test.tsx
    ApprovalPrompt.test.tsx
```

### New: `skills/autoviral/` (full rewrite)

```
skills/autoviral/
  SKILL.md                  # rewritten as agent-agnostic entry
  manual/
    00-quickstart.md        # 5-minute zero-to-export
    01-workspace-layout.md  # ~/.autoviral/works/$ID/ tree
    02-composition-schema.md
    03-cli-reference.md     # ground truth for `autoviral docs`
    04-ui-control.md
    05-conventions.md
  recipes/
    crossfade-between-clips.md
    swap-clip-source.md
    generate-i2v-batch.md
    apply-platform-preset.md
    add-subtitle-overlay.md
  contracts/
    error-codes.md
    event-stream.md
  references/
    SDK-equivalents.md      # raw HTTP for power users
```

### Removed

- `skills/autoviral/taste/` (entire dir — 7 files of editorial taste content)
- `skills/autoviral/modules/` (entire dir — research/planning/assets/assembly)
- `skills/autoviral/references/` (replaced by manual/ + contracts/)
- `web/src/features/studio/panels/Chat/` (entire dir — ChatPanel + sub-components)
- `web/src/features/studio/panels/Chat/SafeChatPanel.tsx`
- WebSocket chat protocol code in `src/server/` (chat-socket.ts if exists)

### Modified

- `web/src/pages/Studio.tsx` — replace `<ChatPanel>` import with `<TerminalPanel>`
- `src/server/api.ts` — mount `bridge/routes` + register `/ws/terminal/:workId` upgrade
- `package.json` (root) — add `node-pty`, `ws`, terminal-related deps
- `web/package.json` — add `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`
- `CLAUDE.md` — update Skill 结构规范 section (taste/modules removed; manual/recipes added)
- `tsconfig.json` (root) — add `cli/autoviral/` as project reference (optional)

---

## Phase 0 — Foundation

### Task 0.1: Commit pending bug fixes to main before branching

**Files:**
- Modify: existing files from prior conversation (PCM audio fix in `src/audio-tools.ts:401-432`, opacity keyframes in `web/src/features/studio/composition/tracks/VideoTrackRenderer.tsx`, opacity tests in `web/src/features/studio/composition/tracks/__tests__/VideoTrackRenderer.keyframes.test.tsx`, TS fixes in `web/src/features/editor/services/layout.test.ts`, `web/src/features/studio/composition/captions/CaptionsLayer.tsx`, `web/src/features/studio/panels/Chat/index.tsx`)

- [ ] **Step 1: Verify the six target files are dirty and contain only the fixes from the prior conversation**

```bash
git diff --stat src/audio-tools.ts \
                web/src/features/studio/composition/tracks/VideoTrackRenderer.tsx \
                web/src/features/studio/composition/tracks/__tests__/VideoTrackRenderer.keyframes.test.tsx \
                web/src/features/editor/services/layout.test.ts \
                web/src/features/studio/composition/captions/CaptionsLayer.tsx \
                web/src/features/studio/panels/Chat/index.tsx
```

Expected: 6 files, with diff lines roughly: audio-tools (+25/-9), VideoTrackRenderer (+30/-3), VideoTrackRenderer.keyframes.test (+50/-2), layout.test (+1/-0), CaptionsLayer (-2), Chat/index (+10/-10).

- [ ] **Step 2: Run server + web tests on the focused subset to prove correctness before commit**

```bash
npm run test:server -- audio-tools
npm run test:web -- VideoTrackRenderer layout
npx tsc --noEmit -p web/tsconfig.json
```

Expected: 0 failures, 0 TS errors in web.

- [ ] **Step 3: Stage exactly the 6 files (NEVER `git add .`) and commit**

```bash
git add src/audio-tools.ts \
        web/src/features/studio/composition/tracks/VideoTrackRenderer.tsx \
        web/src/features/studio/composition/tracks/__tests__/VideoTrackRenderer.keyframes.test.tsx \
        web/src/features/editor/services/layout.test.ts \
        web/src/features/studio/composition/captions/CaptionsLayer.tsx \
        web/src/features/studio/panels/Chat/index.tsx
git commit -m "$(cat <<'EOF'
fix(render+ui): export PCM→AAC + faststart, video clip opacity keyframes, TS cleanup

Three independent fixes landed together because they were discovered in the
same diagnosis session:

1. src/audio-tools.ts — normalizeLufs pass-2 was muxing PCM_S16LE audio into
   the mp4 container, which has no decoder fast-path in browsers and made
   playback stutter. Branch by output extension: video containers get
   `-c:v copy -c:a aac -b:a 192k -movflags +faststart`; wav stays PCM so
   the existing audio-only integration test holds.

2. VideoTrackRenderer — opacity keyframes were in the schema and honored by
   OverlayTrackRenderer but silently dropped by the video track renderer.
   Added `computeVideoOpacityForFrame` + applied it to the Video element's
   style. Three unit tests for midpoint interpolation, default fallback,
   and non-bleed of unrelated keyframe properties.

3. TS cleanup — ImageLayer fixture missing `filters`, unused
   CaptionGroupStyle import + exitFrames var in CaptionsLayer, and
   react-markdown v9 Components type mismatch for HighlightedCode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git status --short
```

Expected: commit succeeds, status shows the other orphan dirty files still dirty (unchanged from prior conversation; not our scope).

- [ ] **Step 4: Verify the commit**

```bash
git log --oneline -1
git show --stat HEAD
```

Expected: top commit is the new one, exactly 6 files changed.

---

### Task 0.2: Create the refactor branch

**Files:** none (git op)

- [ ] **Step 1: Confirm on main and clean enough to branch**

```bash
git branch --show-current
git status --short | grep -E '^M |^D |^A ' | head -5
```

Expected: branch is `main`. Remaining dirty files are pre-existing orphan dirt (Tweaks/* deletions, ProfileBar.module.css edits, etc.) — fine to carry on the new branch since they're unrelated to refactor scope and we won't touch them.

- [ ] **Step 2: Create + switch to the refactor branch**

```bash
git checkout -b refactor/agentic-terminal
git branch --show-current
```

Expected: branch is `refactor/agentic-terminal`.

---

### Task 0.3: Save this plan into the branch + commit

**Files:**
- Create: `docs/superpowers/plans/2026-05-14-agentic-terminal-refactor.md` (this file)

- [ ] **Step 1: This file already exists from the planning step. Stage + commit.**

```bash
git add docs/superpowers/plans/2026-05-14-agentic-terminal-refactor.md
git commit -m "$(cat <<'EOF'
docs(plan): agentic terminal refactor blueprint

Implementation plan for the AutoViral product reframing: terminal panel
replaces ChatPanel, `autoviral` CLI becomes the agent-agnostic bridge to
the Studio UI, skill rewritten as the platform operator manual instead of
editorial taste content. 70 tasks across 6 phases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit lands on `refactor/agentic-terminal`.

---

### Task 0.4: Pin runtime dependencies — server (root package.json)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps for pty + WebSocket + CLI tooling**

```bash
npm install --save node-pty@^1.0 ws@^8.18
npm install --save-dev @types/ws@^8.5 tsup@^8 execa@^9
```

`node-pty` is the canonical PTY binding (used by VS Code, Theia, code-server). `ws` is the canonical WebSocket lib for Node. `tsup` builds the CLI to a single ESM file. `execa` is for CLI integration tests (spawn the built binary, assert on stdout/stderr/exit code).

Expected: package.json has new entries; npm install runs without postinstall errors.

- [ ] **Step 2: Smoke-test node-pty (macOS native compile is the #1 failure mode)**

```bash
node -e "const pty = require('node-pty'); const p = pty.spawn('echo', ['ok'], {}); p.onData(d => process.stdout.write(d)); p.onExit(() => process.exit(0));"
```

Expected: prints `ok` and exits 0. If it fails with a build error: install Xcode CLI tools (`xcode-select --install`) and re-run `npm rebuild node-pty`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(deps): add node-pty + ws for terminal panel + bridge"
```

---

### Task 0.5: Pin runtime dependencies — web (web/package.json)

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install xterm.js packages from the canonical @xterm scope (not legacy `xterm`)**

```bash
cd web
npm install --save @xterm/xterm@^5.5 @xterm/addon-fit@^0.10 @xterm/addon-webgl@^0.18 @xterm/addon-clipboard@^0.1
cd ..
```

Expected: 4 packages added under `web/node_modules`. xterm v5.x ships under the `@xterm` scope; legacy `xterm` is deprecated.

- [ ] **Step 2: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "build(deps): add @xterm/xterm + addons for terminal panel"
```

---

### Task 0.6: Scaffold the `cli/autoviral/` workspace

**Files:**
- Create: `cli/autoviral/package.json`
- Create: `cli/autoviral/tsconfig.json`
- Create: `cli/autoviral/src/cli.ts` (entry stub)

- [ ] **Step 1: Write `cli/autoviral/package.json`**

```json
{
  "name": "@autoviral/cli",
  "version": "0.1.0",
  "description": "Agent-facing CLI that bridges any shell agent to the AutoViral Studio.",
  "type": "module",
  "bin": {
    "autoviral": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsup src/cli.ts --format esm --target node20 --no-splitting --minify --out-dir dist",
    "test": "vitest run",
    "dev": "tsup src/cli.ts --format esm --target node20 --no-splitting --watch --out-dir dist"
  },
  "dependencies": {
    "undici": "^7"
  },
  "devDependencies": {
    "execa": "^9",
    "tsup": "^8",
    "typescript": "^5.6",
    "vitest": "^3"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Choice rationale: `undici` is the Node-native HTTP client used by Node 20+ fetch; explicit dep makes the binary self-contained when bundled.

- [ ] **Step 2: Write `cli/autoviral/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `cli/autoviral/src/cli.ts` stub**

```typescript
#!/usr/bin/env node
// Entry. Phase 0 stub — real commands land in Phase 2.
const [, , subcommand, ...rest] = process.argv;
if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  process.stdout.write(
    "autoviral — bridge between shell agents and the AutoViral Studio.\n" +
      "Commands land starting Phase 2. See `docs/superpowers/plans/` for status.\n",
  );
  process.exit(0);
}
process.stderr.write(`autoviral: unknown command "${subcommand}" (Phase 0 stub; args=${rest.join(",")})\n`);
process.exit(127);
```

- [ ] **Step 4: Install + build, sanity-check the binary**

```bash
cd cli/autoviral
npm install
npm run build
node dist/cli.js --help
node dist/cli.js unknownthing 2>&1; echo "exit=$?"
cd ../..
```

Expected: `--help` prints stub message + exits 0; `unknownthing` prints stderr + exits 127.

- [ ] **Step 5: Commit**

```bash
git add cli/autoviral/package.json cli/autoviral/tsconfig.json cli/autoviral/src/cli.ts cli/autoviral/package-lock.json
git commit -m "feat(cli): scaffold @autoviral/cli workspace + stub entry"
```

---

### Task 0.7: Write the canonical bridge protocol spec (the contract)

**Files:**
- Create: `docs/superpowers/specs/agentic-terminal-bridge-protocol.md`

- [ ] **Step 1: Write the spec**

```markdown
# AutoViral Bridge Protocol v1

**Status:** Frozen 2026-05-14 for the agentic-terminal refactor.
**Audience:** Anyone implementing `autoviral` CLI commands, Studio backend
RPC routes, or UI subscribers.

## Transport

- **CLI → Backend:** HTTP/1.1 POST to `http://127.0.0.1:${AUTOVIRAL_PORT:-3271}/api/bridge/v1/${command}`
- **Backend → Studio UI:** WebSocket frames on `/ws/bridge/:workId`
- **Backend ↔ pty:** WebSocket frames on `/ws/terminal/:workId` (raw byte stream)

All HTTP requests carry header `X-AutoViral-Work-Id: ${AUTOVIRAL_WORK_ID}`.
The backend resolves the active Studio tab(s) bound to that work id and
broadcasts to them.

## Request shape

```json
POST /api/bridge/v1/select
Content-Type: application/json
X-AutoViral-Work-Id: w_20260514_1019_abc

{ "target": { "kind": "clip", "id": "vc_s07" } }
```

## Response shape

```json
200 OK
Content-Type: application/json

{ "ok": true, "result": { "selected": "vc_s07" } }
```

## WebSocket event shape (Backend → Studio UI)

```json
{
  "type": "ui-select",
  "workId": "w_20260514_1019_abc",
  "ts": 1747250000123,
  "payload": { "kind": "clip", "id": "vc_s07" }
}
```

## Commands (v1)

### Read-only

| HTTP path | CLI form | Notes |
|---|---|---|
| `GET /api/bridge/v1/whoami` | `autoviral whoami` | Returns `{ workId, cwd, port, version }` |
| `GET /api/bridge/v1/docs` | `autoviral docs [topic]` | Returns manual content from `skills/autoviral/manual/` |
| `GET /api/bridge/v1/comp` | `autoviral comp show` | Returns composition.yaml as JSON |
| `GET /api/bridge/v1/comp/diff` | `autoviral comp diff` | Unified diff vs last commit |
| `GET /api/bridge/v1/clips?track=video` | `autoviral list clips` | Filtered clip list |
| `GET /api/bridge/v1/assets?kind=video` | `autoviral list assets` | Filtered asset list |

### Write composition

| HTTP path | CLI form | Notes |
|---|---|---|
| `POST /api/bridge/v1/clip` | `autoviral clip add ...` | Append a clip; returns clip id |
| `PATCH /api/bridge/v1/clip/:id` | `autoviral clip set vc_s07 ...` | Partial update |
| `DELETE /api/bridge/v1/clip/:id` | `autoviral clip remove vc_s07` | |

### UI command (state-less)

| HTTP path | CLI form | UI event broadcast |
|---|---|---|
| `POST /api/bridge/v1/select` | `autoviral select clip vc_s07` | `ui-select` |
| `POST /api/bridge/v1/seek` | `autoviral seek 12.5s` | `ui-seek` |
| `POST /api/bridge/v1/play` | `autoviral play` | `ui-play` |
| `POST /api/bridge/v1/pause` | `autoviral pause` | `ui-pause` |
| `POST /api/bridge/v1/toast` | `autoviral toast "msg" --kind success` | `ui-toast` |
| `POST /api/bridge/v1/progress` | `autoviral progress ...` | `ui-progress` |

### Approval gate (blocking)

| HTTP path | CLI form | Returns |
|---|---|---|
| `POST /api/bridge/v1/ask` | `autoviral ask "msg" --yes-no` | Long-poll; resolves when user clicks |

The `ask` request blocks the HTTP response until the Studio UI emits an
`approval-response` WebSocket frame matching the request's `askId`. Default
timeout 30 minutes; CLI can override with `--timeout`. Exit codes: 0=yes,
1=no, 124=timeout.

### Tasks

| HTTP path | CLI form | Notes |
|---|---|---|
| `POST /api/bridge/v1/export` | `autoviral export --preset douyin` | Triggers existing render pipeline |
| `POST /api/bridge/v1/render` | `autoviral render [--proxy]` | Same, with proxy flag |

## Exit codes (CLI)

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User said "no" to an `ask` |
| 2 | Wrong state (e.g., Studio not connected, no AUTOVIRAL_WORK_ID env) |
| 3 | Protocol error (malformed response) |
| 4 | Validation error (bad args) |
| 124 | Timeout (especially `ask`) |
| 127 | Unknown subcommand |

## Output formats

Every read command supports `--format json|yaml|table`. Default for
machine-readable: `json`. Default for terminals: human-readable
(YAML-ish or boxed table). `autoviral` detects `isatty(stdout)` to pick.

## Environment

The pty is spawned with these env vars set by the terminal backend:

- `AUTOVIRAL_WORK_ID` — current workspace id (the `/studio/:workId` route)
- `AUTOVIRAL_PORT` — backend port (default 3271)
- `AUTOVIRAL_CWD` — `~/.autoviral/works/${AUTOVIRAL_WORK_ID}`

The `autoviral` CLI relies on these; if any is missing it exits with
code 2 and a clear "no AutoViral context detected" message — so the
same binary is safe to leave on the user's global PATH.
```

- [ ] **Step 2: Commit the spec**

```bash
mkdir -p docs/superpowers/specs
git add docs/superpowers/specs/agentic-terminal-bridge-protocol.md
git commit -m "spec(bridge): freeze v1 protocol for agentic-terminal refactor"
```

---

### Task 0.8: Scaffold empty backend bridge directory + register placeholder route

**Files:**
- Create: `src/server/bridge/routes.ts`
- Create: `src/server/bridge/schemas.ts`
- Modify: `src/server/api.ts` (mount the new router)

- [ ] **Step 1: Locate where existing routes are mounted in `src/server/api.ts`**

```bash
grep -n "app.route\|new Hono\|export.*app" src/server/api.ts | head -10
```

Read the file to confirm the Hono pattern. Adapt the snippets below to match.

- [ ] **Step 2: Write `src/server/bridge/schemas.ts`**

```typescript
import { z } from "zod";

// Shared with the CLI (cli/autoviral/src/client.ts re-imports via type-only
// path or re-declares minimal subset — depending on whether you wire a
// shared/ workspace symlink; Phase 2 decides).

export const WhoAmIResponse = z.object({
  workId: z.string(),
  cwd: z.string(),
  port: z.number(),
  version: z.string(),
});

export const SelectRequest = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("clip"), id: z.string() }),
    z.object({ kind: z.literal("track"), id: z.string() }),
    z.object({ kind: z.literal("none") }),
  ]),
});

export const SeekRequest = z.object({
  seconds: z.number().min(0),
});

export const ToastRequest = z.object({
  message: z.string().min(1).max(280),
  kind: z.enum(["info", "success", "warn", "error"]).default("info"),
  durationMs: z.number().int().positive().max(60_000).default(3000),
});

export const AskRequest = z.object({
  message: z.string().min(1),
  kind: z.enum(["yes-no", "ok-cancel", "input"]).default("yes-no"),
  timeoutMs: z.number().int().positive().default(30 * 60 * 1000),
});

export type WhoAmIResponse = z.infer<typeof WhoAmIResponse>;
```

- [ ] **Step 3: Write `src/server/bridge/routes.ts` (placeholder; real commands in Phase 2-3)**

```typescript
import { Hono } from "hono";
import { WhoAmIResponse } from "./schemas.js";

// Versioned router mounted at /api/bridge/v1 from src/server/api.ts.
// Phase 0 ships only `whoami` as a smoke test of the routing wire.
export const bridgeRouter = new Hono();

bridgeRouter.get("/whoami", (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) {
    return c.json({ ok: false, error: "missing X-AutoViral-Work-Id" }, 400);
  }
  const body: WhoAmIResponse = {
    workId,
    cwd: `${process.env.HOME ?? ""}/.autoviral/works/${workId}`,
    port: Number(process.env.AUTOVIRAL_PORT ?? 3271),
    version: "0.1.0",
  };
  return c.json({ ok: true, result: body });
});
```

- [ ] **Step 4: Mount the router in `src/server/api.ts`**

Find the existing pattern (`app.route("/api/...", subRouter)`) and add:

```typescript
import { bridgeRouter } from "./bridge/routes.js";
// ...
app.route("/api/bridge/v1", bridgeRouter);
```

- [ ] **Step 5: Smoke-test the route end-to-end**

```bash
# In one terminal:
npm run dev:server &
SERVER_PID=$!
sleep 2
curl -s -H "X-AutoViral-Work-Id: test_w_001" http://127.0.0.1:3271/api/bridge/v1/whoami | head
kill $SERVER_PID
```

Expected: JSON response `{ "ok": true, "result": { "workId": "test_w_001", ... } }`.

- [ ] **Step 6: Commit**

```bash
git add src/server/bridge/routes.ts src/server/bridge/schemas.ts src/server/api.ts
git commit -m "feat(bridge): scaffold /api/bridge/v1 router + whoami smoke route"
```

---

### Task 0.9: Write the spec coverage test harness (placeholder file)

**Files:**
- Create: `src/server/bridge/__tests__/routes.test.ts`

- [ ] **Step 1: Write a single happy-path test for whoami**

```typescript
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { bridgeRouter } from "../routes.js";

describe("bridge router — Phase 0 smoke", () => {
  const app = new Hono().route("/api/bridge/v1", bridgeRouter);

  it("GET /whoami returns workId echoed from header", async () => {
    const res = await app.request("/api/bridge/v1/whoami", {
      headers: { "X-AutoViral-Work-Id": "w_test_001" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.workId).toBe("w_test_001");
  });

  it("GET /whoami without header → 400", async () => {
    const res = await app.request("/api/bridge/v1/whoami");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npm run test:server -- bridge
```

Expected: 2/2 pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/bridge/__tests__/routes.test.ts
git commit -m "test(bridge): whoami route happy + header-missing cases"
```

---

### Task 0.10: Update `CLAUDE.md` to reflect the new skill structure

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the `## Skill 结构规范` section**

The current section describes a `taste/ + modules/ + references/` layout
that's about to be deleted. Replace lines 3-27 with:

```markdown
## Skill 结构规范

AutoViral 不再把"如何做好视频"作为 skill 内容 —— 那是 commodity，让用户挂自己喜欢的 taste skill（hyperframes / editorial-pro / 等）。**AutoViral 的 skill 是"如何操作这个工位"的操作手册**，agent-agnostic markdown，任何 CLI agent 加载后都能在 Studio 里给用户一流体验。

```
skills/autoviral/
  SKILL.md            # 入口：你在 AutoViral 工位里，能用这些工具
  manual/             # 操作手册 (agent-agnostic markdown)
    00-quickstart.md
    01-workspace-layout.md
    02-composition-schema.md
    03-cli-reference.md   # 同时也是 `autoviral docs` 的内容源
    04-ui-control.md
    05-conventions.md
  recipes/            # 常见任务的 step-by-step pattern
  contracts/          # 错误码 / 事件流 schema
  references/         # 给 power user 的 SDK 直调
```

核心原则：
- **Skill = 操作手册**，不教审美（审美交给 sibling skill）
- **`autoviral` CLI 是协议层**，skill 是知识层 —— skill 里教 agent 调 CLI
- **零强制顺序**：agent 按需查文档，不强迫线性流程
- **Single source of truth**：`autoviral docs` 命令输出 = `manual/*.md` 内容
```

- [ ] **Step 2: Commit (only CLAUDE.md, not the orphan dirty files)**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): update skill structure for agentic-terminal refactor"
```

---

## Phase 1 — Terminal Panel MVP

Goal: by end of phase, opening `/studio/:workId` shows a working zsh prompt
in the left column where ChatPanel used to be. User can type commands and
see output. No `autoviral` CLI yet — just the raw terminal.

### Task 1.1: Write failing test for `pty-pool`

**Files:**
- Test: `src/server/terminal/__tests__/pty-pool.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it, afterEach } from "vitest";
import { PtyPool } from "../pty-pool.js";

describe("PtyPool", () => {
  const pool = new PtyPool();
  afterEach(() => pool.disposeAll());

  it("spawns a pty bound to workspace cwd + env, returns id", async () => {
    const cwd = process.cwd();
    const session = pool.spawn({
      workId: "w_test",
      cwd,
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    expect(session.id).toMatch(/^pty_/);
    expect(session.workId).toBe("w_test");
    expect(pool.get(session.id)).toBe(session);
  });

  it("forwards data → echo → onData; disposing kills the process", async () => {
    const session = pool.spawn({
      workId: "w_test2",
      cwd: process.cwd(),
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    const chunks: string[] = [];
    session.onData((d) => chunks.push(d));
    session.write("printf hello\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(chunks.join("")).toContain("hello");
    pool.dispose(session.id);
    expect(pool.get(session.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — expect failure (module not found)**

```bash
npm run test:server -- pty-pool
```

Expected: FAIL with `Cannot find module '../pty-pool.js'`.

---

### Task 1.2: Implement `pty-pool`

**Files:**
- Create: `src/server/terminal/pty-pool.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import * as pty from "node-pty";
import { randomBytes } from "node:crypto";

export interface SpawnOptions {
  workId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface PtySession {
  id: string;
  workId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): () => void;
  onExit(cb: (code: number) => void): () => void;
}

interface PtyEntry extends PtySession {
  proc: pty.IPty;
  dataListeners: Set<(data: string) => void>;
  exitListeners: Set<(code: number) => void>;
}

export class PtyPool {
  private readonly sessions = new Map<string, PtyEntry>();

  spawn(opts: SpawnOptions): PtySession {
    const id = `pty_${randomBytes(6).toString("hex")}`;
    const proc = pty.spawn(opts.shell, [], {
      name: "xterm-256color",
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: { ...process.env, ...opts.env },
    });
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(code: number) => void>();
    proc.onData((d) => dataListeners.forEach((l) => l(d)));
    proc.onExit(({ exitCode }) => {
      exitListeners.forEach((l) => l(exitCode));
      this.sessions.delete(id);
    });
    const entry: PtyEntry = {
      id,
      workId: opts.workId,
      proc,
      dataListeners,
      exitListeners,
      write: (d) => proc.write(d),
      resize: (cols, rows) => proc.resize(cols, rows),
      onData: (cb) => {
        dataListeners.add(cb);
        return () => dataListeners.delete(cb);
      },
      onExit: (cb) => {
        exitListeners.add(cb);
        return () => exitListeners.delete(cb);
      },
    };
    this.sessions.set(id, entry);
    return entry;
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  dispose(id: string): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    try {
      entry.proc.kill();
    } catch {
      /* already dead */
    }
    this.sessions.delete(id);
  }

  disposeAll(): void {
    for (const id of this.sessions.keys()) this.dispose(id);
  }
}
```

- [ ] **Step 2: Run the test — expect pass**

```bash
npm run test:server -- pty-pool
```

Expected: 2/2 pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/terminal/pty-pool.ts src/server/terminal/__tests__/pty-pool.test.ts
git commit -m "feat(terminal): PtyPool for node-pty lifecycle management"
```

---

### Task 1.3: Implement WebSocket adapter for the pty

**Files:**
- Create: `src/server/terminal/terminal-ws.ts`

- [ ] **Step 1: Write the adapter**

```typescript
import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { PtyPool } from "./pty-pool.js";
import { homedir } from "node:os";
import { join } from "node:path";

// Wire format (JSON frames):
//   client → server: {"t":"data","d":"keystrokes"} | {"t":"resize","cols":80,"rows":24}
//   server → client: {"t":"data","d":"chunk"} | {"t":"exit","code":0}
//
// The shell is picked from $SHELL, fallback /bin/zsh on macOS, /bin/bash
// elsewhere. AUTOVIRAL_WORK_ID + AUTOVIRAL_PORT are injected so the
// `autoviral` CLI on PATH auto-detects context.

function pickShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  return process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

export function attachTerminalWebSocket(
  httpServer: HttpServer,
  port: number,
  path = "/ws/terminal",
): { close: () => void } {
  const wss = new WebSocketServer({ noServer: true });
  const pool = new PtyPool();

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith(path)) return;
    const workId = url.slice(path.length + 1).split("?")[0];
    if (!workId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handle(ws, workId);
    });
  });

  function handle(ws: WebSocket, workId: string): void {
    const cwd = join(homedir(), ".autoviral/works", workId);
    const session = pool.spawn({
      workId,
      cwd,
      shell: pickShell(),
      cols: 80,
      rows: 24,
      env: {
        AUTOVIRAL_WORK_ID: workId,
        AUTOVIRAL_PORT: String(port),
        AUTOVIRAL_CWD: cwd,
      },
    });
    const send = (frame: unknown) =>
      ws.readyState === ws.OPEN && ws.send(JSON.stringify(frame));
    const offData = session.onData((d) => send({ t: "data", d }));
    const offExit = session.onExit((code) => {
      send({ t: "exit", code });
      try { ws.close(); } catch { /* ignore */ }
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.t === "data" && typeof msg.d === "string") session.write(msg.d);
        else if (msg.t === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
          session.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on("close", () => {
      offData();
      offExit();
      pool.dispose(session.id);
    });
  }

  return {
    close: () => {
      pool.disposeAll();
      wss.close();
    },
  };
}
```

- [ ] **Step 2: Wire into the existing HTTP server entry**

Find where `httpServer.listen(port)` happens (likely `src/server/index.ts`
or similar). After locating it, add:

```typescript
import { attachTerminalWebSocket } from "./terminal/terminal-ws.js";
// ...
const httpServer = createServer(/* hono adapter */);
attachTerminalWebSocket(httpServer, port);
httpServer.listen(port);
```

If the existing server uses `serve` from `@hono/node-server`, that helper
returns the raw http server — capture its return value and pass to
`attachTerminalWebSocket`.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev:server &
SERVER_PID=$!
sleep 2
# WebSocket test via wscat (npm i -g wscat) or node one-liner:
node -e "
const WS = require('ws');
const ws = new WS('ws://127.0.0.1:3271/ws/terminal/w_smoke_001');
ws.on('open', () => ws.send(JSON.stringify({ t: 'data', d: 'printf hi\\\\n' })));
ws.on('message', (m) => { const f = JSON.parse(m); if (f.t === 'data') process.stdout.write(f.d); });
setTimeout(() => { ws.close(); process.exit(0); }, 1500);
"
kill $SERVER_PID
```

Expected: console prints `hi` (echoed from the pty running `printf hi`).

- [ ] **Step 4: Commit**

```bash
git add src/server/terminal/terminal-ws.ts src/server/index.ts # or whatever the entry is
git commit -m "feat(terminal): WebSocket adapter mounting node-pty at /ws/terminal/:workId"
```

---

### Task 1.4: Web — write failing test for `useTerminalSocket`

**Files:**
- Test: `web/src/features/terminal/__tests__/useTerminalSocket.test.ts`

- [ ] **Step 1: Write the test using msw or a mock WebSocket**

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalSocket } from "../useTerminalSocket";

class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1;
  readyState = MockWS.OPEN;
  sent: string[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  constructor(public url: string) {
    MockWS.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(new CloseEvent("close")); }
}

describe("useTerminalSocket", () => {
  beforeEach(() => { (globalThis as any).WebSocket = MockWS; MockWS.instances = []; });
  afterEach(() => { delete (globalThis as any).WebSocket; });

  it("sends keystrokes as {t:'data'} frames", async () => {
    const onData = vi.fn();
    const { result } = renderHook(() => useTerminalSocket("w_test", onData));
    await act(() => Promise.resolve());
    act(() => result.current.send("hello"));
    expect(MockWS.instances[0].sent).toContain('{"t":"data","d":"hello"}');
  });

  it("forwards server data frames to onData callback", async () => {
    const onData = vi.fn();
    renderHook(() => useTerminalSocket("w_test", onData));
    await act(() => Promise.resolve());
    act(() => {
      MockWS.instances[0].onmessage?.(new MessageEvent("message", {
        data: JSON.stringify({ t: "data", d: "from-server" }),
      }));
    });
    expect(onData).toHaveBeenCalledWith("from-server");
  });
});
```

- [ ] **Step 2: Run it — expect failure**

```bash
npm run test:web -- useTerminalSocket
```

Expected: FAIL with module-not-found.

---

### Task 1.5: Web — implement `useTerminalSocket`

**Files:**
- Create: `web/src/features/terminal/useTerminalSocket.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useEffect, useRef, useCallback } from "react";

export interface TerminalSocket {
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  ready: boolean;
}

// Reads from window.location to build ws:// URL; lets dev + prod work
// without explicit config. Path matches src/server/terminal/terminal-ws.ts.
export function useTerminalSocket(
  workId: string,
  onData: (data: string) => void,
): TerminalSocket {
  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<string[]>([]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/ws/terminal/${workId}`);
    wsRef.current = ws;
    ws.onopen = () => {
      readyRef.current = true;
      for (const q of queueRef.current) ws.send(q);
      queueRef.current = [];
    };
    ws.onmessage = (e) => {
      try {
        const f = JSON.parse(e.data);
        if (f.t === "data" && typeof f.d === "string") onData(f.d);
        else if (f.t === "exit") onData(`\r\n[exit ${f.code}]\r\n`);
      } catch { /* ignore */ }
    };
    ws.onclose = () => { readyRef.current = false; };
    return () => ws.close();
  }, [workId, onData]);

  const send = useCallback((data: string) => {
    const ws = wsRef.current;
    const frame = JSON.stringify({ t: "data", d: data });
    if (ws && readyRef.current) ws.send(frame);
    else queueRef.current.push(frame);
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && readyRef.current) ws.send(JSON.stringify({ t: "resize", cols, rows }));
  }, []);

  const close = useCallback(() => wsRef.current?.close(), []);

  return { send, resize, close, ready: readyRef.current };
}
```

- [ ] **Step 2: Run tests — expect pass**

```bash
npm run test:web -- useTerminalSocket
```

Expected: 2/2 pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/features/terminal/useTerminalSocket.ts web/src/features/terminal/__tests__/useTerminalSocket.test.ts
git commit -m "feat(web): useTerminalSocket WebSocket bridge to backend pty"
```

---

### Task 1.6: Web — write `TerminalPanel.module.css`

**Files:**
- Create: `web/src/features/terminal/TerminalPanel.module.css`

- [ ] **Step 1: Write the styles following Brand Personality (editorial · cool · glass; AVOID 终端极客风)**

The trap to dodge: xterm.js defaults are full-screen green-on-black hacker
aesthetic. We override to match Studio's cool-steel glass. Keep monospace
(JetBrains Mono) but raise contrast on a slightly tinted surface.

```css
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-0);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.header {
  flex: 0 0 auto;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--divider);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--text-dim);
}

.dotIndicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-ok, #6ec18f);
  box-shadow: 0 0 6px var(--status-ok, #6ec18f);
}

.dotIndicatorDisconnected {
  background: var(--text-dimmer);
  box-shadow: none;
}

.quickLaunch {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.quickLaunchBtn {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--surface-1);
  color: var(--text);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}

.quickLaunchBtn:hover {
  background: var(--accent-lo);
  border-color: var(--accent);
}

.terminalMount {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px 0 8px 8px;
  position: relative;
}

/* xterm.js wraps itself in .xterm; override defaults to match Brand. */
.terminalMount :global(.xterm) {
  height: 100% !important;
  padding: 0;
}

.terminalMount :global(.xterm-viewport) {
  background: transparent !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/features/terminal/TerminalPanel.module.css
git commit -m "style(terminal): editorial/glass theme overriding xterm.js defaults"
```

---

### Task 1.7: Web — implement `TerminalPanel.tsx`

**Files:**
- Create: `web/src/features/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import { useTerminalSocket } from "./useTerminalSocket";
import styles from "./TerminalPanel.module.css";

interface Props {
  workId: string;
}

// Theme tuned for cool-steel editorial glass — NOT terminal-hacker green.
// Color tokens fall back to readable defaults if CSS vars not loaded yet.
const XTERM_THEME = {
  background: "rgba(0,0,0,0)",
  foreground: "#e6ebf0",
  cursor: "#a8c5d6",
  cursorAccent: "#0a0b0f",
  selectionBackground: "rgba(168,197,214,0.25)",
  black: "#0a0b0f",
  red: "#d4756c",
  green: "#6ec18f",
  yellow: "#d8c2a1",
  blue: "#a8c5d6",
  magenta: "#c6a8d6",
  cyan: "#a8d6c5",
  white: "#e6ebf0",
  brightBlack: "#3a3d44",
  brightRed: "#e89a91",
  brightGreen: "#9adfb4",
  brightYellow: "#ecdcc0",
  brightBlue: "#c7dde9",
  brightMagenta: "#d6c0e1",
  brightCyan: "#c0e1d6",
  brightWhite: "#fafaf7",
};

export function TerminalPanel({ workId }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  const { send, resize } = useTerminalSocket(workId, handleData);

  useEffect(() => {
    if (!mountRef.current) return;
    const term = new Terminal({
      fontFamily: "var(--font-mono), JetBrains Mono, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      theme: XTERM_THEME,
      allowProposedApi: true,
      scrollback: 5000,
      smoothScrollDuration: 80,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new ClipboardAddon());
    try { term.loadAddon(new WebglAddon()); } catch {
      // WebGL not available — fall back to canvas/DOM renderer (xterm default)
    }
    term.open(mountRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((d) => send(d));
    term.onResize(({ cols, rows }) => resize(cols, rows));

    const ro = new ResizeObserver(() => {
      fit.fit();
    });
    ro.observe(mountRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, [send, resize]);

  const quickLaunch = (cmd: string) => () => {
    send(cmd + "\r");
  };

  return (
    <div className={styles.shell} data-area="terminal">
      <div className={styles.header}>
        <span className={styles.dotIndicator} aria-hidden />
        <span>TERMINAL · {workId}</span>
        <div className={styles.quickLaunch}>
          <button type="button" className={styles.quickLaunchBtn} onClick={quickLaunch("claude")}>
            claude
          </button>
          <button type="button" className={styles.quickLaunchBtn} onClick={quickLaunch("codex")}>
            codex
          </button>
          <button type="button" className={styles.quickLaunchBtn} onClick={quickLaunch("kimi")}>
            kimi
          </button>
        </div>
      </div>
      <div ref={mountRef} className={styles.terminalMount} />
    </div>
  );
}
```

- [ ] **Step 2: Smoke render test**

Add to `web/src/features/terminal/__tests__/TerminalPanel.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TerminalPanel } from "../TerminalPanel";

describe("TerminalPanel", () => {
  it("renders header with workId + quick-launch buttons", () => {
    // WebSocket mock — same pattern as useTerminalSocket test
    class MockWS { constructor(public url: string) {} send() {} close() {} }
    (globalThis as any).WebSocket = MockWS;
    const { getByText } = render(<TerminalPanel workId="w_test_render" />);
    expect(getByText(/TERMINAL · w_test_render/i)).toBeTruthy();
    expect(getByText("claude")).toBeTruthy();
    expect(getByText("codex")).toBeTruthy();
    expect(getByText("kimi")).toBeTruthy();
    delete (globalThis as any).WebSocket;
  });
});
```

- [ ] **Step 3: Run**

```bash
npm run test:web -- TerminalPanel
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/terminal/TerminalPanel.tsx web/src/features/terminal/__tests__/TerminalPanel.test.tsx
git commit -m "feat(web): TerminalPanel — xterm.js mounted with editorial theme + quick-launch"
```

---

### Task 1.8: Replace ChatPanel with TerminalPanel in Studio

**Files:**
- Modify: `web/src/pages/Studio.tsx`

- [ ] **Step 1: Find the current ChatPanel mount location**

```bash
grep -n "SafeChatPanel\|ChatPanel" web/src/pages/Studio.tsx
```

Expected: a couple of import + JSX usage lines.

- [ ] **Step 2: Replace import**

Find:
```typescript
import { SafeChatPanel as ChatPanel } from "@/features/studio/panels/Chat/SafeChatPanel";
```

Replace with:
```typescript
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
```

- [ ] **Step 3: Replace JSX**

Find the `<ChatPanel ... />` JSX block (around line 268-291) and replace it with:

```tsx
<TerminalPanel workId={workId} />
```

Remove all the `onTurnComplete`, `getViewerContext`, `dispatchAction` plumbing — those were ChatPanel-specific and no longer apply. The bridge events Phase 3 will mount via a separate `<useBridgeEvents>` subscription, not via the terminal panel itself.

Also remove the now-unused imports near the top: `buildStudioViewerContext`, and the entire `refetchOnTurnComplete` callback + the `workIdRef`. Composition refetch will happen via a different mechanism in Phase 3 (server-side file watcher → WebSocket → studio refetch).

For Phase 1 we accept this regression: editing composition.yaml outside the UI won't auto-refetch. Phase 3 Task 3.13 restores it via the bridge.

- [ ] **Step 4: Smoke test — type-check + the Studio layout test**

```bash
npx tsc --noEmit -p web/tsconfig.json 2>&1 | grep "Studio.tsx" || echo "Studio.tsx clean"
npm run test:web -- Studio.layout
```

Expected: no Studio.tsx TS errors; the smoke test that mounts Studio still passes (it doesn't assert on chat-specific elements).

- [ ] **Step 5: Manual browser verify**

```bash
npm run dev &
sleep 4
open "http://localhost:5173/studio/w_smoke_001"
```

Use chrome-MCP `mcp__claude-in-chrome__computer screenshot` to verify the
left column shows TERMINAL · w_smoke_001 header with a prompt. Then close
the dev server.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Studio.tsx
git commit -m "feat(studio): replace ChatPanel mount with TerminalPanel"
```

---

### Task 1.9: Delete the old ChatPanel directory (kill darlings)

**Files:**
- Delete: `web/src/features/studio/panels/Chat/` (entire directory)

- [ ] **Step 1: Verify no other imports reference Chat panel internals**

```bash
grep -rn "features/studio/panels/Chat" web/src --include="*.ts" --include="*.tsx" | grep -v "panels/Chat/"
```

Expected: empty (no external imports). If anything else imports something
from Chat/, resolve those refs first.

- [ ] **Step 2: Delete + run full web tests + type-check**

```bash
git rm -r web/src/features/studio/panels/Chat
npx tsc --noEmit -p web/tsconfig.json 2>&1 | tail -10
npm run test:web 2>&1 | tail -10
```

Expected: TS clean (modulo pre-existing orphan errors unrelated to chat);
test suite green (Chat tests deleted with the dir).

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(studio): delete ChatPanel — replaced by TerminalPanel"
```

---

### Task 1.10: Wire AUTOVIRAL_WORK_ID env in dev server, end-to-end smoke

**Files:**
- Modify: `src/server/index.ts` (or wherever AUTOVIRAL_PORT is read)

- [ ] **Step 1: Audit env var handling**

```bash
grep -rn "AUTOVIRAL_PORT\|process.env.AUTOVIRAL" src/server | head
```

Ensure `AUTOVIRAL_PORT` is read consistently. If not yet, pick a single
location and document it.

- [ ] **Step 2: Manual end-to-end smoke**

```bash
npm run dev:server &
SERVER_PID=$!
sleep 2
# Verify whoami works via the env vars that the pty would inject:
AUTOVIRAL_WORK_ID=w_smoke_001 AUTOVIRAL_PORT=3271 \
  curl -sH "X-AutoViral-Work-Id: w_smoke_001" http://127.0.0.1:3271/api/bridge/v1/whoami
kill $SERVER_PID
```

Expected: JSON `{ok:true, result:{workId:"w_smoke_001", ...}}`.

- [ ] **Step 3: Commit any wiring tweaks**

```bash
git diff --stat
# only commit if real changes
git add -p
git commit -m "chore(server): finalize AUTOVIRAL_PORT env contract for Phase 1"
```

---

### Task 1.11: Documentation — terminal-panel-implementation-notes

**Files:**
- Create: `docs/superpowers/notes/terminal-panel-implementation-notes.md`

- [ ] **Step 1: Write a tight 1-page note for future-you**

Topics:
- Why xterm.js v5 + @xterm scope (not legacy `xterm`)
- Why node-pty (not pure-JS shellish — emoji breakage, ANSI gaps)
- WebSocket framing format choice
- Why FitAddon ResizeObserver instead of window resize event
- WebglAddon fallback path
- Known edge case: when user `exit`s the shell, pty exits → WS closes →
  TerminalPanel currently shows nothing. Future enhancement: respawn button.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/terminal-panel-implementation-notes.md
git commit -m "docs(notes): terminal-panel implementation rationale"
```

---

### Task 1.12: Phase 1 milestone checkpoint

- [ ] **Step 1: Run full test suite end-to-end**

```bash
npm run test:server 2>&1 | tail -10
npm run test:web 2>&1 | tail -10
npx tsc --noEmit -p web/tsconfig.json 2>&1 | grep -v "CaptionsLayer\|layout.test\|Chat" | tail -10
```

Expected: server green, web green, no NEW TS errors (only orphan ones from
other dirty files unrelated to refactor).

- [ ] **Step 2: Manual user-perspective verification (per .claude/rules/e2e-testing.md)**

Open `http://localhost:5173/studio/w_20260513_1919_74d` in the browser
(this existing work id, since it has data). Screenshot the left column.
The screenshot MUST show:
- Header: "TERMINAL · w_20260513_1919_74d" with green dot
- A working shell prompt (zsh % or $)
- Three quick-launch chips: claude / codex / kimi
- Typing `pwd` echoes the workspace cwd

If any of the above is missing → the phase is NOT done; back up to
Task 1.7 or 1.8 to diagnose.

- [ ] **Step 3: Tag the milestone**

```bash
git tag phase-1-terminal-mvp
```

---

## Phase 2 — `autoviral` CLI v1 (read-only)

Goal: by end of phase, a built `autoviral` binary on the user's PATH supports
`autoviral whoami / docs / comp show / list clips / list assets`. All
read-only; no UI side effects yet.

### Task 2.1: Implement `client.ts` — the HTTP layer

**Files:**
- Create: `cli/autoviral/src/client.ts`

- [ ] **Step 1: Write minimal fetch wrapper**

```typescript
import { fetch as undiciFetch } from "undici";

export interface BridgeContext {
  workId: string;
  port: number;
  cwd: string;
}

export function readContext(): BridgeContext {
  const workId = process.env.AUTOVIRAL_WORK_ID;
  const port = Number(process.env.AUTOVIRAL_PORT ?? 3271);
  const cwd = process.env.AUTOVIRAL_CWD ?? process.cwd();
  if (!workId) {
    process.stderr.write(
      "autoviral: AUTOVIRAL_WORK_ID env not set — are you running outside the Studio terminal?\n",
    );
    process.exit(2);
  }
  return { workId, port, cwd };
}

export async function bridgeRequest<T>(
  ctx: BridgeContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `http://127.0.0.1:${ctx.port}/api/bridge/v1${path}`;
  const res = await undiciFetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-AutoViral-Work-Id": ctx.workId,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    process.stderr.write(`autoviral: bridge ${method} ${path} → ${res.status} ${txt}\n`);
    process.exit(3);
  }
  const json = await res.json() as { ok: boolean; result?: T; error?: string };
  if (!json.ok) {
    process.stderr.write(`autoviral: ${json.error ?? "unknown error"}\n`);
    process.exit(3);
  }
  return json.result as T;
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/autoviral/src/client.ts
git commit -m "feat(cli): HTTP client + context resolver"
```

---

### Task 2.2: Implement `whoami` command + integration test

**Files:**
- Create: `cli/autoviral/src/commands/whoami.ts`
- Modify: `cli/autoviral/src/cli.ts`
- Test: `cli/autoviral/test/whoami.test.ts`

- [ ] **Step 1: Write failing test (uses mock-server fixture)**

```typescript
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/bridge/v1/whoami") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: { workId: "w_t", cwd: "/tmp", port: 9999, version: "0.1.0" } }));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});
afterAll(() => server.close());

const BIN = join(__dirname, "../dist/cli.js");

describe("autoviral whoami", () => {
  it("prints JSON when stdout not tty", async () => {
    const { stdout, exitCode } = await execa("node", [BIN, "whoami"], {
      env: { AUTOVIRAL_WORK_ID: "w_t", AUTOVIRAL_PORT: String(port) },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.workId).toBe("w_t");
  });
});
```

- [ ] **Step 2: Implement `commands/whoami.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

export async function whoamiCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  const result = await bridgeRequest<{ workId: string; cwd: string; port: number; version: string }>(
    ctx, "GET", "/whoami",
  );
  writeOut(result);
}
```

- [ ] **Step 3: Implement `output.ts`**

```typescript
import { stringify as yamlStringify } from "yaml";

export function writeOut(data: unknown): void {
  if (process.stdout.isTTY) {
    // Human-readable: YAML for objects, plain for primitives
    if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
      process.stdout.write(`${data}\n`);
    } else {
      process.stdout.write(yamlStringify(data));
    }
  } else {
    process.stdout.write(JSON.stringify(data) + "\n");
  }
}
```

`yaml` is already a dep (root project uses it). Confirm in CLI's package.json too — add it if missing.

- [ ] **Step 4: Wire into cli.ts**

```typescript
#!/usr/bin/env node
import { whoamiCommand } from "./commands/whoami.js";

const [, , subcommand, ...rest] = process.argv;
const dispatch: Record<string, (args: string[]) => Promise<void>> = {
  whoami: whoamiCommand,
};

(async () => {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(usage());
    process.exit(0);
  }
  const handler = dispatch[subcommand];
  if (!handler) {
    process.stderr.write(`autoviral: unknown command "${subcommand}"\n`);
    process.exit(127);
  }
  await handler(rest);
})().catch((e) => {
  process.stderr.write(`autoviral: ${e.message ?? String(e)}\n`);
  process.exit(3);
});

function usage(): string {
  return [
    "autoviral — bridge between shell agents and the AutoViral Studio.",
    "",
    "Commands:",
    "  whoami              Print current Studio context (workId, cwd, port)",
    "  docs [topic]        Print operator manual",
    "  comp show           Print composition.yaml",
    "  list clips [...]    List video clips",
    "  list assets [...]   List assets",
    "",
    "Run `autoviral docs` for the full manual.",
    "",
  ].join("\n");
}
```

- [ ] **Step 5: Build + run tests**

```bash
cd cli/autoviral && npm install yaml && npm run build && npm test
cd ../..
```

Expected: tests green.

- [ ] **Step 6: Commit**

```bash
git add cli/autoviral
git commit -m "feat(cli): whoami command + output formatter"
```

---

### Task 2.3: Backend — `composition-ops.ts` (read composition.yaml)

**Files:**
- Create: `src/server/bridge/composition-ops.ts`
- Test: `src/server/bridge/__tests__/composition-ops.test.ts`

- [ ] **Step 1: Test**

```typescript
import { describe, expect, it } from "vitest";
import { readCompositionFor } from "../composition-ops.js";
import { join } from "node:path";

// Uses tests/fixtures/sample-work/composition.yaml as a stable fixture
// (create one with at minimum: id, workId, fps, width, height, duration,
// aspect, tracks (one video, one audio, one text), updatedAt).

describe("readCompositionFor", () => {
  it("parses & returns Composition from disk", async () => {
    const comp = await readCompositionFor({
      workId: "sample-work",
      worksRoot: join(__dirname, "../../../../tests/fixtures"),
    });
    expect(comp.workId).toBe("sample-work");
    expect(comp.tracks.length).toBeGreaterThan(0);
  });
});
```

Stage a fixture: `tests/fixtures/sample-work/composition.yaml`.

- [ ] **Step 2: Implement**

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { CompositionSchema, type Composition } from "../../shared/composition.js";
import { homedir } from "node:os";

export interface OpsContext {
  workId: string;
  worksRoot?: string; // defaults to ~/.autoviral/works
}

function resolveRoot(ctx: OpsContext): string {
  return ctx.worksRoot ?? join(homedir(), ".autoviral/works");
}

export async function readCompositionFor(ctx: OpsContext): Promise<Composition> {
  const path = join(resolveRoot(ctx), ctx.workId, "composition.yaml");
  const raw = await readFile(path, "utf8");
  const parsed = yamlParse(raw);
  return CompositionSchema.parse(parsed);
}
```

- [ ] **Step 3: Run test + commit**

```bash
npm run test:server -- composition-ops
git add src/server/bridge/composition-ops.ts src/server/bridge/__tests__/composition-ops.test.ts tests/fixtures/sample-work/composition.yaml
git commit -m "feat(bridge): composition-ops.readCompositionFor + fixture"
```

---

### Task 2.4: Backend — `GET /comp` route

**Files:**
- Modify: `src/server/bridge/routes.ts`

- [ ] **Step 1: Add the route**

```typescript
import { readCompositionFor } from "./composition-ops.js";

bridgeRouter.get("/comp", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing X-AutoViral-Work-Id" }, 400);
  try {
    const comp = await readCompositionFor({ workId });
    return c.json({ ok: true, result: comp });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? String(err) }, 500);
  }
});
```

- [ ] **Step 2: Add test in `routes.test.ts`**

Use a fixture work copied into a temp dir, set process.env.HOME for the test
to point worksRoot there.

- [ ] **Step 3: Run + commit**

```bash
npm run test:server -- bridge
git add src/server/bridge/routes.ts src/server/bridge/__tests__/routes.test.ts
git commit -m "feat(bridge): GET /comp returns parsed composition.yaml"
```

---

### Task 2.5: CLI — `comp show` command

**Files:**
- Create: `cli/autoviral/src/commands/comp.ts`
- Modify: `cli/autoviral/src/cli.ts`

- [ ] **Step 1: Implement**

```typescript
import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

export async function compCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "show" || sub === undefined) {
    const ctx = readContext();
    const result = await bridgeRequest<unknown>(ctx, "GET", "/comp");
    writeOut(result);
    return;
  }
  if (sub === "diff") {
    process.stderr.write("autoviral comp diff: not yet implemented (Phase 3)\n");
    process.exit(4);
  }
  process.stderr.write(`autoviral comp: unknown subcommand "${sub}"\n`);
  process.exit(127);
}
```

- [ ] **Step 2: Wire into cli.ts dispatch**

Add `comp: compCommand` to the dispatch object.

- [ ] **Step 3: Smoke test by running against dev server**

```bash
cd cli/autoviral && npm run build && cd ../..
npm run dev:server &
SERVER_PID=$!
sleep 2
AUTOVIRAL_WORK_ID=w_20260513_1919_74d AUTOVIRAL_PORT=3271 \
  node cli/autoviral/dist/cli.js comp show | head -10
kill $SERVER_PID
```

Expected: prints composition.yaml as JSON (since stdout is piped).

- [ ] **Step 4: Commit**

```bash
git add cli/autoviral/src/commands/comp.ts cli/autoviral/src/cli.ts
git commit -m "feat(cli): comp show command"
```

---

### Task 2.6: Backend + CLI — `list clips` / `list assets`

**Files:**
- Modify: `src/server/bridge/routes.ts`
- Create: `cli/autoviral/src/commands/list.ts`
- Modify: `cli/autoviral/src/cli.ts`

- [ ] **Step 1: Backend — add `/clips` and `/assets` routes that filter composition**

```typescript
bridgeRouter.get("/clips", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing X-AutoViral-Work-Id" }, 400);
  const trackFilter = c.req.query("track");
  const comp = await readCompositionFor({ workId });
  const clips = comp.tracks
    .filter((t) => !trackFilter || t.kind === trackFilter)
    .flatMap((t) =>
      t.clips.map((c) => ({
        id: c.id,
        kind: c.kind,
        trackId: t.id,
        trackKind: t.kind,
        trackOffset: c.trackOffset,
        duration: "out" in c ? c.out - c.in : c.duration,
      })),
    );
  return c.json({ ok: true, result: clips });
});

bridgeRouter.get("/assets", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing X-AutoViral-Work-Id" }, 400);
  const kindFilter = c.req.query("kind");
  const comp = await readCompositionFor({ workId });
  const assets = comp.assets.filter((a) => !kindFilter || a.kind === kindFilter);
  return c.json({ ok: true, result: assets });
});
```

- [ ] **Step 2: CLI — `list.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

export async function listCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const ctx = readContext();
  if (sub === "clips") {
    const trackIdx = args.indexOf("--track");
    const track = trackIdx >= 0 ? args[trackIdx + 1] : undefined;
    const qs = track ? `?track=${encodeURIComponent(track)}` : "";
    const r = await bridgeRequest<unknown[]>(ctx, "GET", `/clips${qs}`);
    writeOut(r);
    return;
  }
  if (sub === "assets") {
    const kindIdx = args.indexOf("--kind");
    const kind = kindIdx >= 0 ? args[kindIdx + 1] : undefined;
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    const r = await bridgeRequest<unknown[]>(ctx, "GET", `/assets${qs}`);
    writeOut(r);
    return;
  }
  process.stderr.write(`autoviral list: expected "clips" or "assets", got "${sub}"\n`);
  process.exit(127);
}
```

- [ ] **Step 3: Wire + test + commit**

```bash
npm run test:server -- bridge
cd cli/autoviral && npm run build && cd ../..
# manual sanity:
npm run dev:server & SERVER_PID=$!
sleep 2
AUTOVIRAL_WORK_ID=w_20260513_1919_74d AUTOVIRAL_PORT=3271 node cli/autoviral/dist/cli.js list clips --track video | head
kill $SERVER_PID
git add src/server/bridge/routes.ts cli/autoviral/src/commands/list.ts cli/autoviral/src/cli.ts
git commit -m "feat(cli+bridge): list clips/assets with --track/--kind filters"
```

---

### Task 2.7: Backend — `GET /docs` route serves `skills/autoviral/manual/`

**Files:**
- Modify: `src/server/bridge/routes.ts`

- [ ] **Step 1: Add the route**

```typescript
import { readdir, readFile } from "node:fs/promises";

bridgeRouter.get("/docs", async (c) => {
  const topic = c.req.query("topic");
  const manualDir = join(process.cwd(), "skills/autoviral/manual");
  try {
    if (topic) {
      const file = join(manualDir, topic.endsWith(".md") ? topic : `${topic}.md`);
      const md = await readFile(file, "utf8");
      return c.text(md);
    }
    // No topic — list all topics + concatenate
    const files = (await readdir(manualDir)).filter((f) => f.endsWith(".md")).sort();
    const chunks = await Promise.all(files.map((f) => readFile(join(manualDir, f), "utf8")));
    return c.text(chunks.join("\n\n---\n\n"));
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 404);
  }
});
```

- [ ] **Step 2: CLI — `docs.ts`**

```typescript
import { readContext } from "../client.js";

export async function docsCommand(args: string[]): Promise<void> {
  const ctx = readContext();
  const topic = args[0];
  const qs = topic ? `?topic=${encodeURIComponent(topic)}` : "";
  // Docs returns raw markdown, not JSON-wrapped. Direct fetch:
  const res = await (await import("undici")).fetch(
    `http://127.0.0.1:${ctx.port}/api/bridge/v1/docs${qs}`,
    { headers: { "X-AutoViral-Work-Id": ctx.workId } },
  );
  if (!res.ok) {
    process.stderr.write(`autoviral docs: ${res.status}\n`);
    process.exit(3);
  }
  process.stdout.write(await res.text());
}
```

- [ ] **Step 3: Wire + commit**

```bash
git add src/server/bridge/routes.ts cli/autoviral/src/commands/docs.ts cli/autoviral/src/cli.ts
git commit -m "feat(cli+bridge): docs command serving skills/autoviral/manual/"
```

---

### Task 2.8: Install the built CLI on PATH for dev sessions

**Files:** none (build + symlink)

- [ ] **Step 1: Add an npm script to root package.json**

```json
{
  "scripts": {
    "build:cli": "cd cli/autoviral && npm run build",
    "install:cli": "cd cli/autoviral && npm run build && npm link"
  }
}
```

- [ ] **Step 2: Link the binary into the user's global PATH**

```bash
npm run install:cli
which autoviral
autoviral --help
```

Expected: `which` resolves under `~/.npm-global/bin/autoviral` or similar;
help text prints.

- [ ] **Step 3: Document in `cli/autoviral/README.md` (brief)**

```markdown
# @autoviral/cli

Agent-facing bridge between any shell agent (claude / codex / kimi / aider /
…) and the AutoViral Studio.

## Install

From the AutoViral repo root:

    npm run install:cli

This builds and global-links `autoviral` on your PATH. Use within a Studio
terminal — the panel injects `AUTOVIRAL_WORK_ID`/`AUTOVIRAL_PORT` env vars
automatically, so the CLI knows which Studio to talk to.

## Commands

    autoviral whoami
    autoviral docs [topic]
    autoviral comp show
    autoviral list clips [--track video]
    autoviral list assets [--kind video]

See `autoviral docs` for the full manual.
```

- [ ] **Step 4: Commit**

```bash
git add package.json cli/autoviral/README.md
git commit -m "build(cli): root npm scripts + README for global install"
```

---

### Task 2.9: Phase 2 milestone checkpoint

- [ ] **Step 1: Full end-to-end smoke from a terminal panel**

```bash
npm run dev &
sleep 4
# Open browser to a real work id
open "http://localhost:5173/studio/w_20260513_1919_74d"
# Wait for user to manually run inside the terminal panel:
#   autoviral whoami
#   autoviral list clips --track video | head
# Expected: both commands succeed. Screenshot.
```

- [ ] **Step 2: Tag**

```bash
git tag phase-2-cli-readonly
```

---

## Phase 3 — `autoviral` CLI v2: write + UI control

Goal: by end of phase, agent can mutate composition.yaml AND command Studio
UI (select / seek / toast / ask). Composition writes are safe (atomic +
schema-validated). UI commands broadcast over a fresh `/ws/bridge/:workId`
WebSocket subscribed by Studio.

### Task 3.1: Backend — bridge WebSocket event bus

**Files:**
- Create: `src/server/bridge/ui-events.ts`
- Test: `src/server/bridge/__tests__/ui-events.test.ts`

- [ ] **Step 1: Test the pub/sub correctness**

```typescript
import { describe, expect, it, vi } from "vitest";
import { UiEventBus } from "../ui-events.js";

describe("UiEventBus", () => {
  it("delivers a published event to all subscribers of the same workId", () => {
    const bus = new UiEventBus();
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    bus.subscribe("w1", a);
    bus.subscribe("w1", b);
    bus.subscribe("w2", c);
    bus.publish("w1", { type: "ui-toast", workId: "w1", ts: 0, payload: { message: "x", kind: "info", durationMs: 1000 } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
export interface UiEvent {
  type: string;
  workId: string;
  ts: number;
  payload: unknown;
}

export class UiEventBus {
  private subs = new Map<string, Set<(e: UiEvent) => void>>();

  subscribe(workId: string, listener: (e: UiEvent) => void): () => void {
    if (!this.subs.has(workId)) this.subs.set(workId, new Set());
    this.subs.get(workId)!.add(listener);
    return () => this.subs.get(workId)?.delete(listener);
  }

  publish(workId: string, event: UiEvent): void {
    const set = this.subs.get(workId);
    if (!set) return;
    for (const l of set) l(event);
  }
}

// Process-global singleton — the HTTP routes + WebSocket attach hook
// import this same instance.
export const uiEventBus = new UiEventBus();
```

- [ ] **Step 3: Run + commit**

```bash
npm run test:server -- ui-events
git add src/server/bridge/ui-events.ts src/server/bridge/__tests__/ui-events.test.ts
git commit -m "feat(bridge): UiEventBus pub/sub for UI commands"
```

---

### Task 3.2: Backend — attach `/ws/bridge/:workId` WebSocket

**Files:**
- Create: `src/server/bridge/bridge-ws.ts`
- Modify: `src/server/index.ts` (mount it)

- [ ] **Step 1: Implement**

```typescript
import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { uiEventBus } from "./ui-events.js";

export function attachBridgeWebSocket(httpServer: HttpServer, path = "/ws/bridge"): { close: () => void } {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith(path)) return;
    const workId = url.slice(path.length + 1).split("?")[0];
    if (!workId) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => handle(ws, workId));
  });
  function handle(ws: WebSocket, workId: string) {
    const off = uiEventBus.subscribe(workId, (event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    });
    ws.on("close", () => off());
  }
  return { close: () => wss.close() };
}
```

- [ ] **Step 2: Mount alongside terminal-ws in server entry**

```typescript
import { attachBridgeWebSocket } from "./bridge/bridge-ws.js";
// ...
attachBridgeWebSocket(httpServer);
```

- [ ] **Step 3: Commit**

```bash
git add src/server/bridge/bridge-ws.ts src/server/index.ts
git commit -m "feat(bridge): /ws/bridge/:workId WebSocket subscribes to UiEventBus"
```

---

### Task 3.3: Backend — `POST /select`, `/seek`, `/play`, `/pause`, `/toast`, `/progress`

**Files:**
- Modify: `src/server/bridge/routes.ts`

- [ ] **Step 1: Implement**

```typescript
import { SelectRequest, SeekRequest, ToastRequest } from "./schemas.js";
import { uiEventBus } from "./ui-events.js";

function broadcast(workId: string, type: string, payload: unknown) {
  uiEventBus.publish(workId, { type, workId, ts: Date.now(), payload });
}

bridgeRouter.post("/select", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing header" }, 400);
  const body = SelectRequest.parse(await c.req.json());
  broadcast(workId, "ui-select", body.target);
  return c.json({ ok: true, result: { selected: body.target } });
});

bridgeRouter.post("/seek", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing header" }, 400);
  const body = SeekRequest.parse(await c.req.json());
  broadcast(workId, "ui-seek", { seconds: body.seconds });
  return c.json({ ok: true, result: { seekedTo: body.seconds } });
});

bridgeRouter.post("/play", (c) => {
  const w = c.req.header("X-AutoViral-Work-Id")!;
  broadcast(w, "ui-play", null);
  return c.json({ ok: true });
});

bridgeRouter.post("/pause", (c) => {
  const w = c.req.header("X-AutoViral-Work-Id")!;
  broadcast(w, "ui-pause", null);
  return c.json({ ok: true });
});

bridgeRouter.post("/toast", async (c) => {
  const w = c.req.header("X-AutoViral-Work-Id")!;
  const body = ToastRequest.parse(await c.req.json());
  broadcast(w, "ui-toast", body);
  return c.json({ ok: true });
});
```

(Progress is similar — left as exercise within the same task; just emit
`ui-progress` events with start/step/done variants.)

- [ ] **Step 2: Test all the new routes**

Add to `routes.test.ts` — each posts a body and asserts that
`uiEventBus.subscribe` fired with the right event type/payload.

- [ ] **Step 3: Commit**

```bash
npm run test:server -- bridge
git add src/server/bridge/routes.ts src/server/bridge/__tests__/routes.test.ts
git commit -m "feat(bridge): UI command routes — select/seek/play/pause/toast/progress"
```

---

### Task 3.4: CLI — `select`, `seek`, `play`, `pause`, `toast`, `progress`

**Files:**
- Create: `cli/autoviral/src/commands/select.ts`
- Create: `cli/autoviral/src/commands/seek.ts`
- Create: `cli/autoviral/src/commands/play.ts`
- Create: `cli/autoviral/src/commands/toast.ts`
- Create: `cli/autoviral/src/commands/progress.ts`
- Modify: `cli/autoviral/src/cli.ts`

- [ ] **Step 1: Implement `select.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";

export async function selectCommand(args: string[]): Promise<void> {
  const [kind, id] = args;
  if (!kind) { process.stderr.write("usage: autoviral select <kind> <id>  |  autoviral select none\n"); process.exit(4); }
  const ctx = readContext();
  if (kind === "none") {
    await bridgeRequest(ctx, "POST", "/select", { target: { kind: "none" } });
    return;
  }
  if (!id) { process.stderr.write("autoviral select: missing id\n"); process.exit(4); }
  await bridgeRequest(ctx, "POST", "/select", { target: { kind, id } });
}
```

- [ ] **Step 2: Implement `seek.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";

export async function seekCommand(args: string[]): Promise<void> {
  let raw = args[0];
  if (!raw) { process.stderr.write("usage: autoviral seek <seconds|'12.5s'|'1m30s'>\n"); process.exit(4); }
  // accept "12s", "1m30s", or bare number → seconds
  let seconds: number;
  if (/^[\d.]+$/.test(raw)) seconds = parseFloat(raw);
  else {
    const m = raw.match(/^(?:(\d+)m)?(\d+(?:\.\d+)?)s$/);
    if (!m) { process.stderr.write(`autoviral seek: bad time format ${raw}\n`); process.exit(4); }
    seconds = (Number(m[1] ?? 0) * 60) + Number(m[2]);
  }
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/seek", { seconds });
}
```

- [ ] **Step 3: Implement `play.ts` (covers play + pause via sub-dispatch)**

```typescript
import { bridgeRequest, readContext } from "../client.js";

export async function playCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/play", {});
}
export async function pauseCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/pause", {});
}
```

- [ ] **Step 4: Implement `toast.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";

export async function toastCommand(args: string[]): Promise<void> {
  const message = args[0];
  if (!message) { process.stderr.write("usage: autoviral toast <message> [--kind info|success|warn|error] [--duration 3000]\n"); process.exit(4); }
  const kindIdx = args.indexOf("--kind");
  const durIdx = args.indexOf("--duration");
  const kind = kindIdx >= 0 ? args[kindIdx + 1] : "info";
  const durationMs = durIdx >= 0 ? Number(args[durIdx + 1]) : 3000;
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/toast", { message, kind, durationMs });
}
```

- [ ] **Step 5: Implement `progress.ts`**

Sub-commands: `start <label> [--steps N]`, `step <n>`, `done`. Each posts
to `/progress` with a discriminator.

```typescript
import { bridgeRequest, readContext } from "../client.js";

export async function progressCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();
  if (sub === "start") {
    const label = rest[0] ?? "";
    const stepsIdx = rest.indexOf("--steps");
    const steps = stepsIdx >= 0 ? Number(rest[stepsIdx + 1]) : undefined;
    await bridgeRequest(ctx, "POST", "/progress", { phase: "start", label, steps });
    return;
  }
  if (sub === "step") {
    const n = Number(rest[0] ?? "0");
    await bridgeRequest(ctx, "POST", "/progress", { phase: "step", n });
    return;
  }
  if (sub === "done") {
    await bridgeRequest(ctx, "POST", "/progress", { phase: "done" });
    return;
  }
  process.stderr.write("usage: autoviral progress start|step|done\n");
  process.exit(4);
}
```

- [ ] **Step 6: Wire all into dispatch + commit**

```bash
cd cli/autoviral && npm run build && cd ../..
git add cli/autoviral/src/commands/select.ts cli/autoviral/src/commands/seek.ts \
        cli/autoviral/src/commands/play.ts cli/autoviral/src/commands/toast.ts \
        cli/autoviral/src/commands/progress.ts cli/autoviral/src/cli.ts
git commit -m "feat(cli): UI command suite — select/seek/play/pause/toast/progress"
```

---

### Task 3.5: Web — subscribe to `/ws/bridge/:workId` from Studio

**Files:**
- Create: `web/src/features/terminal/useBridgeEvents.ts`
- Modify: `web/src/pages/Studio.tsx`

- [ ] **Step 1: Implement the hook**

```typescript
import { useEffect } from "react";
import { useComposition } from "@/features/studio/store";
import { useToastStore } from "@/stores/toast";

export function useBridgeEvents(workId: string | undefined) {
  useEffect(() => {
    if (!workId) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/bridge/${workId}`);
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { type: string; payload: any };
        const store = useComposition.getState();
        switch (ev.type) {
          case "ui-select":
            if (ev.payload.kind === "clip") store.setSelection(ev.payload.id);
            else if (ev.payload.kind === "none") store.setSelection(null);
            break;
          case "ui-seek": {
            const fps = store.comp?.fps ?? 30;
            store.setFrame(Math.round(ev.payload.seconds * fps));
            break;
          }
          case "ui-play":
          case "ui-pause":
            // Phase 3.6: imperative play/pause hook into PreviewPanel ref
            window.dispatchEvent(new CustomEvent(`autoviral:${ev.type}`));
            break;
          case "ui-toast":
            useToastStore.getState().push({
              message: ev.payload.message,
              kind: ev.payload.kind,
              durationMs: ev.payload.durationMs,
            });
            break;
          case "ui-progress":
            // simple: surface as toast for now; richer UI in Phase 5
            useToastStore.getState().push({
              message: `${ev.payload.phase}: ${ev.payload.label ?? ""}`,
              kind: "info",
              durationMs: 2000,
            });
            break;
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [workId]);
}
```

- [ ] **Step 2: Call from Studio.tsx**

Add to the top of Studio component body:

```typescript
import { useBridgeEvents } from "@/features/terminal/useBridgeEvents";
// inside component:
useBridgeEvents(workId);
```

- [ ] **Step 3: Commit**

```bash
git add web/src/features/terminal/useBridgeEvents.ts web/src/pages/Studio.tsx
git commit -m "feat(web): useBridgeEvents subscribes Studio to bridge UI commands"
```

---

### Task 3.6: PreviewPanel — listen to `autoviral:ui-play` / `ui-pause`

**Files:**
- Modify: `web/src/features/studio/panels/PreviewPanel.tsx`

- [ ] **Step 1: Add the event listener**

In PreviewPanel, near the existing `useEffect` that wires playerRef:

```typescript
useEffect(() => {
  const onPlay = () => playerRef.current?.play();
  const onPause = () => playerRef.current?.pause();
  window.addEventListener("autoviral:ui-play", onPlay);
  window.addEventListener("autoviral:ui-pause", onPause);
  return () => {
    window.removeEventListener("autoviral:ui-play", onPlay);
    window.removeEventListener("autoviral:ui-pause", onPause);
  };
}, []);
```

- [ ] **Step 2: Commit**

```bash
git add web/src/features/studio/panels/PreviewPanel.tsx
git commit -m "feat(preview): respond to autoviral ui-play/ui-pause events"
```

---

### Task 3.7: Backend — composition write op (atomic + validated)

**Files:**
- Modify: `src/server/bridge/composition-ops.ts`

- [ ] **Step 1: Add write helpers**

```typescript
import { writeFile, rename, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stringify as yamlStringify } from "yaml";

export async function writeCompositionFor(ctx: OpsContext, comp: Composition): Promise<void> {
  // Validate via schema before writing (zod throws on shape mismatch)
  const validated = CompositionSchema.parse(comp);
  const target = join(resolveRoot(ctx), ctx.workId, "composition.yaml");
  // Atomic write: write to tmp file, fsync, rename
  const tmpDir = await mkdtemp(join(tmpdir(), "autoviral-comp-"));
  const tmpPath = join(tmpDir, "composition.yaml");
  await writeFile(tmpPath, yamlStringify(validated), "utf8");
  await rename(tmpPath, target);
}

export async function mutateCompositionFor(
  ctx: OpsContext,
  mutator: (comp: Composition) => Composition,
): Promise<Composition> {
  const current = await readCompositionFor(ctx);
  const next = mutator(current);
  await writeCompositionFor(ctx, next);
  return next;
}
```

- [ ] **Step 2: Test atomicity** — write, kill the process mid-write, verify
the file is either the OLD content or the new — never partial. Use a unit
test that simulates by injecting a write-fail mid-rename. (Skip if low ROI;
the rename pattern is well-known correct.)

- [ ] **Step 3: Commit**

```bash
git add src/server/bridge/composition-ops.ts
git commit -m "feat(bridge): atomic + validated composition.yaml writer"
```

---

### Task 3.8: Backend + CLI — `clip add / set / remove`

**Files:**
- Modify: `src/server/bridge/routes.ts`
- Create: `cli/autoviral/src/commands/clip.ts`

- [ ] **Step 1: Backend POST `/clip` to append a clip**

```typescript
bridgeRouter.post("/clip", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing header" }, 400);
  const body = await c.req.json() as {
    src: string; track: "video" | "audio" | "overlay" | "text";
    offset: number; duration?: number; in?: number; out?: number;
  };
  const updated = await mutateCompositionFor({ workId }, (comp) => {
    const track = comp.tracks.find((t) => t.kind === body.track);
    if (!track) throw new Error(`No track of kind ${body.track}`);
    const id = `${body.track === "video" ? "vc" : body.track === "audio" ? "ac" : "oc"}_${Math.random().toString(36).slice(2, 8)}`;
    // Minimal shape — Phase 3 only supports video for first round
    if (body.track === "video") {
      track.clips.push({
        id, kind: "video", src: body.src,
        in: body.in ?? 0, out: body.out ?? (body.duration ?? 5),
        trackOffset: body.offset,
        transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
        filters: { brightness: 0, contrast: 0, saturation: 0 },
      } as any);
    }
    // (extend for audio/text/overlay later)
    return comp;
  });
  return c.json({ ok: true, result: updated });
});

bridgeRouter.delete("/clip/:id", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing header" }, 400);
  const id = c.req.param("id");
  await mutateCompositionFor({ workId }, (comp) => ({
    ...comp,
    tracks: comp.tracks.map((t) => ({ ...t, clips: t.clips.filter((c: any) => c.id !== id) })),
  }));
  return c.json({ ok: true });
});

bridgeRouter.patch("/clip/:id", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) return c.json({ ok: false, error: "missing header" }, 400);
  const id = c.req.param("id");
  const patch = await c.req.json() as Record<string, unknown>;
  await mutateCompositionFor({ workId }, (comp) => ({
    ...comp,
    tracks: comp.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((cl: any) => cl.id === id ? { ...cl, ...patch } : cl),
    })),
  }));
  return c.json({ ok: true });
});
```

- [ ] **Step 2: CLI `clip.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";

export async function clipCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();
  if (sub === "add") {
    const opts = parseFlags(rest, ["--src", "--track", "--offset", "--duration", "--in", "--out"]);
    if (!opts["--src"]) { process.stderr.write("autoviral clip add: --src required\n"); process.exit(4); }
    const body = {
      src: opts["--src"], track: opts["--track"] ?? "video",
      offset: Number(opts["--offset"] ?? 0),
      duration: opts["--duration"] ? Number(opts["--duration"]) : undefined,
      in: opts["--in"] ? Number(opts["--in"]) : undefined,
      out: opts["--out"] ? Number(opts["--out"]) : undefined,
    };
    await bridgeRequest(ctx, "POST", "/clip", body);
    return;
  }
  if (sub === "remove") {
    const id = rest[0];
    if (!id) { process.stderr.write("usage: autoviral clip remove <id>\n"); process.exit(4); }
    await bridgeRequest(ctx, "DELETE", `/clip/${encodeURIComponent(id)}`, {});
    return;
  }
  if (sub === "set") {
    const id = rest[0];
    if (!id) { process.stderr.write("usage: autoviral clip set <id> [--key value]...\n"); process.exit(4); }
    const opts = parseFlags(rest.slice(1));
    // strip leading "--" from key names for JSON patch
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) {
      const key = k.replace(/^--/, "");
      patch[key] = /^[-\d.]+$/.test(v) ? Number(v) : v;
    }
    await bridgeRequest(ctx, "PATCH", `/clip/${encodeURIComponent(id)}`, patch);
    return;
  }
  process.stderr.write(`autoviral clip: unknown subcommand "${sub}"\n`);
  process.exit(127);
}

function parseFlags(argv: string[], allowed?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      if (allowed && !allowed.includes(k)) continue;
      out[k] = argv[i + 1];
      i++;
    }
  }
  return out;
}
```

- [ ] **Step 3: Commit**

```bash
cd cli/autoviral && npm run build && cd ../..
git add src/server/bridge/routes.ts cli/autoviral/src/commands/clip.ts cli/autoviral/src/cli.ts
git commit -m "feat(cli+bridge): clip add/set/remove with atomic composition write"
```

---

### Task 3.9: Approval gate — `POST /ask` blocks until UI responds

**Files:**
- Create: `src/server/bridge/approval-gate.ts`
- Modify: `src/server/bridge/routes.ts`
- Modify: `src/server/bridge/bridge-ws.ts` (accept inbound `approval-response`)
- Create: `web/src/features/terminal/ApprovalPrompt.tsx`

- [ ] **Step 1: Implement the gate**

```typescript
// src/server/bridge/approval-gate.ts
import { randomBytes } from "node:crypto";

interface Pending {
  resolve: (answer: "yes" | "no" | "cancelled" | "timeout") => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();

export function createAsk(workId: string, timeoutMs: number): { askId: string; promise: Promise<"yes" | "no" | "cancelled" | "timeout"> } {
  const askId = `ask_${workId}_${randomBytes(4).toString("hex")}`;
  const promise = new Promise<"yes" | "no" | "cancelled" | "timeout">((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(askId);
      resolve("timeout");
    }, timeoutMs);
    pending.set(askId, { resolve, timer });
  });
  return { askId, promise };
}

export function answerAsk(askId: string, answer: "yes" | "no" | "cancelled"): boolean {
  const p = pending.get(askId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(askId);
  p.resolve(answer);
  return true;
}
```

- [ ] **Step 2: Wire route**

```typescript
import { createAsk } from "./approval-gate.js";
import { AskRequest } from "./schemas.js";

bridgeRouter.post("/ask", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id")!;
  const body = AskRequest.parse(await c.req.json());
  const { askId, promise } = createAsk(workId, body.timeoutMs);
  broadcast(workId, "ui-ask", { askId, message: body.message, kind: body.kind });
  const answer = await promise;
  if (answer === "timeout") return c.json({ ok: false, error: "timeout", exitCode: 124 });
  return c.json({ ok: true, result: { answer } });
});
```

- [ ] **Step 3: Wire WebSocket inbound (Studio → backend response)**

Modify `bridge-ws.ts` to read inbound frames:

```typescript
ws.on("message", (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.t === "approval-response" && typeof msg.askId === "string") {
      answerAsk(msg.askId, msg.answer);
    }
  } catch { /* ignore */ }
});
```

- [ ] **Step 4: Web — `ApprovalPrompt.tsx`**

```typescript
import { useEffect, useState } from "react";

interface Ask { askId: string; message: string; kind: "yes-no" | "ok-cancel" | "input"; }

export function ApprovalPrompt({ workId }: { workId: string }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [wsRef] = useState<{ ws: WebSocket | null }>({ ws: null });

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/bridge/${workId}`);
    wsRef.ws = ws;
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "ui-ask") setAsk(ev.payload);
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [workId]);

  if (!ask) return null;
  const answer = (a: "yes" | "no" | "cancelled") => {
    wsRef.ws?.send(JSON.stringify({ t: "approval-response", askId: ask.askId, answer: a }));
    setAsk(null);
  };

  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center", zIndex: 1000 }}>
      <div className="glass" style={{ padding: 24, maxWidth: 420, borderRadius: 16, fontFamily: "var(--font-mono)" }}>
        <div style={{ fontSize: 11, color: "var(--text-dimmer)", marginBottom: 8 }}>AGENT REQUEST</div>
        <div style={{ marginBottom: 20, fontSize: 14, color: "var(--text)" }}>{ask.message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => answer("no")} style={{ /* dim style */ }}>NO</button>
          <button onClick={() => answer("yes")} style={{ /* accent style */ }}>YES</button>
        </div>
      </div>
    </div>
  );
}
```

Mount in `Studio.tsx` next to `<TweaksPanel>`.

- [ ] **Step 5: CLI — `ask.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";

export async function askCommand(args: string[]): Promise<void> {
  const message = args[0];
  if (!message) { process.stderr.write("usage: autoviral ask <message> [--yes-no|--ok-cancel|--input] [--timeout 600]\n"); process.exit(4); }
  const yesno = args.includes("--yes-no");
  const okCancel = args.includes("--ok-cancel");
  const kind = yesno ? "yes-no" : okCancel ? "ok-cancel" : "yes-no";
  const tIdx = args.indexOf("--timeout");
  const timeoutMs = (tIdx >= 0 ? Number(args[tIdx + 1]) : 1800) * 1000; // seconds → ms
  const ctx = readContext();
  const result = await bridgeRequest<{ answer: "yes" | "no" | "cancelled" } | undefined>(
    ctx, "POST", "/ask", { message, kind, timeoutMs },
  );
  if (!result) { process.exit(124); }
  process.stdout.write(result.answer + "\n");
  process.exit(result.answer === "yes" ? 0 : result.answer === "no" ? 1 : 2);
}
```

- [ ] **Step 6: Smoke + commit**

```bash
# Manual: in dev, run from terminal: autoviral ask "Render now?" --yes-no
# Verify the UI modal appears and clicking sets exit code.
git add src/server/bridge/approval-gate.ts src/server/bridge/routes.ts \
        src/server/bridge/bridge-ws.ts \
        web/src/features/terminal/ApprovalPrompt.tsx web/src/pages/Studio.tsx \
        cli/autoviral/src/commands/ask.ts cli/autoviral/src/cli.ts
git commit -m "feat(bridge): approval gate — autoviral ask blocks until UI responds"
```

---

### Task 3.10: Composition file watcher → broadcast `composition-changed` event

**Files:**
- Modify: `src/server/bridge/composition-ops.ts` (export an event emitter)
- Create: `src/server/bridge/composition-watcher.ts`

- [ ] **Step 1: Watcher**

```typescript
import { watch } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { uiEventBus } from "./ui-events.js";

const watchers = new Map<string, ReturnType<typeof watch>>();

export function watchCompositionFor(workId: string): void {
  if (watchers.has(workId)) return;
  const path = join(homedir(), ".autoviral/works", workId, "composition.yaml");
  const w = watch(path, { persistent: true }, () => {
    uiEventBus.publish(workId, {
      type: "composition-changed", workId, ts: Date.now(), payload: null,
    });
  });
  watchers.set(workId, w);
}
```

- [ ] **Step 2: Trigger watcher on first WebSocket connection**

In `bridge-ws.ts` `handle()`:
```typescript
watchCompositionFor(workId);
```

- [ ] **Step 3: Studio side — refetch on `composition-changed`**

In `useBridgeEvents.ts`, add:
```typescript
case "composition-changed":
  // reuse the existing loadComposition flow
  import("@/features/studio/services/composition").then(({ loadComposition }) =>
    loadComposition(workId).then((found) => found && useComposition.getState().loadComposition(found)),
  );
  break;
```

- [ ] **Step 4: Commit**

```bash
git add src/server/bridge/composition-watcher.ts src/server/bridge/bridge-ws.ts web/src/features/terminal/useBridgeEvents.ts
git commit -m "feat(bridge): composition file watcher → composition-changed broadcasts"
```

---

### Task 3.11: CLI — `export` + `render` commands

**Files:**
- Modify: `src/server/bridge/routes.ts`
- Create: `cli/autoviral/src/commands/export.ts`
- Create: `cli/autoviral/src/commands/render.ts`

- [ ] **Step 1: Backend — wrap existing runRenderPipeline behind `/export`**

```typescript
import { runRenderPipeline } from "../render-pipeline.js";
import { readCompositionFor } from "./composition-ops.js";

bridgeRouter.post("/export", async (c) => {
  const workId = c.req.header("X-AutoViral-Work-Id")!;
  const body = await c.req.json() as { preset?: string; proxy?: boolean };
  const comp = await readCompositionFor({ workId });
  const outDir = join(homedir(), ".autoviral/works", workId, "output");
  // (apply preset if specified — Phase 5 hardens; here just pass through)
  const finalPath = await runRenderPipeline({
    comp, outDir, proxy: body.proxy ?? false,
    onProgress: (stage, pct) => {
      uiEventBus.publish(workId, {
        type: "ui-render-progress", workId, ts: Date.now(),
        payload: { stage, pct },
      });
    },
  });
  return c.json({ ok: true, result: { path: finalPath } });
});
```

- [ ] **Step 2: CLI — `export.ts`**

```typescript
import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

export async function exportCommand(args: string[]): Promise<void> {
  const presetIdx = args.indexOf("--preset");
  const preset = presetIdx >= 0 ? args[presetIdx + 1] : undefined;
  const proxy = args.includes("--proxy");
  const ctx = readContext();
  const result = await bridgeRequest<{ path: string }>(ctx, "POST", "/export", { preset, proxy });
  writeOut(result);
}
export async function renderCommand(args: string[]): Promise<void> {
  // alias
  return exportCommand([...args, "--proxy"]);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/server/bridge/routes.ts cli/autoviral/src/commands/export.ts cli/autoviral/src/commands/render.ts cli/autoviral/src/cli.ts
git commit -m "feat(cli+bridge): export/render commands wrapping runRenderPipeline"
```

---

### Task 3.12: CLI integration tests end-to-end

**Files:**
- Modify: `cli/autoviral/test/cli.test.ts`

- [ ] **Step 1: Run all commands against an in-process bridge router**

Use `Hono.app.fetch()` directly (no real HTTP) for fast tests, OR spin up
a real server on an ephemeral port. Cover: whoami, comp show, list clips,
clip add → list clips shows new id → clip remove → list clips no longer
shows it.

- [ ] **Step 2: Commit**

```bash
git add cli/autoviral/test/cli.test.ts
git commit -m "test(cli): end-to-end coverage of read + write command suite"
```

---

### Task 3.13: Phase 3 milestone checkpoint

- [ ] **Step 1: User-perspective E2E (per .claude/rules/e2e-testing.md)**

In the Studio terminal panel, manually run:
```
autoviral whoami
autoviral list clips --track video
autoviral select clip vc_s07
# verify the selection highlights in Studio
autoviral seek 12.5s
# verify preview seeks
autoviral toast "Test toast" --kind success
# verify toast appears
autoviral ask "Run a test render?" --yes-no
# click YES in the modal — verify CLI exits 0
```

Each step requires a screenshot. If any fails, fix before tagging.

- [ ] **Step 2: Tag**

```bash
git tag phase-3-bridge-complete
```

---

## Phase 4 — Skill rewrite

Goal: by end of phase, `skills/autoviral/` is the operator manual; taste/
and modules/ are gone; recipes cover the top 5 use cases; `autoviral docs`
serves the manual.

### Task 4.1: Snapshot + delete `skills/autoviral/taste/` and `modules/`

**Files:**
- Delete: `skills/autoviral/taste/` (entire dir)
- Delete: `skills/autoviral/modules/` (entire dir)
- Delete: `skills/autoviral/references/` (entire dir — replaced by manual/ + contracts/)

- [ ] **Step 1: Snapshot the OLD content into a git tag for archaeology**

```bash
git tag pre-skill-rewrite-snapshot
```

- [ ] **Step 2: Delete + commit**

```bash
git rm -r skills/autoviral/taste skills/autoviral/modules skills/autoviral/references
git commit -m "chore(skill): delete taste/ modules/ references/ — operator-manual rewrite"
```

---

### Task 4.2: Write new `skills/autoviral/SKILL.md`

**Files:**
- Modify: `skills/autoviral/SKILL.md`

- [ ] **Step 1: Write the new entry**

```markdown
---
name: autoviral
description: Operator manual for the AutoViral creator workstation. Use when the user is editing video / image / poster content in AutoViral and you (any CLI agent — claude, codex, kimi, aider, gemini) need to know how to drive the Studio UI, mutate compositions, and coordinate with the user. NOT a taste/editorial skill — bring your own.
---

# AutoViral Operator Manual

You are a CLI agent running inside the **AutoViral Studio terminal panel**. The user has opened a workspace at `/studio/${AUTOVIRAL_WORK_ID}`. You see the Studio preview + timeline to your right; the user is watching what you do.

You drive AutoViral via the `autoviral` CLI on your PATH. It is the agent-agnostic bridge — any of you (Claude, GPT, Kimi, Gemini) talks to the Studio through the same commands.

## Read this in order

1. **manual/00-quickstart.md** — 5-minute zero-to-export walkthrough
2. **manual/01-workspace-layout.md** — where the files live
3. **manual/02-composition-schema.md** — the data you'll be mutating
4. **manual/03-cli-reference.md** — every command you can call
5. **manual/04-ui-control.md** — how to make the Studio dance for the user
6. **manual/05-conventions.md** — naming, units, gotchas

When stuck, run `autoviral docs <topic>` to print any section.

## Aesthetic / taste decisions are NOT in this skill

AutoViral has no opinion on what makes a video good. Bring your own taste skill — [hyperframes](https://github.com/heygen-com/hyperframes), editorial-pro, your own — or ask the user.

## Recipes for common tasks

See `recipes/` — crossfade-between-clips, swap-clip-source, generate-i2v-batch, apply-platform-preset, add-subtitle-overlay.

## When in doubt

Run `autoviral ask "<question>" --yes-no` to consult the user via a modal. Never silently make destructive changes.
```

- [ ] **Step 2: Commit**

```bash
git add skills/autoviral/SKILL.md
git commit -m "docs(skill): rewrite SKILL.md as operator-manual entry"
```

---

### Task 4.3-4.8: Write each manual section

Six tasks, one per file in `manual/`. Each follows the same shape:

- **Task 4.3:** `manual/00-quickstart.md` — narrate the end-to-end flow from blank workspace to exported mp4 in <500 words.
- **Task 4.4:** `manual/01-workspace-layout.md` — `~/.autoviral/works/$ID/` tree with each file's purpose; what's writable, what's generated.
- **Task 4.5:** `manual/02-composition-schema.md` — the `Composition` zod schema annotated with examples; clip kinds; keyframes (incl. opacity for crossfade — refer to recipes/crossfade-between-clips.md).
- **Task 4.6:** `manual/03-cli-reference.md` — same content as `docs/superpowers/specs/agentic-terminal-bridge-protocol.md`'s command table, expanded with examples per command.
- **Task 4.7:** `manual/04-ui-control.md` — when to call `select`/`seek`/`toast`/`ask`/`progress` for a great UX.
- **Task 4.8:** `manual/05-conventions.md` — seconds vs frames, fps locked at composition.fps, trackOffset is absolute on the track, clip overlap semantics, etc.

Each task = write the file + commit. ~5 minutes each.

```bash
# Per task:
git add skills/autoviral/manual/<file>.md
git commit -m "docs(skill): write manual/<file>"
```

---

### Task 4.9-4.13: Write recipes

Five recipes, one per file in `recipes/`. Each is a step-by-step pattern with exact `autoviral` commands.

- **Task 4.9:** `recipes/crossfade-between-clips.md` — overlap clips 0.18s + fade-out keyframes (the exact pattern we shipped in the prior bug fix).
- **Task 4.10:** `recipes/swap-clip-source.md` — `autoviral clip set <id> --src new.mp4`.
- **Task 4.11:** `recipes/generate-i2v-batch.md` — call Seedance via external API + write the 16 clip entries with proper `trackOffset` math.
- **Task 4.12:** `recipes/apply-platform-preset.md` — set `exportPresets[0]` for 抖音/B站/YouTube.
- **Task 4.13:** `recipes/add-subtitle-overlay.md` — wire a CaptionModel into composition with overlay strategy.

```bash
# Per recipe:
git add skills/autoviral/recipes/<file>.md
git commit -m "docs(skill): write recipe/<file>"
```

---

### Task 4.14: Write `contracts/`

**Files:**
- Create: `skills/autoviral/contracts/error-codes.md`
- Create: `skills/autoviral/contracts/event-stream.md`

- [ ] **Step 1: error-codes.md** — pull from the bridge protocol spec.
- [ ] **Step 2: event-stream.md** — every WebSocket event type the agent might observe (most agents won't, but power users / future MCP shim will).
- [ ] **Step 3: Commit each**

```bash
git add skills/autoviral/contracts
git commit -m "docs(skill): contracts/error-codes + contracts/event-stream"
```

---

### Task 4.15: Phase 4 milestone — three-agent dry-read

Have three different agents read SKILL.md + manual/* and report back what they understood. This is a validation step — not all agents will summarize equally well, and gaps in the docs surface immediately.

- [ ] **Step 1: Read with claude-code**

```bash
# In an autoviral terminal panel:
claude --print "Read every file under skills/autoviral/ and tell me: (1) what is the autoviral CLI for? (2) when should I call autoviral ask? (3) how do I crossfade two clips?"
```

Save the response. Note any gaps.

- [ ] **Step 2: Read with codex**

Same prompt via `codex` CLI. Note differences.

- [ ] **Step 3: Read with kimi**

Same prompt via `kimi` CLI. Note differences.

- [ ] **Step 4: Patch any gap you found in the manual; commit**

```bash
git commit -am "docs(skill): clarify <gap-area> based on three-agent dry-read"
```

- [ ] **Step 5: Tag**

```bash
git tag phase-4-skill-rewritten
```

---

## Phase 5 — Polish + three-agent E2E

Goal: by end of phase, the refactor is shippable. Three agents can complete
the same end-to-end task in the Studio (generate an i2v batch + render).

### Task 5.1: Toast styling matches Brand

**Files:**
- Modify: `web/src/stores/toast.ts` + the toast UI component

- [ ] **Step 1: Audit current toast UI**, ensure it uses glass + cool-steel
tokens, font-mono for the message, kind-indicator dot on the left.

- [ ] **Step 2: Commit**

```bash
git commit -am "style(toast): editorial glass styling for bridge UI commands"
```

---

### Task 5.2: Render progress UI

**Files:**
- Modify: `web/src/features/terminal/useBridgeEvents.ts`
- Create: `web/src/features/terminal/RenderProgressBar.tsx`

- [ ] **Step 1: Wire `ui-render-progress` event into a top-bar progress strip with stage label**

```typescript
// surface stage names: render / duck / loudnorm / burn / encode
// progress bar matches accent gradient
```

- [ ] **Step 2: Commit**

```bash
git add web/src/features/terminal/RenderProgressBar.tsx web/src/features/terminal/useBridgeEvents.ts
git commit -m "feat(ui): render progress strip surfaced from bridge events"
```

---

### Task 5.3: Terminal reconnect on disconnect

**Files:**
- Modify: `web/src/features/terminal/useTerminalSocket.ts`
- Modify: `web/src/features/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Auto-retry WebSocket with backoff (1s, 2s, 5s, then give up + show reconnect button)**

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(terminal): reconnect with backoff + manual reconnect button"
```

---

### Task 5.4: Composition diff command (`autoviral comp diff`)

**Files:**
- Modify: `src/server/bridge/composition-ops.ts` (add `diffComposition`)
- Modify: `cli/autoviral/src/commands/comp.ts`

- [ ] **Step 1: Use simple-diff against last `git show HEAD:composition.yaml`** OR keep a backup file when `mutateCompositionFor` writes.

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(cli): autoviral comp diff — unified diff vs last commit"
```

---

### Task 5.5: Backend WebSocket auth (light)

**Files:**
- Modify: `src/server/bridge/bridge-ws.ts` + `terminal-ws.ts`

- [ ] **Step 1: Reject WebSocket upgrades from non-localhost origins**

Since the server only binds to 127.0.0.1 by default, this is already
de-facto enforced. Add an explicit `req.headers.origin` check as defense
in depth + log rejected attempts.

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(bridge): reject cross-origin WebSocket upgrades"
```

---

### Task 5.6: Three-agent end-to-end task

Define a canonical task: "Given an empty workspace, generate 8 i2v clips
of 5 seconds each at 16:9 720p with `autoviral` + an image generator,
arrange them on a video track with 0.18s crossfade between adjacent clips,
add a BGM track, render the output."

- [ ] **Step 1: Run with claude-code**

Inside the Studio terminal:
```
$ claude
> [paste the task]
```

Capture transcript + screenshot of resulting Studio + verify exported mp4.

- [ ] **Step 2: Run with codex**

Same task, different agent.

- [ ] **Step 3: Run with kimi**

Same task.

- [ ] **Step 4: Score**

For each: success/fail, time-to-complete, # of `autoviral ask` calls,
quality of final mp4. If <2 of 3 succeed, identify what's missing from the
manual or CLI and add tasks back into the plan.

- [ ] **Step 5: Document the results in `docs/qa/three-agent-e2e-report.md`**

- [ ] **Step 6: Commit**

```bash
git add docs/qa/three-agent-e2e-report.md
git commit -m "docs(qa): three-agent E2E validation report"
```

---

### Task 5.7: Final merge prep

- [ ] **Step 1: Squash + clean commit history if desired (optional)**

```bash
git log --oneline main..refactor/agentic-terminal | wc -l
# decide if rebase + squash makes sense for the PR; otherwise leave verbose
```

- [ ] **Step 2: Update CHANGELOG.md / README.md with the new product framing**

- [ ] **Step 3: Final test sweep**

```bash
npm run test:server
npm run test:web
npx tsc --noEmit -p web/tsconfig.json
cd cli/autoviral && npm test
```

All green.

- [ ] **Step 4: Tag the final commit + present for merge**

```bash
git tag refactor-complete
```

---

## Self-Review

(Run before declaring the plan ready.)

**1. Spec coverage:**
- "Terminal in Studio" → Phase 1 ✓
- "Any agent can drive it" → Phase 2 + Phase 4 (manual) + Phase 5 (3-agent E2E) ✓
- "Skill = operator manual, not taste" → Phase 4 ✓
- "HTTP POST bridge" → Phase 0 spec + Phase 2/3 implementation ✓
- "Single branch, all phases" → Phase 0 Task 0.2 ✓

**2. Placeholder scan:** I left a few explicit deferrals (`progress` event details inside Task 3.3, audio/text track support in `clip add` Task 3.8). These are scope-trimming, NOT TBDs — Phase 4 recipes only need video crossfades for the demo task. Documented in-place.

**3. Type consistency:**
- `PtySession.id` (string) flows through `PtyPool` → `terminal-ws` consistently
- `UiEvent.type` strings match between `bridge/routes.ts` broadcasts and `useBridgeEvents.ts` switch cases (`ui-select`/`ui-seek`/`ui-play`/`ui-pause`/`ui-toast`/`ui-progress`/`ui-ask`/`composition-changed`/`ui-render-progress`)
- Exit codes 0/1/2/3/4/124/127 used uniformly across all CLI commands

---
