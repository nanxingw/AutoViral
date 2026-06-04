# ADR-008: Multi-session Chat + Terminal — `(workId, sessionId)` keying, sidecar persistence, shared focus

- **Status:** Accepted
- **Date:** 2026-06-04
- **Deciders:** nanxingw + AI design partner
- **Related:** [ADR-005](ADR-005-dual-chat-entry-layout.md) (superseded in the multi-session dimension), [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md)
- **Resolves:** PRD-0003 §5 — the keystone HITL gate (I22) for I23 / I24 / I25.

## Context

ADR-005 fixed the right-pane layout as a horizontal tab switcher (Chat | Terminal) and explicitly scoped Studio to **"one work = one Chat + one Terminal", "no multi-tab concurrency."** PRD-0003 §5 changes that scope: the user wants to **open a new chat / a new terminal while keeping the existing one, so they can jump back.** That is a keystone change — session identity moves from `(workId)` to `(workId, sessionId)` — which sits outside ADR-005's range, hence this ADR.

### Verified current state (2026-06-04 grep, not PRD hearsay)

| Surface | Current keying | Persistence | Resume |
|---|---|---|---|
| **Chat** | `WsBridge.sessions: Map<workId, WsSession>` (`src/ws-bridge.ts:277`) — one in-memory session per work (single `cliProcess` / `messageHistory` / `cliSessionId`). `broadcastToBrowsers(workId)` fans focus/blocks to every browser on the work. | `chat.jsonl` + `work.yaml.cliSessionId` | yes (`claude --resume <cliSessionId>`) |
| **Terminal** | **Connection-scoped, no stable identity.** Each ws connection runs `handle(ws, workId)` → `pool.spawn()` a **fresh** pty keyed by a generated `pty_<rand>` id (`src/server/terminal/terminal-ws.ts:68-87`, `pty-pool.ts`). `workId` is used only for `cwd`. On `ws.close` the pty is `dispose()`d (`terminal-ws.ts:106-110`). | none | **no** — reload = new shell, scrollback lost |

**PRD §5 correction (evidence over the PRD).** PRD §5 claims "two browser tabs on the same work connect to the *same* pty (output duplication / resize conflict)." That is **false** — the code spawns an **independent** pty per ws connection and disposes it on close, so two tabs today get **two separate** ptys, and a reload **kills** the pty (no resume). The real current-state defect is the *opposite*: ptys have **no stable identity and no resume**. This correction reframes I25: the goal is not "stop sharing a pty" but "give ptys a stable `(workId, sessionId)` identity so a session survives reconnect" — and, as a consequence, multiple tabs viewing the *same* session will *intentionally* attach to one pty (multiplex), which is where output-broadcast + resize negotiation become real (designed, not accidental) concerns.

## Decision

Move session identity from `(workId)` to **`(workId, sessionId)`** for both Chat and Terminal, persist a per-work session manifest in an **append-only `.sessions.jsonl` sidecar**, keep **focus (playhead / selection) work-scoped and shared across all sessions**, and govern session growth with **manual delete + idle-TTL auto-archive**.

### 1. Session keying & WS routes — path-based

- `WsBridge.sessions: Map<workId, WsSession>` → **nested** `Map<workId, Map<sessionId, WsSession>>`. `PtyPool` keyed by `(workId, sessionId)` instead of an opaque generated id.
- WS routes carry sessionId in the **path** (matches the existing `/ws/browser/{workId}` / `/ws/terminal/{workId}` convention, not a query param):
  - `/ws/browser/{workId}/{sessionId}`
  - `/ws/terminal/{workId}/{sessionId}`
- **`sessionId` is our own id** (server-minted, short, stable — e.g. `s_<base36 counter>` per work). It is **distinct from `cliSessionId`**, which is claude's immutable `--resume` UUID. Each *chat* session owns its own `cliSessionId`; a *terminal* session's `sessionId` identifies the pty lineage. Never conflate the two.

### 2. Persistence — `.sessions.jsonl` sidecar, never inline in work.yaml

