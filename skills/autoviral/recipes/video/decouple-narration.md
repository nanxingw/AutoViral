# Recipe: decouple narration from picture (one locked-voice VO track)

**Never rely on a video model's embedded voice for a multi-shot narration.** When
you let an i2v model speak the line inside each clip, the timbre drifts shot-to-shot
and the voice drops out between cuts — the narration stops sounding like one person.
The operational fix is to keep **voice and picture on separate tracks**: synthesize
**one continuous TTS voiceover with a single locked `voice` id**, generate the picture
**silent**, and lay the VO on its own audio lane over the whole timeline.

This is a mechanics recipe. *What* the narration says (script, hook, pacing) is the
taste/editorial job; this covers only how to wire the workstation so the voice stays
coherent.

## 1 — Synthesize ONE voiceover, ONE voice id

Write the whole narration as a single block of text and synthesize it in **one** call
so the timbre is identical end to end. Use the library-registering TTS endpoint so the
clip lands in the Studio asset library automatically:

```bash
# POST /api/works/:id/tts — one call, one locked voice, the full narration.
# Capture the whole response: you need BOTH the file uri AND its real length.
RESP=$(curl -s "http://localhost:$AUTOVIRAL_PORT/api/works/$AUTOVIRAL_WORK_ID/tts" \
  -H 'content-type: application/json' \
  -d '{
        "text": "第一句旁白。第二句旁白。第三句旁白，一气呵成。",
        "voice": "zh-CN-XiaoxiaoNeural",
        "language": "zh-CN"
      }')
# → { relativeUri: "assets/audio/tts_<hash>.mp3", providerId, durationSec, voice }
```

- Keep **`voice` identical** for every call in a piece. If you must split the narration
  (e.g. to regenerate one line), reuse the exact same `voice` id — a different id is a
  different speaker.
- `voice` examples: Chinese `zh-CN-XiaoxiaoNeural`, English `en-US-AriaNeural` (edge-tts
  ids). `provider` defaults to `auto` (Gemini-via-OpenRouter primary, edge-tts fallback);
  pin `"provider": "edge-tts"` if you need the zero-key deterministic voice.
- Full field table: the "Text-to-speech (TTS)" section of
  `autoviral docs _shared/03-cli-reference`.

Add the returned file to its own audio lane — **pass the response's `durationSec`
as `--duration`**. A bare `clip add` with neither `--duration` nor `--out` falls
back to the bridge's `in + 5` default and **silently truncates a long narration
to a 5-second clip** (the voice cuts off mid-sentence):

```bash
VO_SRC=$(echo "$RESP" | jq -r .relativeUri)     # assets/audio/tts_<hash>.mp3
VO_DUR=$(echo "$RESP" | jq -r .durationSec)      # full narration length, seconds

TID=$(autoviral track add --kind audio --label "VO")
# --duration is the CLIP length; the bridge computes out = in + duration. Omit
# it and the whole VO collapses to the 5s in+5 fallback.
autoviral clip add --src "$VO_SRC" --track audio --track-id "$TID" --offset 0 --duration "$VO_DUR"
```

## 2 — Generate the picture SILENT

Prompt the video shots for **picture only** — do not ask the model to speak the line.
Seedance i2v/t2v shots generated without a spoken-line prompt come back mute, which is
exactly what you want under a separate VO track.

If a source clip *does* carry embedded audio you don't want (a model that voiced the
line anyway, or stock footage with its own sound), split it off with the S5 detach verb:

```bash
# S5 — mint a same-source AudioClip on an audio lane AND mute the video clip's
# own source in one atomic step (the same op the Studio "Detach" button runs).
# Echoes the minted audio clip id.
autoviral clip detach-audio vc_s01
```

After `clip detach-audio`, the video clip's source audio is muted (`sourceAudio.enabled
= false`) and its original sound lives on a new audio clip you can delete, duck, or
volume-ride independently. To just silence the embedded source without keeping it, set
the source-audio toggle off in the Inspector, or `clip detach-audio` then
`clip remove` the minted audio clip.

## 3 — Layer + duck

With the VO on its own lane, mix it above any BGM. Duck the music under the voice at
export via the mixer's sidechain (`ducking: { trigger: "voiceover", ratio, threshold }`
in `POST /api/audio/mix`) — see the "add BGM track" recipe. The VO track stays a single
continuous clip, so the voice never re-anchors between shots.

## Why this is the default

- **Timbre stability** — one synthesis pass = one speaker for the whole piece.
- **No inter-shot dropout** — the voice is continuous over the cuts, not restarted per clip.
- **Independent control** — you can re-time captions to the VO (see the ASR-aligned
  subtitle recipe), duck BGM under it, or swap the picture without touching the voice.

## Verify

```bash
autoviral seek 0 && autoviral play   # the VO should carry unbroken across every cut
autoviral list clips --track audio   # one continuous VO clip, not one-per-shot
```
