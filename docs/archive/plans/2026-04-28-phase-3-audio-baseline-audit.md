# Phase 3 Audio Baseline Audit (2026-04-28)

> Reality snapshot of every file Phase 3 of `2026-04-28-autoviral-video-supremacy.md`
> intends to touch. Every claim traces to a file path + line range. No source files
> were modified during this audit.

---

## 0. Audit Scope + Versions

| Probe | Result |
| --- | --- |
| Audit date | 2026-04-28 (Tue) 19:12 CST |
| Repo HEAD SHA | `0dc3d795f205ce06bafe0d6b80fcd8de0e1d8c31` (branch `refactor/ui-v3-react`) |
| Master plan reference | `docs/superpowers/plans/2026-04-28-autoviral-video-supremacy.md` §3 (lines 2049-2193) |
| ffmpeg | `8.1` (Homebrew, Apple clang 17.0.0). Includes `--enable-libx264 --enable-libx265 --enable-libopus --enable-libmp3lame`. |
| ffprobe | `8.1` (same build) |
| Python | `3.11.13` |
| Python deps present | `librosa 0.11.0`, `pydub`, `moviepy 2.1.2`, `Pillow` |
| Python deps **missing** | `edge_tts` (ModuleNotFoundError), `elevenlabs` (ModuleNotFoundError), `stable_whisper` (ModuleNotFoundError) |
| Files audited | `src/audio-tools.ts` (311 lines), `src/server/remotion-renderer.ts` (55 lines), `src/server/api.ts` (1899 lines), 7 capability docs, 4 scripts |

**Key environment flags for Phase 3:**

- ffmpeg 8.1 has both `loudnorm` (since 3.0) and `sidechaincompress` (since 2.5) — Phase 3.A's two-pass loudnorm and the existing ducking implementation in `mixAudioTracks` are both supported.
- `stable_whisper` is **missing** — `/api/audio/captions` (api.ts:1116) will currently 503 with `PYTHON_DEP_MISSING`. Plan must call out an install step or a gracefully-degraded test fixture.
- `edge_tts` is **missing** — Phase 3.E/3.F (TTS) **cannot** even smoke-test today without `pip install edge-tts`. Include in plan prerequisites.

---

## 1. `src/audio-tools.ts` — Full Export Inventory

File length: **311 lines**. Contains 1 internal helper, 2 type interfaces, 1 internal data constant, and **2 exported async functions**. No additional utilities (no `normalizeLufs`, no `applyLut3d`, no `burnSubtitles` — these are all NEW for Phase 3).

### 1.1 `runCmd(cmd, args, timeoutMs = 30_000)` — internal (audio-tools.ts:20-43)

Generic spawn helper; **not exported**. Concatenates stdout+stderr into a single utf-8 string. Rejects on `child.on("error")` and on a `setTimeout(...kill SIGKILL)` after `timeoutMs`. Resolves with combined output on `close` regardless of exit code (so "ffmpeg exits 1 because of `-f null -` quirk" is treated as success — the regex on stderr is what extracts data). Default timeout 30 s; `mixAudioTracks` overrides to 5 min.

### 1.2 `interface AudioAnalysis` (audio-tools.ts:6-12)

```ts
export interface AudioAnalysis {
  hasAudio: boolean;
  hasMeaningfulAudio: boolean;  // mean_volume > -40dB
  avgVolume: number;            // dB
  peakVolume: number;           // dB
  silenceRatio: number;         // 0.0-1.0
}
```

### 1.3 `analyzeAudio(filePath: string): Promise<AudioAnalysis>` (audio-tools.ts:63-127)

Three-step ffprobe + ffmpeg detection. No options object — single positional arg.

**Step 1: stream existence** (lines 65-74)

```bash
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 <filePath>
```

If the resulting CSV doesn't include the literal substring `audio`, returns `NO_AUDIO` (the `-999/-999/1.0` constant declared at line 47-53). **No audio stream type narrowing** — a video stream that happens to contain the literal `audio` somewhere would false-positive (extremely unlikely with `csv=p=0`).

**Step 2: volume detection** (lines 77-88)

```bash
ffmpeg -i <filePath> -af volumedetect -f null -
```

Regex extracts `mean_volume:\s*([-\d.]+)\s*dB` and `max_volume:\s*([-\d.]+)\s*dB` from combined stdout+stderr. Defaults to -999 dB on parse failure.

**Step 3: silence ratio** (lines 91-118)

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 <filePath>   # totalDuration
ffmpeg  -i <filePath> -af silencedetect=noise=-40dB:d=0.3 -f null -      # silenceOutput
```

Sums all `silence_duration:\s*([\d.]+)` matches, divides by `totalDuration`, clamps to ≤ 1.0. If ffprobe returns 0 duration, `silenceRatio` stays at 1.0 (means `NO_AUDIO`-equivalent silence — **not** 0).

**Returns**

```ts
{ hasAudio: true, hasMeaningfulAudio: avgVolume > -40, avgVolume, peakVolume, silenceRatio }
```

**Error handling:** Each `runCmd` rejection bubbles to caller (no try/catch internally). API-layer caller (api.ts:957) catches and returns `{ success: false, error, code: "API_ERROR" }`.

### 1.4 `interface MixTrack` (audio-tools.ts:131-143)

```ts
export interface MixTrack {
  source: string;           // absolute file path
  type: "original" | "bgm" | "voiceover" | "sfx";
  volume: number;           // 0.0-1.0
  delay?: number;           // seconds
  fadeIn?: number;          // seconds
  fadeOut?: number;         // seconds
  ducking?: {
    trigger: string;        // type of track that triggers ducking
    ratio: number;          // compression ratio 2-8
    threshold?: number;     // 0.01-0.1, default 0.02
  };
}
```

Note `MixTrack.type` is a **closed enum** of four strings. Phase 3.C's `Composition → MixTrack[]` adapter must map AudioClip semantics; `Composition.AudioClip` has no `type` field today (composition.ts:100-118 only has `volume / fadeIn / fadeOut / ducking{ratio,attack,release}`), so Phase 3 must either (a) infer `type` from track.id (`audio-0` → `bgm`), or (b) extend `AudioClip` with a `type` discriminator.

Note also the schema mismatch: composition's ducking has `{ratio, attack, release}`; MixTrack ducking has `{trigger, ratio, threshold}`. The trigger field is a **string identifying the track type** (e.g. "voiceover"), not a track id.

### 1.5 `interface MixOptions` (audio-tools.ts:145-149)

```ts
export interface MixOptions {
  videoPath: string;        // absolute path to base video
  tracks: MixTrack[];
  outputPath: string;       // absolute path for output
}
```

### 1.6 `mixAudioTracks(opts: MixOptions): Promise<void>` (audio-tools.ts:157-311)

Builds a single `-filter_complex` graph; muxes against the supplied video (input 0).

**Step 1: probe duration** (lines 165-174). Calls `ffprobe -show_entries format=duration` on `videoPath`; throws if non-finite or ≤ 0.

**Step 2: build inputs** (lines 178-181). `["-i", videoPath, "-i", track[0].source, "-i", track[1].source, ...]`. Input 0 = video; tracks start at input index 1.

**Step 3: per-track filter chain** (lines 185-260). For each track, builds chain of:

- `volume=<v>`
- `adelay=<ms>|<ms>` if `delay > 0` (stereo-aware: `|` separator applies same delay to both channels)
- `afade=t=in:st=0:d=<fadeIn>` if `fadeIn > 0`
- `afade=t=out:st=<totalDur - fadeOut>:d=<fadeOut>` if `fadeOut > 0`

**Label naming** (post-Phase-1.7 cleanup; line 236):

```ts
const label = hasDucking[i] ? `t${i}_pre` : `t${i}`;
filterParts.push(`${inputRef}${filters.join(",")}[${label}]`);
```

So the per-track chain emits to `[tN_pre]` if and only if **that track itself** is ducked; otherwise to `[tN]` directly. The per-track ffmpeg snippet:

```
[1:a]volume=0.6,afade=t=in:st=0:d=0.5[t0]                          (no ducking)
[2:a]volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st=28:d=2[t1_pre] (ducking)
```

**Ducking trigger lookup** (lines 198-207, 240-258). A `typeToIdx: Map<string,number>` is built from the **first** occurrence of each `track.type`. So `ducking.trigger: "voiceover"` always maps to the FIRST voiceover track. **Limitation:** if a composition has two voiceover tracks, only the first one will trigger ducking against any BGM. For Phase 3, this is acceptable — ducking is a single-pair effect.

The trigger label resolved as `triggerPreLabel = hasDucking[triggerIdx] ? "t<i>_pre" : "t<i>"` so the sidechain reads the **un-ducked** signal of the trigger (correct — sidechaincompress should not feed ducked audio back into itself).

**Step 4: sidechain compression** (lines 263-267)

```
[t<i>_pre][<triggerPre>]sidechaincompress=
  threshold=<t>:ratio=<r>:attack=200:release=1000[t<i>]
