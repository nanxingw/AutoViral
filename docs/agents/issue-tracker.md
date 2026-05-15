# Issue tracker · AutoViral

**Type:** GitHub Issues
**Repo:** https://github.com/nanxingw/AutoViral
**CLI:** `gh` (authenticated as `nanxingw`, verified 2026-05-15)

## Operations

| Skill | Command pattern | Notes |
|---|---|---|
| `to-prd` | `gh issue create --label ready-for-agent` | Single epic-style issue carrying the PRD body. |
| `to-issues` | `gh issue create --label ready-for-agent` per tracer-bullet slice | One issue per independently-grabbable slice; each links back to its parent PRD issue. |
| `triage` | `gh issue list --label needs-triage` → `gh issue edit --add-label <state> --remove-label needs-triage` | Walks the state machine. |
| `diagnose` / `tdd` | `gh issue view <n>` to read context; `gh issue comment` for findings | Read-mostly. |

## Issue body conventions

- **First line of body:** `> Parent: #<n>` if derived from a PRD or parent issue.
- **PRD reference:** if the issue comes from a PRD in `docs/superpowers/plans/`, link the path explicitly in the body: `Source: docs/superpowers/plans/<file>.md`.
- **Acceptance criteria:** a checklist in the body. Each box should be testable.
- **Code-area hints:** include the deepest directory the issue touches so AFK agents can `cd` directly.

## What goes where

- **PRDs / plans → `docs/superpowers/plans/`** (canonical source) + a single tracking issue with the `ready-for-agent` label.
- **Architecture decisions → `docs/adr/`** (immutable). Discussion happens in PRs / issues; the ADR captures the conclusion.
- **In-flight work → GitHub Issues** (mutable). Issues link out to ADRs and PRDs.

## No issue templates yet

`.github/ISSUE_TEMPLATE/` does not exist. Agents currently synthesize issue bodies from PRD context. If a template is added later, update this file.
