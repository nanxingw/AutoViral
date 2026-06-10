# CLI reference

Every `autoviral` subcommand currently shipped. Source of truth: `cli/autoviral/src/commands/*.ts`. Wire-level surface: `docs/archive/specs/2026-05-14-agentic-terminal-bridge-protocol.md` (v1, frozen).

The CLI auto-formats output: **JSON when stdout is piped** (`stdout.isTTY === false`), **YAML / human table when interactive**. Override either direction with `--format json|yaml|table`.

All HTTP calls require `AUTOVIRAL_WORK_ID`, `AUTOVIRAL_PORT`. Exits with code 2 if missing.

## Read commands

### `autoviral whoami`

Print active Studio context — smoke test for the env wiring.

```
$ autoviral whoami
workId: w_20260513_1919_74d
cwd:    /Users/.../.autoviral/works/w_20260513_1919_74d
port:   3271
version: 0.1.0
```

### `autoviral docs [topic]`

Print the operator manual. Returns raw markdown (not JSON-wrapped) so agents pipe straight into their reading context.

```bash
autoviral docs                       # full manual concatenated
autoviral docs _shared/03-cli-reference   # this file
autoviral docs video/02-composition-schema
```

Unknown topic → exit 3.

### `autoviral comp show`

Print the full composition.yaml as structured data.

```bash
autoviral comp show                  # YAML if interactive, JSON if piped
autoviral comp show | jq '.tracks[0].clips[].id'
```

### `autoviral comp diff`

Print the unified diff between `composition.yaml.previous` (the snapshot taken just before the most recent write) and the current `composition.yaml`. Exits 0; prints `(no changes since last write)` when they match, or a friendly note when no baseline snapshot exists yet (first write of this workspace).

### `autoviral comp put <file|->`

The full-composition write escape hatch: read a COMPLETE composition from a file (or stdin via `-`), then PUT it through the bridge so it lands atomically (zod-validate → tmpfile → rename) and broadcasts `composition-changed` so the Studio refetches. Reach for this when no single intent verb covers the edit, or when you've composed the whole composition client-side.

```bash
autoviral comp show | jq '.duration = 30' | autoviral comp put -   # edit + write back
autoviral comp put ./my-composition.yaml                            # write a file
```

**Unknown keys are REJECTED, not silently dropped.** The write path validates against a *strict* schema: a misspelled top-level key (`tracts` for `tracks`, singular `exportPreset`) or a misspelled clip field fails loud with HTTP 400 + exit 4 and the zod issue path, and the on-disk file is left untouched. This is deliberate — a silent strip would lose the field you meant to write with no feedback. Round-tripping a `comp show` body is always safe (it only contains known keys).

### `autoviral comp set --duration <seconds|auto>`

Set — or **shorten** — the overall timeline length (`comp.duration`). This is the **only supported path** to set a specific duration: every clip edit (add / trim / split / move) only ever *grows* `comp.duration` (it tracks the maximum clip end and never shrinks), so cropping a tail of dead time at the end has no other verb.

```bash
autoviral comp set --duration 30      # set the timeline to exactly 30s
autoviral comp set --duration auto    # derive it from the furthest clip end
autoviral comp set --duration 12      # shorten — tail content past 12s won't render
```

- `--duration <seconds>` — an explicit, finite, non-negative number. Setting a value **shorter than the content end** is allowed (a legitimate crop), but prints a non-blocking warning to stderr and the response flags `truncatesContent: true` — clip content past the new duration will not render.
- `--duration auto` — derive the length from `max(clip end)` across every track (the same口径 the store grows duration with). An empty composition yields `0`.
- A malformed value (`abc`, negative) fails fast with exit 4 **before** the bridge.

### `autoviral list clips [--track <kind>]`

List clip summaries (id, kind, src, in/out, trackOffset, opacity hint). `--track` filters by parent track kind.

```bash
autoviral list clips                 # all clips, all tracks
autoviral list clips --track video
autoviral list clips --track audio
```

### `autoviral list assets [--kind <kind>]`

List asset registry entries. `--kind` is `image | video | audio | subtitle`.

```bash
autoviral list assets --kind video
```

## Write commands (composition.yaml)

