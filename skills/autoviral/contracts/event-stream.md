# WebSocket event stream

The Studio UI subscribes to `ws://127.0.0.1:${AUTOVIRAL_PORT}/ws/bridge/:workId` and receives JSON frames. Most agents will never connect directly — the `autoviral` CLI is the canonical interface — but power users, MCP shims, and debug tooling do.

## Frame envelope

```json
{
  "type": "ui-select",
  "workId": "w_20260514_1019_abc",
  "ts": 1747250000123,
  "payload": { "kind": "clip", "id": "vc_s07" }
}
```

Every event has these four fields. `payload` varies per type; everything below documents the shape.

## Event types (Backend → Studio UI)

### `ui-select`

```json
{ "type": "ui-select", "workId": "...", "ts": 0,
  "payload": { "kind": "clip", "id": "vc_s07" } }
```

`payload.kind` is `clip | track | none`. When `none`, no `id` field.

Triggered by `POST /api/bridge/v1/select` (`autoviral select ...`).

### `ui-seek`

```json
{ "type": "ui-seek", "workId": "...", "ts": 0,
  "payload": { "seconds": 12.5 } }
```

`payload.seconds` is a non-negative float.

Triggered by `POST /api/bridge/v1/seek` (`autoviral seek ...`).

### `ui-play`

```json
{ "type": "ui-play", "workId": "...", "ts": 0, "payload": null }
```

Triggered by `POST /api/bridge/v1/play` (`autoviral play`).

### `ui-pause`

```json
{ "type": "ui-pause", "workId": "...", "ts": 0, "payload": null }
```

Triggered by `POST /api/bridge/v1/pause` (`autoviral pause`).

### `ui-toast`

```json
{ "type": "ui-toast", "workId": "...", "ts": 0,
  "payload": { "message": "Done", "kind": "success", "durationMs": 3000 } }
```

`payload.kind` is `info | success | warn | error`. `durationMs` is the auto-dismiss timer.

Triggered by `POST /api/bridge/v1/toast` (`autoviral toast ...`).

### `ui-progress`

```json
{ "type": "ui-progress", "workId": "...", "ts": 0,
  "payload": { "phase": "start", "label": "Generating clips", "steps": 16 } }
```

Three phase shapes:

- `{ phase: "start", label: string, steps?: number }`
- `{ phase: "step", n: number }`
- `{ phase: "done" }`

Triggered by `POST /api/bridge/v1/progress` (`autoviral progress start|step|done`).

### `ui-ask`

```json
{ "type": "ui-ask", "workId": "...", "ts": 0,
  "payload": { "askId": "ask_abc123", "message": "Render now?", "kind": "yes-no" } }
```

`payload.kind` is `yes-no | ok-cancel`. The Studio opens a modal; the user clicks; the Studio sends back an `approval-response` inbound frame (see below).

Triggered by `POST /api/bridge/v1/ask` (`autoviral ask ...`). The HTTP response is **held open** until the matching `approval-response` arrives.

### `ui-render-progress`

```json
{ "type": "ui-render-progress", "workId": "...", "ts": 0,
  "payload": { "stage": "encode", "pct": 0.67 } }
```

`payload.stage` is one of the `RenderStage` literals from `src/server/render-pipeline.ts` (`decode | compose | encode | mux` + variants). `payload.pct` is `[0, 1]`.

Triggered automatically during `POST /api/bridge/v1/export` and `/render` — agents don't fire this manually.

### `composition-changed`

```json
{ "type": "composition-changed", "workId": "...", "ts": 0,
  "payload": { "reason": "external-edit" } }
```

Fires when `composition.yaml` is rewritten — either by a bridge `clip add/set/remove` call or by an external editor (the watcher sees the file change). `payload.reason` is `"bridge-write"` or `"external-edit"`.

Triggered by the composition watcher; agents don't fire this manually.

## Background-task lifecycle (`ui-workflow`)

> **Different transport.** Unlike every envelope above (work-level `/ws/bridge/:workId`, `{type, workId, ts, payload}`), the `ui-workflow` family rides the **per-session chat WebSocket** `/ws/browser/:workId/:sessionId` and uses that stream's frame shape `{ event, data, timestamp }`. A background task belongs to one chat session (the CLI process that spawned it), so it is fanned to that session's sockets only — not work-wide. Consumed by the Studio chat task panel.