```

`attack=200ms / release=1000ms` are hardcoded; only `threshold` and `ratio` are user-tunable. Phase 3 acceptance criterion ("ducking ducks under voiceover") will pass with these defaults but the Plan should note these are non-configurable today.

**Step 5: amix** (lines 270-276)

```
[t0][t1][t2]amix=inputs=<N>:duration=first[out]
```

`duration=first` clamps the mix to the duration of the **first audio input** (which is the first track, NOT the video). The post-mix output is then muxed against the original video stream via the `-map 0:v` rule in step 6.

**Step 6: ffmpeg invocation** (lines 281-292)

```
ffmpeg -i <video> -i <track0> -i <track1> ... -filter_complex "<graph>"
       -map 0:v -map [out] -c:v copy -c:a aac -y <outputPath>
```

`-c:v copy` preserves the video bitstream; `-c:a aac` re-encodes to AAC. **No bitrate flag** is set, so ffmpeg uses its AAC encoder default (~128 kbps). 5-minute timeout via `runCmd`.

**Step 7: verification** (lines 295-309). Re-probes output for `audio` codec_type; throws if missing OR if `stat().size === 0`.

### 1.7 What's missing for Phase 3.A (LUFS) and 3.B (burn)

| Phase 3 task | Function expected | Currently exists? |
| --- | --- | --- |
| 3.A | `normalizeLufs(input, output, opts)` | NO — must be added to `audio-tools.ts` |
| 3.B | `burnSubtitles(input, ass, output, opts)` adapter | NO — must shell to `subtitle_burn.py` |
| Phase 6 (later) | `applyLut3d(input, output, lutPath)` | NO |

The plan §3.0 (line 2063) says "extend `audio-tools.ts` with `normalizeLufs`, `applyLut3d`, `burnSubtitles`". Phase 3 only ships the first two of those.

---

## 2. `src/server/remotion-renderer.ts` — Post-Phase-1.8 / 1.9 State

File length: **55 lines**. Two exports.

### 2.1 `buildSafeOutputFilename(title, now = new Date()): string` (lines 5-18)

Sanitises the work title into a slug, appends an ISO timestamp, returns `<slug>-<stamp>.mp4`.

```ts
const safe = (title ?? "")
  .toLowerCase()
  .replace(/[^\w.-]+/g, "-")
  .replace(/^-+|-+$/g, "") || "autoviral-export";
const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
return `${safe}-${stamp}.mp4`;
```

Always returns a `.mp4` extension regardless of preset. Phase 6 will need to plumb `preset.container` into this helper.

### 2.2 `renderCompositionToMp4(comp, outDir): Promise<string>` (lines 20-55)

Signature post-Phase-1.8: `comp` now includes `title?: string`.

```ts
async function renderCompositionToMp4(
  comp: { duration: number; fps: number; width: number; height: number; title?: string; [k: string]: unknown },
  outDir: string,
): Promise<string>
```

**Internal flow:**
1. `bundle({ entryPoint: "<repo>/web/src/features/studio/composition/RemotionRoot.tsx" })` (sync-await; no caching across calls — every export re-bundles).
2. `selectComposition({ serveUrl, id: "main", inputProps: { comp } })`.
3. `renderMedia({ composition: { ...composition, width, height, fps, durationInFrames }, codec: "h264", outputLocation, inputProps: { comp } })`.
4. Returns the final output path.

The dimension/fps overrides at lines 41-48 are explicit — Remotion's `<Composition>` root only declares 1080x1920 30fps defaults; without overrides, exports came out wrong-sized (Codex review note 2026-04-27 in source comment).

### 2.3 What `renderCompositionToMp4` does NOT do

This is critical for Phase 3.C (`runRenderPipeline`). The current renderer:

- **No** LUFS normalization (Phase 3.A target).
- **No** post-process audio mixing — ducking metadata in `AudioClip.ducking` is read by `<Audio>` element but **cannot** trigger sidechain compression in the browser. (Plan line 740 explicitly notes this.)
- **No** subtitle burn — text track is rendered as Remotion canvas text via `TextTrackRenderer.tsx`, which is soft / canvas-rendered.
- **No** LUT application.
- **No** preset-aware encoding — codec is hardcoded `"h264"`, no `videoBitrate` / `audioBitrate` flags. AAC default for audio.
- **No** progress callback — the `renderMedia` call is awaited as a single unit; there's no `onProgress` hook in this wrapper.
- **No** exit hook / post-process chain — Phase 3.C's `runRenderPipeline` must wrap this externally.

Bundle/render is **synchronous-await** (one Promise). The API handler awaits the entire flow before returning. There is no streaming progress today.

### 2.4 Caller in `src/server/api.ts` post-Phase-1.9 (lines 538-570)

```ts
apiRoutes.post("/api/works/:id/render", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found" }, 404);
  let raw: string;
  try {
    raw = await readFile(join(dataDir, "works", id, "composition.yaml"), "utf-8");
  } catch {
    return c.json({ error: "Composition missing — save first" }, 400);
  }
  const parsed = CompositionSchema.safeParse(yaml.load(raw));
  if (!parsed.success) {
    return c.json({ error: "Composition on disk is invalid", issues: parsed.error.issues }, 400);
  }
  const outDir = join(dataDir, "works", id, "output");
  await mkdir(outDir, { recursive: true });
  try {
    const { renderCompositionToMp4 } = await import("./remotion-renderer.js");
    const file = await renderCompositionToMp4({ ...parsed.data, title: w.title }, outDir);
    return c.json({ ok: true, output: file });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Render failed" }, 500);
  }
});
```

Key Phase-1.9 hardening landmarks:

- `safeParse` (line 552) — invalid YAML returns 400 with issues array, no exception bubble.
- `title: w.title` (line 565) — feeds the work's display name into `buildSafeOutputFilename`.
- Dynamic import (line 562) — keeps Remotion bundle out of cold path.
- **Request body is ignored** — handler reads composition from disk, takes no `preset` / `burnSubtitles` / `loudnessTargetLufs` from the request. Phase 3.D must rewrite the body to accept these (the master plan says "Pass through `opts.preset` from the request body").

---

## 3. `src/server/api.ts` — Audio + Render Endpoint Inventory

| Lines | Method + Path | Dispatch | Error shape |
| --- | --- | --- | --- |
| 254-280 | GET `/api/works/:id/composition` | reads `composition.yaml`, `CompositionSchema.parse`, `synthesiseLegacyAssetsAndProvenance`, falls back to `synthesiseLegacyComposition` on ENOENT | 404 not-found / 500 unreadable |
| 429-450 | PUT `/api/works/:id/composition` | `safeParse` body, writes YAML | `{ error, issues }` 400 on schema fail |
| 538-570 | POST `/api/works/:id/render` | reads YAML, `safeParse`, dynamic-import `renderCompositionToMp4`, returns `{ok, output}` | `{error}` 400/500 |
| 928-962 | POST `/api/audio/analyze` | resolves `assetPath` under work via `resolveAssetPath`, calls `analyzeAudio`, returns full `AudioAnalysis` | `{success:false, error, code: "INVALID_PARAMS"\|"INVALID_PATH"\|"API_ERROR"}` |
| 964-1034 | POST `/api/audio/mix` | resolves `videoPath` + `tracks[].source` + `outputFilename` (basename-only); `mkdir` parent of output; calls `mixAudioTracks`; returns `{success, assetPath, previewUrl}` | same `{success:false, ...}` shape |
| 1036-1109 | POST `/api/audio/beats` | shells to `skills/.../detect_beats.py` with `python3` + 60 s timeout; parses JSON from stdout; 503 with `code: "PYTHON_DEP_MISSING"` if librosa missing | structured `{success:false, error, code}` |
| 1111-1176 | POST `/api/audio/captions` | inline Python script (heredoc-style) `import stable_whisper; model.transcribe(...)` with 180 s timeout; 503 if stable-whisper missing | structured `{success:false, error, code}` |
| 1179 | GET `/api/generate/providers` | `listProviders()` from registry | n/a |

### 3.1 POST /api/audio/analyze (lines 928-962) — full flow

Body `{ workId, assetPath }`. `assetPath` may begin with `output/`, `assets/`, or be a bare path (defaults to `assets/`). All three are funnelled through `resolveAssetPath(workId, root, rest)` from `src/server/safe-paths.ts` (Codex review hardening 2026-04-27).

Response on success:
```json
{ "success": true, "hasAudio": true, "hasMeaningfulAudio": true,
  "avgVolume": -18.5, "peakVolume": -6.2, "silenceRatio": 0.12 }
