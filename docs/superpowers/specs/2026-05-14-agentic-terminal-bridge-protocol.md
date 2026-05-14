# AutoViral Bridge Protocol v1

**Status:** Frozen 2026-05-14 for the agentic-terminal refactor.
**Audience:** Anyone implementing `autoviral` CLI commands, Studio backend RPC routes, or Studio UI subscribers.
**Companion:** [Implementation Plan](../plans/2026-05-14-agentic-terminal-refactor.md)

The bridge is the **only** way an in-terminal agent talks to the Studio UI. It exists because file watches alone can't express UI commands (select / seek / toast / blocking ask). Keeping it tiny, shell-native, and agent-agnostic is the explicit design intent.

## Transport

| Direction | Channel | Frame |
|---|---|---|
| CLI → Backend | HTTP/1.1 to `http://127.0.0.1:${AUTOVIRAL_PORT}/api/bridge/v1/...` | JSON body |
| Backend → Studio UI | WebSocket `/ws/bridge/:workId` | JSON frames |
| Backend ↔ pty | WebSocket `/ws/terminal/:workId` | JSON frames wrapping raw bytes |
| Studio UI → Backend | Same `/ws/bridge/:workId`, inbound | Approval responses |

Loopback only (`127.0.0.1`). Cross-origin WebSocket upgrades rejected.

All HTTP requests carry header **`X-AutoViral-Work-Id: ${AUTOVIRAL_WORK_ID}`**. The backend resolves the active Studio tab(s) bound to that work id and broadcasts to them. A request without the header → `400 Bad Request`.

## HTTP request/response envelope

```http
POST /api/bridge/v1/select HTTP/1.1
Content-Type: application/json
X-AutoViral-Work-Id: w_20260514_1019_abc

{ "target": { "kind": "clip", "id": "vc_s07" } }
```

```http
200 OK
Content-Type: application/json

{ "ok": true, "result": { "selected": "vc_s07" } }
```

