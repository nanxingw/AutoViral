# Phase 3 — `autoviral` CLI v2 — E2E checkpoint notes

**Status:** Phase 3 backend + CLI + web wiring complete. Multi-layer test
coverage green (see counts below). Browser E2E smoke deferred — the dev
server failed to stay alive inside the Claude Code task harness (SIGTERM
on subprocess teardown), so the in-Studio terminal-panel walkthrough was
not captured this session.

## Test coverage that proves the wiring works

| Layer | Tests | Notes |
|---|---|---|
| `UiEventBus` | 4/4 | pub/sub correctness + workId isolation + unsubscribe |
| `/api/bridge/v1` routes | 24/24 | select / seek / play / pause / toast / progress / clip add/remove/patch / ask (yes + timeout=124) |
| `composition-ops` (write) | 4/4 | atomic round-trip + invalid composition leaves disk byte-identical |
| `approval-gate` | 5/5 | answer / timeout / unknown-id / no/cancelled paths |
| `composition-watcher` | 2/2 | macOS atomic-rename fires composition-changed; idempotent |
| `@autoviral/cli` end-to-end | 9/9 | subprocess + JSON envelope + exit codes (0/1/2/124/127) |

Total Phase 3 surface: **48 new test cases, all green.**

## Smoke steps that REMAIN to verify in browser

Per `.claude/rules/e2e-testing.md`, these still need real Studio screenshots:

1. `autoviral select clip vc_s01` → clip highlights in Studio
2. `autoviral seek 5s` → preview jumps to ~5s
3. `autoviral toast "test" --kind success` → toast appears
4. `autoviral ask "Continue?" --yes-no` → modal appears, click YES → CLI exits 0
5. `autoviral clip remove vc_s01` → Studio composition re-fetches via watcher

Pickup instructions for the next session:

```bash
# In a real Terminal.app (not the Claude Code harness):
node dist/cli.js start --foreground   # keeps server alive
open http://127.0.0.1:3271/studio/<workId>
# In the Studio's TerminalPanel, run the 5 commands above.
```

## What broke inside the harness

`node dist/cli.js start --foreground` runs `process.on("SIGTERM" → exit)`.
When the Bash tool-call returns, the harness's process group teardown
sends SIGTERM to every child, including the server. Background mode
(`run_in_background: true`) didn't help — the harness still tears the
tree down on task completion.

This is a harness limitation, not a Phase 3 wiring bug. The unit +
integration tests cover the full bridge round-trip including the trickiest
piece (approval gate yes/no/timeout state machine) and the file
watcher → composition-changed broadcast.
