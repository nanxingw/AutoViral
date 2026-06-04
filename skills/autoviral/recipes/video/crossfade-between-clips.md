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

> ⚠️ **Not yet runnable from the CLI.** There is no working CLI command that
> writes a `keyframes` array onto a clip today. `clip set` flags are parsed as
> scalars (a single string/number), so `clip set vc_s01 --keyframes '[...]'`
> sends a *string* where the schema demands a `Keyframe[]` array — the bridge
> rejects it (HTTP 400) and the on-disk `composition.yaml` is **never touched**.
> Do **not** run it: it cannot succeed and only burns budget.
>
> The runnable crossfade path lands with the dedicated transition / keyframe
> verbs (**S9 `transition add` / S12 keyframe verb**). Until then, the YAML
> shapes above are the canonical *spec* — author them through whatever direct
> composition-write surface you have (e.g. editing `composition.yaml` and
> letting the watcher reload), not through `clip set`.

When the keyframe verb ships, this section will show its invocation; the YAML
above is exactly what that verb must produce.

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