- Per-work sidecar `~/.autoviral/works/{workId}/.sessions.jsonl`, **append-only** (last-write-wins on replay by `id`). One record per session:
  ```jsonc
  { "id": "s_1", "surface": "chat" | "terminal",
    "cliSessionId": "<uuid|undefined>",          // chat only
    "createdAt": "<iso>", "lastActive": "<iso>",
    "preview": "<first user line / cwd>",
    "archived": false }
  ```
  Append-only is chosen over inline-in-`work.yaml` because `updateWork` rewrites the whole yaml on every mutation — inlining a growing session list there would amplify writes and risk clobbering. State changes (rename/archive/delete/lastActive bump) are **new appended records** replayed at load; a periodic compaction may rewrite the file (out of scope here).
- Chat log per session: `chat.jsonl` → **`chat-{sessionId}.jsonl`**.

### 3. Focus channel — **shared across sessions** (work-scoped)

Playhead position and the selected clip/layer stay **work-scoped**, shared by every session of that work. `broadcastToBrowsers(workId)` keeps broadcasting focus to *all* browsers/sessions on the work; focus is **not** keyed by sessionId. Rationale: one work = one canvas; multiple chats/terminals are editing the *same* `composition.yaml`, so they should see the same playhead and selection. Isolating focus per session would require threading sessionId through the focus store and would let two sessions disagree about "the current selection" on a single shared document — confusing, and strictly more code. (Reversible later if a real need appears.)

### 4. Migration — legacy single session → first session, lazy & non-destructive

On first access of a work that has **no `.sessions.jsonl`**:
- Synthesize one chat session record `{ id: "s_1", surface: "chat", cliSessionId: <work.yaml.cliSessionId>, preview: <derived>, archived: false }`.
- **Keep the legacy `chat.jsonl` filename for `s_1`** (the chat-log resolver maps `s_1` → `chat.jsonl` when no `chat-s_1.jsonl` exists). New sessions use `chat-{sessionId}.jsonl`. This avoids a risky bulk file-rename migration — no existing history is moved or rewritten.
- No terminal session is synthesized (terminals had no persisted identity anyway; the first new terminal mints `s_1` in the terminal namespace, independent of chat ids).

### 5. Session governance — manual delete + idle-TTL auto-archive

