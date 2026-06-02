# ADR-001: AutoViral owns the editing layer

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** nanxingw (project owner) + AI design partner
- **Supersedes:** the (never-implemented) "AutoViral is a protocol over hyperframes" direction floated 2026-05-15 morning.

## Context

AutoViral entered May 2026 with a working Remotion-based editing stack (composition.yaml + React/Remotion renderer + Studio UI). The 2026-05-14 agentic-terminal refactor introduced an auto-install of the `hyperframes` skill ("HTML is the source of truth for video") into `~/.claude/skills/`, intending the role split:

> *AutoViral provides the interactive workstation; hyperframes provides the editing capability.*

On 2026-05-15 we attempted an end-to-end demo (YouTube → 中文 short video) and observed:

1. The ingest pipeline wrote to AutoViral's own `composition.yaml` schema with its own Remotion captions renderer.
2. hyperframes was installed in `~/.claude/skills/` but never invoked — it was dormant.
3. The two stacks have totally different composition languages (Remotion JSX vs HTML+CSS+GSAP), different preview servers, different render pipelines.

Bridging them (iframe `<iframe src="http://localhost:3002">` + postMessage focus channel + render-event bus) is technically feasible but operationally heavy: it requires Node 22 (hyperframes' min, AutoViral runs on 20.19), iframe/postMessage protocol design, two preview servers, and migration of 19 existing works.

## Decision

**AutoViral owns the editing layer.** We will absorb hyperframes' four high-ROI technical capabilities (quality gate · composition variables · caption animation library · TTS preprocess) into AutoViral as native features. We will not bundle, embed, or interoperate with hyperframes at runtime.

External sibling skills are categorized into two families:

- **Taste / craft skills** (e.g. `editorial-pro`, `viral-hooks-zh`, `lyric-video`): provide *what* to make. AutoViral commands provide *how* to make it.
- **Engineering / process skills** (e.g. `mattpocock/handoff`, `caveman`, `diagnose`, `tdd`, `to-prd`, `to-issues`, `triage`): provide *how* to collaborate. They are workflow primitives, not creative ones.

hyperframes is referenced as a technique source (its `references/captions.md`, `transitions.md`, `inspect.mjs`, etc. inspire our absorbed features), but is not bundled and `installHyperframes()` is removed from postinstall.

## Consequences

### Positive

- One stack to maintain — no protocol bridge complexity, no Node-version negotiation, no double preview server.
- Existing 19 works are forward-compatible (additive schema changes only).
- New capability features (variables, quality gate, etc.) live in the same codebase the agent already drives.
- Sibling skill landscape is cleaner: taste vs engineering, no "skill that also tries to be a renderer."

### Negative / risk

- ~~Effort~~ scope discipline required: hyperframes has 5 capability blocks; absorbing all of them is multi-month. We must commit to the four-block scope defined in the absorb PRD and reject ad-hoc additions.
- We're forgoing hyperframes' active community / shader transitions / sub-composition reuse / HTML composability for now. Re-revisit in 6 months if user-facing feedback ever blocks on these.
- The agent must learn AutoViral's `${id}` variable syntax instead of leveraging hyperframes' `data-composition-variables` — agent ergonomics cost.

### Neutral

- `skills/autoviral/` continues to teach editing operations (since we own them) — but as *capability* documentation, not *taste* documentation.

## Alternatives considered

1. **Protocol-and-bridge**: AutoViral is a workstation shell, hyperframes is mounted via iframe. Rejected: operational cost > architectural purity benefit (see Context section).
2. **Hybrid double-stack**: keep Remotion for legacy works, scaffold new works as hyperframes projects with kind-discriminator. Rejected: forces the codebase to carry two renderers indefinitely.
3. **Switch entirely to hyperframes**: rewrite Studio renderer + migrate 19 works + adopt Node 22 + lose existing Tweaks panels. Rejected: cost too high without clear user benefit.

## References

- PRD: `docs/archive/plans/2026-05-15-autoviral-absorb-hyperframes-tech.md`
- hyperframes source (read-only inspection): https://github.com/heygen-com/hyperframes
- Prior plan (now archived): `docs/archive/plans/2026-05-14-agentic-terminal-refactor.md`
