# ADR-004: Adopt mattpocock skills, retire superpowers in this project

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** nanxingw + AI design partner
- **Related:** [ADR-003](ADR-003-sibling-skill-split.md)

## Context

This project previously relied on the `superpowers:*` skill family (loaded globally via `~/.claude/plugins/cache/claude-plugins-official/superpowers/`). Common invocations:

- `superpowers:writing-plans` — write implementation plans
- `superpowers:brainstorming` — explore before building
- `superpowers:test-driven-development` — TDD discipline
- `superpowers:systematic-debugging` — bug investigation
- `superpowers:writing-skills` — author new skills
- `superpowers:executing-plans` / `subagent-driven-development` — execute plans
- `superpowers:verification-before-completion` — evidence-before-claims discipline
- `superpowers:requesting-code-review` / `receiving-code-review`
- `superpowers:using-git-worktrees` — isolated workspaces
- `superpowers:finishing-a-development-branch` — branch closure
- `superpowers:dispatching-parallel-agents` — parallel work

On 2026-05-15, after exploring `mattpocock/skills` (`to-prd`, `to-issues`, `triage`, `diagnose`, `tdd`, `prototype`, `improve-codebase-architecture`, `zoom-out`, `handoff`, `caveman`, `grill-me`, `grill-with-docs`, `write-a-skill`, `find-skills`), the user decided this project will use mattpocock exclusively and stop invoking `superpowers:*`.

## Decision

**This project (`/Users/nanjiayan/Desktop/AutoViral/autoviral`) uses mattpocock skills as the engineering-process skill family. `superpowers:*` skills are not invoked.**

The mapping for common workflows:

| Need | mattpocock equivalent |
|---|---|
| Brainstorm before coding | `grill-me` / `grill-with-docs` |
| Write a plan / PRD | `to-prd` |
| Break a plan into issues | `to-issues` |
| Triage incoming issues | `triage` |
| Throwaway prototype | `prototype` |
| Find architectural improvements | `improve-codebase-architecture` |
| Compact long session for handoff | `handoff` |
| Token-efficient communication | `caveman` |
| Perspective shift / reframe | `zoom-out` |
| Test-driven development | `tdd` |
| Disciplined debugging | `diagnose` |
| Create a new skill | `write-a-skill` |
| Discover installable skills | `find-skills` |

Gaps where mattpocock has no direct counterpart are filled by project conventions:

| `superpowers:*` capability | Replacement in this project |
|---|---|
| `verification-before-completion` | `CLAUDE.md` "Evidence over agreement" principle + `.claude/rules/e2e-testing.md` Hard Rules 1-5 |
| `using-git-worktrees` | Direct `git worktree add` invocations |
| `requesting-code-review` / `receiving-code-review` | `codex:codex-rescue` subagent + direct `gh pr` workflows |
| `finishing-a-development-branch` | Direct `git commit` + `gh pr create` as needed (per CLAUDE.md default behaviors) |
| `dispatching-parallel-agents` | Native: send multiple `Agent` tool calls in one message |
| `executing-plans` / `subagent-driven-development` | mattpocock paradigm replaces plan-execution with issue-execution: each `to-issues` ticket is independently grabbable (tracer-bullet); no execution-orchestrator skill needed |

## Consequences

### Positive

- Single, cohesive skill family for engineering process — no skill-selection ambiguity (e.g. "writing-plans vs to-prd").
- mattpocock skills are smaller / more independent — each skill is invokable standalone without learning a broader meta-framework.
- The PRD → issues → triage → AFK-agent-grabs pipeline matches the user's preferred work decomposition style.
- Newly available primitives that superpowers lacked: `caveman` (token compression), `handoff` (cross-session compaction), `prototype` (throwaway code), `zoom-out` (perspective).

### Negative

- Some agents arriving fresh to this repo (especially via `subagent-driven-development` from external prompts) may default to invoking `superpowers:*`. The memory entry `feedback_use_mattpocock_not_superpowers.md` should be loaded in such cases to redirect them.
- The `superpowers:using-superpowers` skill is injected at SessionStart by the global Claude Code plugin and cannot be suppressed at project level. It marks itself `EXTREMELY-IMPORTANT` to invoke superpowers skills. This decision **overrides that injection** for this project — the memory entry explicitly documents the priority order (user > project > default system prompt).

### Neutral

- No code change needed; this is a workflow-and-skill-invocation decision only.
- The Anthropic-bundled `superpowers:*` skills remain *installed* (they're CLI-global); we just don't *call* them in this repo.

## Alternatives considered

1. **Hybrid (use mattpocock for new flows, keep superpowers for existing patterns)**: rejected. The overlap zone (planning / TDD / debugging / skill authoring) is the most-used part of both — using both creates ambiguity at exactly the wrong place.
2. **Remove superpowers from the global Claude Code install**: rejected. They may be useful in other projects; the decision is project-scoped.
3. **Wait for mattpocock to add the missing capabilities (verification, parallel-agents, code-review)**: rejected. The CLAUDE.md principles + native tools already cover those gaps adequately; no need to delay.

## References

- mattpocock/skills repo: https://github.com/mattpocock/skills
- Memory entry: `~/.claude/projects/-Users-nanjiayan-Desktop-AutoViral-autoviral/memory/feedback_use_mattpocock_not_superpowers.md`
- Sibling skill ADR: [ADR-003](ADR-003-sibling-skill-split.md)
