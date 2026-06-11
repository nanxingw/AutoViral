# UI control — keeping the user oriented

The user is watching the Studio preview + timeline while you work. They can read your terminal output, but they can't context-switch fast enough to follow a wall of `clip set` calls. Use the UI commands to **show**, not just **tell**.

## The four UI levers

| Command | When to fire | What the user sees |
|---|---|---|
| `autoviral select <kind> <id>` | Right before mutating a clip; right after creating one | The clip glows in the timeline + Inspector opens |
| `autoviral seek <time>` | When you want them looking at a specific frame | Playhead jumps; preview re-renders to that frame |
| `autoviral toast "msg" --kind ...` | After a meaningful unit of work completes | Glass toast slides in for 3s (configurable) |
| `autoviral progress start/step/done` | For ops taking >5s | Top-bar progress strip with label + step counter |

`play` / `pause` are also UI commands but rarely used by agents — the user usually drives playback themselves.

## Patterns

### Pattern: "I'm about to change clip X"

Always select before mutating. The user sees what's changing.

```bash
autoviral select clip vc_s07
autoviral seek $(get-clip-start vc_s07)
autoviral clip keyframe add vc_s07 --property opacity --at 0 --value 0.5
autoviral toast "Faded vc_s07 to 0.5" --kind success
```

### Pattern: "I'm running a long generation"

Wrap the loop in `progress` so the top bar isn't dead air.

```bash
autoviral progress start "Generating 16 clips" --steps 16
for i in 1..16; do
  generate-clip $i
  autoviral progress step $i
done
autoviral progress done
autoviral toast "Generated 16 clips" --kind success
```

If something fails mid-loop, finish with `progress done` first (don't leave the bar hanging) and follow with `toast "Generation failed at step N" --kind error`.

### Pattern: "I'm about to do something destructive"

Always ask. Gate render, mass-delete, source-swap-all.

```bash
if ! autoviral ask "Delete all 19 clips and start fresh?" --yes-no; then
  echo "User said no; staying put"
  exit 0
fi
# proceed with deletion
```

The modal blocks until the user clicks. Default timeout is 30 min — plenty of time for them to think. **Don't** try to be clever by polling `autoviral list clips` to detect manual changes; just ask.

### Pattern: "I made many small edits"

Don't toast every one. Group them.

```bash
# Bad — five toasts in 200ms
for clip in vc_s01 vc_s02 vc_s03 vc_s04 vc_s05; do
  autoviral clip keyframe add $clip --property opacity --at 0 --value 0.8
  autoviral toast "Faded $clip" --kind info
done

# Good — one summary toast
for clip in vc_s01 vc_s02 vc_s03 vc_s04 vc_s05; do
  autoviral clip keyframe add $clip --property opacity --at 0 --value 0.8
done
autoviral toast "Faded 5 clips to 0.8 opacity" --kind success
```

### Pattern: "I'm about to render"

```bash
autoviral progress start "Rendering" --steps 5
# the export pipeline emits its own ui-render-progress events; the
# --steps here is mostly a fallback if the agent wants a manual count
autoviral export --preset douyin
autoviral progress done
autoviral toast "Render done: output/douyin-final.mp4" --kind success --duration 6000
```

The Studio's render progress bar is also driven by the `ui-render-progress` event stream from the server (stage labels + percentage). Your `progress` calls are complementary, not duplicate.

## Toast `--kind` semantics

- `info` — neutral status updates. "Loaded 19 clips."
- `success` — a unit of work finished. "Rendered." "Generated 16 i2v clips."
- `warn` — something the user should notice but didn't break. "Quota at 80%." "Asset s14.mp4 missing, skipped."
- `error` — operation failed. "Render failed: ENOSPC." "Seedance API returned 429." Pair with longer `--duration` (6000–8000ms) so the user has time to read.

## When NOT to use UI commands

- Inside `autoviral docs` lookups — no UI side effect needed
- Inside read-only investigation (`autoviral list assets | jq ...`)
- When you're about to call `autoviral ask` immediately — the modal itself is the UI

## What the agent cannot do from the CLI

- Resize panels / change layout
- Open or close other tabs
- Change the editor theme
- Trigger a file-system rescan (the Studio's composition watcher handles this automatically)

If the user asks for any of these, tell them they have to do it manually in the Studio. Don't pretend the CLI has a hidden flag.
