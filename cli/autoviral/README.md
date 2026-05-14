# @autoviral/cli

Agent-facing bridge between any shell agent (claude / codex / kimi / aider /
…) and the AutoViral Studio.

The CLI is the **agent-agnostic protocol layer**: any agent in any shell
running inside the Studio terminal panel can drive the Studio UI by
shelling out to `autoviral <subcommand>`. The Studio backend translates
the call into UI events broadcast over WebSocket to the active tab.

## Install (dev)

From the AutoViral repo root:

```bash
npm run install:cli
```

This builds and global-links `autoviral` on your PATH.

## Commands

Phase 2 (current): read-only.

```
autoviral whoami                       # current Studio context
autoviral docs [topic]                 # operator manual (raw markdown)
autoviral comp show                    # full composition.yaml
autoviral list clips [--track video]   # clip rows, optionally per-track
autoviral list assets [--kind video]   # asset registry, optionally per-kind
```

Phase 3 will ship writes + UI control: `clip add/set/remove`, `select`, `seek`,
`play`/`pause`, `toast`, `progress`, `ask`, `export`, `render`.

See [the plan](../../docs/superpowers/plans/2026-05-14-agentic-terminal-refactor.md)
for the full command surface and rollout schedule.

## Environment

The terminal panel injects these env vars into the spawned pty so the CLI
auto-detects the active Studio:

- `AUTOVIRAL_WORK_ID` — current workspace id
- `AUTOVIRAL_PORT` — backend port (default 3271)
- `AUTOVIRAL_CWD` — `~/.autoviral/works/$AUTOVIRAL_WORK_ID`

If you run `autoviral` outside the Studio terminal, it exits with code 2
("no AutoViral context detected").

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User said "no" to an `ask` |
| 2 | Wrong state (no AUTOVIRAL_WORK_ID env, Studio not running) |
| 3 | Protocol error (malformed bridge response) |
| 4 | Validation error (bad CLI args) |
| 124 | Timeout (typically `ask`) |
| 127 | Unknown subcommand |
