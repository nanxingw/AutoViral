# AI Music Generation for AutoViral - Research Report

**Date**: 2026-03-25
**Purpose**: Evaluate AI music generation options for short video BGM (10-60s) targeting Douyin/Xiaohongshu

---

## 1. Commercial API Services

### 1.1 Suno AI

| Attribute | Details |
|-----------|---------|
| **Quality** | Industry-leading vocal + instrumental, best overall quality |
| **Official API** | NO public API as of March 2026 |
| **Access** | Third-party wrappers only (sunoapi.org, PiAPI, apiframe.ai, AIMLAPI) |
| **Third-party pricing** | ~$0.05-0.15 per song |
| **Duration** | Up to ~4 min per generation |
| **Commercial use** | Pro/Premier plans allow commercial use |
| **Latency** | ~30-120s per generation |
| **Risk** | Third-party APIs are unofficial reverse-engineered wrappers; could break at any time. Legal gray area. |
| **Languages** | Good multilingual including Chinese |
| **Verdict** | Best quality but no official API = high integration risk |

### 1.2 Udio

| Attribute | Details |
|-----------|---------|
| **Quality** | Comparable to Suno, strong instrumentals |
| **Official API** | Limited Developer Portal (Pro/Enterprise only, launched 2025) |
| **Status** | Downloads disabled since Oct 2025 (critical issue) |
| **Third-party pricing** | Similar to Suno third-party wrappers |
| **Risk** | Platform instability (download issues), limited official support |
| **Verdict** | Avoid due to platform instability and download issues |

### 1.3 ElevenLabs Music (Eleven Music)

| Attribute | Details |
|-----------|---------|
| **Quality** | High quality, trained on licensed data |
| **Official API** | YES - available for paid subscribers |
| **Duration** | 3 seconds to 5 minutes |
| **Commercial use** | Full commercial clearance (trained on licensed data) |
| **Output** | MP3 (44.1kHz, 128-192kbps) and WAV |
| **Features** | Text prompt, instrumental/vocal, genre/style control |
| **Pricing** | Per-generation billing (exact pricing requires account) |
| **Verdict** | Strong option - official API, commercial-safe, good quality |

### 1.4 MiniMax Music (海螺音乐)

| Attribute | Details |
|-----------|---------|
| **Quality** | Excellent, especially for Chinese content and traditional instruments |
| **Official API** | YES - `POST https://api.minimaxi.com/v1/music_generation` |
| **Model** | `music-2.5+` (latest) |
| **Pricing** | ~$0.035 per generation |
| **Duration** | Up to 60 seconds (next version: up to 3 min) |
| **Features** | Lyrics with structure tags ([Verse], [Chorus]), instrumental mode, style prompt, streaming, audio settings (sample rate, bitrate, format) |
| **Commercial use** | Yes |
| **Languages** | Excellent Chinese (Mandarin), multilingual |
| **Chinese instruments** | Industry-leading (guzheng, pipa, flute, erhu) |
| **Verdict** | TOP RECOMMENDATION for Chinese market - official API, great Chinese support, affordable |

### 1.5 Mureka (昆仑万维)

| Attribute | Details |
|-----------|---------|
| **Quality** | Very high - Mureka O1 claims to surpass Suno V4 on multiple metrics |
| **Official API** | YES - platform.mureka.ai |
| **Pricing** | From ~$0.03 per song; paid plans from $10/month for 400 songs |
| **Commercial use** | Full commercial rights on paid API calls |
| **Features** | Song generation, model fine-tuning API, Mureka V6 + O1 models |
| **Chinese market** | Purpose-built by Chinese company (Kunlun Tech) |
| **Verdict** | Strong Chinese-market option with official API and fine-tuning |

### 1.6 Stable Audio (Stability AI)

| Attribute | Details |
|-----------|---------|
| **Quality** | Good for ambient/electronic, less strong on vocals |
| **Official API** | YES - platform.stability.ai |
| **Pricing** | Credit-based ($0.01/credit); community license free for <$1M revenue |
| **Open source** | Stable Audio Open available for self-hosting |
| **Verdict** | Good for ambient BGM, less suitable for vocal tracks |

### 1.7 SOUNDRAW / Beatoven.ai / Mubert

