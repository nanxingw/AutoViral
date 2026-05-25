# Multi-Track Stacking + Industrial Waveform

> **For agentic workers:** REQUIRED SUB-SKILL: Use `mattpocock:to-issues` to break this PRD into vertical-slice issues (already done in this round, see "Issue Map" below). Use `mattpocock:tdd` to execute each slice red→green. Steps in each phase use checkbox (`- [ ]`) syntax.

**Goal:** Land two paired, mutually-reinforcing capabilities on the AutoViral timeline:

1. **Industrial waveform pipeline** — pre-bake per-channel peaks JSON on the server (BBC `audiowaveform` model), so the frontend stops decoding entire audio files in WebAudio on every mount and waveforms render instantly even on 30+ minute beds.
2. **Multi-track stacking** — let users add/remove/reorder any number of lanes per kind (V1/V2/..., A1/A2/A3/..., CC1/CC2/...) inside a **type-pinned** track model (Kdenlive/Shotcut/Premiere/Resolve school), with **UUID-based track ids** so no rigid V1→V2 shift hell, and a **double UI entry** (track-header right-click + lane-gap hover `+` button).

The two ship together because they answer the same user complaint: *"my timeline can hold one BGM, one VO, one subtitle, and the waveform takes 4 seconds to draw on a long beat — it doesn't feel like a real NLE."* Solving only one feels half-done; solving both lets a user lay down BGM + VO + SFX + 2 caption tracks on a 5-minute lyric video and have it scrub at 60fps from first paint.

**Architecture:** Three orthogonal pieces. **(1) Peaks generator** — a server-side ffmpeg pipeline that emits `<asset>.peaks.json` (per-channel Float32 buckets, 32/sec base resolution) on upload, with boot-time backfill for legacy assets. **(2) Schema migration** — `TrackSchema.id` becomes `trk_${uuid}`, gains `displayOrder: number` + optional `language: string` for subtitle tracks; read-time migration transparently rewrites the four legacy ids (`video-0` / `audio-0` / `text-0` / `overlay-0`) on first load. **(3) Track ops UI** — Zustand actions (`addTrack` / `removeTrack` / `reorderTracks`), header right-click menu, lane-gap `+` button; multi-audio rendering already half-works in `render-pipeline.ts:163` and gets finished here.

**Tech stack:** zod (existing schema) · ffmpeg (existing `src/audio-tools.ts` chain) · BBC `audiowaveform` algorithm (re-implemented in TS, no native dep) · React + Zustand (existing studio store) · CSS modules (Brand cool-steel/glass).

**Branch:** continue on `refactor/agentic-terminal` for now (current branch); split a `feature/multi-track-stacking` worktree only if peaks work outpaces track work.

**Phases:**
- **Phase A** — Server peaks generator (per-channel JSON; idempotent; on-upload trigger; boot backfill) (3 tasks)
- **Phase B** — Frontend peaks consumer (prefer `.peaks.json`, fall back to WebAudio for legacy/missing) (1 task)
- **Phase C** — Schema migration (uuid + displayOrder + language; read-time legacy id rewrite) (1 task)
- **Phase D** — Store actions (addTrack / removeTrack / reorderTracks + unit tests) (1 task)
- **Phase E** — Track ops UI (header right-click + lane-gap hover `+`) (1 task)
- **Phase F** — Multi-audio render pipeline finish (verify + extend mixing for N audio tracks) (1 task)
- **Phase G** — Multi-subtitle (Resolve model: N caption lanes with `language` tag; export decision UI) (1 task)

**Total:** 8 vertical slices (one issue each). Estimated 3-5 working sessions.

**Non-goals (explicit out-of-scope for this PRD):**

- **FCP magnetic primary storyline.** We deliberately stay in the type-pinned camp (Kdenlive/Shotcut/Premiere/Resolve). Magnetic timelines win for documentary cutting but lose for the music-video / lyric-video / explainer workloads that are our actual user base.
- **Auto-ducking based on speech detection.** Per-clip ducking ratios already exist; we don't add SoX-style sidechain compression here.
- **Multi-track for video.** Video stays a single canvas stack (overlay tracks handle PiP). Multi-lane video opens a giant compositor-blend rabbit hole; out of scope.
- **Per-channel pan automation.** Track-level volume + per-clip pan is enough for v1. Surround / channel-routing matrices are wontfix for the foreseeable.
- **Variable-resolution peaks (zoom-adaptive resampling).** Base resolution 32 buckets/sec ships in v1; an LOD pyramid (the BBC `.dat` multi-resolution format) is a follow-up if 32/sec proves too coarse at deep zoom or too dense at full-clip zoom-out.
- **Rich track-header chrome** (color swatches, lock icons, solo, automation toggles). v1 ships a thin header — just label, mute, hide. Each is its own follow-up issue.