```

Note: capability doc (`audio-mixing.md` line 36-37) shows a `"durationMs"` field in the example response but the actual implementation does **not** return durationMs. Phase 3 documentation (audio-pipeline.md) should reconcile this — either add the field server-side or remove from the doc.

### 3.2 POST /api/audio/mix (lines 964-1034) — full flow

Body `{ workId, videoPath, tracks, outputFilename }`. `outputFilename` is sanitised to a basename via `String(outputFilename).replace(/[/\\]/g, "_").replace(/^\.+/, "")` (lines 1004-1005); the resolved output is **always** under `workDir/output/`. Phase 3.D should reuse the same basename rule for `runRenderPipeline`'s output naming to avoid two divergent sanitisers.

Response on success:
```json
{ "success": true, "assetPath": "output/<safeOutName>",
  "previewUrl": "/api/works/<id>/assets/output/<urlEnc>" }
```

(Codex round 2 finding #3 noted in source comments lines 1023-1025.)

### 3.3 POST /api/audio/beats (lines 1036-1109)

Shells to `join(repoRoot, "skills/autoviral/modules/assembly/scripts/beat-sync/detect_beats.py")` with the resolved fullPath as a positional arg. Parses stdout regardless of exit code (Codex round 2 finding #2; the script writes structured `{"error": ...}` JSON on stdout for both success and known failures).

Returns:
```json
{ "success": true, "beats": [...], "strongBeats": [...], "bpm": 128.0 }
```

Or 503 with `code: "PYTHON_DEP_MISSING"` if the script reports librosa-missing (matched by `/librosa/i.test(parsed.error)`) OR if the stderr fallback regex `/ModuleNotFoundError.*librosa|No module named.*librosa/` fires.

### 3.4 POST /api/audio/captions (lines 1111-1176)

Generates an inline Python heredoc that imports `stable_whisper`, loads `"base"` model (hardcoded — **not** the `medium` default that `caption_generate.py` and the `pro-captions.md` doc use), transcribes, dumps `{"segments": [{start, end, text}]}`. Path is interpolated via `JSON.stringify(fullPath)` — safe against shell injection. 180 s timeout; 16 MiB stdout buffer.

Returns `{ success: true, captions: [{start, end, text}] }`. **Word-level timestamps are NOT exposed**; the inline script aggregates to segment-level only. `caption_generate.py` has access to word-level granularity (the karaoke effect depends on it). Phase 3.B's burn adapter will need word-level timing for `karaoke` style — but this endpoint doesn't return it. **See risk §11.**

### 3.5 GET/PUT carousel endpoints (lines 452-536)

Out of Phase 3 scope. Mentioned only because they share the `synthesiseLegacy*` pattern.

---

## 4. `skills/autoviral/modules/assembly/capabilities/`

7 docs total. Cross-referenced from `skills/autoviral/modules/assembly/SKILL.md`.

| Doc | Lines | In-scope for Phase 3? |
| --- | --- | --- |
| `audio-mixing.md` | 163 | YES — primary reference |
| `pro-captions.md` | 313 | YES — caption decision tree |
| `subtitle-aesthetics.md` | 346 | YES — ASS spec, fonts, pyJianYingDraft note |
| `beat-sync.md` | 122 | tangential |
| `music-search.md` | 124 | tangential |
| `color-grading.md` | 219 | OUT — Phase 6 |
| `video-enhancement.md` | 265 | OUT — separate concern |

### 4.1 `audio-mixing.md` (163 lines)

Teaches a 4-step **analyse-decide-mix** flow:
1. POST `/api/audio/analyze` for each clip.
2. Combine audio analysis with generation context (was the clip prompted for voice?).
3. Apply a 5-row decision matrix (e.g. "voiceover prompted + meaningful audio → original is main, BGM ducks").
4. POST `/api/audio/mix` with the resulting `tracks[]`.

Key reference values codified:

| Track type | Volume | Notes |
| --- | --- | --- |
| Voice (original or VO) | 0.8-1.0 | always loudest |
| BGM with ducking | 0.3-0.5 | duck during voice |
| BGM no voice | 0.5-0.7 | normal |
| Ambient/SFX low | 0.15-0.3 | atmosphere |
| SFX punch | 0.5-0.8 | short bursts |

**Ducking ratios:** `2` = light (interview), `4` = standard, `8` = heavy (tutorials/explainer).

**Caveat for Phase 3:** the doc's example POST body uses snake_case keys (`filePath`, `delayMs`, `fadeInMs`, `triggerTrack`) but the actual API (api.ts:967) reads camelCase keys (`videoPath`, `tracks[].delay`, `tracks[].fadeIn`, `ducking.trigger`). Phase 3.G's `audio-pipeline.md` should either fix this drift or note it explicitly.

### 4.2 `pro-captions.md` (313 lines)

Dual-mode caption decision tree:

- **auto** (`--input video.mp4`): ffmpeg extracts 16 kHz mono WAV, `stable_whisper` transcribes, emits ASS karaoke.
- **timestamps** (`--timestamps captions.json`): caller pre-supplies word-level timing (segments → words[] with start/end).

5 preset styles documented in detail:

| Style | Font | Size | Effect | Use case |
| --- | --- | --- | --- | --- |
| `douyin-highlight` | Source Han Sans Bold | 52 | white→yellow karaoke, 3px black stroke | DEFAULT — talk/tutorial |
| `douyin-bold` | Source Han Sans Heavy | 64 | solid white, no karaoke | impact |
| `xhs-soft` | LXGW WenKai | 48 | light grey stroke, fade in/out | lifestyle |
| `funny` | Smiley Sans | 60 | yellow/red alternating, bounce/scale | comedy |
| `minimal` | Inter + Source Han | 44 | semi-transparent shadow | premium/brand |

**Whisper model size table** (line 222-228): tiny (39M), base (74M), small (244M), medium (769M default), large-v3 (1.5G).

**Recommended order**: original video → burn captions → mix BGM → final.

### 4.3 `subtitle-aesthetics.md` (346 lines)

Full ASS spec including:
- Color format `&HAABBGGRR` (BGR, not RGB).
- 7 macOS / open-source CJK font recommendations with paths.
- Animation tags: `\fad`, `\move`, `\t`, `\frz`, `\alpha`.
- Multi-style ASS template.
- Whisper SRT → ASS conversion Python snippet.
- pyJianYingDraft integration note (out-of-scope for Phase 3 but flagged).

Phase 3.B's burn adapter will likely need the multi-style template if the future captionStyle.background-color requires opaque box rendering.

### 4.4 `beat-sync.md` (122 lines)

Three styles documented for `beat_sync_edit.py`:
- `fast` → cut on every strong beat (comedy/abstract)
- `smooth` → cut only on downbeats (lifestyle)
- `dramatic` → alternating (story/suspense)

Manual flow: `detect_beats.py → JSON → ffmpeg per-segment → concat → BGM mix`.

### 4.5 `music-search.md` (124 lines)

Out-of-scope for Phase 3 but used as supporting material when `runRenderPipeline` lacks a BGM input. yt-dlp recipes, BPM-tag searches, fade commands. No interaction with `runRenderPipeline`.

### 4.6 `color-grading.md` (219 lines) and `video-enhancement.md` (265 lines)

Both **out of Phase 3 scope**. `color-grading.md` covers ffmpeg `lut3d`/`haldclut` + `eq` filters; this is what Phase 6 will use for `applyLut3d`. `video-enhancement.md` covers RIFE / Video2X / face-restoration tools; out of scope entirely.

---

## 5. `skills/autoviral/modules/assembly/scripts/`

```
scripts/
├── caption_generate.py                       691-line ASR + ASS karaoke generator
├── subtitle_burn.py                          882-line moviepy/Pillow hard-burn
└── beat-sync/
    ├── detect_beats.py                       142 lines (librosa)
    └── beat_sync_edit.py                     217 lines (ffmpeg per-cut concat)