| Tool | Key Feature | Pricing |
|------|-------------|---------|
| **SOUNDRAW** | Trained on in-house music only, guaranteed copyright-safe | Subscription-based |
| **Beatoven.ai** | Mood-based generation, good for video BGM | Freemium |
| **Mubert** | Real-time generation, API available, mood/BPM/duration control | API available |

---

## 2. Open Source Models (Self-Hosted)

### 2.1 ACE-Step v1.5 (RECOMMENDED OPEN SOURCE)

| Attribute | Details |
|-----------|---------|
| **Parameters** | 3.5B |
| **License** | Apache 2.0 |
| **Speed** | 1 min audio in 1.74s on RTX 4090 (27 steps) |
| **VRAM** | Min 8GB with CPU offload; ~16GB comfortable |
| **Duration** | Configurable, supports long-form |
| **Languages** | 19 languages including Chinese, English, Japanese |
| **Features** | Lyrics-to-music, style tags, BPM-aware, voice cloning, LoRA fine-tuning, audio repainting |
| **Quality** | Claims to outperform most commercial alternatives |
| **Install** | `pip install -e .` then `acestep --port 7865` |
| **Verdict** | Best open-source option - fast, controllable, Chinese support, Apache 2.0 |

### 2.2 Meta MusicGen / AudioCraft

| Attribute | Details |
|-----------|---------|
| **Parameters** | 300M (small), 1.5B (medium/melody), 3.3B (large) |
| **License** | Code: MIT; Weights: CC-BY-NC 4.0 (NON-COMMERCIAL) |
| **Duration** | Up to 30s per generation (can chain) |
| **Features** | Text-to-music, melody conditioning (chromagram), tempo awareness |
| **API** | Hugging Face, Replicate ($0.032/run), local Python |
| **Variants** | MusicGen-Chord (BPM/chord control), MusiConGen (rhythm/chord control) |
| **Verdict** | Mature and well-documented, BUT non-commercial license on weights is a blocker |

### 2.3 YuE

| Attribute | Details |
|-----------|---------|
| **License** | Apache 2.0 |
| **Features** | Full-song generation (lyrics2song), multi-genre, dual-track (vocal + accompaniment) |
| **Quality** | Comparable to Suno for open-source |
| **Duration** | Several minutes |
| **Limitation** | Slower generation; heavier compute requirements |
| **Verdict** | Good for full songs, but heavier than ACE-Step for short BGM |

### 2.4 Bark (Suno Open Source)

| Attribute | Details |
|-----------|---------|
| **Type** | Text-to-audio (speech + music + sound effects) |
| **Quality** | Better for speech/sound effects than pure music |
| **Verdict** | Not recommended for music BGM specifically |

### 2.5 Riffusion

| Attribute | Details |
|-----------|---------|
| **Type** | Stable Diffusion fine-tuned on spectrograms |
| **Quality** | Decent for short loops, limited style range |
| **Verdict** | Interesting approach but surpassed by newer models |

---

## 3. Video-to-Music Generation (V2M)

This is an active research area. Key models:

| Model | Year | Output | Duration | Key Feature | Code Available |
|-------|------|--------|----------|-------------|----------------|
| **VidMuse** | 2024 | Audio | ~20s | Long-short-term visual modeling, CVPR 2025 | Yes |
| **FilmComposer** | 2025 | Audio | ~15s | Film-specific, controllable rhythm | Yes |
| **SONIQUE** | 2024 | Audio | Variable | Video-LLaMA + Stable Audio backend | Yes |
| **GVMGen** | 2025 | Audio | Variable | CLIP + MusicGen backend | Yes |
| **MTCV2M** | 2025 | Audio | Variable | Multiple time-varying conditions, ACM MM 2025 | Yes (GitHub) |
| **Diff-V2M** | 2025 | Audio | Variable | Hierarchical diffusion, explicit rhythm alignment | Paper |

**Practical Assessment**: These are research models, not production-ready. For AutoViral, a more practical approach is:
1. Analyze video content (scene, mood, pacing) with a vision model
2. Extract tempo/rhythm from video cuts
3. Generate a text prompt describing desired music
4. Feed prompt to a production music generation API

---

## 4. Recommended Architecture for AutoViral

### Primary Recommendation: Hybrid Approach

