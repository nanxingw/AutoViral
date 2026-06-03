# Quickstart — zero to export in 5 minutes

You're sitting inside an `autoviral` terminal panel. The user just opened a Studio workspace and types something like *"add a 0.18s crossfade between every clip then render"*. Here's the loop you run:

## 1. Smoke-test the wiring

```bash
autoviral whoami
```

Returns `{workId, cwd, port, version}`. If this fails with exit code 2 you're not in a Studio terminal — the env vars `AUTOVIRAL_WORK_ID` / `AUTOVIRAL_PORT` / `AUTOVIRAL_CWD` aren't set. Tell the user.

## 2. Read state

```bash
autoviral comp show               # full composition.yaml
autoviral list clips              # array of clip summaries
autoviral list clips --track video
autoviral list assets --kind video
```

Output is YAML when stdout is a TTY (user reads it), JSON otherwise (you parse with `jq`). Force a format with `--format json|yaml|table`.

## 3. Mutate composition

```bash
# Append a video clip
autoviral clip add --src assets/clips/s20.mp4 --track video --offset 75.0 --duration 5.0

# Patch a clip in place
autoviral clip set vc_s07 --opacity 0.5 --in 0.2 --out 4.8

# Delete
autoviral clip remove vc_s07
```

Every write round-trips through the bridge: server validates with zod, atomically writes `composition.yaml`, then emits a `composition-changed` event the Studio listens to. **The on-disk file is never partially-written.**

## 4. Drive the UI alongside the user

```bash
autoviral select clip vc_s07       # highlight the clip
autoviral seek 12.5s               # scrub the playhead
autoviral seek 1m30s               # m/s notation also fine
autoviral play
autoviral pause
autoviral toast "Applied 3 changes" --kind success --duration 3000
```

These don't change disk state — they're stateless broadcasts to the Studio React app. Use them to keep the user oriented while you work.

## 5. Long-running operations

```bash
autoviral progress start "Generating 16 clips" --steps 16
# ... do work ...
autoviral progress step 1
autoviral progress step 2
# ...
autoviral progress done
```

The Studio shows a top-bar progress strip. Pair `progress` with `toast` for "I did X" milestones.

## 6. Gate destructive actions

```bash
if autoviral ask "Render with current settings?" --yes-no; then
  autoviral export --preset douyin
fi
```

`ask` blocks until the user clicks a button in the Studio modal. Exit codes:

- `0` — yes / ok
- `1` — no
- `2` — cancelled
- `124` — timeout (default 30 min, override with `--timeout 60`)

**Never** skip the gate for: renders, deleting >1 clip, swapping every clip's source, or anything that spends API credits.

## 7. Render

```bash
autoviral export                    # full quality, uses comp's exportPresets[0]
autoviral export --preset douyin    # named preset
autoviral render                    # alias for `export --proxy` — fast review
```

The CLI prints the output path to stdout. The Studio shows render progress via the `ui-render-progress` event stream — you don't need to poll.

## 8. When stuck

```bash
autoviral docs                       # full manual (concatenated)
autoviral docs _shared/03-cli-reference   # one section
autoviral docs recipes/video/crossfade-between-clips
```

That's the loop. Read `_shared/01-workspace-layout` next to learn where files live, then `_shared/03-cli-reference` for every flag. For the deliverable schema, read `video/02-composition-schema` (short-video) or `carousel/02-schema` (图文).