```

(No other scripts under assembly/. No `audio/` subdirectory — the master plan §3.0 line 2076 wants a NEW `scripts/audio/` directory containing `loudnorm.py` and `voice_clone.py`.)

### 5.1 `caption_generate.py` (691 lines)

**CLI arg surface (line 600-660):**

```
--input FILE              video/audio path (auto mode; mutex with --timestamps)
--timestamps JSON         word-level timestamps (manual; mutex with --input)
--output FILE             REQUIRED — output ASS path
--style {douyin-highlight,douyin-bold,xhs-soft,funny,minimal}   default douyin-highlight
--language CODE           default zh (auto mode only)
--model NAME              default medium (auto mode only — Whisper model name)
--font ID                 override preset font
--font-size INT           override
--highlight-color HEX     override
--base-color HEX          override
--stroke-width INT        override
--position {center,top,bottom}  override
--max-words INT           default 8 (per ASS line)
--lead-time INT           default 80ms (subs appear early)
```

**Output format (stdout JSON):**

```json
{ "success": true, "output": "...ass", "segments": 12, "words": 87,
  "duration_sec": 45.2, "style": "douyin-highlight", "mode": "auto",
  "model": "medium" }
```

Always emits ASS (never SRT). Auto mode requires `stable_whisper` (currently MISSING in env, see §0).

### 5.2 `subtitle_burn.py` (882 lines) — **CRITICAL for Phase 3.B**

**CLI arg surface (line 786-845):**

```
--video FILE              REQUIRED — input video
--subs FILE               REQUIRED — subtitle file (SRT/ASS/JSON)
--output FILE             REQUIRED — output video
--style {modern,cinematic,bold,minimal,karaoke}   default modern
--font FILE               override font path; default ~/.autoviral/fonts/NotoSansCJKsc-Regular.otf
--fontsize INT            override
--color HEX|name          override
--stroke-color HEX|name   override
--stroke-width INT        override
--position FLOAT          override (0-1, from top)
```

**Supported subtitle formats** (auto-detected via `detect_and_parse(path)` at line 247):
- `.srt` — `parse_srt(path)` regex-based, returns `[{start, end, text}]` (no word-level).
- `.ass` — `parse_ass(path)` extracts `Dialogue:` lines, **strips** `{...}` override tags including karaoke `\kf...`, returns segment-level only. **Karaoke timing IS LOST** for ASS input — subtitle_burn does its own karaoke from JSON.
- `.json` — expects `[{start, end, text, words?:[{start, end, word}]}]` flat array (NOT the nested `{segments:[...]}` shape that `caption_generate.py` accepts!). `--style karaoke` requires the `words` field.

**5 built-in styles** (lines 66-118):

| Style | fontsize | color | stroke | position | extras |
| --- | --- | --- | --- | --- | --- |
| `modern` (default) | 48 | white | black 3px | 0.85 | — |
| `cinematic` | 42 | #F5F0E8 | black 2px | 0.88 | shadow=true |
| `bold` | 56 | white | black 5px | 0.82 | — |
| `minimal` | 36 | white | none | 0.90 | bg_bar=true (semi-transparent black box) |
| `karaoke` | 48 | white | black 3px | 0.85 | karaoke=true, highlight_color=#FFD700 |

**Implementation pipeline** (lines 622-779):
1. Parse subtitle → `entries[]`.
2. Resolve font (resolves to `~/.autoviral/fonts/NotoSansCJKsc-Regular.otf` if `--font` not provided).
3. `VideoFileClip(video_path)` → `(video_w, video_h, fps, duration)`.
4. For each entry, render text frame(s) via `render_text_image` or `render_karaoke_image` (Pillow `ImageDraw`) → `make_subtitle_clip` → moviepy `ImageClip`.
5. `CompositeVideoClip([video, ...subtitle_clips])`.
6. `final.write_videofile(output, fps=fps, codec=libx264, audio_codec="aac", logger="bar")` — defaults to libx264 for mp4/mov, libvpx for webm.

**Output JSON (stdout, lines 771-779):**

```json
{ "success": true, "output": "/abs/path.mp4", "subtitles_count": 32,
  "video_duration_sec": 45.2, "style": "modern", "resolution": "1080x1920",
  "file_size_mb": 12.4 }
