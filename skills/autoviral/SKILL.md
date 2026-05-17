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

AutoViral has no opinion on what makes a video good. It stays small by deferring to two flavors of sibling skill — invoke them on demand from the terminal or chat:

- **Taste / craft** — `editorial-pro`, `viral-hooks-zh`, `lyric-video`, etc. Tells the agent *what* to make: brand briefs, palette guidance, hook templates, platform-specific grammar.
- **Engineering / process** — `mattpocock/*` (`to-prd`, `to-issues`, `triage`, `diagnose`, `tdd`, `handoff`, `caveman`, `prototype`, `zoom-out`, `grill-me`, `improve-codebase-architecture`, `write-a-skill`, `find-skills`). Tells the agent *how* to collaborate.

This manual only documents how to operate the tool; **what** to operate it toward is the sibling skill's or the user's job.

(Note: `hyperframes` is NOT bundled and is no longer auto-installed. Per [ADR-001](../../docs/adr/ADR-001-autoviral-owns-the-editing-layer.md), AutoViral now owns the editing layer itself and absorbs hyperframes' high-ROI techniques as native capability. Install hyperframes explicitly via `npx skills add heygen-com/hyperframes` if you want to use it directly.)

## Recipes for common tasks

See `recipes/`:

- `crossfade-between-clips.md`
- `swap-clip-source.md`
- `generate-i2v-batch.md`
- `apply-platform-preset.md`
- `add-subtitle-overlay.md`
- `ingest-youtube.md` — turn a YouTube URL into a 中文 short via the one-shot `autoviral ingest youtube` pipeline

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

## Where the old scripts went

Before the 2026-05-14 agentic-terminal refactor, this skill carried both editorial taste content (rubrics, brand briefs) AND workstation-infrastructure scripts (subtitle burn-in, beat detection, smart crop, CLIP-based asset search, AI image generators). All of it was deleted from `skills/autoviral/` to keep this skill scoped to "operator manual" only.

**Nothing is lost.** The full pre-refactor tree is preserved in the git tag `pre-skill-rewrite-snapshot`. To re-package any of it as a sibling skill:

```bash
git show pre-skill-rewrite-snapshot -- skills/autoviral/modules/<subpath>
# or to materialise into a new skill:
git checkout pre-skill-rewrite-snapshot -- skills/autoviral/modules
mv skills/autoviral/modules skills/<new-sibling-skill>/scripts
# then write a SKILL.md for the new sibling and unstage anything you don't want
```

Server endpoints that depended on those scripts (`/api/audio/beats`, `/api/works/:id/rubric/:module`, `burnSubtitles()`, `buildClipIndex`) now return **410 Gone** or stub `{ stub: true, reason: "..._removed_in_refactor" }` instead of crashing. They'll come back automatically if a sibling skill re-provides the scripts and you re-wire the server import paths.
