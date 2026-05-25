# UI v3 — editorial-glass + D3 stage removal + production hardening

## Summary

Complete UI rewrite (Svelte 5 → React 18 + Vite + Zustand + TanStack Query + Radix), backend D3 cleanup (drop the `step/{key}` + `pipeline/advance` ordering scaffold in favor of a single `/api/works/:id/invoke {module, input}`), brand override (editorial-glass v1), production-grade Studio/Editor (Remotion + Konva), and a Codex-driven security/correctness pass.

R1 Big Bang — 5 plans executed end-to-end on this branch, 4 of them by Opus subagents under `superpowers:subagent-driven-development`. ~62 commits, ~24k insertions / ~20k deletions, 323 files changed.

## What changed

### Frontend
- **Stack**: Svelte 5 fully removed → React 18 + Vite 5 + Zustand 4 + TanStack Query 5 + Radix UI primitives + clsx + zod
- **Pages**: Works (autonomy hero) / Explore (4 platforms) / Analytics (KPI + demographics) / Studio (video) / Editor (image-text)
- **Studio**: Remotion `<Player>` preview + multi-track Timeline (Video/Audio/Text/Overlay) + WaveSurfer waveforms + Tweaks Panel (Theme/Density/Layer/Composition) + ChatPanel + server-side mp4 render via `@remotion/renderer`
- **Editor**: react-konva 4:5 carousel canvas, Inspector with Design / Copy / AI tabs, Filmstrip with sortable thumbs, single + batch PNG export
- **Design system**: vanilla CSS + tokens.css/typography.css/globals.css, `--accent` 5 variants (steel/violet/cyan/coral/lime), `Inter` + `Instrument Serif italic` + `JetBrains Mono`, glass = `backdrop-filter blur(24px) saturate(140%)` + grain overlay

### Backend D3
- **Routes**: `POST /api/works/:id/step/:key` + `POST /api/works/:id/pipeline/advance` removed (410 stubs); replaced with `POST /api/works/:id/invoke {module, input}` — modules are `research|planning|assets|assembly` with no ordering constraint
- **Evaluator**: demoted from gate (blocking advance) to a read-only `GET /api/works/:id/rubric/:module` tool the agent may call self-evaluatively
- **Persistence**: `composition.yaml` + `carousel.yaml` per work; new `Work` type drops `pipeline` / `evaluationMode` / `evalSessionIds` / `evalAttempts` (silent strip on read for legacy yaml; one-shot migration in `migrations/strip-pipeline.ts` with backup-first semantic)
- **Cron / scheduler**: never implemented in backend; legacy `researchEnabled` / `researchCron` config fields removed from `/api/config` response/PUT body
- **WS bridge**: `buildSystemPrompt` rewritten — modules-as-capabilities, no ordering language, optional plan/素材生成/成品 mental buckets; `step_divider` / `eval_divider` events removed from stream; idle-grace bumped from 1s/3s to 60s/90s

### Skills (`skills/autoviral/**`)
- 25 files re-edited to remove ordering language (research / planning / assets / assembly described as orthogonal capabilities, not ordered phases)
- New "When NOT to use this module" sections in each module's SKILL.md
- Verified against obra/superpowers + garrytan/gstack imperative-voice patterns (notes captured in `docs/superpowers/notes/2026-04-27-skill-references.md`)

### Brand (CLAUDE.md)
- `### Aesthetic Direction` overwritten with editorial-glass v1: dark `#0a0b0f` / light `#fafaf7`, `--accent #a8c5d6` cool steel, glass + grain
- `### Brand Personality` rewritten to "editorial · 克制 · 现代质感"

