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

There are now two runnable paths. Pick by intent.

### Path 1 — the easy crossfade: `transition add` (preferred)

For a plain dissolve at a cut between two **adjacent video clips on the same
track**, you don't author keyframes at all — add a transition and the renderer
cross-fades the boundary for you. Pin it to the cut AFTER the first clip:

```bash
# trk_v = the video track id (from `autoviral comp show`); vc_s01 = the clip the
# transition fires AFTER. `cross-dissolve` is the fade preset; --duration is the
# crossfade width in seconds (defaults to the preset's 0.5s, clamped to the
# adjacent clips' handles so it can never over-consume a clip).
autoviral transition add --track trk_v --after vc_s01 --preset cross-dissolve --duration 0.18
```

This prints the new transition id (`tr_…`) and writes `composition.yaml`
atomically. Remove it (restore a hard cut) with `autoviral transition remove <id>`.

### Path 2 — hand-authored fades via `clip keyframe`

When you need the precise opacity curve above (overlapping clips, asymmetric
fades, a fade against a non-adjacent clip), author the keyframes one at a time.
Each call adds **one** keyframe to one property; re-adding at the same
`(property, --at)` replaces the value (idempotent), so a re-run is safe.

```bash
# Clip A — fade out over its 5.0→5.18 tail:
autoviral clip keyframe add vc_s01 --property opacity --at 5    --value 1 --easing easeIn
autoviral clip keyframe add vc_s01 --property opacity --at 5.18 --value 0 --easing linear

# Clip B — fade in over its first 0.18s (paired with A's fade-out):
autoviral clip keyframe add vc_s02 --property opacity --at 0    --value 0 --easing linear
autoviral clip keyframe add vc_s02 --property opacity --at 0.18 --value 1 --easing easeOut
```

`--at` is **clip-local** seconds (measured from each clip's own start, not the
timeline). `--property` is one of `opacity / scale / x / y / rotation / volume /
speed`. `add` and `set` are the same author-or-replace verb — use whichever reads
better. The bridge rejects (exit 4) a bad property, a text clip (text carries no
keyframes), a negative time, or a speed value outside `[0.1, 4.0]`; nothing is
written on rejection.

> The earlier `clip set <id> --keyframes '[...]'` form does NOT work and never
> did — `clip set` flags are scalars, so a JSON array arrives as a string the
> schema rejects (HTTP 400, comp untouched). Use `clip keyframe` (above) instead.

## Verifying

Once the keyframes are on disk (via S9/S12 or a direct composition write), watch
the preview at the boundary. If the cut is hard (no blend), one of:

1. `trackOffset` of clip B doesn't actually overlap clip A — check `comp show`
2. The `out` on clip A isn't extended past `trackOffset` of clip B
3. Keyframes have wrong `easing` strings (must be `linear` / `easeIn` / `easeOut` / `easeInOut`)

## Reverting

If your composition-write surface kept a backup, restore that. (The `before-crossfade`
auto-backup referenced by older drafts of this recipe is not a guaranteed
artifact today — verify a backup exists before relying on it.)

## Why 0.18s specifically

The 0.18s number is from the original onset-aligned i2v pattern — slightly longer than a single video frame (1/24s ≈ 0.042s) but short enough to feel like a hard cut with a softening edge, not a stylized dissolve. For documentary / cinematic feel try 0.4–0.6s; for kinetic / music-video try 0.08–0.12s.

## Path 3 — cinematic blends (light-leak / glitch / domain-warp / grav-lens)

For a *stylized* transition rather than a plain dissolve, the four cinematic
endpoints render a baked blend clip you then drop on the timeline — never hand-write
`ffmpeg xfade`. They all take the same body (`{ workId, clipARelative, clipBRelative,
outputFilename, clipADuration, transitionDuration? }`); see the per-look table and
duration guidance in `autoviral docs _shared/03-cli-reference` (the "Cinematic
transitions" section). Use `light-leak` for editorial cuts, `glitch` for tech/beat
accents, `domain-warp` for dream/travel, `grav-lens` for dramatic reversals.
