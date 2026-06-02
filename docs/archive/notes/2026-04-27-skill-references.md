# Skill Reference Notes — obra/superpowers + garrytan/gstack

> Captured 2026-04-27 as a prerequisite for Plan 4 Task 11 (skill rewrite). These
> are distilled, not load-bearing — re-fetch the upstream sources when in doubt.

## obra/superpowers — voice & structure

- **Imperative, mandatory wording.** Skills phrase rules as non-negotiable
  directives. Examples: *"Write the test first. Watch it fail."*,
  *"NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST"*,
  *"Activates before writing code"*. Avoid "you should / consider".
- **Use-when frontmatter.** Every SKILL.md leads with a YAML block whose
  `description` is a literal use-when sentence:

  ```yaml
  description: Use when implementing any feature or bugfix, before writing
    implementation code
  ```

  Mirror this exact form (no marketing copy, just the trigger).
- **Red-flags section.** Skills include a list of disqualifying patterns
  ("Code written before tests", "Rationalizing 'just this once'", etc.).
  When seen, the agent must hard-stop and restart the workflow. Use the same
  bullet style.
- **Process flow.** Linear, gated, with explicit verification between phases:
  RED → confirm fail → GREEN → confirm pass → REFACTOR → repeat. Visualised
  via a small dot/mermaid graph or numbered list — the contract is that *each
  arrow has a verification step*.
- **Decision flow / activation.** *"If you think there is even a 1% chance a
  skill might apply, you ABSOLUTELY MUST invoke the skill."* Skills do not
  defer triggering to the user.

## garrytan/gstack — flexibility & specialist roles

- **Specialist personas, not pipelines.** Each slash command maps to a focused
  responsibility (CEO scope, eng manager architecture, designer polish,
  security threat modelling). Skills adopt personas rather than positions in a
  flow.
- **Flexible entry.** Users can jump straight to any skill (`/qa`, `/review`)
  without prerequisites; downstream skills auto-detect upstream context when
  it exists. *Sequential execution is a benefit, not a requirement.*
- **Declarative over imperative for product surface.** What should be true
  (coverage targets, security posture) over how to achieve it. Implementation
  is left to the agent.
- **Forcing questions over checklists.** GStack pushes back on premise
  ("six forcing questions that reframe your product before you write code")
  rather than handing out a script.

## Patterns to apply in `skills/autoviral/**`

1. Frontmatter `description:` must read as a "Use when …; do NOT use when …"
   sentence — model it on superpowers.
2. Each module SKILL.md gets three sections in this order:
   - **何时调用 / Use when** (concrete user intents)
   - **何时不调用 / When NOT this module** (横跳引导，gstack flexible-entry)
   - **工具 / Tools** (declarative list of capabilities)
3. Avoid sequence words. The 4 modules are *capabilities*, not stages — mirror
   gstack's "specialist roles" framing.
4. Top-level `skills/autoviral/SKILL.md` describes the 4 capabilities as
   orthogonal; the optional `plan / 素材生成 / 成品` thinking buckets are
   internal mental scaffolding, not a UI flow.
5. Use imperative voice for rules ("Do not reply with '我们应该先做哪一步' —
   pick a module and act") and red-flags lists for anti-patterns.

## Process-flow snippet (reference shape)

```
   ┌────────┐    intent       ┌─────────┐
   │  user  │ ──────────────▶ │  agent  │
   └────────┘                 └────┬────┘
                                   │ chooses ONE capability
            ┌──────────────┬───────┴──────┬──────────────┐
            ▼              ▼              ▼              ▼
        research       planning        assets         assembly
            └──────────────┴──────────────┴──────────────┘
                                   │
                          (no required arrow back)
```

## D3 sweep baseline (recorded 2026-04-27, after Task 1 Step 3)

`./scripts/check-d3-words.sh` exits 1 with 119 lines of output. Hits cluster
in:

- Documentation under `docs/` (`how-it-works.md`, `desigen/issues-and-improvements.md`,
  `skill-structure-guide.md`, research docs) — these are reference docs that
  describe legacy behaviour. **Allowed for now**; later plans clean them up.
  The sweep script does NOT exclude `docs/` outside `docs/superpowers/`, so
  these will continue to fail until rewritten. Plan 4 only commits to making
  the *production code + skills/* sub-tree clean — see Task 12.
- `CLAUDE.md` line 5, `README.md` lines 164/243 — contain the words inside
  *negation* statements ("它不是一条流水线"). Acceptable copy, but the sweep
  cannot tell. Task 12 will revisit whether to scope the sweep to
  `src/` + `skills/` only.
- `skills/autoviral/SKILL.md` and module docs (assembly capabilities, etc.) —
  Task 11 cleans these.
- `src/` — none in this baseline (the regex doesn't include `pipeline`/`step`
  alone, only the specific tokens listed in the pattern). When Tasks 3-9 add
  legacy 410 stubs and tests they may surface — tests are excluded by glob.
- `e2e/works.spec.ts` — already tagged with `NEGATIVE` marker but the regex
  doesn't honour markers; this hit is benign (assertion text). Plan 4 leaves
  it.

Plan 4 success criterion (Task 12): sweep clean for `src/`, `skills/`,
`migrations/`. Wider-tree clean is a Plan 5 follow-up. The script as written
fails on `docs/`/`README.md`/`CLAUDE.md` — that is acknowledged and will be
revisited at Task 12 (we may either scope-limit the script or rewrite the doc
hits).