- **Manual delete:** hard-removes a session — disposes the in-memory `WsSession` / pty, marks `deleted` (or drops the record on compaction), and removes its `chat-{sessionId}.jsonl`. UI two-step confirm (reuses the repo's confirm-dialog pattern).
- **Idle-TTL auto-archive:** a session whose `lastActive` is older than **`SESSION_IDLE_TTL` (default 7 days)** is auto-archived on boot/sweep: the in-memory session and pty are **disposed (memory released)** but the chat log is **kept on disk** and the record flagged `archived: true`. Archived sessions are hidden from the active session strip and surfaced under an "archived" affordance; opening one **restores** it (re-seed history from `chat-{sessionId}.jsonl`, re-`--resume` via its `cliSessionId`). TTL is injectable/configurable so tests don't wait 7 days.
- This caps live-memory growth (each active chat session holds ~60–90k of `messageHistory`) without silently destroying data — the dangerous member ("auto-disappear") is mitigated by archive-not-delete + restorability.

### 6. Terminal lifecycle (corrects I25 framing)

- pty keyed by `(workId, sessionId)`, **persists across ws reconnect** — `ws.close` no longer disposes the pty; only explicit session **delete** or **pty exit** disposes it. (This is the actual resume fix; "new tab doesn't kill old" falls out for free.)
- Same-session multi-attach is **intentional**: N tabs on `(workId, s_2)` attach to the one pty. Server **broadcasts pty output to all attached ws**; resize is **last-writer-wins** (acceptable — same session, rare conflict). Different sessions → different ptys (no cross-talk).
- Respawn button: replaces a dead/exited pty under the same sessionId.

### 7. Relationship to ADR-005

ADR-005's **layout** decision stands (Chat | Terminal horizontal tab switcher, default Chat, both surfaces stay mounted via `display:none`). What is **superseded** is its scope clause "one Chat + one Terminal / no multi-tab concurrency": each surface now hosts an **intra-surface session sub-strip** (session tabs/dropdown) under the Chat|Terminal switcher. ADR-005 Consequences is annotated accordingly.

## Consequences

### Positive
- Users get true multi-conversation / multi-terminal with jump-back, the headline §5 ask.
- Terminal finally **resumes** across reload — a long-standing papercut fixed as a side effect.
- Sidecar keeps `work.yaml` small and write-cheap; append-only is crash-friendly.
- Shared focus = minimal new surface area (existing broadcast already work-scoped).
- `tsc` guards the keying change: threading `sessionId` through `Map<workId, Map<sessionId>>` / hooks makes every stale single-session call a compile error.

### Negative
- More moving parts (nested maps, per-session WS lifecycle, archive sweep). Mitigated by landing backend (I23) behind round-trip tests before any frontend.
- Append-only sidecar needs eventual compaction; deferred (records are tiny; a work won't realistically accrue thousands).
- Same-session multi-attach resize is last-writer-wins, not negotiated — a minor power-user wart, acceptable.

### Neutral
- `SESSION_IDLE_TTL` default 7 days is a guess; tunable via config later.
- Terminal scrollback across *server* restart is still not persisted (pty is process state) — out of scope per PRD; resume here means in-process survival across ws reconnect.

## Alternatives considered

### A. `(workId, sessionId)` keying + sidecar + shared focus (chosen)
See Decision.

### B. sessionId as a query param (`/ws/terminal/{workId}?session=s_2`)
**Rejected.** The existing routes put workId in the path; a query param would split the convention and complicate the upgrade-time route parse. Path segments are uniform and cache-/log-friendly.

### C. Inline session list in `work.yaml`
**Rejected.** `updateWork` rewrites the whole file per mutation; a growing inline list amplifies writes and widens the clobber window on the shared work doc. Sidecar append-only avoids both.

### D. Per-session isolated focus
**Rejected (user decision).** One work = one canvas; isolating playhead/selection per session lets sessions disagree about the single shared document and costs extra keying. Shared is simpler and matches the mental model.

### E. No-TTL, manual-delete-only governance
**Rejected (user decision).** Live chat sessions each pin ~60–90k of history in memory; unbounded accrual risks runaway memory. Idle-TTL auto-archive releases memory while keeping data restorable.

## Implementation notes

Maps onto PRD-0003 slices:
- **I23 (backend):** nested `Map<workId, Map<sessionId>>` in `WsBridge` + `PtyPool`; path routes `/ws/{browser,terminal}/{workId}/{sessionId}`; `.sessions.jsonl` sidecar read/append + `chat-{sessionId}.jsonl`; lazy legacy migration (§4); idle-TTL archive sweep (injectable TTL). Land behind `npm run test:server` round-trip + migration tests **before** touching frontend.
- **I24 (frontend chat):** session sub-strip + "new chat" in ChatPanel; `useChatSocket` / `useChatStore` take a `sessionId`; switch = close old ws / open new / re-seed history by sessionId.
- **I25 (frontend terminal):** terminal session sub-strip + "new terminal" (does **not** kill old pty); `useTerminalSocket` takes `sessionId`; respawn button; the pty-resume + multi-attach broadcast land in I23's server change.

## References
- PRD-0003 (`docs/prd/0003-v0.1.2-zero-friction-setup.md`) §5 + Open Questions.
- `src/ws-bridge.ts:277` (`Map<workId, WsSession>`), `src/server/terminal/terminal-ws.ts:68-110`, `src/server/terminal/pty-pool.ts` — verified current state.
- ADR-005 (`ADR-005-dual-chat-entry-layout.md`) — layout this ADR builds on / scopes past.
- CONTEXT invariant #4 (Terminal agent skill-agnostic / Chat claude-only) — unchanged; multi-session still runs over the generic pty + bridge protocol.
