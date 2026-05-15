# ADR-003: Sibling skill split — taste vs engineering

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** nanxingw + AI design partner
- **Related:** [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md)

## Context

The 2026-05-14 agentic-terminal refactor moved `skills/autoviral/` away from carrying editorial taste content ("how to make a good video"). The original framing was:

> AutoViral provides the workstation; bring your own taste skill (`hyperframes`, `editorial-pro`, etc).

This framing implicitly assumed sibling skills are uniformly about *creative direction*. But by 2026-05-15, two distinct categories of sibling skill emerged:

1. **Creative / taste** — `editorial-pro`, `viral-hooks-zh`, `lyric-video`. These tell the agent *what* to make: brand briefs, palette guidance, hook templates, platform-specific grammar.
2. **Engineering / process** — `mattpocock/handoff`, `caveman`, `diagnose`, `tdd`, `to-prd`, `to-issues`, `triage`, `prototype`, `zoom-out`, `grill-me`, `improve-codebase-architecture`, `write-a-skill`, `find-skills`. These tell the agent *how* to collaborate: workflow patterns, planning primitives, debugging discipline, work decomposition.

The user installed mattpocock's bundle on 2026-05-15 and confirmed both families are intended sibling skills in this project.

## Decision

**Sibling skills are split into two named families**, both documented in `skills/autoviral/SKILL.md` and `CONTEXT.md`:

- **Taste / craft skills**: provide creative direction. Examples: `editorial-pro`, `viral-hooks-zh`, `lyric-video`, `data-journalism-zh`, `shorts-grammar`.
- **Engineering / process skills**: provide collaboration primitives. The canonical set is mattpocock's: `to-prd`, `to-issues`, `triage`, `diagnose`, `tdd`, `prototype`, `zoom-out`, `handoff`, `caveman`, `grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `write-a-skill`, `find-skills`.

Engineering-process skills replace the previously-used `superpowers:*` skill family for this project (see `memory/feedback_use_mattpocock_not_superpowers.md`).

AutoViral itself remains a **third category**: the operator manual skill — it describes how to drive the workstation tool, neither taste nor process.

## Consequences

### Positive

- Two clean primitives for sibling-skill discovery: "taste" and "engineering." Agents can search `find-skills` with that vocabulary.
- The `mattpocock` install replaces the loose `superpowers:*` setup with a more cohesive set (each skill is self-contained, no cross-skill required-prerequisites).
- Skills like `handoff` and `caveman` solve long-running session problems specific to this project's pattern (multi-hour sessions, multiple subagent runs).

### Negative

- Two categories means two onboarding moments — a new contributor must understand both families.
- Some functionality has no direct mattpocock replacement (verification-before-completion, git-worktrees, parallel-agents, code-review). These gaps are now filled by:
  - CLAUDE.md "Evidence over agreement" principle (replaces verification-before-completion)
  - `.claude/rules/e2e-testing.md` Hard Rules (concrete verification discipline)
  - Direct `git worktree` usage (no skill wrapper)
  - `codex:codex-rescue` subagent for code review
  - Native parallel-Agent tool calls (no skill wrapper)

### Neutral

- The `setup-matt-pocock-skills` script generated config under `docs/agents/` to formalize this decision. See `docs/agents/index.md`.

## Alternatives considered

1. **Keep only taste sibling skills** (continue with the original 2026-05-14 framing): rejected — it would require us to re-implement plan / issue / triage / debugging workflows ourselves, which mattpocock already solved well.
2. **Keep using `superpowers:*` alongside mattpocock**: rejected — too much overlap (writing-plans / to-prd, systematic-debugging / diagnose, test-driven-development / tdd, writing-skills / write-a-skill) would cause skill-selection confusion.
3. **No sibling skills at all, embed everything**: rejected — AutoViral would bloat into an opinion-heavy IDE that competes with the agents installed in it.

## References

- mattpocock skills source: https://github.com/mattpocock/skills (installed via `npx skills add mattpocock/skills`, symlinked from `~/.claude/skills/` → `.agents/skills/`)
- Memory entry: `~/.claude/projects/-Users-nanjiayan-Desktop-AutoViral-autoviral/memory/feedback_use_mattpocock_not_superpowers.md`
- Sibling skill config: `docs/agents/index.md`
