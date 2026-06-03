# Recipe: crossfade between two clips (0.18s)

The canonical pattern, derived from the fix shipped in `~/.autoviral/works/w_20260513_1919_74d/` (19 i2v clips, all crossfaded).

## The shape of a crossfade

Two clips on the same video track. Their on-track windows **overlap** by the crossfade duration (`X = 0.18s`). Clip A fades out over the overlap; clip B fades in over the overlap.

```
Clip A:  [══════════ 5.18s ══════════]
                              [fade out 0.18s]
Clip B:                   [fade in 0.18s]
                          [══════════ 5.18s ══════════]
Timeline:  0 ──────────── 5.0 ───── 5.18 ──────────── 10.18
                          ↑ overlap
```

Both clips have `out - in = 5.18s` (the visible duration), but clip B's `trackOffset` is `5.0`, not `5.18`. The overlap is `5.18 - 5.0 = 0.18s`.

## Clip A — fade out at the end

```yaml
- id: vc_s01
  kind: video
  src: assets/clips/s01.mp4
  in: 0
  out: 5.18              # 5s of content + 0.18s tail for the fade
  trackOffset: 0
  keyframes:
    - { property: opacity, time: 5,    value: 1, easing: easeIn }
    - { property: opacity, time: 5.18, value: 0, easing: linear }
```

The keyframes say: "from clip-local time 5.0 to 5.18, opacity goes 1 → 0 linearly."

## Clip B — fade in at the start, fade out at the end

```yaml
- id: vc_s02
  kind: video
  src: assets/clips/s02.mp4
  in: 0
  out: 5.18
  trackOffset: 5         # ← starts BEFORE A ends (A ends at 5.18, B starts at 5.0)
  keyframes:
    - { property: opacity, time: 0,    value: 0, easing: linear }
    - { property: opacity, time: 0.18, value: 1, easing: easeOut }
    - { property: opacity, time: 5,    value: 1, easing: easeIn }
    - { property: opacity, time: 5.18, value: 0, easing: linear }
```

The first two keyframes are the fade-in (paired with A's fade-out). The last two are the fade-out for the next crossfade (with C). Every middle clip in a chain carries four keyframes.

## Doing it via CLI

You can't currently express keyframes through a single `clip set` flag — the schema expects an array. The path is: `comp show`, mutate the JSON locally, `clip set --keyframes <json-array>`.

```bash
# Read clip A
clip_a=$(autoviral comp show --format json \
  | jq '.tracks[].clips[] | select(.id=="vc_s01")')

# Build the new keyframes array
new_kfs='[
  {"property":"opacity","time":5,"value":1,"easing":"easeIn"},
  {"property":"opacity","time":5.18,"value":0,"easing":"linear"}
]'

# Patch
autoviral clip set vc_s01 --keyframes "$new_kfs"

# Repeat for clip B with the 4-keyframe array
# ...
```

## Doing it as a batch (the 19-clip pattern)

For a chain of N clips, every clip's `out` must be extended by 0.18s (so there's tail to fade), and consecutive `trackOffset`s must overlap by 0.18s. Pseudo-code:

```bash
CROSSFADE=0.18
SEGMENT=5.0       # visible duration of each clip

autoviral progress start "Adding crossfades" --steps $N
for i in $(seq 0 $((N-1))); do
  clip_id="vc_s$(printf '%02d' $((i+1)))"
  track_offset=$(echo "$i * $SEGMENT" | bc)
  out=$(echo "$SEGMENT + $CROSSFADE" | bc)

  if [ "$i" -eq 0 ]; then
    # first clip — fade out only
    kfs='[{"property":"opacity","time":'$SEGMENT',"value":1,"easing":"easeIn"},
          {"property":"opacity","time":'$out',"value":0,"easing":"linear"}]'
  elif [ "$i" -eq $((N-1)) ]; then
    # last clip — fade in only
    kfs='[{"property":"opacity","time":0,"value":0,"easing":"linear"},
          {"property":"opacity","time":'$CROSSFADE',"value":1,"easing":"easeOut"}]'
  else
    # middle clip — both
    kfs='[{"property":"opacity","time":0,"value":0,"easing":"linear"},
          {"property":"opacity","time":'$CROSSFADE',"value":1,"easing":"easeOut"},
          {"property":"opacity","time":'$SEGMENT',"value":1,"easing":"easeIn"},
          {"property":"opacity","time":'$out',"value":0,"easing":"linear"}]'
  fi

  autoviral clip set "$clip_id" --out "$out" --trackOffset "$track_offset" --keyframes "$kfs"
  autoviral progress step $((i+1))
done
autoviral progress done
autoviral toast "Added 0.18s crossfades to $N clips" --kind success
```

## Verifying

```bash
autoviral seek 5s
autoviral play
```

Watch the preview at the boundary. If the cut is hard (no blend), one of:

1. `trackOffset` of clip B doesn't actually overlap clip A — check `comp show`
2. The `out` on clip A isn't extended past `trackOffset` of clip B
3. Keyframes have wrong `easing` strings (must be `linear` / `easeIn` / `easeOut` / `easeInOut`)

## Reverting

The render pipeline writes `composition.yaml.before-crossfade` on first run as a manual safety. To revert:

```bash
autoviral ask "Revert crossfades?" --yes-no && \
  cp "$AUTOVIRAL_CWD/composition.yaml.before-crossfade" "$AUTOVIRAL_CWD/composition.yaml"
```

The composition watcher will pick up the file change automatically.

## Why 0.18s specifically

The 0.18s number is from the original onset-aligned i2v pattern — slightly longer than a single video frame (1/24s ≈ 0.042s) but short enough to feel like a hard cut with a softening edge, not a stylized dissolve. For documentary / cinematic feel try 0.4–0.6s; for kinetic / music-video try 0.08–0.12s.