---

## Research / Industry Reference

This PRD's design choices are anchored to a 2026-05-25 industry survey. Cite both matrices when reviewing.

### Waveform processing matrix

| Project | Asset path model | Peaks algorithm | Failure display |
|---|---|---|---|
| Kdenlive | Absolute `file://` | Background thread decode → `audiothumbs/` cache | Progressive paint + grey bar + warn icon |
| Shotcut | MLT XML abs path + `~/.cache` | Background thread decode (multi-channel summed) | Empty clip until done |
| Olive | Node-graph reference | Renderer samples on the fly | Empty if node unresolved |
| OpenShot | Absolute path | `Frame::GetWaveformImage()` per-frame | Full clip black |
| wavesurfer.js | URL fetch | Default WebAudio decode; docs explicitly recommend pre-baked peaks for large files | `error` event |
| **Peaks.js (BBC)** | Audio URL + `.dat`/`.json` peaks file | **Offline `audiowaveform` CLI pre-bake (industrial standard)** | If peaks missing → does not render |

→ **Decision:** adopt the Peaks.js model. Pre-bake `<file>.peaks.json` on upload; ship a WebAudio fallback for assets without peaks (legacy works, asset-substitution edge cases) so we don't break existing compositions.

### Multi-track matrix

| Project | Track model | Add lane entry | Default count | Multi-subtitle? |
|---|---|---|---|---|
| Kdenlive | Type-pinned | Menu + header right-click | 2V + 2A | 1 subtitle track |
| Shotcut | Type-pinned V1/V2 A1/A2 | Header right-click | 1V + 1A | Separate panel (not a lane) |
| Olive | Node + 2 groups | Drag multi-audio auto-adds | 1V + 1A | Text node |
| OpenShot | Free-mixed layer | Header right-click | 5 layers | Title clip |
| Premiere | Type-pinned | Header right-click + drag-empty auto-add | 3V + 3A | Dedicated Captions track family |
| **Resolve** | Type-pinned | Header right-click (with batch) | 1V + 2A | **Subtitle is a third type; multiple concurrent multilingual tracks** ← our reference |
| FCP X | Magnetic primary + connected lanes | Drag-connected auto | 1 storyline | Caption sub-lanes by language+format |

→ **Decision:** Type-pinned model, Resolve multi-subtitle behavior. Default 4 lanes (`V1 main / A1 BGM / A2 VO / CC1 main`) — open-the-box ergonomics without imposing extra clutter.

### Three pitfalls (must dodge)

1. **Premiere/Kdenlive's V1/V2 rigid numbering trap.** If track id is semantic (`video-0`, `audio-1`) any reorder forces every downstream id + every reference to shift. → Mitigation: `TrackSchema.id` becomes `trk_${uuid}`, ordering is a separate `displayOrder: number` field. Renaming a lane doesn't touch its id.
2. **WebAudio's `decodeAudioData` `EncodingError` swallows the HTTP status.** If a 404/302/HTML-error-page comes back to `decodeAudioData()` you get a useless `EncodingError`. → Mitigation: fetch layer pre-checks `content-type: audio/*`; bad content-type fails fast with a readable message before reaching `decodeAudioData`.
3. **Shotcut's multi-channel summed-to-one waveform hides L/R imbalance.** A stereo clip with one dead channel looks healthy in a summed peaks view. → Mitigation: peaks JSON ships per-channel arrays from day one (`channels: number[][]`), not summed. Frontend can render summed/L-only/R-only/stacked depending on UI.

---

## Solution Architecture

### Peaks pipeline

**Server side** (new `src/server/audio/peaks.ts`):

```
upload-asset → enqueue peaks-job → ffmpeg -i <asset> -ac N -f f32le pipe:1
  → Float32 stream chunker (32 buckets/sec, max-abs reduce)
  → write <asset>.peaks.json next to source
  → fire-and-forget; failure logs but does NOT fail upload
```