All writes are atomic (tmpfile + rename), zod-validated. Invalid input → HTTP 400 with the zod issue list, exit 4, on-disk file untouched.

> ### ⚠️ NEVER hand-edit `composition.yaml` directly
>
> Always write through the bridge — `comp set` / `comp put` / `clip` / `scene` verbs — **never** open `composition.yaml` in an editor and write it yourself.
>
> **Why your direct edit gets silently reverted:** while the Studio editor has this work open, it runs an **800ms debounced auto-save that PUTs its in-memory composition over whatever is on disk.** A disk watcher does refetch your direct edit into the editor first — but the moment the editor's in-memory composition next becomes dirty (any UI nudge), that debounced auto-save writes the editor's memory state back, **overwriting your direct edit.** It's a file-vs-editor-memory race, and the editor wins. (The server itself has no in-memory cache — every read hits disk; the overwrite comes from the *Studio editor*, not the daemon.)
>
> Bridge writes have none of this problem: they go through the atomic-rename chokepoint **and broadcast `composition-changed`**, so the editor *refetches* your change instead of clobbering it, and the write is safe whether or not anyone has the work open. **If you catch yourself reaching for `Write composition.yaml`, use `comp put -` (or a narrower verb) instead.**

### `autoviral clip add`

Append a clip to a track.

```bash
autoviral clip add \
  --src assets/clips/s20.mp4 \
  --track video \
  --offset 75.0 \
  --duration 5.0
```

| Flag | Meaning | Required |
|---|---|---|
| `--src <path>` | Asset path relative to workspace root | yes (except `--track text`) |
| `--text <string>` | Text content (only for `--track text`) | yes for text track |
| `--track <kind>` | `video` (default) `audio` `text` | no |
| `--offset <s>` | `trackOffset` in seconds (default 0) | no |
| `--duration <s>` | Sets `out = in + duration` for video/audio; sets `duration` for text/overlay | no |
| `--in <s>` | Source-time start (video/audio only) | no |
| `--out <s>` | Source-time end (video/audio only) | no |

Prints the new clip id to stdout. **Caveat:** `clip add` writes `video`, `audio`, and `text` clips today. `--track overlay` is NOT yet supported — the bridge throws `overlay track not yet supported` and returns HTTP 400, so don't reach for it.

### `autoviral clip set <id> --key value ...`

Partial update. Flags become the patch body verbatim. Numeric values are auto-cast to numbers; everything else stays a string.

```bash
autoviral clip set vc_s07 --opacity 0.5
autoviral clip set vc_s07 --in 0.2 --out 4.8 --trackOffset 12.4
autoviral clip set ac_bgm --volume 0.65 --fadeOut 1.5
```

Nested objects (transforms / filters / position / style) are **replaced wholesale**, not deep-merged. Fetch via `comp show` first if you only want to tweak one field.

### `autoviral clip remove <id>`

Delete a clip. No confirmation; gate with `autoviral ask` for destructive flows.

```bash
autoviral clip remove vc_s07
```

### `autoviral clip split <id> --at <seconds>`

Cut one clip into two at a point on the timeline. The original id keeps the left
half `[start, at)`; the right half `[at, end)` gets a freshly-minted id which is
printed to stdout. Keyframes are partitioned and the right half's are rebased to
its new local 0.

```bash
# clip vc_s01 sits at trackOffset 0 and runs to 4.0 on the timeline.
# split it at the 2.0s mark of the TIMELINE:
autoviral clip split vc_s01 --at 2.0
```

- `--at` — **absolute timeline seconds** (measured from the start of the whole
  timeline, the same axis as `seek`/`snapshot --at`), NOT clip-local. `--at` must
  fall strictly inside the clip's timeline range `(trackOffset, trackOffset+dur)`;
  a boundary or out-of-range value is rejected with exit 4.
  > Contrast: `clip keyframe --at` is **clip-local** (measured from the clip's own
  > start). `split`/`trim` use the timeline axis; `keyframe` uses the clip axis.

### `autoviral clip trim <id> [--in <seconds>] [--out <seconds>]`

Adjust a video/audio clip's source `in`/`out` window. `--in`/`--out` are
positions in the clip's SOURCE media (seconds from the start of the underlying
file), not timeline seconds.