### Codex review fixes (latest 3 commits)
- **Path traversal hardening**: new `src/server/safe-paths.ts` resolver, applied to upload/audio-analyze/audio-mix/asset-GET routes; rejects `../`, absolute paths, backslash traversal, escape via `resolve()`
- **Info disclosure**: `/api/works/:id/assets/*` now restricted to `assets/` and `output/` roots (previously could serve `chat.json`, `work.yaml`, `eval-*.json`)
- **Remotion render**: pass `width`/`height`/`fps` from comp; previously only `durationInFrames` was overridden so non-9:16 / non-30fps exports came out wrong
- **Autosave race**: Studio/Editor reset comp/car + savedAt on workId change; autosave guarded with `comp.workId === workId`; on server 5xx the page shows error and suspends autosave (no longer overwrites corrupt yaml with empty)
- **404 swallow**: composition/carousel GET return 404 only on `ENOENT`, 500 with message on parse failures
- **updateClip duration**: recompute on every patch; previously only grew, leaving stale empty tail when dragging clips earlier
- **DnD inert**: removed dead `DndContext` wrapper from Track; free-position drag (Clip's pointer handlers) keeps working; explicit reorder via new `moveClipWithinTrack` store action
- **duplicateSlide layer IDs**: regenerate every layer ID on duplicate; previously editing a duplicated slide mutated the original
- **Chat first message**: `recordUserMessage(workId, text)` after `createSession` so the first user line is in `messageHistory` and `chat.jsonl`
- **Audio backend gaps**: new `POST /api/audio/beats` (wraps `detect_beats.py` / librosa) and `POST /api/audio/captions` (wraps `stable-whisper` ASR), 503 + install hint when python deps missing
- **Dead code**: `EvalResult`/`saveEvalResult`/`loadEvalResult`/`loadAllEvalResults` removed from `work-store.ts` (orphaned after evaluator demote)

### Tooling
- `scripts/check-d3-words.sh` enforces forbidden vocabulary across `src/ + skills/ + migrations/ + README.md + CLAUDE.md + docs/skill-structure-guide.md` AND commit subjects on this branch (with removal-context allowance)
- 7 e2e specs (works/navigation/studio/editor/d3-smoke), 4 D3 smoke flows verify route stays clean of stage vocabulary
- 42 server unit tests (vitest, node env) + 115 web unit tests (vitest, happy-dom + RTL)

## Stats

- 323 files changed
- 24k insertions / 20k deletions
- 62 commits since `plan1-scaffold-complete`
- 5 plans (4 executed by Opus subagents, 1 by controller after subagent stalled)
- 4 tags: `plan1-scaffold-complete` → `plan2-studio-complete` → `plan3-editor-complete` → `plan4-backend-d3-complete`

## Test plan

- [x] `npm run test:web` — 115/115 passed
- [x] `npm run test:server` — 42/42 passed
- [x] `npx tsc --noEmit` — 0 errors (web + server)
- [x] `npm run build` — clean (web bundle 893 KB, gzip 274 KB)
- [x] `npm run e2e` — 7/7 passed (with `AV_E2E_CHROMIUM_PATH` env override for chromium-1208)
- [x] `./scripts/check-d3-words.sh` — clean across `src/ + skills/ + migrations/ + top-level docs + commit subjects`
- [ ] Manual smoke in browser (deferred — controller reviewing manually before merge)

## Migration & deployment checklist

1. **Before merge**: have user spot-check Studio + Editor in dev (`npm run dev:frontend` + `npm run dev`)
2. **At cutover (deploy day, NOT now)**:
   - Run `AUTOVIRAL_DATA_DIR=$HOME/.autoviral npx tsx migrations/strip-pipeline.ts --dry-run` (expected `wouldStrip: 27` on author's data dir)
   - Run real migration: `AUTOVIRAL_DATA_DIR=$HOME/.autoviral npx tsx migrations/strip-pipeline.ts` — backups land in `<work>/work.<ts>.bak.yaml`
   - Note: server runtime already silently strips legacy fields on read (`STRIP_KEYS` in `src/work-store.ts:36`), so the migration is for physical disk cleanup, NOT runtime safety
3. **Optional pip deps for full functionality**:
   - `pip install librosa numpy` — enables `/api/audio/beats` (Studio beat snap)
   - `pip install stable-whisper` — enables `/api/audio/captions` (Studio caption import)
   - Without these, both endpoints return 503 with friendly install hint; UI degrades gracefully

## Known follow-ups (deferred, NOT blocking)

- **Web bundle 893 KB**: Konva + Remotion are heavy; consider `manualChunks` route-split before performance becomes user-visible
- **`/api/works/:id/render` blocks request thread**: long renders should move to a job queue
- **Long timeline (100+ clips) re-renders on every `currentFrame` change**: needs virtualization
- **`test-runner.ts` looser semantics** (no longer pipeline-gated): no consumer test exercises it
- **Playwright bundled chromium 1217 not cached locally**: env override works; CI needs `npx playwright install chromium` in fresh containers

## Rollback

If production breaks:
1. Revert backend deployment
2. Revert frontend deployment
3. Restore each `~/.autoviral/works/<id>/work.yaml` from its `work.<ts>.bak.yaml` backup if migration was run
4. Old `refactor/ui-v3-react` branch preserved for 30+ days for reference

---

**Author**: Claude Opus 4.7 + controller iterations
**Reviewer**: codex (security + correctness review on 2026-04-27)
**Branch**: `refactor/ui-v3-react`
**Base**: `main`