```

On failure: `{"success": false, "error": "..."}` and exit 1.

**Phase 3.B contract implications:**

- The adapter must convert `composition.tracks[type=text].clips[]` (TextClip schema in composition.ts:120-150) into one of SRT/ASS/JSON. **JSON is the path of least resistance** since TextClip already has `trackOffset / duration / text / animation` plus optional style overrides — these map to `{start: trackOffset, end: trackOffset+duration, text}` directly.
- Word-level karaoke is NOT derivable from a TextClip alone (TextClip stores a single string, no per-word timing). If `runRenderPipeline` ever wants karaoke output, it needs the upstream `caption_generate.py`-shaped JSON, NOT the TextClip array. Phase 3.B should **only** support segment-level burn for now; karaoke is a Phase 3.G+ documentation note.
- moviepy 2.1.2 import path is `from moviepy import ...` (line 50), with `moviepy.editor` fallback (line 52) for older installs. Phase 3.B can rely on moviepy 2.x being present in dev env.
- subtitle_burn's `--position` is a float 0..1 from TOP. TextClip's `position.yPct` is 0..100 from top. Phase 3.B must divide by 100.

### 5.3 `beat-sync/detect_beats.py` (142 lines)

**CLI:**
```
detect_beats.py <audio_path> [--strong-ratio 0.3] [--output beats.json]
```

**Stdout JSON shape:**
```json
{ "duration": 33.5, "bpm": 128.0,
  "beat_times": [...], "strong_beats": [...], "downbeats": [...],
  "energy_curve": [{"time":..., "energy":...}, ...],
  "suggested_cuts": [{"time":..., "type":"strong_beat|onset", "energy":...}, ...],
  "total_beats": N, "total_strong_beats": M }
```

**Failure mode** (lines 117-127): `{"error": "librosa not installed. Run: pip3 install librosa"}` on `ImportError`, generic `{"error": str(e)}` otherwise. Exit 1 on failure.

**Deps:** `librosa`, `numpy`. Both available in audit env.

### 5.4 `beat-sync/beat_sync_edit.py` (217 lines)

**CLI:**
```
beat_sync_edit.py --video <path> --music <path> --output <path>
                 [--style {fast,smooth,dramatic}] [--music-volume 0.6] [--strong-ratio 0.3]
```

**Pipeline** (lines 105-160):
1. `detect_beats(music)` → `{bpm, beat_times, strong_beats, downbeats}`.
2. `generate_cuts(...)` per style → `[{video_start, duration, music_time}]`.
3. `build_ffmpeg_command(...)`:
   - Cut each segment: `ffmpeg -ss S -i video -t D -an -c:v libx264 -preset fast -crf 23 -r 30 seg_NNNN.mp4`
   - Concat: `ffmpeg -f concat -safe 0 -i concat.txt -c copy concat.mp4`
   - Mix BGM with fade-in/out: `[1:a]volume=V,atrim=0:concat_dur,afade=t=in:st=0:d=0.5,afade=t=out:st=concat_dur-1.5:d=1.5[bgm]`
4. Final stdout JSON: `{ output, duration, size_mb, bpm, segments, style }`.

Out-of-scope for Phase 3 but `runRenderPipeline` may eventually call this for "auto-cut to BGM" mode (not in §3 scope).

---

## 6. TTS — Currently 0 Server Implementation

### 6.1 Forward references in client (no script exists yet)

`web/src/features/studio/generation/dispatchGeneration.ts:288-317` builds a notification message that **assumes** a `tts_generate.py` script:

```ts
const isTts = p.subKind === "tts";
const args: Record<string, string | number> = isTts
  ? { "--text": p.prompt }
  : { "--prompt": p.prompt };
if (isTts && p.voice) args["--voice"] = p.voice;
// ...
script: isTts
  ? "modules/assets/scripts/tts_generate.py"
  : "modules/assets/scripts/music_generate.py",
provenance: {
  agent_id: isTts ? "autoviral-tts" : "autoviral-bgm",
  label: isTts ? "edge-tts/multilingual" : "google/lyria-3-pro-preview",
  model: isTts ? "edge-tts/multilingual" : "google/lyria-3-pro-preview",
}
```

Tests (`__tests__/dispatchGeneration.test.ts:67-83` and `GenerationDialog.test.tsx:73-78`) lock in the `tts_generate.py` script path and `edge-tts/multilingual` model label. Phase 3.F **must** match these exact strings or the existing tests fail.

### 6.2 UI state — TTS is in the Generation dialog

`GenerationDialog.tsx` defines:
- `AudioSubKind = "bgm" | "tts"` (line 35)
- `TTS_VOICES` constant (line 65)
- Radio sub-tab (`bgm` | `tts`) at line 530
- Voice picker at line 542-549
- Default placeholder script `"你好，欢迎来到 AutoViral"` (line 587)

So the UI is **wired and shipping** but every TTS click today fires a notification that points to a non-existent script.

### 6.3 Confirmed absent

| Probe | Result |
| --- | --- |
| `ls skills/autoviral/modules/assets/scripts/tts_generate.py` | "No such file or directory" |
| `grep -rn "tts" src/` | (empty — no server-side tts code) |
| `grep -rn "edge-tts\|elevenlabs\|coqui" skills/` | (empty — no skill-side tts code) |
| `grep -rn "/api/audio/tts" src/ web/src skills/` | (empty — endpoint not registered) |

`structured-generation.md` line 290 explicitly tags `tts_generate.py` as "Phase 3.E 待新增" (to be added in Phase 3.E).

### 6.4 What Phase 3.E/3.F must add

- `src/tts-providers/{edge-tts.ts, elevenlabs.ts, volcano-tts.ts, registry.ts, types.ts}` per master plan §3.0.
- `POST /api/audio/tts` registered in `api.ts` next to `/api/audio/captions`.
- `skills/autoviral/modules/assets/scripts/tts_generate.py` — must accept `--text / --voice / --style / --output` (per master plan §3.F, line 2173). Must mirror the structure of `make_character_sheet.py` (`skills/autoviral/modules/assets/scripts/make_character_sheet.py`, 13.6 KB) which uses `argparse` + `def main(argv)` + `sys.exit(0/1)` with stdout JSON (Phase 2.9 pattern).
- `pip install edge-tts` — required because audit env doesn't have it.

---

## 7. Platform Export Presets — Schema-Only, No Consumers

`src/shared/composition.ts:225-244` defines `ExportPresetSchema`:

```ts
{ id, label,
  platform: "douyin"|"xiaohongshu"|"weixin-channels"|"bilibili"|"tiktok"|"reels"|"shorts"|"youtube-long"|"custom",
  width, height, fps, videoBitrate, audioBitrate,
  codec: "h264"|"h265"|"vp9"|"av1"  (default h264),
  container: "mp4"|"mov"|"webm"     (default mp4),
  maxDurationSec?: number,
  loudnessTargetLufs: number  (default -14),
  safeZonePct: number         (default 0.05),
  notes?: string }