Models the lifecycle of harness-tracked background tasks a chat agent starts (a Workflow run, a background Bash, a subagent). Task state is **mutable concurrent state**, not an append-only transcript — so it uses a registry + snapshot model (like the render progress channel), keyed by `sessionId + taskId + generation`.

### `ui-workflow`

An upsert (or terminal transition) of one task. Same-id delivery **REPLACES** the prior view of that task on the client — it is not appended.

```json
{ "event": "ui-workflow", "timestamp": "2026-07-15T06:32:50.202Z",
  "data": {
    "workId": "w_20260714_2317_f24", "sessionId": "s_1",
    "taskId": "wf_296ee812", "generation": 3, "status": "running",
    "taskType": "local_workflow", "description": "深度调研",
    "toolUseId": "toolu_x", "summary": "报告已出",
    "usage": { "total_tokens": 1234, "tool_uses": 3 },
    "outputFile": "research/report.md",
    "startTime": 1752561170195, "endTime": 1752561170712,
    "settleReason": "cli_exit", "ts": 1752561170712 } }
```

| field | type | notes |
|---|---|---|
| `sessionId` | string | Chat session the task belongs to. Half of the identity. |
| `taskId` | string | claude's ephemeral per-process task id (reused across turns). |
| `generation` | number | Process generation (bumped each spawn). `taskId` alone is ambiguous across turns; `taskId + generation` is the stable key — an old turn's task and a new turn's same-`taskId` task are two rows. |
| `status` | enum | `running` \| `pending-settle` \| `completed` \| `failed` \| `killed` \| `stopped` \| `orphaned`. |
| `taskType` | string? | e.g. `local_workflow` / `local_bash` (passed through, not enumerated). |
| `description` | string? | Human label. |
| `toolUseId` | string? | The assistant `tool_use` block that launched it (stitches to the chat chip). |
| `summary` | string? | Terminal notification summary. |
| `usage` | object? | Counts (`total_tokens` / `tool_uses` / `duration_ms` …) — the "how much did it cost" surface. |
| `outputFile` | string? | Produced artifact path, when the task reports one. |
| `startTime` / `endTime` | number? | Epoch ms. |
| `settleReason` | string? | Present only on a **synthesized** terminal state (host process exited while the task was still live) — e.g. `cli_exit` / `superseded`. A task that reached a natural terminal via a CLI frame has no `settleReason`. |
| `ts` | number | Broadcast epoch ms. |

**State machine.** A task is created `running`, may go `pending-settle` (dropped from the live snapshot but no terminal frame yet), and settles into one terminal: `completed` \| `failed` \| `killed` \| `stopped` \| `orphaned`. Terminal is **monotonic** — a late non-terminal frame never revives it (a CLI-authoritative terminal→terminal move like `killed`→`stopped` is allowed). `orphaned` is produced only by journal harvest (a later slice), never speculatively.

**Process-exit behavior.** When the host CLI process exits (turn end, kill, crash), the server settles every still-live task of that generation to `stopped` with a `settleReason` and broadcasts a terminal `ui-workflow` — so "killed with no notice" (issue 030) is impossible. Tasks that already reached a terminal are not overwritten.

### `ui-workflow-snapshot`

Sent **once, first**, to a browser the moment it (re)connects — the full current task set for the session (current generation + un-cleaned terminals), so a refresh / reconnect restores task state without depending on being online at the moment each `ui-workflow` fired. Subsequent changes arrive as incremental `ui-workflow` frames.

```json
{ "event": "ui-workflow-snapshot", "timestamp": "2026-07-15T06:33:00.000Z",
  "data": {
    "workId": "w_20260714_2317_f24", "sessionId": "s_1", "ts": 1752561180000,
    "tasks": [ { "taskId": "wf_296ee812", "generation": 3, "status": "running",
                 "taskType": "local_workflow", "description": "深度调研" } ] } }
```

`data.tasks` is an array of the same per-task shape as `ui-workflow`'s `data` (minus the envelope-level `sessionId`/`workId`/`ts`, which live on the snapshot wrapper). The client replaces its whole local task map for the session from this frame. Emitted only when the session has run at least one turn (no registry ⇒ no snapshot frame).

### KillGate drain discipline (`chat_notice` + terminal `ui-workflow`)