JSON shape (frozen):

```json
{
  "version": 2,
  "sampleRate": 48000,
  "durationSec": 171.234,
  "sampleCount": 5479,
  "channels": [
    [0.012, 0.043, 0.097, ...],
    [0.011, 0.038, 0.091, ...]
  ]
}
```

- `version: 2` because v1 was implicit "no peaks file, decode in browser."
- `channels` is **per-channel** (not summed). Mono → 1 element. Stereo → 2.
- 32 buckets/sec base. A 171s stereo file → 2 × 5472 floats ≈ 44 KB JSON, well within HTTP comfort zone.
- Idempotent: if `<asset>.peaks.json` exists and `mtime >= asset.mtime`, skip.

**Triggers:**
1. **On upload** — wire into the existing audio-asset POST handler.
2. **On boot backfill** — scan `~/.autoviral/works/*/assets/*.{mp3,m4a,wav,flac}`, enqueue any missing peaks. Throttled (1 concurrent ffmpeg, 100ms breath) so it doesn't pin the box.

**Frontend** (`web/src/features/studio/hooks/useWaveform.ts`):

```
useWaveform(src):
  fetch <src>.peaks.json
    200 + valid JSON → return { peaks, durationSec, source: "prebaked" }
    404 / bad content-type → fall back to WebAudio decode (existing 151-line implementation)
    fallback also caches in module map, same as today
```

The fallback is mandatory for backward compat: existing works' assets won't have `.peaks.json` until the boot backfill catches up, and we never want a blank waveform during that window.

### Track schema migration

Current schema (`src/shared/composition.ts:251-285`):

```typescript
export const TrackSchema = z.object({
  id: z.string(),                              // semantic — "audio-0", "text-0"
  kind: z.enum(["video", "audio", "text", "overlay"]),
  label: z.string(),
  muted, hidden, clips
});
```

New schema:

```typescript
export const TrackSchema = z.object({
  id: z.string().regex(/^trk_/),               // uuid-tagged — "trk_a3f8c1..."
  kind: z.enum(["video", "audio", "text", "overlay"]),
  label: z.string(),
  displayOrder: z.number().int().nonnegative(),// NEW — UI sort key
  language: z.string().optional(),             // NEW — for subtitle/caption lanes
  muted, hidden, clips
});
```

**Read-time migration** (in the composition loader, not the schema itself — schema stays strict):

```typescript
function migrateLegacyTrackIds(raw: unknown): unknown {
  // If we see id like "audio-0" / "video-0" / etc., rewrite once:
  //   id → "trk_" + crypto.randomUUID().slice(0,8)
  //   displayOrder → original array index
  //   language → undefined (user can set later)
  // Write-back happens on next save; until then we hold the migrated
  // version in memory and the on-disk yaml is rewritten on first edit.
}
```

The fixed default for `makeEmptyComposition` becomes:

```
trk_<uuid>  video   "V1"   displayOrder 0
trk_<uuid>  audio   "A1 · BGM"  displayOrder 1
trk_<uuid>  audio   "A2 · VO"   displayOrder 2
trk_<uuid>  text    "CC1"  displayOrder 3, language "zh"
```

(was: 4 lanes, but mono BGM. New default is closer to what 90% of works end up with anyway.)

### Track ops + UI

**Store actions** (Zustand, in the existing studio store):

```typescript
addTrack(kind, opts?: { afterTrackId?, language?, label? }): string   // returns new track id
removeTrack(id): void
reorderTracks(fromTrackId, toIndex): void
renameTrack(id, label): void
setTrackLanguage(id, lang | null): void   // subtitle tracks only
```

All actions update `displayOrder` for affected tracks transactionally (no partial-state slip in the middle of an array splice).

**UI entries — double entry per modern web NLE UX:**

1. **Track header right-click menu** (`TimelineTrackHeader` component, new):
   - Add lane above
   - Add lane below
   - Rename
   - Set language (subtitle only)
   - Remove (with confirm if track has clips)

2. **Lane-gap hover `+` button**: a 24×24 circular `+` floats in the 4px gap between adjacent lane rows on hover. Click → adds a same-kind lane immediately below the row above. Clicking on a gap between a `video` row and an `audio` row shows a kind picker.

Both routes call the same `addTrack` action — single source of truth.

### Multi-audio rendering