Failure shape:
```json
{ "ok": false, "error": "humanly readable", "code": 4 }
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

## Commands

### Read-only

| HTTP path | CLI form | Returns |
|---|---|---|
| `GET /api/bridge/v1/whoami` | `autoviral whoami` | `{ workId, cwd, port, version }` |
| `GET /api/bridge/v1/docs?topic=` | `autoviral docs [topic]` | raw markdown from `skills/autoviral/manual/` |
| `GET /api/bridge/v1/comp` | `autoviral comp show` | composition.yaml as JSON |
| `GET /api/bridge/v1/comp/diff` | `autoviral comp diff` | unified diff vs last commit |
| `GET /api/bridge/v1/clips?track=` | `autoviral list clips [--track video]` | array of clip summaries |
| `GET /api/bridge/v1/assets?kind=` | `autoviral list assets [--kind video]` | array of asset entries |

### Write composition

| HTTP path | CLI form | Side effect |
|---|---|---|
| `POST /api/bridge/v1/clip` | `autoviral clip add --src x.mp4 --track video --offset 12.4 --duration 4.8` | Append clip; emit `composition-changed` |
| `PATCH /api/bridge/v1/clip/:id` | `autoviral clip set vc_s07 --opacity 0.5 ...` | Partial update; emit `composition-changed` |
| `DELETE /api/bridge/v1/clip/:id` | `autoviral clip remove vc_s07` | Remove; emit `composition-changed` |

All composition writes are **atomic** (tmpfile + rename) and **schema-validated** (zod). A failed validation returns HTTP 400 with the zod issue list. The on-disk file is never partially-written.

### UI commands (stateless broadcasts)

| HTTP path | CLI form | UI event |
|---|---|---|
| `POST /api/bridge/v1/select` | `autoviral select <kind> <id>` | `ui-select` |
| `POST /api/bridge/v1/seek` | `autoviral seek 12.5s` (also `1m30s`) | `ui-seek` |
| `POST /api/bridge/v1/play` | `autoviral play` | `ui-play` |
| `POST /api/bridge/v1/pause` | `autoviral pause` | `ui-pause` |
| `POST /api/bridge/v1/toast` | `autoviral toast "msg" --kind success --duration 3000` | `ui-toast` |
| `POST /api/bridge/v1/progress` | `autoviral progress start "Rendering" --steps 5` / `step 3` / `done` | `ui-progress` |

### Approval gate (blocking)

`POST /api/bridge/v1/ask` blocks the HTTP response until the Studio UI emits an `approval-response` WebSocket frame matching the request's `askId`. Default timeout 30 minutes; CLI overrides with `--timeout` (seconds).

```bash
$ autoviral ask "Apply 3 changes?" --yes-no
yes        # printed to stdout
$ echo $?
0          # exit 0 = yes, 1 = no, 2 = cancelled, 124 = timeout
```

| CLI form | Behavior |
|---|---|
| `autoviral ask "msg" --yes-no` | Two buttons; exit 0=yes, 1=no |
| `autoviral ask "msg" --ok-cancel` | OK/Cancel; exit 0=ok, 2=cancelled |
| `autoviral approve-render` | Convenience alias for "Render now? (yes/no)" |

### Tasks

| HTTP path | CLI form | Notes |
|---|---|---|
| `POST /api/bridge/v1/export` | `autoviral export [--preset douyin]` | Triggers `runRenderPipeline`; emits `ui-render-progress` events |
| `POST /api/bridge/v1/render` | `autoviral render [--proxy]` | Same with proxy flag |

## Exit codes (CLI)

| Code | Meaning | When it fires |
|---|---|---|
| 0 | Success | All happy paths; `ask` answered yes |
| 1 | User said "no" | `ask` answered no |
| 2 | Wrong state | Missing `AUTOVIRAL_WORK_ID` env, or Studio not reachable on `AUTOVIRAL_PORT`; `ask` cancelled |
| 3 | Protocol error | Malformed bridge response, schema mismatch, network mid-call |
| 4 | Validation error | Bad CLI args, missing required flags |
| 124 | Timeout | `ask` not answered within `--timeout` |
| 127 | Unknown subcommand | Typo in CLI |

## Output formats

- Default to **JSON** to stdout when `stdout.isTTY === false` (piped / agent-consumed).
- Default to **YAML or human-readable table** when `stdout.isTTY === true` (interactive user looking).
- Override either direction with `--format json|yaml|table`.

This split is intentional: agents using `autoviral list clips | jq ...` get clean JSON; users typing `autoviral list clips` interactively get a scannable table.

## Environment contract

The terminal panel spawns the pty with these injected env vars:

| Var | Value | Set by |
|---|---|---|
| `AUTOVIRAL_WORK_ID` | The `:workId` from `/studio/:workId` | Terminal WebSocket adapter |
| `AUTOVIRAL_PORT` | The backend port (default 3271) | Terminal WebSocket adapter |
| `AUTOVIRAL_CWD` | `~/.autoviral/works/${AUTOVIRAL_WORK_ID}` | Terminal WebSocket adapter |

The CLI exits with code 2 if `AUTOVIRAL_WORK_ID` is unset — making the binary safe to leave on the user's global PATH (running `autoviral whoami` from a non-Studio terminal fails fast with a clear message).

## What this protocol explicitly does NOT do

- **No sandboxing.** The pty runs the user's actual shell on their actual mac. Agents have the same access the user has.
- **No multi-tenant isolation.** One Studio tab = one pty session. Multi-tab is permitted but no tab-level access controls.
- **No MCP server (yet).** MCP is a possible Phase 6 addition as a thin shim over this HTTP API; the CLI remains the canonical interface.
- **No auth.** Loopback binding is the boundary. A future remote-Studio feature would need auth bolted on at the WebSocket upgrade.

## Versioning

The path prefix `/api/bridge/v1/` is the version handle. Breaking changes ship as `/v2/`. The CLI's `whoami` returns the bridge version it spoke; the CLI's startup checks compat and falls back to a clear "upgrade autoviral" message on mismatch.