Every CLI-process recycle — a new message, `/stop`, a model/backend switch, a slash-command passthrough, a browser-disconnect grace timeout, an idle-TTL sweep, deleting a session, daemon shutdown — passes through one server-side chokepoint (`requestKill(session, cause)`). When the current generation has an **active** background task (a non-terminal task), the chokepoint refuses to silently abort it. Behavior by cause family (issue 030 fix):

| Cause family | With an active task |
|---|---|
| Destructive intent — `/stop`, `abort`, test-runner timeout, delete session, delete work (all sessions), session replace, daemon shutdown | Settle the task(s) to `stopped` + broadcast a terminal `ui-workflow` (`settleReason` = the cause), then kill. Never silent. |
| New user message | **Not killed.** The message is queued behind the running task and a `chat_notice` (`kind: "queued_message"`) is broadcast. When a `result` frame later arrives with the task settled, the queued message is dispatched as a fresh turn (queue replay bypasses the A2 dedup window and is mutually exclusive, so a double `result` frame flushes at most one queued message). |
| Model switch / backend switch / command passthrough | **Not killed.** The operation is refused and a `chat_notice` (`kind: "kill_rejected"`) is broadcast; the caller (e.g. `setSessionModel`, or the `POST /api/agent/model` route which returns **HTTP 409** `busy_background_task`) returns a failure so the UI can prompt "wait or /stop". |
| Browser-disconnect grace / idle-TTL sweep | **Skipped this round** — the process keeps running so its task finishes; it exits on its own. |

With no active task, every path behaves exactly as before (kill + respawn / archive).

> **"Drain" here means *immediate settle-and-broadcast*, not *wait-for-completion*.** Daemon shutdown (`shutdownAll`) walks every in-memory session and, for each, **immediately** synthesizes a terminal `ui-workflow` for its live tasks and SIGTERMs the CLI — it does **not** block waiting for background tasks to finish. The discipline is "close out honestly and tell the user (`settleReason: "daemon_shutdown"`), never leave a task silently orphaned", not "gracefully await the workflow". A settled generation is also *closed*: any late frame the dying process flushes for that generation is rejected, never reopening a dead task.

```json
{ "event": "chat_notice", "timestamp": "2026-07-15T06:34:00.000Z",
  "data": {
    "workId": "w_20260714_2317_f24", "sessionId": "s_1",
    "kind": "queued_message",
    "message": "后台任务运行中，消息将在完成后发送。" } }
```

`kind` is `"queued_message"` (a message was deferred behind a running task) or `"kill_rejected"` (a switch/command was refused; `data.cause` names which). `chat_notice` is a transient user-visible notice — it is **not** persisted to chat history.

## Inbound frames (Studio UI → Backend)

The same WebSocket is bidirectional. The UI sends:

### `approval-response`

```json
{ "t": "approval-response", "askId": "ask_abc123", "answer": "yes" }
```

`answer` is `"yes" | "no" | "cancelled"`. This unblocks the `POST /ask` HTTP request matching `askId`.

(Note the field name is `t`, not `type` — inbound frames are namespaced separately.)

## Subscription / lifecycle

- Connection open → bus subscribes the socket to `workId`
- Connection close → unsubscribe; no buffered replay (you miss what happened while disconnected)
- One Studio tab = one WebSocket = one subscription
- Multi-tab on the same workspace: every tab gets every event (they all see toasts / selects / progress)

## What's NOT broadcast over this stream

- pty bytes (terminal output / input) — those live on `/ws/terminal/:workId`, a separate WebSocket
- Studio-internal events (panel resizes, theme toggles, scroll positions)
- Render pipeline logs (only the progress events; full logs stay server-side)

## Building an MCP shim

If you're wrapping this as an MCP server, the natural shape is:

- Each `autoviral` subcommand → one tool
- The blocking `ask` becomes an MCP elicit
- The WebSocket events become MCP resource subscriptions (read-only)
- The CLI's stdout JSON shape is your tool result schema

The bridge protocol is intentionally MCP-shaped without being MCP-bound — adding the shim is a Phase 6 candidate.

## Versioning

The bridge path is `/api/bridge/v1/`. Breaking changes to event payloads ship as `/v2/`. The CLI's `whoami` returns the bridge version it speaks; check it before assuming a new event type exists.
