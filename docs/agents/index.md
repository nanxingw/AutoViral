# Agent skills · AutoViral

> Per-repo configuration for the mattpocock skill family. Read by `to-prd`, `to-issues`, `triage`, `diagnose`, and friends so they know where to publish work and how to label state.
>
> **Last setup:** 2026-05-15 (via `setup-matt-pocock-skills`, decisions confirmed interactively).

## Issue tracker

**GitHub Issues** at https://github.com/nanxingw/AutoViral.

- `gh` CLI is authenticated as `nanxingw` (verified 2026-05-15).
- All `to-issues`, `triage`, `to-prd` operations go through `gh issue create / list / edit / view / close`.
- New issues default to no labels; the triage flow applies one of the canonical labels below.
- No issue templates currently exist in `.github/ISSUE_TEMPLATE/`. Agents synthesize the body from PRD content.

See [issue-tracker.md](issue-tracker.md) for the full consumer rules.

## Triage label vocabulary

Canonical mattpocock state-machine names. All 5 labels exist in GitHub (verified 2026-05-15).

| State machine role | GitHub label | Color | Meaning |
|---|---|---|---|
| Incoming | `needs-triage` | `#e99695` (pink) | New, awaiting triage decision |
| Awaiting reporter | `waiting-on-reporter` | `#fbca04` (yellow) | Needs more information from reporter |
| Ready for agent | `ready-for-agent` | `#1d76db` (blue) | Fully specified, an AFK agent may pick it up |
| Ready for human | `ready-for-human` | `#5319e7` (purple) | Needs human decision before any agent proceeds |
| Declined | `wontfix` | `#ffffff` (white, GitHub default) | Will not be worked on |

See [triage-labels.md](triage-labels.md) for the full state-machine rules.

## Domain documents

Where these skills look for project terminology and architectural context:

| File | Contains | Read by |
|---|---|---|
| `CONTEXT.md` | Domain glossary, architectural invariants, code map | `to-issues` (terminology), `to-prd` (vocabulary), `improve-codebase-architecture` (invariants), `zoom-out` (context) |
| `docs/adr/ADR-*.md` | Architecture Decision Records | `improve-codebase-architecture`, `zoom-out`, `triage` (deciding if a proposal contradicts an ADR) |
| `CLAUDE.md` | Project-specific instructions for Claude Code | All skills (lowest-priority context) |
| `.claude/rules/*.md` | Hard rules (e.g. e2e testing) | All skills |

## Skill-specific configs

Some skills have their own bundled config files (`*.md` inside `.agents/skills/<skill>/`). Project-level overrides for those go here:

- [`triage-labels.md`](triage-labels.md) — overrides `.agents/skills/setup-matt-pocock-skills/triage-labels.md` with our canonical mapping.
- [`issue-tracker.md`](issue-tracker.md) — confirms GitHub + describes any non-default workflow.
- [`domain.md`](domain.md) — pointer file to `CONTEXT.md` + `docs/adr/`.

## How to update this config

If you change the issue tracker, labels, or domain doc layout:

1. Edit the relevant file under `docs/agents/` (or re-run `setup-matt-pocock-skills` interactively if multiple sections change at once).
2. Update the corresponding section in this index.
3. Update the `## Agent skills` section in `CLAUDE.md` to keep the project entry point in sync.
