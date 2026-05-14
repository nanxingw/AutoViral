# Recipe: turn a YouTube URL into a 中文 short video

The user pastes a YouTube link and asks something like *"reframe this as a 中文 short, focus on the punchline"* or *"用中文重新剪辑一版"*. AutoViral ships a one-shot ingest pipeline that handles the boring parts; you handle the editorial.

## What `ingest youtube` actually does

```
autoviral ingest youtube <URL> [--lang zh-CN] [--model anthropic/claude-sonnet-4.5]
```

Server-side pipeline (`src/server/bridge/ingest-youtube.ts`):

1. **yt-dlp** downloads the video to `assets/clips/source.mp4` (best mp4 + m4a, single-pass mux)
2. **ffprobe** reads the duration
3. **Whisper (`stable-ts`)** transcribes with source-language auto-detection — returns per-segment `{start, end, text}`
4. **OpenRouter chat** translates every segment in one batched call (numbered-list contract), default model `anthropic/claude-sonnet-4.5`
5. **Plan files** drop into `plan/transcript.json` (both languages) + `plan/brief.md` (human-readable summary)
6. **Composition bootstrap**: writes `composition.yaml` with the source clip on `trk_video_main`, `captionStrategy: overlay`, and a `CaptionModel` whose `groups[]` carry the translated text — the Studio renders it as live overlay captions immediately

Total wall time on a 5-minute clip is typically **3–6 minutes** (ASR dominates). Progress emits via `ui-progress` / `ui-toast` events; the Studio top strip + terminal toasts show live status. The CLI prints `<sourceClipPath>\nduration <s>s · <N> segments · <src> → <dst>` on success.

## The one-liner you call

```bash
autoviral ingest youtube "https://www.youtube.com/watch?v=XXX"
```

If you want a different target language or a faster (cheaper) translator:

```bash
autoviral ingest youtube "$URL" --lang zh-CN --model anthropic/claude-haiku-4-5
```

Exit codes follow the canonical CLI table — see `contracts/error-codes.md`.

## What you do next

After `ingest youtube` returns, your job is editorial:

```bash
# 1. See what landed
autoviral comp show --format json | jq '{duration, captionStrategy, segCount: (.captions.segments | length)}'

# 2. Scrub the start so the user can preview captions
autoviral select clip vc_source
autoviral seek 0
autoviral play

# 3. Decide which segments to keep
#    Open plan/transcript.json — it has both languages with start/end times.
#    For a 90-second 抖音 short you usually keep 8–12 segments out of 40+.

# 4. Trim the source clip to the desired window OR add multiple cuts.
#    Note: vc_source spans the whole video right now.
autoviral clip set vc_source --in 12.4 --out 23.7  # keep 12.4s → 23.7s
#    Then either ask the user where else to cut or use composition.yaml
#    to add additional clip slices.
```

**Don't** add new clip slices via `clip add --src assets/clips/source.mp4 --in X --out Y` until you've removed the existing `vc_source` — multiple overlapping references to the same source file work but make the timeline harder to read.

## Trim + caption sync

When you trim `vc_source` to `[12.4, 23.7]`, the caption overlay must also be re-anchored. The `CaptionModel` segments are stored in **source time** (the original Whisper timestamps), so they still align correctly as long as you DON'T change `trackOffset`. If you move the trimmed clip to start at `trackOffset: 0`, you also need to subtract 12.4 from every caption segment's `start` and `end`.

Easiest workflow: keep `trackOffset: 0` and use `in / out` to slice — captions stay aligned automatically.

If the user wants to **cut multiple non-contiguous segments together**, you'll need to manually re-time the captions. For now, surface this as a limitation and ask the user how aggressive the cut should be — the Studio caption editor (Phase 5+) will handle this UX better than the CLI does.

## Picking cuts for 抖音/小红书 short-form

The translated transcript in `plan/brief.md` is your editorial canvas. Typical short-form pattern:

- **Hook (0–3s)** — the most surprising or pointed line; lift it out of context if needed
- **Setup (3–15s)** — minimal background so the punch lands
- **Payoff (15–45s)** — the substantive arc
- **CTA / outro (45–60s)** — optional; sometimes silence and a beat work

Target **45–60 seconds** for 抖音 native pacing; **30–90 seconds** for 小红书 mid-form. Anything longer than 60s on 抖音 should justify itself with information density.

## Cost notes

- yt-dlp: free (your bandwidth + storage)
- Whisper (`base` model, local): ~0 cost; runs CPU-only on Mac, ~1× duration
- OpenRouter `claude-sonnet-4.5` translation: typically <$0.05 for a 5-min transcript (~3000 tokens in + ~3000 out)
- If you want cheaper, pass `--model anthropic/claude-haiku-4-5` (~10× cheaper, slightly less natural)

## Gotchas

- **YouTube blocks downloads** when fingerprinting suspects a bot. If yt-dlp fails with `Sign in to confirm`, the CLI surfaces the upstream error verbatim; tell the user they may need `yt-dlp --cookies-from-browser` and re-run from their shell.
- **stable-ts not installed** → step `transcribe` fails with `PYTHON_DEP_MISSING`. The error message includes the exact `pip install stable-ts` command (NOT `stable-whisper` — that package doesn't exist on PyPI).
- **Long videos (>30 min)** can exceed Whisper's `base` model memory comfort on consumer hardware. Pre-trim with `yt-dlp --download-sections` before passing the URL.
- **OPENROUTER_API_KEY missing** → translation step returns segments with empty `translation` strings (not a hard fail). Source transcript still lands; warn the user that translation needs a key in Settings.

## Idempotence

Re-running `ingest youtube <URL>` on the same work overwrites:

- `assets/clips/source.mp4` (the download)
- `plan/transcript.json` + `plan/brief.md`
- the `vc_source` clip and `captions` field in `composition.yaml`

It does **not** clobber other clips the user has added — only the source-of-truth clip and the caption overlay. Safe to re-run after the user tweaks the source URL or switches target language.