```bash
autoviral clip trim vc_s01 --in 0.5 --out 3.8
```

### `autoviral clip move <id> --to-track <trackId>`

Move a clip to a **different lane** (track), preserving its `trackOffset` (timeline position). The flag is `--to-track` — it takes an exact `trackId` (e.g. `t_v2`), not a kind. The bridge runs the same shared op the Studio drag/Inspector lane-select uses: a **same-kind guard** (a video clip can only move to a video lane — a cross-kind move is rejected with exit 4), `trackOffset` preservation, and source-lane orphan-transition pruning. So an agent's `clip move` and a human dragging the clip converge on the same composition.

```bash
autoviral list clips                          # find the target lane's trackId
autoviral clip move vc_s01 --to-track t_v2    # move into the second video lane
```

### `autoviral clip keyframe add|set <id> --property <p> --at <sec> --value <v> [--easing <e>]`

Author one keyframe on a numeric clip property (this is how you make a clip
animate — opacity fades, Ken Burns scale, position drifts). `add` and `set` are
the same idempotent author-or-replace verb: re-running at the same
`(--property, --at)` replaces the value, never duplicating.

```bash
# fade a clip out over its last 0.18s (clip-local time)
autoviral clip keyframe add vc_s07 --property opacity --at 5    --value 1 --easing easeIn
autoviral clip keyframe set vc_s07 --property opacity --at 5.18 --value 0
```

- `--property` — one of `opacity`, `scale`, `x`, `y`, `rotation`, `volume`, `speed`.
- `--at` — **clip-local** seconds (measured from the clip's own start, not the timeline).
- `--value` — a number; `speed` must be in `[0.1, 4.0]`.
- `--easing` — `linear` (default) / `easeIn` / `easeOut` / `easeInOut`.

Text clips carry no keyframes (the bridge returns HTTP 400). For a plain
cross-fade at a cut between two adjacent video clips, prefer
`autoviral transition add` (it cross-fades the boundary without hand-authored
keyframes) — see the *crossfade* recipe.

## Script commands (剧本 / narrative outline)

The 剧本 is the work's free-text narrative outline at `plan/script.md` (剧本=PRD
/ 分镜=issue). These verbs round-trip raw markdown through the works route (not
the bridge envelope); a write broadcasts `plan-changed` so the Studio script
editor refreshes live. Writing the file directly also works (a watcher picks it
up), but the CLI write confirms and broadcasts in one step.

### `autoviral script show`

Print `plan/script.md` verbatim. A missing or empty script prints nothing —
that is a clean empty plan, not an error.

### `autoviral script edit [--file <path>]`

Replace the whole script with markdown read from `--file` (or stdin when the
flag is absent).

```bash
autoviral script edit --file /tmp/draft.md
printf '# 主题\n通勤治愈 30 秒\n' | autoviral script edit
```

## Storyboard commands (scenes / 分镜)

Scenes are the **planning layer** — a storyboard table written into the
composition's `scenes[]`. A scene is one shot in your intended sequence (剧本=PRD
/ 分镜=issue); it has **no direct render effect** until you hand it off to
generation (`scene generate` for image shots, the generation endpoints +
`scene link` otherwise) and assemble the output with `autoviral clip`. All write
verbs go through the same shared ops the Studio「剧本·分镜」tab uses, so
CLI-driven and UI-driven storyboards converge on one `composition.yaml`. Schema +
every field: `autoviral docs video/02-composition-schema`. Full pattern: the
*script-to-storyboard* recipe.

### `autoviral scene add --title X [...]`

Add one shot. Prints the minted `scn_…` id. `--title` is the only required flag;
the enum flags are validated locally (exit 4 on a typo, no round-trip).

```bash
autoviral scene add --title "钩子镜" --intent hook --shot-size closeup --camera push --duration 3
autoviral scene add --title "结尾 CTA" --intent cta --narration "点关注看下集" --md-anchor 第三幕-收尾
```

