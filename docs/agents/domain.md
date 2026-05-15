# Domain docs · AutoViral

Pointer file. The actual content lives in two places:

| File | Purpose |
|---|---|
| [`/CONTEXT.md`](../../CONTEXT.md) | Domain glossary (project terminology), architectural invariants, code map. Skills like `to-issues` / `to-prd` consult this for vocabulary so issue descriptions use the right words ("composition," "work," "track," "clip," "CaptionModel," "Studio," "bridge"). |
| [`/docs/adr/`](../adr/) | Architecture Decision Records — numbered immutable records of choices that shape the codebase. Skills like `improve-codebase-architecture` and `zoom-out` consult these to avoid re-debating settled questions. |

## Why these exist as separate files

- **`CONTEXT.md`** is mutable. It evolves as the domain grows — new terms get added, old ones get redefined. It's safe to edit anytime.
- **`docs/adr/`** is immutable. Each ADR captures a decision *as it stood at that date*. If a decision is reversed, a new ADR supersedes the old (the old ADR isn't deleted — its `Status:` line gets updated to "Superseded by ADR-XXX"). This preserves history.

## Reading order for a new agent

1. **`CONTEXT.md` § Domain glossary** — learn the words.
2. **`CONTEXT.md` § Architectural invariants** — learn the constraints you should not violate.
3. **`docs/adr/`** — learn the decisions that produced those constraints (chronologically: ADR-001 → ADR-002 → ...).
4. **`CLAUDE.md`** — project-specific guidance for Claude Code (testing rules, aesthetic direction, agent behavior).
5. **`skills/autoviral/SKILL.md`** + `manual/` — how to operate AutoViral as a tool.
6. **The current PRD** in `docs/superpowers/plans/` — what's being built right now.
