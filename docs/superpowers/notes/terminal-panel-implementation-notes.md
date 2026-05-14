# Terminal Panel — Implementation Notes (Phase 1)

Tight rationale for the choices baked into the Phase 1 terminal panel, so
future-me (or anyone touching the panel) doesn't unwind a decision blind.

## Why `@xterm/xterm` v5 (not the legacy `xterm` package)

The `xterm` package on npm froze at v5.x and is officially superseded by
the `@xterm` scope (`@xterm/xterm`, `@xterm/addon-fit`, etc.). The new
scope drops jQuery-era deps, ships proper ESM, and is what xterm.js
upstream actually maintains. We use only the `@xterm/*` packages — never
mix scopes.

## Why `node-pty` (not a pure-JS shell)

Pure-JS shell shims (e.g. spawning `/bin/zsh` directly through
`child_process.spawn` with pipes) break on:

- emoji width measurement (terminals need a real PTY width)
- ANSI cursor escapes (zsh's prompt assumes a tty)
- `claude`/`codex` CLIs that detect interactive mode via `isatty(stdin)`

`node-pty` allocates a real pseudo-terminal, so the shell + any child
process behaves identically to running in iTerm/Terminal.app. The cost
is a native binding — handled via the `postinstall.ts` self-heal that
re-chmod-s the spawn-helper executable bit (a recurring node-pty quirk
on packed installs).

## WebSocket framing

JSON frames, two shapes:

- client → server: `{"t":"data","d":"keystrokes"}` | `{"t":"resize","cols":N,"rows":N}`
- server → client: `{"t":"data","d":"chunk"}` | `{"t":"exit","code":0}`

Why not raw text? Because we need a typed `resize` and `exit` channel and
JSON keeps the protocol self-describing for future event types (e.g. the
Phase 3 `composition-changed` bridge events will share the same WS multiplex
once we add a `t:"bridge"` envelope, kept symmetric).

## `FitAddon` + `ResizeObserver` (not `window.resize`)

The panel sits inside `react-resizable-panels`. Dragging the panel
boundary fires no `window.resize` event — the panel just changes size
relative to siblings. `ResizeObserver` on the mount node is the only
reliable signal. Without it, dragging the chat-center handle leaves
xterm with a stale cols/rows and you get visible reflow artifacts.

## `WebglAddon` fallback path

WebGL renderer is significantly faster, but the addon throws synchronously
during `loadAddon()` if WebGL isn't available (headless tests, certain
remote-desktop configs). Wrapped in `try {} catch {}` — on failure xterm
silently falls back to its canvas/DOM renderer. The eye can't tell.

## Known edge case: shell exit → blank panel

When the user types `exit` in the shell, the pty exits, the server sends
`{t:"exit",code:0}`, the WS closes, and the panel is now a dead box.
There's no respawn button yet. Future enhancement: detect close +
surface a "Reconnect" pill in the header dot indicator. Not blocking
Phase 1 because the recovery is also a full page refresh.

## Studio.layout.test + Studio.integration.test stubs

Both tests now `vi.mock("@/features/terminal/TerminalPanel", ...)` because
the real component constructs a `new WebSocket(...)` and `new Terminal(...)`
inside `useEffect` — neither is implemented in happy-dom. Terminal
behaviour is covered by its own focused tests
(`useTerminalSocket.test`, `TerminalPanel.test`), so the integration
tests don't lose coverage by stubbing the panel itself.
