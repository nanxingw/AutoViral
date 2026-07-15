# Recipe: generate a cover / poster (中文 title prompt pattern)

The image endpoint renders **native 中文 titles well** — verified: a single call produced
a poster with a large, correct, 大气 Chinese title + subtitle + logo, no garbling. So you
don't need a separate text-compositing pass for a cover; describe the whole layout in the
prompt and let the model render it.

This is a mechanics recipe (how to drive the image endpoint + self-check the result). The
*copy* — what the title says, the brand voice, the palette — is the taste job (a sibling
skill), so the prompt below leaves style/colour as `<…>` placeholders.

## The prompt pattern

Describe the poster as a **layout**, not just a subject: theme/background → title text →
subtitle → logo/watermark → style. State the exact 中文 title string in quotes so the model
renders it verbatim.

```bash
# POST /api/generate/image — canvas aspect is followed by default (omit
# aspectRatio). It best-effort registers the result as an AssetEntry (+ a
# `generate` provenance edge) and returns { relativeUri, assetId }; the PNG lands
# under the work's assets/images/. It does NOT link the asset to a storyboard
# scene — for a scene-bound shot use `autoviral scene generate` (registers AND
# links atomically).
curl -s "http://localhost:$AUTOVIRAL_PORT/api/generate/image" \
  -H 'content-type: application/json' \
  -d '{
        "workId": "'"$AUTOVIRAL_WORK_ID"'",
        "filename": "cover.png",
        "prompt": "竖版短视频封面海报，9:16。<背景描述>。\n主标题居中偏上：「一分钟看懂内存条」，超大号粗体中文，<主标题颜色>。\n副标题在主标题下方：「AI 硬件科普 · 第 3 期」，中号中文，<副标题颜色>。\n右下角小字 logo：AutoViral。\n<整体风格一句>。"
      }'
# → { relativeUri: "assets/images/cover.png", assetId, ... } — the asset is
#   registered and an asset-added event refreshes the Studio library live.
```

Prompt-writing rules (pure mechanics — the title copy + which palette/style to pick
are the taste job, deferred to a sibling skill):

- **Quote the exact title** (「…」 or "…") — the model renders the quoted string literally.
- **Say the position** ("居中偏上", "右下角") so the title, subtitle, and logo don't collide.
- **State the style once** at the end (a single `<风格>` clause) rather than sprinkling it —
  *which* style is a taste call, not a mechanic.
- Omit `aspectRatio` to follow the work's canvas (e.g. a 9:16 short → a vertical poster);
  pass it explicitly only to override. Field table:
  `autoviral docs _shared/03-cli-reference` ("POST /api/generate/image").

## Self-check the render (don't assume it's right)

The raw image endpoint returns a path, not a guarantee. Before you call the cover done,
**look at the pixels** — read the produced PNG, or if the cover is a rendered frame of the
composition, snapshot the exact frame:

```bash
autoviral render snapshot --frame 0                  # frame 0 → output/snapshot-frame-0.png
autoviral render snapshot --frame 0 --out cover.png  # name it (bare filename, lands in output/)
```

Then `Read` the PNG and verify the 中文 title is correct and un-garbled, the subtitle/logo
don't overlap, and the layout matches the brief (invariant #6 — verify what's visible,
never trust the backend artifact blind). Regenerate with a tightened prompt if the title
wraps oddly or a character is wrong.

## Use it as a work cover

The generated cover is registered in the asset library (`assets/images/`); to also use
it as the *first frame* of the video, drop it on the timeline as an **overlay clip** (a
static image maps to an `overlay` clip — there is no `image` clip/track kind), or pass its
workspace-relative path as `firstFrame` to `POST /api/generate/video` to anchor an i2v
open (stylized/object anchors only — Seedance rejects photo-real human faces).
