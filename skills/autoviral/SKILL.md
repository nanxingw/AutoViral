---
name: autoviral
description: Operator manual for the AutoViral creator workstation. Use when the user is editing video / image / poster content in AutoViral and you (any CLI agent — claude, codex, kimi, aider, gemini) need to know how to drive the Studio UI, mutate compositions, and coordinate with the user. NOT a taste/editorial skill — bring your own.
---

# AutoViral Operator Manual

You are a CLI agent running inside the **AutoViral Studio terminal panel**. The user has opened a workspace at `/studio/${AUTOVIRAL_WORK_ID}`. You see the Studio preview + timeline to your right; the user is watching what you do.

You drive AutoViral via the `autoviral` CLI on your PATH. It is the agent-agnostic bridge — any of you (Claude, GPT, Kimi, Gemini) talks to the Studio through the same commands.

## Read this in order

1. **manual/00-quickstart.md** — 5-minute zero-to-export walkthrough
2. **manual/01-workspace-layout.md** — where the files live
3. **manual/02-composition-schema.md** — the data you'll be mutating
4. **manual/03-cli-reference.md** — every command you can call
5. **manual/04-ui-control.md** — how to make the Studio dance for the user
6. **manual/05-conventions.md** — naming, units, gotchas

When stuck, run `autoviral docs <topic>` to print any section.

## Aesthetic / taste decisions are NOT in this skill

AutoViral has no opinion on what makes a video good. Bring your own taste skill — `hyperframes`, `editorial-pro`, your own — or ask the user. This manual only documents how to operate the tool; **what** to operate it toward is the agent's job (or the user's instruction).

## Recipes for common tasks

See `recipes/`:

- `crossfade-between-clips.md`
- `swap-clip-source.md`
- `generate-i2v-batch.md`
- `apply-platform-preset.md`
- `add-subtitle-overlay.md`

## Contracts

`contracts/` is the wire-level surface you can rely on:

- `error-codes.md` — exit codes you should branch on
- `event-stream.md` — every WebSocket event the Studio UI consumes (useful for power users and future MCP shims)

## When in doubt

Run `autoviral ask "<question>" --yes-no` to consult the user via a modal. Never silently make destructive changes — render, file deletions, multi-clip swaps, anything that costs API spend or takes >10s of compute should ask first.

## Environment contract (quick reference)

The terminal panel injects three env vars; if any are missing, the CLI exits non-zero with a clear message:

| Var | What it holds |
|---|---|
| `AUTOVIRAL_WORK_ID` | The `:workId` segment from `/studio/:workId` |
| `AUTOVIRAL_PORT` | Backend HTTP port (default 3271) |
| `AUTOVIRAL_CWD` | `~/.autoviral/works/${AUTOVIRAL_WORK_ID}` |

The CLI exits with code 2 if `AUTOVIRAL_WORK_ID` is unset, so `autoviral whoami` is a safe smoke test from any prompt.
