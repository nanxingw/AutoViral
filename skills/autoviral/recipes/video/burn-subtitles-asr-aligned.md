# Recipe: ASR-aligned subtitles (right timing, ground-truth text)

ASR (stable-whisper) on a clean TTS voiceover gives you **accurate timestamps but wrong
text** — it mis-hears domain terms ("内存条" → "那村调", "AI" → "黑爱", "DRAM"/"HBM"
garbled). The fix is not to correct the transcript by hand: **keep the ASR word timings,
substitute the known script text**, split CJK into short lines, and render. AutoViral
does all of this in one verb.

This is the focused "I have the script, give me clean captions" recipe. For the full
CaptionModel shape, styling knobs, and the manual Whisper path, see
`add-subtitle-overlay.md`.

## Fastest path — `captions generate --script`

If you have the **ground-truth script** (the exact lines that were spoken — usually the
same text you fed the TTS in the *decouple-narration* recipe), align it to the audio and
get a CaptionModel in one shot:

```bash
# S9 — ASR for word-level TIMING, coarse-align (LCS) the ground-truth text onto
# those anchors, split CJK into ≤14-char lines, write captions + captionStrategy:
# overlay into the composition. Studio refreshes automatically.
autoviral captions generate --script plan/narration.txt --max-cjk-chars 14
```

- `--script <file>` — a path to the truth text (a bare `--script` with no path exits 4;
  it never silently degrades to the mis-heard ASR text).
- `--max-cjk-chars <N>` — per-line CJK cap (default **14**, a good width for 抖音/vertical).
  Lines split at word/punctuation boundaries, not mid-word.
- The on-screen text is now **your exact script**, never Whisper's guess; only the *timing*
  comes from ASR. This is the difference between clean captions and captions littered with
  transcription errors.
- No script? Fall back to the raw verb (`autoviral captions generate`, no `--script`) — but
  expect the mis-heard text.

## Preview (overlay is the default)

`captions generate --script` writes `captionStrategy: "overlay"`, so captions render in the
same Remotion pass as the preview (preview = export). Just scrub:

```bash
autoviral seek 0 && autoviral play
autoviral comp show --format json | jq '{strategy: .captionStrategy, hasCaptions: (.captions != null)}'
# expected: { "strategy": "overlay", "hasCaptions": true }
```

## Baking captions into the pixels (redistribution)

**The `--script` overlay is already baked at export — no extra step.** A
`captionStrategy: "overlay"` CaptionModel renders through `<CaptionsLayer>` in the
same Remotion pass as the preview (**preview = export**), so a plain `autoviral
export` (or `render enqueue`) writes an mp4 with the captions composited into the
pixels. You do **not** need `--caption-tracks` for this flow, and you do **not**
need the retired libass path (`src/domain/audio-tools.ts::burnSubtitles` throws
now). Just export.

`--caption-tracks` is a **different** mechanism — it resolves real **text tracks**,
not the overlay CaptionModel this recipe writes. Reach for it only when you have one
or more text **lanes** tagged by language (e.g. from `autoviral captions generate`
**without** `--script`, which writes TextClips into a text track, or a
manually-added text lane) and want the first language burned in with the rest
emitted as sidecar `.srt` files:

```bash
# export resolves each token against a text lane's `language` tag: the FIRST
# language's text track is composited into the video by Remotion (same renderer as
# preview), any further languages ride along as sidecar .srt files. A language with
# no matching text track is a hard 400 — tag a text lane with that language first.
autoviral export --caption-tracks zh          # burn the zh text lane
autoviral export --caption-tracks zh,en       # zh burned in, en as a sidecar .srt
```

`render enqueue --caption-tracks <trackId>[,...]` does the same on the async queue,
but resolves by **track id** (not language): the first track id is burned, the rest
become sidecar `.srt`s — see the render-queue section of
`autoviral docs _shared/03-cli-reference`.

## Managed-ffmpeg gotcha (read before you burn)

Every burn/encode step shells out to a **workstation-resolved** ffmpeg, not whatever
`ffmpeg` is on `PATH`. The host's Homebrew ffmpeg may lack **libass** (no `subtitles`
filter) / **libfreetype** (no `drawtext`); the vendored/managed binaries have them.
Resolution walks a fixed precedence — `FFMPEG_PATH` env → managed `~/.autoviral/bin` →
vendored `ffmpeg-static` → bare `PATH` — and takes the first that exists. If a burn dies
with a missing-filter/binary error, run `autoviral setup` (INSTALLS the managed binaries)
then `autoviral doctor` (VERIFIES which tier resolved). Full gotcha:
`add-subtitle-overlay.md` and `05-conventions`. Never hard-code a system ffmpeg path.