- `--title` — shot label (**required**).
- `--intent` — `hook` | `build` | `payoff` | `cta`.
- `--shot-size` (景别) — `long` | `full` | `medium` | `close` | `closeup`.
- `--camera` (运镜) — `push` | `pull` | `pan` | `track` | `follow` | `static`.
- `--prompt` / `--narration` — generation prompt / voiceover line for this shot.
- `--duration` — intended shot length in seconds.
- `--md-anchor` — heading in `plan/script.md` this shot expands.

### `autoviral scene list`

Print the storyboard, sorted by `order`. One tab-separated row per scene:
`order` / `id` / `title` / `intent` / `status`. (This is a READ off
`autoviral comp show` → `scenes`; for full structured data use `comp show`.)

### `autoviral scene set <id> [...]`

Patch one scene card. Send only the flags you want to change (same flag set as
`scene add`, all optional). The patch replaces just those fields.

```bash
autoviral scene set scn_a1b2c3 --shot-size medium --narration "改一句旁白"
```

### `autoviral scene reorder <id1> <id2> ...`

Reorder the storyboard. The ids ARE the new order and must be a **full
permutation** of every existing scene id (an incomplete list 400s, exit 4).

```bash
autoviral scene reorder scn_c3 scn_a1 scn_b2
```

### `autoviral scene link <id> --asset <assetId> [...]`

Attach generated asset(s) to a scene — the plan→execution handoff state. At least
one `--asset` is required; `--asset` may repeat. `--select` picks the chosen take
(defaults to the last asset); `--status` is `planned` | `generated` | `stale`
(defaults to `generated`).

```bash
autoviral scene link scn_a1b2c3 --asset img_take1 --asset img_take2 --select img_take2 --status generated
```

### `autoviral scene generate <id> [--provider <name>]`

The plan→execution **handoff for an image shot**, in one verb. The bridge builds
the generation prompt from the scene's OWN fields (`prompt`/`title` + 景别/运镜/
旁白), generates ONE image via the provider registry, then **atomically**
registers the AssetEntry and links it onto the scene (`generatedAssetIds` +
`selectedAssetId` + `status: generated`) — no dangling-reference window, no
manual `scene link` needed. Prints the minted asset id. Run it again on the same
scene to **reshoot**: the new take is appended and `selectedAssetId` moves to
it. Editing a generated scene's generation-affecting fields afterwards flips its
status to `stale` (the Studio card shows a red dot).

```bash
autoviral scene generate scn_a1b2c3
autoviral scene generate scn_a1b2c3 --provider openrouter-image   # pick an image provider
```

Do **not** substitute a raw `POST /api/generate/image` + manual `scene link` for
this verb — the raw image endpoint does not register an AssetEntry in
`composition.assets`, so a hand-rolled link dangles. Video / TTS shots have no
`scene generate` yet: generate via the HTTP endpoints (those DO register the
asset), then record the handoff with `autoviral scene link`.

### `autoviral scene remove <id>`

Remove one shot. `order` recompacts to stay contiguous. No confirmation — gate
destructive flows with `autoviral ask`.

```bash
autoviral scene remove scn_a1b2c3
```

## Asset generation (HTTP — not yet a CLI verb)

These generation endpoints aren't wrapped by a CLI subcommand yet; call them over HTTP at `http://localhost:$AUTOVIRAL_PORT`.

### `POST /api/generate/video`

Generate a clip with Seedance 2.0 (via OpenRouter; enabled once the user has set `OPENROUTER_API_KEY` in Settings). Supports text-to-video and image-to-video.

Body: `{ workId, prompt, filename, aspectRatio?, resolution?, durationSec?, firstFrame?, lastFrame?, provider? }`

| Field | Meaning |
|---|---|
| `aspectRatio` | One of `1:1` / `3:4` / `9:16` / `4:3` / `16:9` / `21:9` / `9:21`. **Omit to follow the work's canvas** — the composition `aspect` maps to the nearest supported ratio (`4:5` → `3:4`). Explicit always wins. |
| `resolution` | `480p` / `720p` / `1080p`. Omit ⇒ gateway default. |
| `durationSec` | Integer `4`–`15` (default `5`). fps is fixed at `24`, not a parameter. |
| `firstFrame` / `lastFrame` | i2v anchors. An `http(s)://` or `data:` URI passes through; a **workspace-relative path** (e.g. `assets/images/anchor.png`) is sandbox-resolved and inlined as a base64 data URI for you. |

