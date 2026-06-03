# Recipe: swap a clip's source file

The user says *"replace the third clip with a different take"* or *"I re-generated s07, swap it in"*. You want to change `src` without disturbing the clip's position on the track or any keyframes.

## Single-clip swap

```bash
# Confirm where it lives + how long it is now
autoviral comp show --format json \
  | jq '.tracks[].clips[] | select(.id=="vc_s07") | {src, in, out, trackOffset, duration: (.out - .in)}'

# Drop the new file in place (the user usually already did this)
ls "$AUTOVIRAL_CWD/assets/clips/s07.mp4"

# Swap
autoviral select clip vc_s07
autoviral clip set vc_s07 --src assets/clips/s07.mp4
autoviral toast "Swapped vc_s07 source" --kind success
```

If the new file is a different physical asset, also update the asset registry — see "Bookkeeping the registry" below.

## When the new file has a different duration

The clip's `in` and `out` are source-time. If you swap to a file that's shorter than `out`, the render will crash or freeze on a black frame past the source end.

Two ways out:

**Option A — keep the same on-track duration, retime `in`/`out` to fit:**

```bash
# new file is 4.2s but clip currently spans 5.18s of source
autoviral clip set vc_s07 --src assets/clips/s07_v2.mp4 --in 0 --out 4.2
# now the on-track window shrinks; you also need to shift every later clip
```

**Option B — let the new file repeat or stretch (only audio supports loop natively; video doesn't):**

Don't try this. Use Option A or pick a longer take.

## Renaming the file inside the workspace

If the swap is "I downloaded a new version with a different filename":

```bash
# Drop new file
cp ~/Downloads/the-new-take.mp4 "$AUTOVIRAL_CWD/assets/clips/s07_v2.mp4"

# Reference it
autoviral clip set vc_s07 --src assets/clips/s07_v2.mp4
```

Leave the old file on disk unless the user asks to clean up — render history may want it.

## Bookkeeping the registry

The `assets[]` array in `composition.yaml` is the registry. Right now there's no `autoviral asset add` command (Phase 5), so to add a new asset entry you'd patch the composition through other means or just leave it un-registered. The render pipeline reads `src` paths directly; the registry is for UI introspection (the asset drawer) and provenance — render works regardless.

If you need the new file in the registry, append to `assets[]` by writing a tiny tool yourself or asking the user to drop it via the Studio asset uploader (which writes the registry entry for you).

## Batch swap — "swap every clip's source from v1 to v2"

```bash
autoviral progress start "Swapping clip sources" --steps 19
i=0
for clip_id in $(autoviral comp show --format json | jq -r '.tracks[0].clips[].id'); do
  i=$((i+1))
  short=${clip_id#vc_}     # s07 from vc_s07
  new_src="assets/clips/${short}_v2.mp4"

  if [ ! -f "$AUTOVIRAL_CWD/$new_src" ]; then
    autoviral toast "Skipping $clip_id: $new_src missing" --kind warn
    continue
  fi

  autoviral clip set "$clip_id" --src "$new_src"
  autoviral progress step $i
done
autoviral progress done
autoviral toast "Swapped 19 clip sources" --kind success
```

Always pre-check the files exist; the schema doesn't validate file existence and a missing source breaks the render. **Gate this batch with `autoviral ask`** — re-rendering 19 clips' worth of preview is not cheap.

## Reverting a swap

`clip set` doesn't snapshot. To revert, you need the original `src` value from before. Common patterns:

- `git diff composition.yaml` — workspaces are sometimes git-tracked
- `composition.yaml.before-*` snapshot files — if a recent destructive op wrote one
- Ask the user

## Verifying

```bash
autoviral select clip vc_s07
autoviral seek $(autoviral comp show --format json | jq -r '.tracks[].clips[] | select(.id=="vc_s07") | .trackOffset')
autoviral play
```

Watch the preview play through the swapped clip. If the frame is black, the file path is wrong — check the relative path resolves against the workspace root.