Today `src/server/render-pipeline.ts:161-186` (`compositionToMixTracks`) already iterates *all* tracks of `kind === "audio"` and flat-maps their clips. The work here is:

1. Verify the existing path handles N>2 audio tracks (it likely does; just needs explicit test).
2. Add track-level `volume` field if missing (per-track mix gain), pipe into `MixTrack.gainDb` (`audio-tools.ts`).
3. Document the contract in a new test fixture (3 audio tracks: BGM + VO + SFX) so the next regression sweeps catch any silent leak.

### Multi-subtitle (Resolve model)

Subtitles already live in `kind: "text"` tracks. New behavior:

- Multiple text tracks can coexist (`CC1`, `CC2`, ...).
- Each track has an optional `language` field (`"zh"` / `"en"` / `"jp"`).
- **Render decision UI:** export panel adds a "Caption tracks" section listing each text track + a checkbox column for `burn` (hard-coded into video) and `sidecar` (emit `.srt` / `.vtt` next to mp4). Default: first track burns, others sidecar.
- Burn pipeline (existing `burnCaptions` flag) is extended to accept a specific track id, not just "the first text track."

---

## File Structure

This PRD touches three areas (server peaks, schema/store, UI). Files that change together live together.

### New: `src/server/audio/` (peaks generation)

```
src/server/audio/
  peaks.ts                  # core: ffmpeg invoke + Float32 bucket reduce + JSON write
  peaks-trigger.ts          # upload-time + boot-backfill orchestration
  __tests__/
    peaks.test.ts           # unit: fixture mp3 → expected per-channel buckets
    peaks-trigger.test.ts   # integration: upload trigger + idempotence
```

### Modified: `src/server/`

- `src/server/api.ts` — wire `peaks-trigger` into audio-asset upload handler + register `runPeaksBackfill()` on server boot.
- `src/server/render-pipeline.ts` — extend `compositionToMixTracks` to read per-track `volume` (new field) and verify N-track handling.

### Modified: `src/shared/composition.ts`

- `TrackSchema` — add `displayOrder`, optional `language`; tighten `id` to `trk_` prefix.
- `makeEmptyComposition` — emit 4 default lanes with uuid ids.
- New: `migrateLegacyTrackIds(raw)` — read-time transparent migration.
- Test fixture additions in `src/shared/__tests__/composition.migrate.test.ts`.

### New + Modified: `web/src/features/studio/`

```
web/src/features/studio/
  state/
    studioStore.ts             # MODIFIED — add addTrack/removeTrack/reorderTracks
    __tests__/
      studioStore.tracks.test.ts   # NEW — store actions unit tests
  panels/Timeline/
    TimelineTrackHeader.tsx    # NEW — header with right-click menu
    TimelineTrackHeader.module.css
    LaneGapAdd.tsx             # NEW — hover-revealed `+` between lanes
    LaneGapAdd.module.css
    index.tsx                  # MODIFIED — wire headers + gap buttons
    __tests__/
      TimelineTrackHeader.test.tsx
      LaneGapAdd.test.tsx
  hooks/
    useWaveform.ts             # MODIFIED — prefer .peaks.json; fall back to WebAudio
    useWaveform.test.ts        # MODIFIED — add prebaked-peaks happy path
  panels/Export/
    CaptionTracksSection.tsx   # NEW — per-track burn/sidecar matrix
    __tests__/CaptionTracksSection.test.tsx
```

### Schema test fixtures

```
src/shared/__tests__/fixtures/
  composition-legacy-ids.yaml      # NEW — sample with audio-0/text-0 etc.
  composition-multi-audio.yaml     # NEW — 3 audio tracks for render test
```

---

## Phase Breakdown

Each phase = one tracer-bullet vertical slice = one GitHub issue. Numbered for cross-reference with the Issue Map at the bottom.

### Phase A — Server-side peaks generator (per-channel JSON)

**Issue 1 of 8.** Implements `src/server/audio/peaks.ts` end-to-end: take an audio file path, invoke ffmpeg to extract per-channel Float32 PCM, reduce into 32-buckets-per-second JSON with the agreed schema (`version: 2`), and write `<asset>.peaks.json` atomically.