Cost (per token, H×W×dur×24): roughly **720p ≈ $0.15/s, 1080p ≈ $0.34/s**.

Response includes `assetId` — the clip is **registered as an AssetEntry + a `generate` provenance edge** on `composition.yaml`, so you can `autoviral scene link <sceneId> --asset <assetId>` directly with no dangling reference. (Contrast the image endpoint below.)

### `POST /api/generate/image`

Body: `{ workId, prompt, filename, aspectRatio?, imageSize?, width?, height?, referenceImage? }`. Like video, the **canvas aspect is followed by default** (omit `aspectRatio`); `width`/`height` only derive the nearest ratio (the model picks exact pixels).

Unlike the video endpoint, the **raw image endpoint does NOT register an AssetEntry** in `composition.assets`. For storyboard image shots use `autoviral scene generate <id>` (it registers + links atomically) — don't pair a raw `POST /api/generate/image` with a manual `scene link`, the link would dangle.

### `POST /api/generate/bgm`

Generate background music / a BGM track with **Lyria 3 Pro** (via OpenRouter; enabled once the user has set `OPENROUTER_API_KEY` in Settings — no key ⇒ `503`). This is the only correct way to make music: **there is no `music_generate.py` script** (it was deleted; if any instruction tells you to run it, that path is dead — see the fallback rule below).

Body: `{ workId, prompt, filename?, vocal?, seed?, temperature?, durationSeconds?, referenceImage?, provider? }`

| Field | Meaning |
|---|---|
| `prompt` | The music description (e.g. "upbeat lo-fi hip-hop for a cooking vlog"). Required. |
| `vocal` | `false` (default) ⇒ instrumental — the server prefixes the prompt with "Instrumental only, no vocals.". `true` ⇒ allow vocals. This is Lyria's only negative-constraint mechanism. |
| `seed` | Optional integer for reproducible generation. |
| `temperature` | Optional `0.0`–`2.0` creativity knob. |
| `durationSeconds` | Optional `5`–`180`. **Lyria has no duration parameter** — it emits a full ~1–2 minute track at a flat **~$0.08/track**; this value only **trims** the result with ffmpeg. Out-of-range ⇒ `400`. Omit to keep the full track. |
| `referenceImage` | Optional `http(s)://` or `data:image/...;base64,...` URI — generate music matching an image's mood. |
| `filename` | Defaults to `bgm_<timestamp>.mp3`. Lands in `assets/audio/`. |

Response includes `assetId` + `relativeUri` — the track is **registered as an AssetEntry (`kind: audio`) + a `generate` provenance edge** on `composition.yaml`, and an `asset-added` event refreshes the Studio library live. Add it to the timeline with `autoviral clip add` (as a `bgm` audio clip).

## UI control commands

Stateless broadcasts to the Studio React app. None of them touch disk.

### `autoviral select <kind> [id]`

Highlight a clip or track in the Studio. Pass `none` to clear.

```bash
autoviral select clip vc_s07
autoviral select track trk_video_main
autoviral select none
```

### `autoviral seek <time>`

Move the playhead. Accepts bare seconds, `Ns`, or `MmNs`.

```bash
autoviral seek 12.5
autoviral seek 12.5s
autoviral seek 1m30s
```

### `autoviral play` / `autoviral pause`

Fire-and-forget transport commands.

### `autoviral toast <message> [--kind] [--duration]`

```bash
autoviral toast "Generated 16 clips" --kind success --duration 3000
autoviral toast "Quota nearly exhausted" --kind warn
autoviral toast "Render failed: out of memory" --kind error --duration 8000
```

`--kind` is `info` (default) `success` `warn` `error`. `--duration` is in ms (default 3000).

### `autoviral progress start|step|done`

Coarse-grained progress bar for long-running ops.

```bash
autoviral progress start "Generating 16 clips" --steps 16
autoviral progress step 1
autoviral progress step 2
# ...
autoviral progress done
```

`--steps` is optional but enables an accurate percentage; without it the Studio shows an indeterminate bar.

## Approval gate

### `autoviral ask <message> [--yes-no | --ok-cancel] [--timeout <s>]`

