# AGENT.md — entry for non-Claude CLI agents

You're a CLI agent (Codex / Kimi / Gemini / Aider — anything that isn't Claude
Code) working in the **AutoViral** repo. This file is your project-level entry
point. AutoViral claims to be *agent-agnostic*: any CLI agent should drive the
workstation identically via the `autoviral` CLI + bridge (architectural
invariant #4). This file makes good on that claim — it tells you where the
shared rules live so you don't have to reverse-engineer them from a file named
after a different agent.

## Documentation Policy (what to read, in what order)

The repo's "constitution" is agent-neutral despite the filenames. Read these
**before** any non-trivial change — conflicts resolve top-to-bottom:

| Doc | What's in it | Applies to you? |
|---|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project instructions: skill system, aesthetic direction, **test discipline**, versioning/release conventions, and the two behavioral baselines (**Evidence over agreement** / **Boil the ocean**). | **Yes — all of it.** Despite the name, only the literal phrase "you are Claude Code" is Claude-specific; everything else (test caps, build commands, commit rules, taste, evidence-before-assertion) is the shared contract for *every* agent. Read it as `AGENT.md`'s body. |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary (work / composition / track / clip / bridge / focus …) + **architectural invariants** + high-level code map. | **Yes.** Keep terminology consistent; do not silently violate an invariant — escalate via an ADR instead. |
| [`docs/README.md`](docs/README.md) | The `docs/` map: where PRDs / ADRs / agent-collaboration conventions live. | **Yes**, when you need to find the *why* behind a decision. |
| [`skills/autoviral/SKILL.md`](skills/autoviral/SKILL.md) | The operator manual you load **when running inside the Studio terminal panel** to drive a live workstation (mutate compositions, control the UI). Agent-agnostic markdown. | **Yes**, but only in the terminal-panel context — not for repo development. |

There is intentionally **no separate copy of the rules here.** `CLAUDE.md` and
`CONTEXT.md` are the single source of truth; this file is a thin pointer plus
the backend-specific notes below. If a rule seems Claude-specific but isn't
genuinely tied to Claude Code's harness, treat it as binding on you too.

## Backend-specific guidance for non-Claude agents

These are the few places where "you're not Claude Code" actually changes
something:

- **Build / test commands** (same for every agent — from `CLAUDE.md` `<testing>`):
  - Backend build: `npm run build:backend`. Frontend build: `npm run build:frontend`.
    Avoid the root `npm run build` until the test-fixture type debt is cleared (its
    `tsc` gate fails on pre-existing fixtures).
  - Server tests: `npm run test:server`. Web tests: `npm run test:web`. **One at a
    time, never concurrently** — vitest worker pools are capped (`maxThreads: 2` /
    `maxForks: 2`, invariant #7). After any run, `pgrep -f vitest | wc -l` must be ≤ 3.
  - These are one-shot runners. Do not start a watch and leave it resident.

- **Two agent surfaces, two different contracts** (this is the honest correction
  the agent-agnostic claim needs):
  - **Terminal panel** (xterm.js) — *this* is the agent-agnostic surface. Any CLI
    agent runs here and drives the workstation through the `autoviral` CLI. Invariant
    #4 (skill-agnostic agents) is scoped to **this surface**. The terminal injects
    `AUTOVIRAL_WORK_ID`, `AUTOVIRAL_PORT`, `AUTOVIRAL_CWD`; `autoviral whoami` is a
    safe smoke test (exits non-zero with a clear message if the env wiring is
    missing).
  - **Chat panel** — currently spawns `claude -p` and is **claude-code-only today**.
    This is an acknowledged gap, not a contradiction of the agent-agnostic claim: per
    [ADR-005](docs/adr/ADR-005-dual-chat-entry-layout.md), Chat being Claude-backed is
    the *intended default* and Terminal is the agent-agnostic surface. A general
    multi-backend Chat (Codex/Kimi/Gemini) is deferred to 0.2.0. If you're a
    non-Claude agent, you drive AutoViral from the **Terminal**, not Chat.

- **Provider gateway**: OpenRouter is the **only** external gateway (invariant #2).
  Image gen (`openai/gpt-5.4-image-2`, aka NanoBanana), video gen
  (`bytedance/seedance-2.0`), and translation all go through it; TTS uses
  edge-tts → OpenAI fallback. There are no direct vendor calls (no Dreamina /
  Jimeng / Lyria paths). Don't reintroduce a multi-provider table — it breaks
  invariant #2.

- **The `autoviral` CLI is the protocol layer.** It talks to the running daemon
  over the bridge's HTTP/WS endpoints (`/api/bridge/v1/*`). Source lives in
  `cli/autoviral/src/commands/`. From inside a workspace, start with
  `autoviral whoami` (context smoke test) and `autoviral docs [topic]` (prints the
  operator manual). Don't read `src/` to learn how to operate the workstation —
  use the CLI + the manual.

## When in doubt

- Repo-development question → `CONTEXT.md` (glossary + invariants) then `docs/README.md`.
- Driving a live workstation → load `skills/autoviral/SKILL.md` and run
  `autoviral docs`.
- A rule looks Claude-specific → assume it binds you too unless it's literally about
  Claude Code's harness.
