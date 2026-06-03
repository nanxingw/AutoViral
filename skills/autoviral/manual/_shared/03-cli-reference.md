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
| `--track <kind>` | `video` (default) `audio` `text` `overlay` | no |
| `--offset <s>` | `trackOffset` in seconds (default 0) | no |
| `--duration <s>` | Sets `out = in + duration` for video/audio; sets `duration` for text/overlay | no |
| `--in <s>` | Source-time start (video/audio only) | no |
| `--out <s>` | Source-time end (video/audio only) | no |

Prints the new clip id to stdout. **Phase 3 caveat:** the backend currently writes only `video` clips. Audio/text/overlay flag handling exists but is widened in Phase 5.

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
