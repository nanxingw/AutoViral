# Recipe: generate a cover / poster (中文 title prompt pattern)

The image endpoint renders **native 中文 titles well** — verified: a single call produced
a poster with a large, correct, 大气 Chinese title + subtitle + logo, no garbling. So you
don't need a separate text-compositing pass for a cover; describe the whole layout in the
prompt and let the model render it.

This is a mechanics recipe (how to drive the image endpoint + self-check the result). The
*copy* — what the title says, the brand voice — is the taste/editorial job.

## The prompt pattern

Describe the poster as a **layout**, not just a subject: theme/background → title text →
subtitle → logo/watermark → style. State the exact 中文 title string in quotes so the model
renders it verbatim.

```bash
# POST /api/generate/image — canvas aspect is followed by default (omit
# aspectRatio); it does NOT auto-register an AssetEntry, so this is for a cover
# file, not a storyboard shot (use `autoviral scene generate` for those).
curl -s "http://localhost:$AUTOVIRAL_PORT/api/generate/image" \
  -H 'content-type: application/json' \
  -d '{
        "workId": "'"$AUTOVIRAL_WORK_ID"'",
        "filename": "cover.png",
        "prompt": "竖版短视频封面海报，9:16。深色高级质感背景，微噪点。\n主标题居中偏上：「一分钟看懂内存条」，超大号粗体中文，白色，排版果断。\n副标题在主标题下方：「AI 硬件科普 · 第 3 期」，中号中文，冷钢蓝色。\n右下角小字 logo：AutoViral。\n整体 editorial、克制、现代，避免高饱和堆叠。"
      }'
# → writes output under the work; response carries the relative path.
```

Prompt-writing rules that keep the title clean:

- **Quote the exact title** (「…」 or "…") — the model renders the quoted string literally.
- **Say the position** ("居中偏上", "右下角") so the title, subtitle, and logo don't collide.
- **Keep the title short** — a 6–12 character 中文 title renders crisper than a long sentence.
- **State the style once** at the end (editorial / 高级 / 克制) rather than sprinkling it.
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

A cover PNG under `output/` is a deliverable; to also use it as the *first frame* of the
video, add it as a short `video`/`image` clip at `trackOffset: 0`, or pass its
workspace-relative path as `firstFrame` to `POST /api/generate/video` to anchor an i2v
open (stylized/object anchors only — Seedance rejects photo-real human faces).