```
Video Input
    |
    v
[Video Analysis] -- LLM/Vision model extracts: mood, tempo, scene type, duration
    |
    v
[Prompt Construction] -- Build music generation prompt with style, BPM, mood, duration
    |
    v
[Music Generation API] -- Primary: MiniMax Music 2.5+ API
                          Fallback: Mureka API
                          Self-hosted: ACE-Step (if cost-sensitive)
    |
    v
[Audio Post-processing] -- Trim to exact duration, fade in/out, normalize volume
    |
    v
[Merge with Video]
```

### Why MiniMax as Primary:

1. **Official API** with clear documentation and stable endpoint
2. **Best Chinese content support** - critical for Douyin/Xiaohongshu
3. **Affordable** at $0.035/generation
4. **60-second max** fits short video format perfectly
5. **Instrumental mode** for BGM without vocals
6. **Chinese traditional instruments** support (guzheng, pipa, erhu)
7. **Structure tags** for precise control ([Verse], [Chorus], etc.)

### Why Mureka as Fallback:

1. **Chinese company** - aligned with target market
2. **Fine-tuning API** - can train custom styles
3. **Very affordable** at $0.03/song
4. **Full commercial rights**

### Why ACE-Step for Self-Hosted:

1. **Apache 2.0** - full commercial use
2. **Fast** - 1.74s for 1 min on RTX 4090
3. **8GB VRAM minimum** - runs on consumer GPUs
4. **19 languages** including Chinese
5. **No per-generation cost** after setup
6. **LoRA fine-tuning** for custom Douyin-style music

---

## 5. Cost Comparison (1000 BGM tracks/month)

| Approach | Monthly Cost | Latency | Quality | Risk |
|----------|-------------|---------|---------|------|
| MiniMax API | ~$35 | ~30s | High | Low (official API) |
| Mureka API | ~$30 | ~30s | High | Low (official API) |
| Suno (third-party) | ~$50-150 | ~60s | Highest | HIGH (unofficial) |
| ElevenLabs | ~$50-100 | ~30s | High | Low (official API) |
| ACE-Step (self-hosted, A100) | ~$150 (GPU rental) | ~2s | High | Medium (self-managed) |
| ACE-Step (own RTX 4090) | $0 marginal | ~2s | High | Low |

---

## 6. Copyright and Legal Considerations

| Service | Commercial Use | Training Data | Risk Level |
|---------|---------------|---------------|------------|
| MiniMax | Yes (paid) | Proprietary | Low |
| Mureka | Yes (paid API) | Proprietary | Low |
| ElevenLabs | Yes (licensed data) | Licensed | Very Low |
| Suno (official) | Yes (Pro/Premier) | Mixed | Medium |
| Suno (third-party API) | Unclear | Mixed | HIGH |
| ACE-Step | Apache 2.0 license | Research data | Medium |
| MusicGen | CC-BY-NC (weights) | Licensed | HIGH for commercial |
| SOUNDRAW | Yes (in-house data) | In-house only | Very Low |

---

## 7. Chinese Market-Specific Recommendations

For Douyin/Xiaohongshu content:

1. **MiniMax Music 2.5+** - Best Chinese instrument rendering, native Mandarin vocals
2. **Mureka** - Chinese company, fine-tuning capability, strong Chinese music styles
3. **ACE-Step** - Good Chinese support in open-source, can fine-tune with LoRA on Chinese music styles
4. **海绵音乐 (Haimian Music by ByteDance)** - ByteDance's own tool, directly integrated with Douyin ecosystem but no public API for external developers

### Douyin-Specific Considerations:
- Douyin has a built-in music library with trending tracks
- AI-generated BGM should match trending Douyin music styles (Chinese pop, electronic, guofeng/国风)
- 15-60 second duration is the sweet spot
- BPM typically 100-130 for most viral content
- Consider generating music in "国风" (Chinese traditional fusion) style which is very popular

---

## 8. Implementation Priority

### Phase 1 (MVP):
- Integrate **MiniMax Music 2.5+ API** for BGM generation
- Use LLM to analyze video content and generate music prompts
- Support instrumental mode for clean BGM

### Phase 2 (Enhancement):
- Add **Mureka API** as fallback/alternative
- Implement video rhythm analysis (cut detection -> BPM estimation)
- Add style presets for common Douyin content types

### Phase 3 (Advanced):
- Self-host **ACE-Step** for cost reduction at scale
- Fine-tune with LoRA on popular Douyin music styles
- Implement V2M pipeline using VidMuse or similar for rhythm-aware generation
