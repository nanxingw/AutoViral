# Carousel schema (图文)

`carousel.yaml` is the data the Studio's carousel editor renders — a multi-slide
图文 deliverable (小红书 / 图文 work type). Source of truth: `src/shared/carousel.ts`
(zod). This file is the working summary; read it before you touch a carousel.

**Do not blind-write `carousel.yaml`.** Mutate it through the CLI — the server
validates every mutation against this schema before atomically writing, so an
invalid shape is rejected (exit 4) instead of bricking the editor with a
`carousel_unreadable` 500. Use:

```bash
autoviral carousel add-slide                    # append an empty slide → prints slide id
autoviral carousel set-layer <slideId> --kind text --text "标题" ...   # add (new --id) / PATCH (existing --id, deep-merge) → prints layer id
```

When in doubt about the live shape, the Studio loads it via
`GET /api/works/:id/carousel`.

## Top-level shape

```yaml
id: car_lx9_1                 # opaque id
workId: w_20260513_1919_74d   # owning work
schemaVersion: 1              # optional; absent ⇒ 1. Stamped on fresh carousels.
width: 1080                   # canvas pixels (小红书 default 1080×1350 = 4:5)
height: 1350
globals: {...}                # palette / fonts / layout / effects — see below
slides: [...]                 # ordered, MIN 1 slide (an empty slides:[] is invalid)
updatedAt: '2026-06-03T...'   # ISO timestamp, bumped on every mutation
```

`width` / `height` must be positive integers. `slides` must have **at least one**
slide — that's a hard zod constraint, so you can never delete the last slide.

## `globals`

Carousel-wide style. Every field has a default, so a minimal `globals: {}` is
valid (zod fills the rest).

```yaml
globals:
  headlineFont: serif         # serif | sans | mono            (default serif)
  palette: mono               # mono | pastel | neon | earth | noir   (default mono)
  layout: centered            # centered | left | split        (default centered)
  effects:
    grain: 0.03               # film-grain overlay strength    (default 0.03)
    gradient: 0.5             # vignette/gradient overlay       (default 0.5)
    sharpen: 0                # DEPRECATED — no renderer reads it; leave 0
```

`sharpen` is a dead field (#70) — kept only so old files round-trip. Don't
expose it; don't set it.

## Slides

A slide is a background plus an ordered stack of layers (painted bottom-to-top
in array order — later layers sit on top).

```yaml
slides:
  - id: s_lx9_2               # opaque id (minted by add-slide)
    bg: {...}                 # background — discriminated union, see below
    layers: [...]             # may be empty
```

### Slide background (`bg`) — discriminated union on `type`

```yaml
# gradient — any CSS gradient string
bg: { type: gradient, value: 'linear-gradient(135deg, #fafaf7 0%, #e8e6df 100%)' }

# image — a URL/path the Studio can load (e.g. /api/works/<id>/assets/images/x.png)
bg: { type: image,    value: '/api/works/w_.../assets/images/cover.png' }

# solid — a single CSS color
bg: { type: solid,    value: '#0a0b0f' }
```

`type` must be exactly one of `gradient | image | solid`; `value` is a required
string. An unknown `type` is rejected.

## Layers — discriminated union on `kind`

Every layer carries an `id`, a `kind`, and a `box`. The four kinds:

### Shared: `box` (geometry, required on every layer)

```yaml
box:
  x: 80                       # top-left, canvas pixels
  y: 80
  w: 920                      # width / height in canvas pixels
  h: 200
  rotation: 0                 # degrees (default 0)
```

`x/y/w/h` are required numbers; `rotation` defaults to 0.

### `text` layer

```yaml
- id: t_lx9_3
  kind: text
  box: { x: 80, y: 80, w: 920, h: 200, rotation: 0 }
  text: '7 个一定要会的 Prompt 技巧'
  style:                      # all fields optional — zod fills defaults
    font: sans                # serif | sans | mono       (default sans)
    size: 48                  # px                        (default 48)
    weight: 700               # numeric font-weight       (default 700)
    italic: false             #                           (default false)
    color: '#111'             # CSS color                 (default #111)
    align: center             # left | center | right     (default center)
    tracking: 0               # letter-spacing            (default 0)
```

`text` (the string) is required. `style` and all its keys are optional.

CLI: `autoviral carousel set-layer <slideId> --kind text --text "..." [--id L] [--x N --y N --w N --h N] [--font sans] [--size 48] [--weight 700] [--italic true|false] [--color '#111'] [--align center] [--tracking 0]`

### `image` layer

```yaml
- id: t_lx9_4
  kind: image
  box: { x: 0, y: 0, w: 1080, h: 1350, rotation: 0 }
  src: '/api/works/w_.../assets/images/photo.png'   # required
  filters:                    # all optional — defaults shown
    blur: 0
    brightness: 1
    opacity: 1
```

`src` is required. CLI: `... --kind image --src <path> [--x ... --w ...]`

### `shape` layer

```yaml
- id: t_lx9_5
  kind: shape
  box: { x: 0, y: 1100, w: 1080, h: 250, rotation: 0 }
  shape: rect                 # rect | circle | line   (required)
  fill: '#0006'               #                        (default #0006)
  stroke: null                # CSS color or null      (default null)
  strokeWidth: 0              #                        (default 0)
```

`shape` (one of `rect | circle | line`) is required. CLI:
`... --kind shape --shape rect [--fill '#0006'] [--stroke '#fff'] [--stroke-width 2]`

### `sticker` layer

```yaml
- id: t_lx9_6
  kind: sticker
  box: { x: 700, y: 100, w: 200, h: 200, rotation: 12 }
  src: '/api/works/w_.../assets/images/sticker.png'   # required
```

`src` is required (no filters). CLI: `... --kind sticker --src <path>`

## Constraints (what the validator rejects)

- `slides` length **≥ 1** — you cannot end up with zero slides.
- `width` / `height` — positive integers.
- Layer `kind` — must be one of `text | image | shape | sticker`; anything else
  is rejected by the discriminated union (this is the #1 cause of a blind-write
  failure the CLI now prevents).
- `bg.type` — must be one of `gradient | image | solid`.
- `text` layers require `text`; `image` / `sticker` require `src`; `shape`
  requires `shape`.
- Every layer needs a complete `box` (`x/y/w/h` numbers).

On any violation the bridge returns HTTP 400 `{ ok:false, error, code:4 }`, the
CLI exits **4**, and `carousel.yaml` on disk is left **untouched** (atomic write
— the file is only replaced after the whole carousel re-validates).

## Layout & sizing notes

- Canvas is `width × height` (小红书 default 1080×1350, 4:5). Layer `box`
  coordinates are in those canvas pixels, origin top-left.
- Layers paint in array order — append puts a layer on top. `set-layer` with an
  existing `--id` **PATCHES in place** (deep-merge): only the fields you pass are
  changed, the rest of that layer's box / style survive. So
  `set-layer s1 --id t_x --kind text --text "new"` re-types the copy but keeps
  its position, font, size, colour, align, italic and tracking. A *new* (or
  absent) `--id` creates a fresh layer with per-kind defaults. `--kind` is NOT
  patchable on an existing layer — make a new layer instead.
- `add-slide --at N` inserts at index N (0-based); default appends at the end.