```

`Composition.exportPresets: ExportPreset[]` (composition.ts:261, default `[]`).

### 7.1 Consumers of `exportPresets[]` today

```
$ grep -rn "exportPresets" web/src src/
src/server/__tests__/legacy-migration.test.ts:18,45,69         (test fixtures, just empty arrays)
src/shared/composition.ts:261,326                              (schema definition + default)
web/src/features/studio/__tests__/types.test.ts:115,147        (test fixtures)
```

**Zero non-test code reads `composition.exportPresets`**. The schema round-trips to YAML; no UI populates it; no renderer consumes it. Phase 6 lights it up; Phase 3 only needs to plumb a single optional `preset` arg through `runRenderPipeline`.

### 7.2 Where the preset would plug into render pipeline

Master plan §3.1 (line 2091-2098) declares:

```ts
export interface RenderJobOptions {
  comp: Composition;
  outDir: string;
  preset?: ExportPreset;
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
  onProgress?: (stage, pct) => void;
}
```

Phase 3.D rewires `POST /api/works/:id/render` to read `preset / burnSubtitles / loudnessTargetLufs` from request body. Phase 3.A's `normalizeLufs` should default to `preset?.loudnessTargetLufs ?? opts.loudnessTargetLufs ?? -14`.

Phase 3 is **NOT** expected to honor `preset.codec / videoBitrate / audioBitrate` (master plan §6.E line 2466 says "Render pipeline (Phase 3) honours `preset.codec`/`videoBitrate`/...". Wait — this statement is from Phase 6 acceptance, ambiguous. Resolution: Phase 3 plumbs the type signature only; Phase 6 implements the encode pass.) Plan should be explicit: Phase 3 accepts `preset` and uses ONLY `preset.loudnessTargetLufs`; codec/bitrate fields are Phase 6.

---

## 8. Subtitle Rendering — Dual Paths in Current State

### 8.1 Path A: `TextTrackRenderer.tsx` (Remotion canvas, soft sub)

`web/src/features/studio/composition/tracks/TextTrackRenderer.tsx` (117 lines). Renders during Remotion bundle/render.

- Reads `(track.clips as TextClip[])`.
- For each clip, wraps an `<AnimatedText>` in `<Sequence from={trackOffset*fps} durationInFrames={duration*fps}>`.
- 4 animations supported in switch (lines 54-71): `fade` (opacity 0→1 over 8 frames), `slide-up` (yOffset 40→0 over 12 frames), `kinetic-pop` (spring scale via `computeKineticPopScale`), `typewriter` (`computeTypewriterChars` 2 frames/char).
- Style fields applied as React inline CSS: `fontFamily, fontSize, fontWeight, letterSpacing, color, textShadow` + `whiteSpace: pre-wrap, textAlign: center`.
- Position resolved via `resolvePosition(clip.position, {width, height})` from `../layout/positionResolve`.
- **Output:** PNG-quality text rasterised by Chromium during Remotion render → MP4 frame → output is "soft" in the sense that the text is part of the video frame but rendered via web tech.

### 8.2 Path B: `subtitle_burn.py` (moviepy + Pillow, hard burn)

See §5.2. Renders text via Pillow `ImageDraw` per-frame, composites with moviepy, re-encodes through libx264. Input is SRT/ASS/JSON file (NOT a Composition); operates on a finished video file.

### 8.3 Reachability today

| Path | Reachable from UI? |
| --- | --- |
| Path A | YES — `POST /api/works/:id/render` triggers Remotion → MP4 with whatever's in `tracks[type=text]` baked into frames. |
| Path B | NO — there is no UI button or API endpoint that calls `subtitle_burn.py`. Only documented in the assembly skill for agent use. |

Both paths produce visually-burned text in the final MP4 — neither produces a sidecar SRT/ASS file or selectable text track. The "soft vs hard" terminology in the brief is misleading; both are equally hard once exported.

### 8.4 Proposed Phase 3 unification (per master plan §3.B)

**Option A (master plan implies this):** Keep Remotion's text rendering for in-browser preview only. For export, when `runRenderPipeline(opts)` has `opts.burnSubtitles = true`:

1. Render Remotion **without** the text-0 track (or with text-0 track hidden) → intermediate.mp4.
2. Convert `composition.tracks[type=text].clips[]` → temp JSON.
3. Shell to `subtitle_burn.py --video intermediate.mp4 --subs temp.json --output final.mp4 --style <derived>`.

**Option B (alternative not in plan):** Only use Path A. Drop Path B entirely. Lose karaoke and font-management benefits.

The master plan §3.B (line 2169) explicitly chose Option A: "Implement burnSubtitles adapter that calls existing subtitle_burn.py from server with a temp ASS file derived from composition.tracks[type=text]".

**Caveat:** The plan says "ASS file" but JSON is simpler given TextClip shape (see §5.2 last paragraph). Phase 3 plan-writer should resolve: **temp JSON** is what should ship in 3.B.

### 8.5 Style mapping question

TextClip animations (`fade / slide-up / kinetic-pop / typewriter`) have **no equivalent** in subtitle_burn's 5 styles (`modern / cinematic / bold / minimal / karaoke`). If `burnSubtitles=true`, the animation is **lost** — only the static frame style survives. This must be an explicit Phase 3.B decision documented in `audio-pipeline.md` or surfaced as a UI warning.

---

## 9. ffmpeg / ffprobe / Python deps availability

| Tool | Status | Required for | Notes |
| --- | --- | --- | --- |
| ffmpeg 8.1 | available | all phases | has `loudnorm`, `sidechaincompress`, `lut3d`, libx264/265, libvpx |
| ffprobe 8.1 | available | analyze + duration probes | — |
| python 3.11.13 | available | all scripts | — |
| `librosa` 0.11.0 | available | beat detection (`detect_beats.py`, `beat_sync_edit.py`) | — |
| `pydub` | available | (not currently used) | — |
| `moviepy` 2.1.2 | available | `subtitle_burn.py` (Phase 3.B target) | both `from moviepy import ...` and `from moviepy.editor import ...` import paths covered |
| `Pillow` (PIL) | available | `subtitle_burn.py` | — |
| `numpy` | (implicit via librosa) | beats / array ops | — |
| `stable_whisper` | **MISSING** | `/api/audio/captions` (existing) and `caption_generate.py` (auto mode) | already returns 503 PYTHON_DEP_MISSING; install: `pip install stable-ts` |
| `edge_tts` | **MISSING** | Phase 3.E TTS fallback | install: `pip install edge-tts` |
| `elevenlabs` | **MISSING** | Phase 3.E premium TTS | install: `pip install elevenlabs` |
| `requests` | (used by openrouter_generate.py — assume present) | provider HTTP calls | — |

Phase 3.E install step: `pip install edge-tts elevenlabs stable-ts` (for the captions endpoint to also start working out-of-box during Phase 3 dev).

---

## 10. Legacy Composition Synthesis (api.ts:282-371)

`synthesiseLegacyComposition(workId, workType)` runs only when `workType === "short-video"` (line 286) and reads three asset directories:

```ts
const finalVids = await collect(join(wDir, "output"), /\.(mp4|mov|webm)$/i);
const clips    = await collect(join(wDir, "assets", "clips"), /\.(mp4|mov|webm)$/i);
const music    = await collect(join(wDir, "assets", "music"), /\.(mp3|m4a|wav|aac)$/i);
```

**Key behaviour for Phase 3:**

- If `output/final*.mp4` exists, the composition's `video-0` track is built from `output/` files only — raw `clips/` are NOT auto-sequenced (avoids the "4×-ify duration" bug noted in source comment lines 316-319).
- **`audio-0` BGM track is auto-populated** with `music[0]` only (lines 339-353): single first music file, full duration, `volume: 0.8`, no fade. If no music file, `audio-0` clips array stays empty.
- Always emits 4 tracks: `video-0`, `audio-0` (label="BGM"), `text-0` (label="Subtitles"), `overlay-0` (label="Overlay").
- Default canvas: 1080x1920 @ 30fps, aspect "9:16" (lines 358-362).

**Phase 3 implication:** The legacy synthesizer already creates an `audio-0` track with a BGM clip. `runRenderPipeline` adapter (§3.C) can rely on the convention `track.id === "audio-0"` ⇒ BGM, but should NOT assume `audio-0` is the only audio track in non-legacy compositions (UI may add more). The MixTrack mapping must inspect each AudioClip individually.

Composition's `AudioClip.ducking` field (composition.ts:110-116) is `{ratio, attack, release}` — but **the legacy synthesizer never sets ducking** (line 342-352 only sets `volume / fadeIn / fadeOut`). So legacy compositions have BGM with **no ducking**; voiceover-driven ducking can only happen for compositions with an explicit voiceover audio clip.

The legacy synthesizer also has **no concept of voiceover** — `audioClips[]` only ever has the single BGM entry. Phase 3.C's runRenderPipeline → MixTrack[] adapter, when fed a legacy composition, will produce `tracks: [{type: "bgm", source: bgm.mp3, volume: 0.8}]` — a single-track mix. mixAudioTracks will work but the amix step is just a passthrough volume. This is fine; no Phase 3 changes needed to the legacy synthesizer.

---

## 11. PHASE 3 RISKS — Surface for Plan Writer

These are concrete unknowns or gotchas that the master plan §3 didn't explicitly anticipate. They must be addressed during writing-plans expansion.

### Risk 11.1 — TextClip → subtitle_burn JSON shape mismatch

`subtitle_burn.py`'s JSON parser (line 215-244, `parse_json_subs`) expects a **flat list**:

```json
[ {"start":..., "end":..., "text":..., "words"?:[...]}, ... ]
```

Whereas `caption_generate.py` consumes `{"segments":[{"text":..., "words":[...]}]}`.

The Phase 3.B adapter must emit the FLAT format expected by subtitle_burn, not the segment-nested format. Phase 3 plan should include a unit test for the converter:

```ts
function compositionTextTrackToJson(comp: Composition): Array<{start, end, text}>
```

### Risk 11.2 — TextClip animations are lost when burned

TextClip's `animation: "kinetic-pop"|"typewriter"|"slide-up"|"fade"` has no analog in subtitle_burn's 5-style enum. Burning subtitles **strips** all kinetic animations. The plan must document this trade-off explicitly and either:

(a) Add a UI warning when `burnSubtitles=true` AND any TextClip has a non-default animation.
(b) Skip burn entirely for clips with kinetic animations (fall back to Remotion canvas rendering for those).
(c) Accept the loss silently (NOT recommended).

### Risk 11.3 — Captions endpoint returns segment-only timing

`POST /api/audio/captions` (api.ts:1116-1176) returns `[{start, end, text}]` only — word-level timing is **discarded** by the inline Python script (lines 1148-1152 only collect `s.start, s.end, s.text`). If a Phase 3+ feature wants karaoke burn, the inline script must be extended to emit `words` arrays (every Whisper segment has them). For Phase 3.B this is non-blocking (we only need segment-level), but flag it.

### Risk 11.4 — `stable_whisper` and `edge_tts` are NOT installed

Phase 3 dev environment must `pip install stable-ts edge-tts elevenlabs`. The plan tasks 3.E and 3.F should include a "prerequisites" step or the plan author will hit `ModuleNotFoundError` mid-execution.

### Risk 11.5 — `mixAudioTracks` ducking trigger is type-keyed, not id-keyed

The current `mixAudioTracks(opts)` resolves `ducking.trigger` against `track.type` (audio-tools.ts:202-207, 240-247). Composition's `AudioClip` has no `type` field. The Phase 3.C adapter must either:

(a) Add `type` discrimination heuristic: `audio-0` track → `bgm`, otherwise scan filename for `vo|voice|narration` → `voiceover`. (Brittle.)
(b) Extend `AudioClipSchema` with `type: "bgm"|"voiceover"|"sfx"|"original"`. (Cleaner but schema migration.)
(c) Use track.id directly (e.g. add a new MixTrack discriminator). (Requires `mixAudioTracks` rewrite.)

The master plan §3.B says "passing comp.tracks → MixTrack[] adapter" — but doesn't pick (a)/(b)/(c). Plan writer must decide. Recommendation: **(b)** — extend AudioClip schema, default to `"bgm"` for backwards-compat. The schema change is small and round-trips cleanly.

### Risk 11.6 — `mixAudioTracks` always re-encodes audio to AAC default bitrate

Lines 286-287 hardcode `"-c:a", "aac"` with no `-b:a`. ffmpeg's default is around 128 kbps. If `runRenderPipeline` is fed a `preset.audioBitrate`, it must add a separate ffmpeg pass after `mixAudioTracks` (or extend MixOptions to accept audioBitrate). Phase 3 deferral to Phase 6 is acceptable but should be called out explicitly.

### Risk 11.7 — `loudnorm` two-pass requires structured stderr parsing

ffmpeg's `loudnorm` filter only emits `print_format=json` to **stderr** (not stdout) and only when `-loglevel info` or higher. The first pass's stderr contains a JSON block among other log lines; the parser must extract the JSON object. The plan §3.A implementation note says "parse JSON from stderr to extract measured_*" but doesn't specify the regex. Recommend:

```ts
// Pass 1 stderr contains: ... \n{\n  "input_i" : "-22.93", ... } \n[Parsed_loudnorm_0 ...] ...
const m = stderr.match(/\{[\s\S]*?"input_thresh"[\s\S]*?\}/);
```

Or simpler: capture all stderr, find the largest balanced `{...}` block. The plan writer should pick one approach and write a test fixture for it (a known-quiet WAV from `tests/fixtures/`).

### Risk 11.8 — `renderCompositionToMp4` re-bundles every call

`bundle({entryPoint: ...})` (remotion-renderer.ts:24-30) is called fresh on every `POST /render`. For dev iteration this is fine (~5s overhead). Production scale will need bundle caching. Phase 3 doesn't need to fix this but `runRenderPipeline` should NOT call `bundle` again — it should call `renderCompositionToMp4` once and chain ffmpeg passes.

### Risk 11.9 — The dispatch generation tests lock in specific TTS strings

`dispatchGeneration.test.ts:78` asserts:
```ts
expect(n.message).toContain('"script": "modules/assets/scripts/tts_generate.py"');
expect(n.message).toContain('"model": "edge-tts/multilingual"');
```

Phase 3.F **must** create `tts_generate.py` at exactly that path AND wire `edge-tts/multilingual` as the default model label. Any deviation breaks existing passing tests. Plan writer should verify this constraint pre-flight.

### Risk 11.10 — `audio-mixing.md` documents a different API contract than the implementation

The capability doc (lines 70-107) shows a POST body with snake_case + `outputPath`, while the actual endpoint (api.ts:967-985) reads camelCase + `videoPath / outputFilename`. Phase 3.G's `audio-pipeline.md` should be authored from the actual API, not the existing capability doc, and the existing doc should be updated. Plan should include a "doc reconciliation" task.

### Risk 11.11 — Subtitle burn font default is fragile

`subtitle_burn.py:62` hardcodes `DEFAULT_FONT = Path.home() / ".autoviral" / "fonts" / "NotoSansCJKsc-Regular.otf"`. If that font isn't downloaded, the script falls through to `font_manager.py` (imported via the sibling skill at line 56-58: `asset-generation/scripts/`) which auto-downloads. **But:** `asset-generation` is the OLD skill name; the current path is `assets/`. The `sys.path.insert` line at script line 57-59 may resolve to a non-existent dir today. Phase 3.B should:

(a) Verify font_manager.py is reachable (or copy it under `assembly/scripts/`).
(b) Or refuse `burnSubtitles=true` with a clear error if `~/.autoviral/fonts/NotoSansCJKsc-Regular.otf` doesn't exist.

```bash
$ ls skills/autoviral/modules/assets/scripts/font_manager.py    # → 7651 bytes, present
$ ls skills/autoviral/modules/asset-generation                  # → does NOT exist (old name)
```

**Confirmed bug:** the relative path traversal at subtitle_burn.py line 57-58 `parent.parent.parent / "asset-generation"` resolves to `skills/autoviral/modules/asset-generation/` which **does not exist**. The font_manager import is currently dead-code. subtitle_burn.py ONLY works if `~/.autoviral/fonts/NotoSansCJKsc-Regular.otf` is pre-installed or `--font` is passed explicitly. Phase 3.B test plan must include a font-missing failure case.

---

## 12. Cross-Reference: Phase 3 Tasks vs Audit Findings

| Task | Description | Audit sections grounding it | Status / blockers |
| --- | --- | --- | --- |
| **3.A** | `normalizeLufs` two-pass | §1.7 (no normalizeLufs today), §9 (ffmpeg 8.1 has loudnorm), §11.7 (stderr parsing risk) | UNBLOCKED — proceed with regex test fixture |
| **3.B** | `burnSubtitles` adapter via `subtitle_burn.py` | §5.2 (CLI contract), §8 (dual paths), §11.1 (JSON shape), §11.2 (animation loss), §11.11 (font dead-import) | PARTIALLY BLOCKED — plan must (a) pick JSON-flat input format, (b) decide on animation fallback strategy, (c) include a font-existence guard |
| **3.C** | `runRenderPipeline` orchestrator | §2 (renderer extension point), §1 (mixAudioTracks contract), §10 (legacy synth no voiceover), §11.5 (type vs id mismatch), §11.8 (bundle once) | PARTIALLY BLOCKED — plan must pick (a)/(b)/(c) for AudioClip.type discrimination |
| **3.D** | Rewire `POST /render` to `runRenderPipeline` | §2.4 (current handler shape), §3 (api endpoint table), §7.2 (preset plumbing) | UNBLOCKED — handler shape known; body schema needs definition |
| **3.E** | Three TTS providers + fallback chain | §6 (zero impl today), §6.4 (test asserts model label), §11.4 (deps missing), §11.9 (test contract lockin) | BLOCKED on `pip install edge-tts elevenlabs` step in plan prerequisites |
| **3.F** | `tts_generate.py` skill script | §6.4 (forward-references), §11.9 (test lockin), §5 ref pattern (mirror `make_character_sheet.py` arg surface) | BLOCKED on 3.E provider implementation. Path + flag names are LOCKED by existing tests; deviation breaks tests |
| **3.G** | `audio-pipeline.md` skill doc | §4 (existing capability docs), §11.10 (doc/impl drift), §0 LUFS table (master plan line 2177-2186) | UNBLOCKED — but plan should include a "reconcile audio-mixing.md" sub-task |

### 12.1 Order of operations recommendation

The master plan implies parallel execution but several tasks have dependencies:

```
3.A normalizeLufs ──┐
3.B burnSubtitles ──┼──► 3.C runRenderPipeline ──► 3.D /render rewire
                    │                                       │
                    │                                       └─► 3.G audio-pipeline.md
                    │
