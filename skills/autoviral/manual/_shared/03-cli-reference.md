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

`autoviral comp diff` is reserved for a future phase; currently exits 4 with a clear message.

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
