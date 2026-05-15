# Triage labels · AutoViral

Project-level mapping of the mattpocock state-machine roles → GitHub labels.

## Canonical mapping

| State machine role | GitHub label | Color | When applied |
|---|---|---|---|
| Incoming | `needs-triage` | `#e99695` | Auto-applied to all newly-created issues that don't already carry a triage label. |
| Awaiting reporter | `waiting-on-reporter` | `#fbca04` | Applied by `triage` when the issue lacks essential information (repro steps, environment, log lines). |
| Ready for agent | `ready-for-agent` | `#1d76db` | Applied by `to-prd` / `to-issues` / `triage` when the issue is fully specified, an AFK agent may pick it up. |
| Ready for human | `ready-for-human` | `#5319e7` | Applied by `triage` when the issue requires a human decision before any agent should proceed (scope, prioritization, architectural choice). |
| Declined | `wontfix` | `#ffffff` | GitHub default. Applied by `triage` when the issue is invalid, duplicate, or out of scope. Closes the issue. |

## State transitions

```
        ┌────────────────┐
        │  needs-triage  │ ← every new issue starts here
        └────────┬───────┘
                 │
        ┌────────┼────────┬────────────────┬───────────────┐
        ▼        ▼        ▼                ▼               ▼
waiting-on-  ready-for- ready-for-     wontfix         (closed
 reporter     agent      human         (closed)          without
                                                         label)
        │        │         │
        ▼        │         │
  (reporter      │         ▼
   replies)      │       (human
        │        │        decides)
        ▼        │         │
   needs-triage  │         ▼
                 │      ready-for-agent
                 ▼
              (agent
               picks up)
                 │
                 ▼
            (PR opened /
             issue closed)
```

## Rules

1. **Exactly one triage label at a time.** Skills that move state must `--remove-label <old>` before `--add-label <new>`.
2. **`needs-triage` is the default.** If an issue exists without any triage label, treat it as `needs-triage`.
3. **`ready-for-agent` requires acceptance criteria.** `triage` checks the issue body for a checklist before applying this label.
4. **`ready-for-human` is the escape hatch.** Use it whenever the agent can't confidently progress without a human call.
5. **Don't apply `wontfix` without closing.** GitHub treats `wontfix` as a state, not a status — pair it with `gh issue close`.

## Non-triage labels (informational)

These are not part of the state machine but commonly used:

- `bug` / `enhancement` / `documentation` / `question` (GitHub defaults — semantic kind)
- `good first issue` / `help wanted` (GitHub defaults — discoverability)
- `duplicate` / `invalid` (GitHub defaults — typically applied alongside `wontfix`)

Future kind labels (not yet created — add when needed): `kind:autoviral-cli`, `kind:studio-ui`, `kind:server`, `kind:skill`, `kind:tests`.