3.E TTS providers ──┴──► 3.F tts_generate.py
```

3.A, 3.B, 3.E are all leaves — can be developed in parallel by separate sub-agents. 3.C must wait on 3.A and 3.B. 3.D must wait on 3.C. 3.F waits on 3.E. 3.G can be drafted in parallel with 3.D once 3.A/B/C contracts are locked.

### 12.2 Acceptance-criteria gap analysis

Master plan §3.3:

- ✅ "UI export with faded clips fade audibly" — covered by 3.D + existing `mixAudioTracks` fade chain (§1.6).
- ✅ "Ducked BGM ducks under voiceover" — covered by sidechaincompress (§1.6 step 4) once 3.C wires AudioClip.ducking through.
- ✅ "Integrated loudness within ±0.5 LU of target" — covered by 3.A.
- ✅ "burnSubtitles:true produces hard-burned subs" — covered by 3.B (with §11.2 animation caveat).
- ⚠ "TTS expressive tags `[sigh]` `[laughing]` honoured by edge-tts" — **edge-tts SSML support is limited**; `[sigh]` is a non-standard tag. Plan writer must verify edge-tts actually honors these or downgrade the acceptance criterion to "edge-tts produces audible Chinese voiceover within 5s" (drop the expressive tags clause).
- ✅ "Provider fallback (no elevenlabs key → edge-tts succeeds)" — covered by 3.E `registry.ts`.

### 12.3 Files Phase 3 will modify (final list)

**Modify:**
- `src/audio-tools.ts` — add `normalizeLufs`, `burnSubtitles`. (~80 lines)
- `src/server/api.ts` — rewrite `POST /api/works/:id/render` body (lines 538-570); add `POST /api/audio/tts` (after line 1176).
- `src/shared/composition.ts` — possibly add `AudioClip.type` enum (Risk §11.5 option b).
- `web/src/features/studio/composition/RemotionRoot.tsx` — possibly add a `burnSubtitles` prop to suppress text track during render (alternative: do it at composition level before render).
- `skills/autoviral/modules/assembly/capabilities/audio-mixing.md` — reconcile API contract drift (Risk §11.10).
- `skills/autoviral/modules/assembly/SKILL.md` — register new audio-pipeline.md.

**Create:**
- `src/server/render-pipeline.ts` — new ~120-line orchestrator.
- `src/tts-providers/{edge-tts.ts, elevenlabs.ts, volcano-tts.ts, registry.ts, types.ts}` — 5 new files.
- `skills/autoviral/modules/assets/scripts/tts_generate.py` — new ~250-line script (mirror `make_character_sheet.py`).
- `skills/autoviral/modules/assembly/capabilities/audio-pipeline.md` — new doc.
- `skills/autoviral/modules/assembly/capabilities/ducking-and-lufs.md` — new doc (per master plan §3.0 line 2073).
- `skills/autoviral/modules/assembly/scripts/audio/loudnorm.py` — optional thin wrapper (master plan §3.0 line 2077; 3.A is in TS, this Python wrapper is for skill-side use).

**Tests to add:**
- `src/__tests__/audio-tools.normalizeLufs.test.ts` — fixture `tests/fixtures/quiet.wav` at -28 LUFS, assert post-normalize within ±0.5 LU of -14.
- `src/__tests__/audio-tools.burnSubtitles.test.ts` — fixture composition with text track, mock subtitle_burn.py invocation, assert correct CLI args.
- `src/server/__tests__/render-pipeline.test.ts` — stage progression with mocked deps.
- `src/server/__tests__/api.render.test.ts` — POST /render with preset / burnSubtitles bodies.
- `src/__tests__/tts-providers.registry.test.ts` — fallback chain.
- `skills/autoviral/modules/assets/scripts/__tests__/test_tts_generate.py` — argparse + dispatch.

### 12.4 Open questions for plan writer

1. **AudioClip.type discrimination strategy** (Risk §11.5) — pick (a)/(b)/(c).
2. **TextClip animation loss policy** (Risk §11.2) — pick warn / skip / silent.
3. **Edge-tts expressive tag verification** (§12.2) — confirm `[sigh]` works or relax acceptance.
4. **Subtitle burn input format** — JSON (recommended) vs ASS (master plan literal text).
5. **Font dependency guard** (Risk §11.11) — pre-flight check or graceful error.

---

**END OF AUDIT.** Lines: ~830. Self-contained for Phase 3 plan-writing. Every section anchors a Phase 3 task to specific code locations and surfaces blocking unknowns the master plan didn't anticipate.
