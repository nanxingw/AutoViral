# ADR-005: Studio right pane uses horizontal tab switcher (Chat | Terminal), default Chat

- **Status:** Accepted
- **Date:** 2026-05-17
- **Deciders:** nanxingw + AI design partner
- **Related:** [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md), [ADR-003](ADR-003-sibling-skill-split.md)
- **Resolves:** [Issue #6](https://github.com/nanxingw/AutoViral/issues/6) (M.1)

## Context

ADR-001 established that AutoViral owns the editing layer; ADR-003 split sibling skills into taste vs engineering families. A consequence raised during planning on 2026-05-17: the `refactor/agentic-terminal` branch *removed* the chat panel that exists on `main` (with its pneuma-inspired `<viewer-context>` + `<viewer-action/>` protocol). The user observed this was a mistake — the chat panel meaningfully reduces cognitive load for non-technical users and should coexist with the new Terminal panel, not be replaced by it.

This ADR decides how the two surfaces visually coexist within Studio's right pane.

## Decision

**Horizontal tab switcher at the top of the right pane. Two tabs: "Chat" and "Terminal". Single visible surface at a time. Default tab: Chat. State persists per-work via localStorage, with a global fallback default.**

```
┌──────────────────────────┐
│  ┌─────────┬──────────┐  │   ← Tab strip (sticky at top)
│  │ ✦ Chat  │ ⌨ Term   │  │   Active tab indicated by accent underline
│  └─────────┴──────────┘  │
│                          │
│  [Active surface content]│   ← Either ChatPanel or TerminalPanel
│                          │
│  • messages              │
│  • streaming             │
│  • input area            │
│                          │
└──────────────────────────┘
```

- **Default for new users:** Chat tab is active.
- **Persistence scope:** localStorage key `autoviral.rightPane.activeSurface.<workId>` (per-work); fallback key `autoviral.rightPane.defaultSurface` (global, written on first explicit switch).
- **Keyboard shortcut:** `Cmd+\` toggles between tabs. Discoverable via tab tooltips ("Cmd+\ to switch") and announced once via toast on first session.
- **Both surfaces stay mounted:** hidden tab's WebSocket session and pty session continue receiving frames — switching is instant, no remount, no state loss. This is critical so a long-running chat conversation doesn't get killed when the user peeks at the terminal.
- **Single-surface fallback:** if either surface fails to mount (Chat: `claude -p` binary missing; Terminal: pty allocation failure), the working surface still functions; the broken tab shows an error state with a retry button.

## Consequences

### Positive

- **Familiar pattern** for both audience halves (every IDE / browser uses tab switching).
- **Clear state indication** — the active tab is always visible; no "which mode am I in" ambiguity.
- **Low chrome cost** — one row of tabs at the top, ~28px height; doesn't steal real estate from either surface.
- **Switching is intentional** — reduces accidental surface changes during heavy work.
- **Mount preservation** allows long sessions to coexist cleanly — switching back to Chat shows the conversation as you left it, plus any messages that arrived while Terminal was active.

### Negative

- **Cannot see both surfaces at once.** If a user wants to watch agent terminal output while typing in chat, they can't. Acceptable tradeoff: this is a rare power-user need; the audience that wants it can run their own external terminal alongside the browser.
- **Memory cost of double mount.** Both surfaces stay in the DOM tree even when hidden. Mitigation: hide via CSS `display: none` rather than unmounting — React state preserved; native xterm.js canvas + Chat ReactMarkdown VDOM both stay alive. For very long sessions (multi-hour) this could grow significant but not dangerously so.

### Neutral

- Hotkey-toggle alternative (Option C from the analysis) was rejected — invisibility of mode state is a deal-breaker for non-technical users. A version of it could be revisited later as a power-user opt-in via a settings flag.

## Alternatives considered

### A. Horizontal tab switcher (chosen)
See Decision above.

### B. Vertical split (Chat top / Terminal bottom, resizable divider)
**Rejected.** Pros: both visible simultaneously. Cons: terminal needs at least ~20 rows × ~80 cols for serviceable CLI work; on a typical right pane ~400px wide, splitting vertically gives terminal too few rows, hurts both. Resize state management (where the divider sits, per-work or global, snap-to behavior) adds significant UI complexity for a marginal gain. Most users will spend 90%+ of their time in one surface or the other, so showing both perpetually is wasteful.

### C. Hotkey toggle (single pane content swap, `Cmd+\` cycles)
**Rejected.** Pros: minimal chrome. Cons: no visible indication of which mode is active — a fatal flaw for the non-technical audience. Users would forget which mode they're in mid-task and become confused. Could revisit as an additional power-user opt-in alongside the chosen tab pattern, but not as the primary affordance.

## Implementation notes

The chosen pattern maps directly onto issues M.2 / M.3 / M.4 / M.5:
- M.2 / M.3 / M.4 cherry-pick the Chat infrastructure from `main` without modification to the pattern decision.
- M.5 implements the tab container at `web/src/features/studio/panels/RightPane/`, with two child slots (Chat and Terminal). Active state in a small Zustand store. Persistence via the keys above. Both children stay in the tree; `display: none` on inactive.

## References

- [Issue #6 (M.1)](https://github.com/nanxingw/AutoViral/issues/6) — the HITL gate this ADR closes.
- [PRD](../archive/plans/2026-05-15-autoviral-absorb-hyperframes-tech.md) — Phase M and the dual-chat conversation rationale.
- `web/src/features/chat/useChatSocket.ts` on `origin/main` — pneuma-inspired chat protocol reference.
- `web/src/features/terminal/TerminalPanel.tsx` on current branch — terminal surface reference.
