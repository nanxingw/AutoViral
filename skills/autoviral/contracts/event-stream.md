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
