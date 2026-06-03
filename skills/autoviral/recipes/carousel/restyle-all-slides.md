# Recipe: restyle every slide in a carousel (图文)

The user says *"make all the slides feel more editorial"* or *"switch the whole
图文 to a noir palette and serif headlines"*. This is a carousel (`carousel.yaml`)
work, not a video — you mutate slides + layers, not clips.

> Read `autoviral docs carousel/02-schema` first. Layers are a discriminated
> union (`text | image | shape | sticker`) and `bg` is a discriminated union on
> `type` — blind-writing the file almost always fails zod and the user sees
> nothing. The CLI validates every mutation before it touches disk.

## 1. Read the current carousel

```bash
# The carousel is served (and round-trips) via the work REST surface.
curl -s "http://127.0.0.1:${AUTOVIRAL_PORT}/api/works/${AUTOVIRAL_WORK_ID}/carousel" \
  | jq '{slides: (.slides | length), palette: .globals.palette, font: .globals.headlineFont}'
```

`globals` is carousel-wide style: `palette` (mono | pastel | neon | earth | noir),
`headlineFont` (serif | sans | mono), `layout` (centered | left | split), plus
`effects.{grain,gradient}`. Per-slide style lives on each `bg` and on each text
layer's `style`.

## 2. Two ways to restyle

There is **no `autoviral carousel set-globals` verb** — the CLI write surface is
`add-slide` and `set-layer` only. So you have two levers:

**Lever A — globals + whole-carousel restyle → `PUT .../carousel`.** Changing the
palette/font/layout or rewriting many slides at once is one atomic PUT of the
full validated carousel. Read it, transform it in memory, write it back:

```bash
work="http://127.0.0.1:${AUTOVIRAL_PORT}/api/works/${AUTOVIRAL_WORK_ID}/carousel"

curl -s "$work" \
  | jq '.globals.palette = "noir"
        | .globals.headlineFont = "serif"
        | .updatedAt = (now | todateiso8601)' \
  > /tmp/carousel.restyled.json

curl -s -X PUT "$work" \
  -H 'Content-Type: application/json' \
  --data @/tmp/carousel.restyled.json \
  | jq '.ok // .error'
```

The PUT re-validates the **whole** carousel against `CarouselSchema`; on any
violation it 400s and disk is left untouched (same invariant as the CLI).

**Lever B — per-layer tweaks → `autoviral carousel set-layer`.** When you want to
restyle the text layers consistently (color, size, weight, alignment) and you
already know each slide's id and the layer's id, `set-layer` with the existing
`--id` is an **idempotent replace** — safe to loop:

```bash
work="http://127.0.0.1:${AUTOVIRAL_PORT}/api/works/${AUTOVIRAL_WORK_ID}/carousel"
autoviral progress start "Restyling headlines" --steps "$(curl -s "$work" | jq '.slides | length')"

i=0
# Walk every text layer (slideId, layerId, text) and re-emit it with new style.
curl -s "$work" | jq -r '
  .slides[] as $s
  | $s.layers[]
  | select(.kind == "text")
  | "\($s.id)\t\(.id)\t\(.text)"' \
| while IFS=$'\t' read -r slide_id layer_id text; do
    i=$((i+1))
    autoviral carousel set-layer "$slide_id" \
      --id "$layer_id" --kind text --text "$text" \
      --font serif --color '#f5f5f5' --weight 600 --align left
    autoviral progress step $i
  done

autoviral progress done
autoviral toast "Restyled every headline" --kind success
```

Because `set-layer --id <existing>` replaces in place, re-running the loop is
safe and produces the same result.

## 3. Gate the destructive version

A whole-carousel PUT or a multi-slide loop changes everything the user can see.
Confirm first — exactly like the video recipes gate a batch render:

```bash
if autoviral ask "Restyle all $(curl -s "$work" | jq '.slides | length') slides to noir + serif?" --yes-no; then
  # ... run lever A or B ...
fi
```

## 4. Verify in the Studio (the only proof that counts)

```bash
autoviral select slide s_lx9_2      # jump the editor to a slide
autoviral toast "Restyled — check the canvas" --kind info
```

Watch the carousel canvas re-render with the new palette/font. If the canvas
didn't change, the PUT 400'd (read the `.error`) or a `set-layer` exited 4 — the
schema rejected your shape. Fix the field it names and re-run; disk was never
left half-written.

## Template note (for new content types)

This file is the **carousel template** for `recipes/carousel/`. When AutoViral
grows another content type, mirror this structure under `recipes/<type>/`:
read state → pick the right write lever (CLI verb vs full-PUT) → gate destructive
loops with `autoviral ask` → verify in the Studio, never on disk.