- [ ] Pick base resolution constant (`PEAKS_PER_SEC = 32`) and JSON shape — frozen, no field renaming after this issue.
- [ ] ffmpeg command: `ffmpeg -i <src> -ac <channels> -ar 48000 -f f32le -hide_banner pipe:1`, stream consumed via `node:child_process.spawn` stdout.
- [ ] Float32 bucket reducer: max-abs over each 48000/32 = 1500-sample window, emit one float per bucket per channel. Watch out for last-bucket partial-window edge case (use what data is there).
- [ ] Atomic write: `<asset>.peaks.json.tmp` then `rename`. Idempotence: skip if existing file's `mtime >= asset.mtime`.
- [ ] Unit tests against three fixtures: short mono mp3, 30s stereo wav, 0-byte file (error path: ffmpeg fails → reject, don't write).
- [ ] **Pitfall #3 dodge:** test explicitly asserts `result.channels.length === fileChannelCount`, never collapsed.

### Phase B — Trigger on upload + backfill on boot

**Issue 2 of 8.** Wire the generator from Phase A into the audio-asset upload path (where `~/.autoviral/works/$ID/assets/audio/*` lands) and add a boot-time pass that backfills any pre-existing asset without `.peaks.json`.

- [ ] Locate the existing audio-asset upload Hono route (likely `src/server/api.ts` or a sub-router); add a post-write hook that fires `generatePeaks(assetPath)` without awaiting (fire-and-forget — upload responds 200 immediately).
- [ ] On server boot, scan `~/.autoviral/works/*/assets/**/*.{mp3,m4a,wav,flac,ogg}`, enqueue any with no sibling `.peaks.json` or stale mtime. Throttle: 1 concurrent ffmpeg job, 100ms breath between completions.
- [ ] Log failures with the asset path; **never crash the upload or the boot sequence on peaks failure.**
- [ ] Integration test: drop a fixture mp3 into a temp `works/$ID/assets/audio/`, hit upload endpoint, assert `.peaks.json` exists within 5s with the right channel count.

### Phase C — Frontend prefer `.peaks.json` with WebAudio fallback

**Issue 3 of 8.** Update `useWaveform` to fetch `<src>.peaks.json` first; on 404 / non-JSON / version-mismatch, fall through to the existing WebAudio decode path unchanged.

- [ ] Add fetch step with `content-type: application/json` check (this is **pitfall #2 dodge** — bail before any `decodeAudioData` if the content type is HTML / etc.).
- [ ] On success, normalize the JSON into the same `{ peaks: Float32Array, durationSec }` shape the existing hook returns, so downstream `WaveformBars` doesn't need to change. For multi-channel, default to channel-summed-on-the-fly **in the UI** (not in storage) — pitfall #3 keeps the data per-channel; the render decision is the UI's.
- [ ] Test matrix: prebaked-peaks happy path (mock fetch returns valid v2 JSON), legacy fallback (mock fetch 404 → existing WebAudio path runs), bad content-type fallback, version-1-or-unknown fallback.
- [ ] **No regression** for any existing `useWaveform.test.ts` case.

### Phase D — TrackSchema migration: uuid + displayOrder + language

**Issue 4 of 8.** Schema-only slice. No UI changes yet, but the data model has to land before store actions can be honest about what they're doing.

- [ ] `TrackSchema.id` regex `^trk_/`; add `displayOrder: number`; add optional `language: string`.
- [ ] `makeEmptyComposition` emits 4 default lanes with `crypto.randomUUID().slice(0,8)` ids and `displayOrder` 0..3.
- [ ] New `migrateLegacyTrackIds(raw)` function in the composition loader (not the schema — schema stays strict). Maps `^(video|audio|text|overlay)-\d+$` ids onto fresh uuids and assigns `displayOrder` from array index.
- [ ] Migration is **read-only-side-effect-free**: it returns a new object, doesn't mutate the on-disk yaml. Next save naturally writes the migrated shape.
- [ ] Test fixture: `composition-legacy-ids.yaml` → load → assert all track ids match `^trk_/`, `displayOrder` is 0..3, semantic info preserved.
- [ ] **Pitfall #1 dodge** test: reorder two tracks in a fixture, save, reload, assert clip references are unbroken (clips reference clip ids, not track ids — so this test is mostly a regression net for "did anyone accidentally couple a clip to a track id string").

### Phase E — Store actions: addTrack / removeTrack / reorderTracks

**Issue 5 of 8.** Zustand store gets three actions + a unit test suite that drives them through realistic sequences.

- [ ] `addTrack(kind, opts?: { afterTrackId?, language?, label? })` returns the new track id. Default placement: at the end of the kind's contiguous block (so adding an audio lane lands after the last existing audio lane, not after a video lane).
- [ ] `removeTrack(id)` — if track has clips, the action returns `{ ok: false, reason: "has-clips" }` so the UI can confirm; with `{ force: true }` it removes anyway and orphans the clips (lost) — orphan warning is a UI concern.
- [ ] `reorderTracks(fromId, toIndex)` — moves one track's `displayOrder` and shifts neighbors transactionally. **Pitfall #1 dodge:** never mutate `id`, only `displayOrder`.
- [ ] All three actions push to the existing undo/redo stack.
- [ ] Unit test sequences: add → reorder → undo → redo; remove-with-clips → confirm path; reorder mixed-kind (allowed — `displayOrder` is global, kind doesn't constrain ordering).

### Phase F — Track header right-click + lane-gap hover `+` (double entry)

**Issue 6 of 8.** UI slice. Both entries call the same store action. Styling per Brand Personality (cool · glass · editorial).

- [ ] `TimelineTrackHeader.tsx` — left of the timeline ruler, one row per track. Shows label + mute + hide + a `⋯` menu icon. Right-click opens the same menu (Add lane above / below / Rename / Set language / Remove).
- [ ] `LaneGapAdd.tsx` — absolutely-positioned 24×24 button in the 4px gap between adjacent lane rows, opacity 0 → 1 on hover. Clicking inserts a same-kind lane below the upper row. Between rows of different kinds, click opens a tiny kind picker.
- [ ] Glass styling: `backdrop-filter: blur(24px) saturate(140%)`, accent ring on focus, `--radius-md`. Avoid terminal-hacker tonality.
- [ ] Tests: React Testing Library — right-click header → menu items appear → clicking "Add lane above" calls `addTrack` with the right `afterTrackId`. Hover gap → button visible → click adds lane.
- [ ] Verify with chrome MCP that hover affordance is discoverable (the `+` is visible enough at first hover); **screenshot in browser before declaring done** (`.claude/rules/e2e-testing.md`).

### Phase G — Multi-audio render pipeline finish + per-track volume

**Issue 7 of 8.** Render pipeline already iterates all audio tracks (`render-pipeline.ts:163`), but per-track volume isn't a thing yet and N>2 audio tracks aren't explicitly tested.

- [ ] Add `Track.volume: number` (dB, default 0) to schema — applies only to `kind: "audio"` tracks. Render-time: each clip's `gainDb` becomes `clip.gainDb + track.volume`.
- [ ] Verify `compositionToMixTracks` handles N=3 audio tracks (BGM + VO + SFX) cleanly. Add a server test with a 3-audio-track fixture → render → ffprobe asserts mixed audio stream has expected RMS.
- [ ] If any silent leak found (per-track volume gets dropped, ducking only references the first track id, etc.) — fix it here, not in a follow-up. **Boil the ocean per CLAUDE.md.**
- [ ] Update `RenderPipelineOptions` types to surface per-track volume settings to the API caller.

### Phase H — Multi-subtitle tracks with language tag (Resolve model)

**Issue 8 of 8.** Several text tracks coexist; each tagged with a language; export panel decides which to burn and which to sidecar.

- [ ] Schema already gained `language` in Phase C — verify it's editable via `setTrackLanguage` store action and persisted.
- [ ] `CaptionTracksSection.tsx` in the export panel: lists every `kind: "text"` track with two checkboxes — Burn / Sidecar. Defaults: first track burns, others sidecar. Either both off (track skipped at export) is allowed.
- [ ] Extend the existing `burnCaptions` flag in render-pipeline to accept a specific track id (or array of ids — though v1 burns only one for clarity).
- [ ] Sidecar emission: write `<output>.<language>.srt` / `.vtt` next to the rendered mp4. Naming follows FCP/YouTube convention.
- [ ] Test: a fixture with two text tracks (zh + en), render with zh burn + en sidecar, assert mp4 has burnt zh + `<out>.en.srt` exists with English caption text.

---

## Risks + Mitigations

### Risk 1: Pitfall #1 — semantic track ids are sticky

If even one consumer (UI selector, store query, export preset, asset metadata) anywhere in the codebase greps for `audio-0` literally, the uuid migration silently breaks them.

**Mitigation:** before Phase D lands, `rg "(video|audio|text|overlay)-\d+" web/src src/` and replace any string-literal references with a `findTrack(kind, options)` helper that takes kind + displayOrder, not raw id. Track this as part of Phase D's acceptance criteria.

### Risk 2: Pitfall #2 — silent peaks fetch failure

If the peaks fetch hits a Vite dev-server HTML 404 page (which returns 200 OK with HTML body in some configs), `JSON.parse` throws and we silently fall through to WebAudio — wasting the peaks pipeline.

**Mitigation:** Phase C explicitly checks `response.headers.get('content-type')?.startsWith('application/json')` before parsing. Add a dev-mode warning when fallback is hit so we notice misconfigured static-asset serving.

### Risk 3: Pitfall #3 — per-channel JSON balloons over the wire

A 60-minute stereo bed at 32 buckets/sec = 230,400 floats per channel × 2 = 460,800 numbers in JSON. Naive JSON.stringify is ~5 MB.

**Mitigation:** Phase A bench-tests with a 60-min file. If JSON exceeds 1 MB, switch storage format to base64-encoded `Float32Array` bytes (or binary `.dat` files like BBC ships) — still per-channel, just packed. Decide at impl-time; not a blocker for the typical 3-5 min asset which is ~40 KB JSON.

### Risk 4: Boot backfill stalls the box

If 200 historical assets need peaks, sequential ffmpeg at 5s/asset = 17 min of background CPU. User notices fan noise.

**Mitigation:** throttle (1 concurrent ffmpeg), 100ms breath, surface boot-backfill progress in a small toast ("Indexing 47 audio files for waveforms…") so user understands what they're hearing.

### Risk 5: UI double-entry causes accidental adds

Lane-gap hover button at 4px gap can fire from mouse-jitter while scrolling.

**Mitigation:** require hover dwell ≥150ms before opacity goes to 1; click target stays 24×24 but visible only after dwell. Mac-native UX convention.

---

## Acceptance Criteria

**For each phase to be "done done," BOTH must hold:**

### Test acceptance
- All new tests pass in `npm run test:web` / `npm run test:server`.
- No regression in existing test suites.
- `npx tsc --noEmit -p web/tsconfig.json` clean.

### Browser-visible acceptance (per `.claude/rules/e2e-testing.md`)
- Open an existing work in Studio with a long BGM clip → waveform paints within 100ms (was: 2-4s) → **screenshot proves it.**
- Right-click an audio track header → menu appears → "Add lane below" → new lane appears immediately → **screenshot proves it.**
- Hover the 4px gap between A1 and A2 → `+` button fades in → click → new A3 lane → **screenshot proves it.**
- Add a second subtitle track in English, drag two caption clips into it, export with zh-burn + en-sidecar → output mp4 has burnt Chinese captions AND a sibling `<out>.en.srt` file with English text → **filesystem + screenshot prove it.**

**Backend artifact ≠ done. If the browser doesn't show it, it's not done.**

---

## Issue Map

The 8 vertical slices below were created on GitHub on 2026-05-25 with label `ready-for-agent`. Each links back to this PRD.

| # | Title (gh issue) | Phase | Surface |
|---|---|---|---|
| 1 | `feat(peaks): server-side peaks JSON generator (per-channel)` | A | `src/server/audio/peaks.ts` |
| 2 | `feat(peaks): trigger on upload + boot backfill` | B | `src/server/api.ts`, boot |
| 3 | `feat(peaks): frontend prefer .peaks.json with WebAudio fallback` | C | `useWaveform.ts` |
| 4 | `feat(timeline): TrackSchema migration — uuid id + displayOrder + language` | D | `composition.ts` |
| 5 | `feat(timeline): store actions addTrack / removeTrack / reorderTracks` | E | studio store |
| 6 | `feat(timeline): track header right-click menu + lane-gap hover-plus UI` | F | Timeline panel |
| 7 | `feat(render): multi-audio track mixing + per-track volume` | G | render-pipeline |
| 8 | `feat(captions): multi-subtitle track + language tag (Resolve model)` | H | Captions / Export |

Tracer-bullet ordering rationale: peaks ships before track-ops because users feel the waveform speedup the moment they reopen a work. Schema before store before UI — strict dependency order; later phases would otherwise rebuild the same migration logic. Multi-audio render is intentionally last among audio because it's the easiest to verify once tracks exist.