Blocks the HTTP response until the user clicks a button in the Studio modal. Exit codes:

| Code | Answer |
|---|---|
| 0 | yes / ok |
| 1 | no |
| 2 | cancelled |
| 124 | timeout |

```bash
if autoviral ask "Render now?" --yes-no; then
  autoviral export
fi

autoviral ask "Apply changes?" --ok-cancel --timeout 60
```

The user's answer is also written to stdout (`yes` / `no` / `cancelled`) so chained scripts can `case $(autoviral ask ...) in ...`.

Default timeout: 30 minutes. Override with `--timeout <seconds>`.

## Render

### `autoviral export [--preset name] [--proxy]`

Trigger `runRenderPipeline` server-side. Emits `ui-render-progress` events the Studio listens to (you don't need to poll). Prints the final output path on success.

```bash
autoviral export                       # full quality, exportPresets[0]
autoviral export --preset douyin
autoviral export --proxy               # faster preview render
```

### `autoviral render`

Alias for `autoviral export --proxy`. Use for quick review cycles.

### `autoviral snapshot [--at <time>] [--slide <id>]`

Capture the CURRENT frame (video) or slide (carousel) as a single PNG and print its absolute path on stdout, so you can `Read` it and visually self-check your output before declaring done (invariant #6 — verify what's actually visible, don't assume the backend artifact is right). Much faster than a full export: one frame, not the whole timeline.

```bash
autoviral snapshot                      # current playhead (video) / first slide (carousel)
autoviral snapshot --at 12.5s           # video: still at a specific time (seconds|'12.5s'|'1m30s')
autoviral snapshot --slide s2           # carousel: a specific slide by id
```

- **Video work** → Remotion `renderStill` at the playhead (or `--at`), same Scene as the mp4 render, so every overlay/text layer is baked into the PNG — fully faithful.
- **Carousel work** → returns a real exported `output/` page if one exists (text layers baked in); otherwise the slide's BACKGROUND image only. There is no headless carousel renderer yet, so in the background-only case the text/shape/sticker layers are **NOT** composited into the PNG. The CLI prints a caveat to stderr in that case — **do not infer text layout/overflow from a background-only snapshot.**

stdout is a clean absolute path (the caveat, if any, goes to stderr), so `$(autoviral snapshot)` substitution works in a shell.

### `autoviral checkpoint list` / `autoviral checkpoint restore <id>`

Safe rollback. A checkpoint of the deliverable (`composition.yaml` / `carousel.yaml`) is taken automatically every turn; these two verbs let you roll one back after a bad hand-edit.

```bash
autoviral checkpoint list                # rollback history, newest first
autoviral checkpoint restore <id>        # roll the deliverable back to checkpoint <id>
```

- `checkpoint list` prints the history as JSON (each row has `file`, `deliverable`, `ts`, `sha`, `bytes`, optional `label`). The `<id>` you pass to `restore` is a row's `file`.
- **`restore` is reversible** — the server snapshots the CURRENT live state FIRST, *then* overwrites it. So a restore never silently destroys your pending, never-checkpointed edits: they become a fresh checkpoint you can roll forward to. The CLI prints a one-line note to stderr confirming the pre-restore snapshot.
- A bad / unknown `<id>` exits 4 (validation error) and leaves the deliverable untouched.

## Ingest

### `autoviral ingest youtube <url> [--lang zh-CN] [--model <openrouter-id>]`

Download a YouTube URL into the current work, transcribe with Whisper, translate to the target language via OpenRouter, then bootstrap `composition.yaml` with overlay captions.

```bash
autoviral ingest youtube "https://www.youtube.com/watch?v=XXX"
autoviral ingest youtube "$URL" --lang zh-CN
autoviral ingest youtube "$URL" --model anthropic/claude-haiku-4-5
```

Long-running — typical 5-minute clip takes 3–6 minutes wall time (Whisper dominates). Progress emits via `ui-progress` / `ui-toast` so the Studio shows status; CLI blocks on the final HTTP response.

Prints on success:
```
assets/clips/source.mp4
duration 312.50s · 47 segments · en → zh-CN
```

Failure surfaces the failing step (`download / probe / transcribe / translate / compose`) on stderr; exit 5xx-equivalent.

See `recipes/ingest-youtube.md` for the full editorial loop after ingest lands.

## Setup / diagnostics

Unlike every other command, `doctor` and `setup` run **client-side** — they do NOT require `AUTOVIRAL_WORK_ID` / a running daemon. They probe (and install) the external binaries AutoViral's core chain needs, resolving from the **managed location** (`~/.autoviral/bin`, `~/.autoviral/tts-venv`) and the vendored npm packages — never relying on the user's shell PATH (PRD-0003 §1).

### `autoviral doctor`

Print a dependency readiness table and exit. Probes are pure local reads (no install, no daemon):

```
$ autoviral doctor
autoviral doctor — dependency readiness

✓ ffmpeg       managed (~/.autoviral/bin)
    → /Users/me/.autoviral/bin/ffmpeg
✓ ffprobe      vendored (ffmpeg-static)
    → /Users/me/.../node_modules/ffmpeg-static/ffmpeg
○ tts venv     missing edge-tts + stable-ts
    fix: run `autoviral setup` (creates the venv & pip-installs them)
○ playwright   chromium not installed
    note: ~150MB, lazy-installs on first trends scrape (or `autoviral setup --heavy`)
✓ claude CLI   on PATH
    → /usr/local/bin/claude

Core dependencies OK.
```

Each binary shows WHERE it resolves, in precedence order: **env override** (`FFMPEG_PATH`/`FFPROBE_PATH`, set by the packaged desktop app) → **managed** (`~/.autoviral/bin`) → **vendored** (`ffmpeg-static`) → **system PATH** (last resort). `claude` can't be bundled (it's Anthropic's) so it's detected + reported only.

**Exit code: non-zero (1) when a CORE dep — ffmpeg or ffprobe — is missing; 0 otherwise.** A missing TTS venv / playwright / claude is a `○` warning, not a failure (those degrade a feature; `setup` or first-use lazy install handles them).

### `autoviral setup [--heavy]`

Install the missing pieces with streamed progress (no npm postinstall — that's fragile and routinely blocked):

```bash
autoviral setup            # ffmpeg/ffprobe → ~/.autoviral/bin + TTS venv (edge-tts + stable-ts)
autoviral setup --heavy    # also installs playwright chromium (~150MB) NOW
```

- **ffmpeg + ffprobe** — copies the vendored binaries into `~/.autoviral/bin` (the managed location `doctor` reports as `managed`).
- **TTS venv** — `python3 -m venv ~/.autoviral/tts-venv` then `pip install --upgrade edge-tts stable-ts`, streaming pip output. Needs a host `python3`; if absent it prints a copy-paste install hint and continues (non-fatal).
- **playwright chromium** — heavy + optional. By DEFAULT left to lazy-install on first trends scrape (printed, not silent); `--heavy` installs it up front.

**Exit code: 1 only if the CORE ffmpeg/ffprobe install failed; 0 otherwise** (a TTS failure is reported but doesn't fail the whole setup). Re-run `autoviral doctor` to verify.

> Desktop (dmg/nsis) users never need `setup` for ffmpeg — the installer ships ffmpeg/ffprobe via electron-builder `extraResources` and the app points `FFMPEG_PATH`/`FFPROBE_PATH` at them at boot, so render/export work with zero manual install.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success; `ask` answered yes |
| 1 | `ask` answered no |
| 2 | Wrong state (env vars missing, Studio unreachable, `ask` cancelled) |
| 3 | Protocol error (malformed response, schema mismatch, mid-call network error) |
| 4 | Validation error (bad flags, missing required arg, schema rejected the body) |
| 124 | `ask` timeout |
| 127 | Unknown subcommand |

See `contracts/error-codes.md` for the canonical table and which conditions map to which code.

## Output format override

Any read-shaped command takes `--format json|yaml|table`:

```bash
autoviral comp show --format json | jq '.duration'
autoviral list clips --format table       # ASCII columns
```

`docs` and `whoami` ignore `--format` (their shapes are fixed). Write commands print only the new id (clip add) or are silent (clip set / remove / select / seek / toast / progress / ask-response).
