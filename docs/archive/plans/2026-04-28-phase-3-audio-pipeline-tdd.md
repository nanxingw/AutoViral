# Phase 3 — Audio Pipeline Unification — TDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify AutoViral's audio rendering so the UI export button produces an MP4 with **identical** audio fidelity as the agent path (faded clips, ducked BGM under voiceover, LUFS-normalised, optional hard-burn subtitles), and add the missing TTS provider layer that Phase 2's GenerationDialog already depends on but was never implemented.

**Architecture:** Server-side `runRenderPipeline` orchestrator chains Remotion render → ffmpeg post-process passes (mixAudioTracks for ducking → loudnorm two-pass → optional hard-burn subtitles → final mux). Adds `normalizeLufs` and `burnSubtitles` as TS functions in `audio-tools.ts` (no new Python wrappers — TS matches existing module patterns). TTS layer lands as `src/tts-providers/` with edge-tts as MVP fallback; ElevenLabs and 火山 are scaffolded but their fal-back implementations defer to Phase 3.x. Skill doc `audio-pipeline.md` documents the platform LUFS targets and reconciles with the existing `audio-mixing.md`.

**Tech Stack:** TypeScript (Hono backend, Vitest), ffmpeg ≥ 8.x with `loudnorm` and `sidechaincompress`, Python 3.10+ (`edge-tts` for the MVP TTS path), existing `subtitle_burn.py` (881-line moviepy + Pillow renderer), Remotion 4 (preserved as the canvas → MP4 first pass; post-process happens via ffmpeg).

---

## 0. Audit-Driven Pre-Plan Decisions

Phase 3 plan-writing was preceded by a 830-line baseline audit (`docs/superpowers/plans/2026-04-28-phase-3-audio-baseline-audit.md`) that surfaced 5 plan-vs-reality mismatches. Each is resolved by an explicit decision baked into this plan:

| # | Audit finding | Decision |
|---|---|---|
| **D1** | `subtitle_burn.py` parser expects flat `[{start,end,text}]` JSON, not the segment-nested shape `caption_generate.py` emits. | Phase 3.B's `compositionTextTrackToJson` adapter emits **flat-list** JSON. Burned subs lose word-level karaoke timing — Phase 3 ships segment-level only; karaoke burn deferred. |
| **D2** | TextClip animations (`kinetic-pop`/`typewriter`/`slide-up`/`fade`) have no analog in `subtitle_burn.py`'s 5 hard-coded styles. | When `burnSubtitles=true`, animations are **frozen to static end-state** (no animation in burned MP4). Soft-sub (Remotion canvas via `TextTrackRenderer.tsx`) preserves animations for in-app preview. Documented in Phase 3.G's audio-pipeline.md. |
| **D3** | `mixAudioTracks` looks up ducking trigger by `track.type` (string enum), but `AudioClipSchema` has no `type` field. Three options: (a) heuristic from track id; (b) extend schema with `type` enum; (c) rewrite `mixAudioTracks`. | **(b)** — extend `AudioClipSchema` with `type: z.enum(["original","bgm","voiceover","sfx"]).default("bgm")`. Matches `MixTrack.type` enum verbatim so the adapter is trivial; default `"bgm"` round-trips legacy comps. (Phase 3.0 task) |
| **D4** | Three Python deps missing in dev: `edge-tts`, `elevenlabs`, `stable-whisper`. The existing `/api/audio/captions` endpoint already 503s today. | Phase 3.0 includes a `pip install edge-tts` step (the only dep Phase 3 actually exercises in the MVP). `elevenlabs` is documented as optional; `stable-whisper` is unrelated to Phase 3 (caption flow is Phase 1's). |
| **D5** | `subtitle_burn.py:57-58` font_manager import traverses to `modules/asset-generation/` which doesn't exist (old skill name). The script silently relies on `~/.autoviral/fonts/NotoSansCJKsc-Regular.otf` being pre-installed. | Phase 3.B includes a **font-existence guard** before invoking `subtitle_burn.py`: if `~/.autoviral/fonts/NotoSansCJKsc-Regular.otf` is absent, the adapter throws a clear error pointing at `font_manager.py install`. No deferred dead-code surprise. |

**Bonus audit clarification:** Master plan §3.0 mentioned `scripts/audio/loudnorm.py` and `voice_clone.py` as candidates. Audit recommends — and this plan adopts — implementing **3.A as a TS function in `audio-tools.ts`** (matches existing module patterns; no Python wrapper needed). The Python wrappers are explicitly NOT created.

---

## 1. File Structure

```
src/
├── audio-tools.ts                                ← extend: normalizeLufs, burnSubtitles, compositionToMixTracks adapter
├── audio-tools.test.ts                           ← extend: tests for normalizeLufs + burnSubtitles + adapter
├── server/
│   ├── render-pipeline.ts                        ← NEW — orchestrates Remotion → ffmpeg post-process
│   ├── render-pipeline.test.ts                   ← NEW — unit tests for the pipeline (mocked ffmpeg)
│   ├── api.ts                                    ← extend: POST /api/works/:id/render rewire (surgery — dirty file)
│   └── tts-providers/                            ← NEW dir
│       ├── types.ts                              ← TtsRequest / TtsResult / TtsProvider interfaces
│       ├── edge-tts.ts                           ← Microsoft Edge TTS implementation (MVP)
│       ├── elevenlabs.ts                         ← stub for Phase 3.x
│       ├── volcano-tts.ts                        ← stub for Phase 3.x
│       ├── registry.ts                           ← provider matrix + fallback chain
│       └── __tests__/
│           └── edge-tts.test.ts                  ← MVP test against edge-tts CLI

src/shared/
└── composition.ts                                ← extend AudioClipSchema with type enum

skills/autoviral/modules/assets/scripts/
└── tts_generate.py                               ← NEW — CLI wrapping POST /api/audio/tts (lock-step with dispatchGeneration.test.ts)

skills/autoviral/modules/assets/scripts/__tests__/
└── test_tts_generate.py                          ← NEW — pure-helper tests (build_args, parse_response)

skills/autoviral/modules/assembly/capabilities/
├── audio-pipeline.md                             ← NEW — end-to-end flow + LUFS table + animation-loss policy
└── audio-mixing.md                               ← reconcile with current api.ts contract (camelCase fields)

tests/fixtures/
├── quiet-tone.wav                                ← NEW — known-quiet WAV for normalizeLufs test (-30 LUFS source)
└── sample-segments.json                          ← NEW — flat-list TextTrack JSON for burnSubtitles test
```

---

## 2. Phase 3 Roadmap

Per audit §12.1 dependency graph:

```
Task 3.0 (prereqs) ──┬──► Task 3.A normalizeLufs ──┐
                     ├──► Task 3.B burnSubtitles ──┼──► Task 3.C runRenderPipeline ──► Task 3.D POST /render rewire
                     │                             │                                        │
                     ├──► Task 3.E TTS provider ──► Task 3.F tts_generate.py                └─► Task 3.G audio-pipeline.md
                     │     (edge-tts MVP)
```

8 tasks total (3.0 + 3.A through 3.G). Tasks 3.A, 3.B, 3.E are **leaves** — independently dispatchable after 3.0 lands. 3.C blocks on 3.A+3.B. 3.D blocks on 3.C. 3.F blocks on 3.E. 3.G can be drafted any time after 3.A/B/C contracts lock.

---

## Task 3.0 — Pre-flight: install Python deps + extend `AudioClipSchema` with `type` enum

**Why this comes first:** D3 (AudioClip.type) blocks Tasks 3.B and 3.C; D4 (edge-tts dep) blocks Tasks 3.E/3.F. Both are tiny but order-dependent.

**Files:**
- Modify: `src/shared/composition.ts` — extend `AudioClipSchema`
- Modify: `web/src/features/studio/__tests__/types.test.ts` — add a test asserting the new field defaults to `"bgm"` and rejects unknown values
- Create: nothing (deps install is a shell command, not a tracked file)

- [ ] **Step 1: Run `pip install edge-tts` (and verify it works)**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
pip install edge-tts
python3 -c "import edge_tts; print(edge_tts.__version__)"
```

Expected: a version string (e.g. `7.0.x` or whatever's current). If pip is not available, install via `pipx install edge-tts` and ensure the `edge-tts` CLI is in `PATH`.

- [ ] **Step 2: Write the failing test** for `AudioClipSchema.type`

Append to `web/src/features/studio/__tests__/types.test.ts`:

```ts
import { AudioClipSchema } from "../types";

describe("AudioClipSchema (Phase 3 type extension)", () => {
  it("defaults type to 'bgm' when omitted", () => {
    const r = AudioClipSchema.parse({
      id: "audio-1",
      kind: "audio",
      src: "/x.mp3",
      in: 0,
      out: 4,
      trackOffset: 0,
    });
    expect(r.type).toBe("bgm");
  });

  it("accepts the four valid types", () => {
    for (const t of ["original", "bgm", "voiceover", "sfx"] as const) {
      const r = AudioClipSchema.parse({
        id: "a",
        kind: "audio",
        src: "/x.mp3",
        in: 0,
        out: 4,
        trackOffset: 0,
        type: t,
      });
      expect(r.type).toBe(t);
    }
  });

  it("rejects unknown type values", () => {
    expect(() =>
      AudioClipSchema.parse({
        id: "a",
        kind: "audio",
        src: "/x.mp3",
        in: 0,
        out: 4,
        trackOffset: 0,
        type: "noise",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify failure**

Run: `cd /Users/nanjiayan/Desktop/AutoViral/autoviral && npx vitest --config web/vitest.config.ts run web/src/features/studio/__tests__/types.test.ts`
Expected: 3 new failing tests (`AudioClipSchema.type` does not exist; defaults missing; rejection paths return wrong shape).

- [ ] **Step 4: Extend `AudioClipSchema`** in `src/shared/composition.ts`

Locate the existing `AudioClipSchema` definition. Add the new `type` field after `ducking`:

```ts
export const AudioClipSchema = z.object({
  id: z.string(),
  kind: z.literal("audio"),
  src: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  trackOffset: z.number().min(0),
  volume: z.number().min(0).max(1.5).default(1),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
  ducking: z
    .object({ ratio: z.number(), attack: z.number(), release: z.number() })
    .optional(),
  // ─── Phase 3.0 — type discriminator for mixAudioTracks ducking trigger lookup ───
  // "bgm" default keeps legacy comps round-trippable; "voiceover" / "sfx" /
  // "original" are explicit opt-ins that the GenerationDialog and Phase 5
  // VariantSwitcher will set when creating new clips.
  type: z.enum(["original", "bgm", "voiceover", "sfx"]).default("bgm"),
});
```

- [ ] **Step 5: Run the tests** — should now pass

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/__tests__/types.test.ts 2>&1 | tail -8
```

Expected: all tests pass (the original 11 + 3 new = 14 tests).

- [ ] **Step 6: Backend tsc clean** (verify the schema change doesn't break server-side imports)

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/composition.ts web/src/features/studio/__tests__/types.test.ts
git commit -m "$(cat <<'EOF'
feat(types): add AudioClip.type discriminator (Phase 3.0 prereq)

Extends AudioClipSchema with type: "original"|"bgm"|"voiceover"|"sfx"
default "bgm". This matches mixAudioTracks' MixTrack.type enum verbatim
so the Phase 3.C composition→MixTracks adapter is trivial. Default
"bgm" keeps legacy compositions round-trippable.

Audit reference: docs/superpowers/plans/2026-04-28-phase-3-audio-baseline-audit.md §11.5

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Verify edge-tts is callable** (smoke test the dep install — no test file)

```bash
echo "你好世界" | python3 -c '
import asyncio
import edge_tts

async def main():
    c = edge_tts.Communicate("Hello world", "zh-CN-XiaoxiaoNeural")
    audio = b""
    async for chunk in c.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    print(f"Got {len(audio)} bytes of audio")

asyncio.run(main())
'
```

Expected: `Got <N> bytes of audio` where N > 1000. If this fails, edge-tts isn't reachable from this Python — diagnose before proceeding to 3.E/3.F.

(No commit — this is a sanity check, not a code change.)

---

## Task 3.A — Implement `normalizeLufs` two-pass in `audio-tools.ts`

**Files:**
- Modify: `src/audio-tools.ts` — add `normalizeLufs` export + helpers
- Modify: `src/audio-tools.test.ts` — add tests
- Create: `tests/fixtures/quiet-tone.wav` — a known-quiet 1-second 1kHz tone WAV at ~-30 LUFS for the integration test

- [ ] **Step 1: Generate the test fixture WAV**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
mkdir -p tests/fixtures
ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -ar 48000 -ac 1 -filter:a "volume=0.05" -y tests/fixtures/quiet-tone.wav 2>&1 | tail -2

# Verify the input loudness is well below the -14 target
ffmpeg -i tests/fixtures/quiet-tone.wav -af loudnorm=I=-14:LRA=11:tp=-1.5:print_format=json -f null - 2>&1 | python3 -c '
import sys, re
err = sys.stdin.read()
m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", err)
print(m.group(0) if m else "NO MATCH")
'
```

Expected: a JSON block printed showing `"input_i" : "-3X.XX"` (some value below -25 LUFS — confirming the fixture is sufficiently quiet for the test to detect normalization).

If the volume filter produces something different on your ffmpeg version, adjust `volume=0.05` until input_i is between -35 and -25.

- [ ] **Step 2: Write the failing tests** in `src/audio-tools.test.ts`

Read the existing test file first to match its style (`head -30 src/audio-tools.test.ts`). Then append a new describe block:

```ts
import { normalizeLufs, parseLoudnormJson } from "./audio-tools";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseLoudnormJson", () => {
  it("extracts the JSON block from ffmpeg loudnorm pass-1 stderr", () => {
    const stderr = `
[Parsed_loudnorm_0 @ 0x600003fa4000] 
{
        "input_i" : "-30.45",
        "input_tp" : "-19.83",
        "input_lra" : "0.00",
        "input_thresh" : "-40.46",
        "output_i" : "-15.00",
        "output_tp" : "-1.51",
        "output_lra" : "0.00",
        "output_thresh" : "-25.07",
        "normalization_type" : "dynamic",
        "target_offset" : "-1.00"
}
size=N/A time=00:00:01.00 bitrate=N/A
`;
    const r = parseLoudnormJson(stderr);
    expect(r).not.toBeNull();
    expect(r!.input_i).toBe("-30.45");
    expect(r!.input_thresh).toBe("-40.46");
  });

  it("returns null when no loudnorm block is present", () => {
    expect(parseLoudnormJson("plain ffmpeg output without loudnorm")).toBeNull();
  });
});

describe("normalizeLufs (integration)", () => {
  it("normalizes a -30 LUFS source to within ±0.5 LU of -14 target", async () => {
    const inFile = join(process.cwd(), "tests/fixtures/quiet-tone.wav");
    const outFile = join(tmpdir(), `normalized-${Date.now()}.wav`);

    await normalizeLufs(inFile, outFile, {
      target: -14,
      truePeak: -1.5,
      lra: 11,
    });

    // Output exists and is non-empty
    const s = await stat(outFile);
    expect(s.size).toBeGreaterThan(0);

    // Re-measure: the output's integrated loudness should be near -14
    const measured = await measureLufs(outFile);
    expect(measured).toBeGreaterThan(-14.5);
    expect(measured).toBeLessThan(-13.5);
  }, 30_000); // 30s timeout — two ffmpeg passes
});
```

You'll need a `measureLufs` helper. Add a third describe block for it:

```ts
describe("measureLufs", () => {
  it("returns a number close to -3 dB for a known-loud tone", async () => {
    const inFile = join(process.cwd(), "tests/fixtures/quiet-tone.wav");
    const r = await measureLufs(inFile);
    expect(typeof r).toBe("number");
    expect(r).toBeLessThan(-20); // The fixture is intentionally quiet
  }, 15_000);
});
```

`measureLufs` will be a NEW exported helper used by the integration test. Implement it in Step 4.

- [ ] **Step 3: Run the tests to verify failure**

```bash
npx vitest run -c vitest.server.config.ts src/audio-tools.test.ts 2>&1 | tail -10
```

Expected: 4 new failing tests (`normalizeLufs`, `parseLoudnormJson`, `measureLufs`, integration).

- [ ] **Step 4: Implement `normalizeLufs` + helpers** in `src/audio-tools.ts`

Append to the existing file (after `mixAudioTracks`, before any final exports):

```ts
// ─── Phase 3.A — LUFS two-pass normalization ───────────────────────────────

export interface LoudnormOptions {
  /** Integrated-loudness target in LUFS. -14 for YouTube/TikTok/Bilibili,
   *  -16 for podcasts and 小红书/视频号. */
  target: number;
  /** True-peak ceiling in dBTP. -1.5 typical, -1.0 if downstream re-encoding
   *  is known to be lossy. */
  truePeak: number;
  /** Loudness range target. 11 is the EBU R128 default; smaller values mean
   *  more aggressive limiting. */
  lra: number;
}

export interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  output_i: string;
  output_tp: string;
  output_lra: string;
  output_thresh: string;
  normalization_type: string;
  target_offset: string;
}

/**
 * Pure helper: extract the loudnorm JSON block from ffmpeg's stderr.
 * Returns null when no loudnorm-shaped JSON block is found.
 *
 * The regex looks for a curly block containing the canonical "input_i"
 * key, which uniquely identifies a loudnorm measurement (no other ffmpeg
 * filter emits this key). Matches are non-greedy on outer braces but
 * inclusive of nested key-value content.
 */
export function parseLoudnormJson(stderr: string): LoudnormMeasurement | null {
  // Non-greedy match across newlines for the smallest brace block containing input_i
  const m = stderr.match(/\{[^{}]*?"input_i"[^{}]*?\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as LoudnormMeasurement;
  } catch {
    return null;
  }
}

/**
 * Two-pass EBU R128 loudness normalization.
 *
 * Pass 1: ffmpeg measures input_i / input_tp / input_lra / input_thresh
 *         via the loudnorm filter with `print_format=json` to stderr.
 * Pass 2: ffmpeg applies the actual normalization with the measured values
 *         pinned, ensuring the output hits the target without dynamic-range
 *         pumping.
 *
 * Single-pass loudnorm sounds noticeably worse on speech because the
 * filter has to estimate dynamics on the fly; two-pass is the only way
 * to get within ±0.5 LU consistently.
 */
export async function normalizeLufs(
  inputPath: string,
  outputPath: string,
  opts: LoudnormOptions = { target: -14, truePeak: -1.5, lra: 11 },
): Promise<void> {
  // Pass 1 — measure
  const pass1Filter =
    `loudnorm=I=${opts.target}:LRA=${opts.lra}:tp=${opts.truePeak}:print_format=json`;
  const pass1Stderr = await runCmd(
    "ffmpeg",
    ["-i", inputPath, "-af", pass1Filter, "-f", "null", "-"],
    60_000, // 60s should cover up to 5min of audio at sane fps
  );
  const measured = parseLoudnormJson(pass1Stderr);
  if (!measured) {
    throw new Error(
      `normalizeLufs pass-1 failed: no loudnorm JSON in stderr. ` +
        `First 500 chars: ${pass1Stderr.slice(0, 500)}`,
    );
  }

  // Pass 2 — apply with measured values pinned
  const pass2Filter = [
    `loudnorm=I=${opts.target}`,
    `LRA=${opts.lra}`,
    `tp=${opts.truePeak}`,
    `measured_I=${measured.input_i}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`,
    `measured_thresh=${measured.input_thresh}`,
    `linear=true`,
    `print_format=summary`,
  ].join(":");

  await runCmd(
    "ffmpeg",
    [
      "-i", inputPath,
      "-af", pass2Filter,
      "-c:a", "pcm_s16le",
      "-ar", "48000",
      "-y",
      outputPath,
    ],
    120_000, // 2-minute cap
  );
}

/**
 * Re-measure the integrated loudness of a file (for tests / verification).
 * Returns the integrated-loudness value as a number (e.g. -14.02).
 */
export async function measureLufs(filePath: string): Promise<number> {
  const stderr = await runCmd(
    "ffmpeg",
    ["-i", filePath, "-af", "loudnorm=I=-14:LRA=11:tp=-1.5:print_format=json", "-f", "null", "-"],
    60_000,
  );
  const m = parseLoudnormJson(stderr);
  if (!m) throw new Error(`measureLufs: no loudnorm block in stderr`);
  return parseFloat(m.input_i);
}
```

(`runCmd` already exists in `audio-tools.ts` — do NOT redefine.)

- [ ] **Step 5: Run the tests** — should pass

```bash
npx vitest run -c vitest.server.config.ts src/audio-tools.test.ts 2>&1 | tail -10
```

Expected: all tests pass (existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/audio-tools.ts src/audio-tools.test.ts tests/fixtures/quiet-tone.wav
git commit -m "$(cat <<'EOF'
feat(audio): normalizeLufs two-pass + parseLoudnormJson + measureLufs

Adds EBU R128 two-pass loudness normalization to audio-tools.ts. Pass 1
measures input_i/input_tp/input_lra/input_thresh via loudnorm with
print_format=json; pass 2 applies normalization with measured values
pinned for consistent ±0.5 LU accuracy. Pure parseLoudnormJson helper
extracts the JSON block from ffmpeg stderr (regex matches the unique
input_i key).

Audit reference: docs/superpowers/plans/2026-04-28-phase-3-audio-baseline-audit.md §11.7

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.B — Implement `burnSubtitles` adapter in `audio-tools.ts`

**Files:**
- Modify: `src/audio-tools.ts` — add `burnSubtitles`, `compositionTextTrackToJson`, `assertFontInstalled`
- Modify: `src/audio-tools.test.ts` — add tests
- Create: `tests/fixtures/sample-segments.json` — flat-list TextTrack JSON

- [ ] **Step 1: Create the test fixture**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
cat > tests/fixtures/sample-segments.json <<'EOF'
[
  {"start": 0.0, "end": 1.5, "text": "Hello world"},
  {"start": 1.6, "end": 3.2, "text": "你好，世界"}
]
EOF
```

- [ ] **Step 2: Write failing tests**

Append to `src/audio-tools.test.ts`:

```ts
import {
  compositionTextTrackToJson,
  assertFontInstalled,
} from "./audio-tools";
import type { Composition } from "../web/src/features/studio/types";

describe("compositionTextTrackToJson", () => {
  it("emits flat-list shape from a Composition's first text track", () => {
    const c: Composition = {
      id: "c", workId: "w", fps: 30, width: 1080, height: 1920,
      duration: 5, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
      tracks: [
        {
          id: "text-0", kind: "text", label: "Subtitles",
          muted: false, hidden: false,
          clips: [
            { id: "t1", kind: "text", text: "Line 1", trackOffset: 0, duration: 2,
              style: { font: "Inter", size: 48, weight: 700, italic: false, tracking: 0, color: "#fff" },
              position: { anchor: "bottom", xPct: 50, yPct: 85 } },
            { id: "t2", kind: "text", text: "Line 2", trackOffset: 2.5, duration: 1.8,
              style: { font: "Inter", size: 48, weight: 700, italic: false, tracking: 0, color: "#fff" },
              position: { anchor: "bottom", xPct: 50, yPct: 85 } },
          ],
        },
      ],
      assets: [], provenance: [], exportPresets: [],
    };
    const r = compositionTextTrackToJson(c);
    expect(r).toEqual([
      { start: 0, end: 2, text: "Line 1" },
      { start: 2.5, end: 4.3, text: "Line 2" },
    ]);
  });

  it("returns empty array when the comp has no text track", () => {
    const c: Composition = {
      id: "c", workId: "w", fps: 30, width: 1080, height: 1920,
      duration: 0, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
      tracks: [], assets: [], provenance: [], exportPresets: [],
    };
    expect(compositionTextTrackToJson(c)).toEqual([]);
  });
});

describe("assertFontInstalled", () => {
  it("returns the path when the font exists", async () => {
    // We use a path we know exists: the audit confirmed the font is at this path on the test machine.
    // Adjust to an actually-existing file, or use the test machine's home dir font path.
    const ok = process.env.AUTOVIRAL_TEST_FONT;
    if (!ok) return; // skip when not running with a test font available
    const r = await assertFontInstalled(ok);
    expect(r).toBe(ok);
  });

  it("throws a clear error when the font is missing", async () => {
    await expect(assertFontInstalled("/nonexistent/font.otf")).rejects.toThrow(
      /font_manager.py install/,
    );
  });
});
```

(The first `assertFontInstalled` test is conditional — only runs if `AUTOVIRAL_TEST_FONT` env var points to an existing font. This avoids assuming the dev machine has the canonical font path.)

- [ ] **Step 3: Run failing tests**

```bash
npx vitest run -c vitest.server.config.ts src/audio-tools.test.ts 2>&1 | tail -10
```

Expected: failures (functions don't exist).

- [ ] **Step 4: Implement the helpers** in `src/audio-tools.ts`

Append:

```ts
// ─── Phase 3.B — Subtitle burning adapter ─────────────────────────────────

import { homedir } from "node:os";
import { join } from "node:path";
import { stat as statAsync, writeFile, mkdtemp } from "node:fs/promises";

const DEFAULT_FONT_PATH = join(homedir(), ".autoviral", "fonts", "NotoSansCJKsc-Regular.otf");

/**
 * Pure helper: walk a Composition's tracks and emit flat-list subtitle JSON
 * matching subtitle_burn.py's parse_json_subs() expected shape:
 *   [{ start: number, end: number, text: string }, ...]
 *
 * Returns the FIRST text track's clips, sorted by trackOffset. If the comp
 * has no text track, returns an empty array. Animations and styling are
 * dropped here — the burn renders static text per Phase 3 decision D2;
 * soft-sub via TextTrackRenderer.tsx preserves animations for in-app preview.
 */
export function compositionTextTrackToJson(
  comp: { tracks: Array<{ kind: string; clips: Array<{ kind: string; text?: string; trackOffset: number; duration?: number }> }> },
): Array<{ start: number; end: number; text: string }> {
  const textTrack = comp.tracks.find((t) => t.kind === "text");
  if (!textTrack) return [];
  return textTrack.clips
    .filter((c) => c.kind === "text" && typeof c.text === "string")
    .slice()
    .sort((a, b) => a.trackOffset - b.trackOffset)
    .map((c) => ({
      start: c.trackOffset,
      end: c.trackOffset + (c.duration ?? 0),
      text: c.text!,
    }));
}

/**
 * Phase 3.B font guard. subtitle_burn.py's font_manager import is dead
 * code (audit §11.11), so the script silently relies on the canonical
 * font being pre-installed. We assert here BEFORE invoking the script so
 * the failure mode is "missing font" with a clear remediation, not a
 * cryptic moviepy traceback.
 */
export async function assertFontInstalled(
  fontPath: string = DEFAULT_FONT_PATH,
): Promise<string> {
  try {
    const s = await statAsync(fontPath);
    if (!s.isFile()) {
      throw new Error(`Font path is not a file: ${fontPath}`);
    }
    return fontPath;
  } catch (e: any) {
    throw new Error(
      `Font not installed at ${fontPath}. ` +
        `Run: python3 skills/autoviral/modules/assets/scripts/font_manager.py install ` +
        `(or set AUTOVIRAL_FONT_PATH to a TTF/OTF you have locally).`,
    );
  }
}

/**
 * Burn the composition's text track into a video by:
 *   1. Adapting comp's text-track clips to flat-list JSON
 *   2. Writing the JSON to a temp file
 *   3. Asserting the canonical font is installed
 *   4. Invoking subtitle_burn.py with the input video, JSON, output path
 *
 * Animations are lost (D2). Output codec is always libx264+aac (subtitle_burn
 * defaults).
 */
export async function burnSubtitles(opts: {
  inputVideo: string;
  comp: Parameters<typeof compositionTextTrackToJson>[0];
  outputVideo: string;
  fontPath?: string;
  style?: "modern" | "cinematic" | "bold" | "minimal" | "karaoke";
}): Promise<void> {
  const segments = compositionTextTrackToJson(opts.comp);
  if (segments.length === 0) {
    throw new Error("burnSubtitles: composition has no text-track clips to burn");
  }

  const fontPath = await assertFontInstalled(
    opts.fontPath ?? process.env.AUTOVIRAL_FONT_PATH ?? DEFAULT_FONT_PATH,
  );

  // Write segments to a temp file
  const tmpDir = await mkdtemp(join(homedir(), ".autoviral", "tmp-burnsubs-"));
  const segPath = join(tmpDir, "segments.json");
  await writeFile(segPath, JSON.stringify(segments), "utf-8");

  // Invoke subtitle_burn.py
  const scriptPath = "skills/autoviral/modules/assembly/scripts/subtitle_burn.py";
  await runCmd(
    "python3",
    [
      scriptPath,
      "--input-video", opts.inputVideo,
      "--subtitles", segPath,
      "--output", opts.outputVideo,
      "--style", opts.style ?? "modern",
      "--font", fontPath,
    ],
    300_000, // 5 minutes for subtitle burn (it's slow)
  );
}
```

- [ ] **Step 5: Verify the helper signatures match `subtitle_burn.py`'s actual CLI**

```bash
head -150 skills/autoviral/modules/assembly/scripts/subtitle_burn.py | grep -A 1 -E "argparse|add_argument" | head -40
```

Compare the flag names — if `subtitle_burn.py` uses different argument names (e.g. `--input` not `--input-video`, or `--subs` not `--subtitles`), update the runCmd call to match. **Don't change the script — change the caller.**

- [ ] **Step 6: Run the tests** — should pass

```bash
npx vitest run -c vitest.server.config.ts src/audio-tools.test.ts 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add src/audio-tools.ts src/audio-tools.test.ts tests/fixtures/sample-segments.json
git commit -m "$(cat <<'EOF'
feat(audio): burnSubtitles + compositionTextTrackToJson + assertFontInstalled

Phase 3.B subtitle-burn adapter. compositionTextTrackToJson emits
the flat-list JSON shape subtitle_burn.py's parser expects (audit
§11.1). assertFontInstalled fails fast with a clear install command
when ~/.autoviral/fonts/NotoSansCJKsc-Regular.otf is missing (audit
§11.11 — font_manager.py path import is dead code in the script).
burnSubtitles orchestrates the JSON write, font guard, and python
invocation; animations are stripped per Phase 3 decision D2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.E — Implement `edge-tts` provider (MVP)

**Files:**
- Create: `src/tts-providers/types.ts` — interfaces
- Create: `src/tts-providers/edge-tts.ts` — Microsoft Edge TTS implementation
- Create: `src/tts-providers/registry.ts` — provider matrix + fallback chain
- Create: `src/tts-providers/__tests__/edge-tts.test.ts` — pure-helper tests + smoke

ElevenLabs and Volcano TTS are deferred to Phase 3.x — this task only ships the MVP fallback. The registry has a 3-slot matrix but only edge-tts is populated.

- [ ] **Step 1: Write failing tests**

Create `src/tts-providers/__tests__/edge-tts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapExpressiveTagsToSsml, edgeTtsProvider } from "../edge-tts";
import { pickProvider } from "../registry";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";

describe("mapExpressiveTagsToSsml", () => {
  it("converts [sigh] to a 400ms break", () => {
    const r = mapExpressiveTagsToSsml("Hello [sigh] world");
    expect(r).toContain('<break time="400ms"/>');
    expect(r).toContain("Hello");
    expect(r).toContain("world");
  });

  it("converts [laughing] to a 600ms break (longer for emphasis)", () => {
    const r = mapExpressiveTagsToSsml("Funny [laughing] story");
    expect(r).toContain('<break time="600ms"/>');
  });

  it("converts [whisper]...[/whisper] to a prosody volume tag", () => {
    const r = mapExpressiveTagsToSsml("Speak [whisper]quietly[/whisper] now");
    expect(r).toMatch(/<prosody volume="x-soft">quietly<\/prosody>/);
  });

  it("preserves text without any tags unchanged", () => {
    expect(mapExpressiveTagsToSsml("plain text")).toBe("plain text");
  });

  it("escapes XML-significant chars when wrapping in SSML", () => {
    const r = mapExpressiveTagsToSsml("AT&T <html> stuff");
    expect(r).toContain("AT&amp;T");
    expect(r).toContain("&lt;html&gt;");
  });
});

describe("pickProvider", () => {
  it("picks edge-tts as the default fallback", () => {
    const p = pickProvider({ language: "zh-CN" });
    expect(p.id).toBe("edge-tts");
  });

  it("returns edge-tts for any language (only MVP provider available)", () => {
    expect(pickProvider({ language: "en-US" }).id).toBe("edge-tts");
    expect(pickProvider({ language: "ja-JP" }).id).toBe("edge-tts");
  });
});

describe("edgeTtsProvider.generate (smoke)", () => {
  // Skip if edge-tts isn't installed; this is a real-network test
  const skip = process.env.SKIP_TTS_SMOKE === "1";
  it.skipIf(skip)("produces an audio file from a 1-line prompt", async () => {
    const out = join(tmpdir(), `tts-${Date.now()}.mp3`);
    const r = await edgeTtsProvider.generate({
      text: "Hello world from AutoViral",
      voice: "en-US-AriaNeural",
      outputPath: out,
    });
    expect(r.outputPath).toBe(out);
    const s = await stat(out);
    expect(s.size).toBeGreaterThan(1000);
    expect(r.duration).toBeGreaterThan(0);
  }, 30_000);
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx vitest run -c vitest.server.config.ts src/tts-providers/__tests__/edge-tts.test.ts 2>&1 | tail -10
```

Expected: all fail (modules don't exist).

- [ ] **Step 3: Implement `types.ts`** — interfaces

```ts
// src/tts-providers/types.ts

export interface TtsRequest {
  text: string;
  voice: string;
  language?: string;
  speed?: number;
  style?: string;
  outputPath: string;
}

export interface TtsResult {
  outputPath: string;
  duration: number;
  sampleRate: number;
  channels: number;
}

export interface TtsProvider {
  id: string;
  name: string;
  supportsLanguages: string[];
  voices: Array<{ id: string; name: string; lang: string; tags: string[] }>;
  generate(req: TtsRequest): Promise<TtsResult>;
}
```

- [ ] **Step 4: Implement `edge-tts.ts`**

```ts
// src/tts-providers/edge-tts.ts

import { spawn } from "node:child_process";
import type { TtsProvider, TtsRequest, TtsResult } from "./types.js";
import { stat } from "node:fs/promises";

/**
 * Translates AutoViral's expressive tag dialect into Edge TTS SSML.
 *
 * AutoViral and pneuma share an inline-tag style ([sigh], [laughing],
 * [whisper]...[/whisper]). Edge TTS uses Microsoft SSML — we translate
 * a small core set rather than expose raw SSML to users.
 *
 * Tags translated:
 *   [sigh]               → <break time="400ms"/>
 *   [laughing]           → <break time="600ms"/>
 *   [pause]              → <break time="500ms"/>
 *   [short pause]        → <break time="200ms"/>
 *   [whisper]X[/whisper] → <prosody volume="x-soft">X</prosody>
 *
 * XML-significant characters in the surrounding text (& < >) are escaped
 * so the output is valid SSML when wrapped in a <speak>...</speak>.
 */
export function mapExpressiveTagsToSsml(text: string): string {
  // First, escape XML chars in the entire string
  let r = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Then introduce SSML tags in place of the escaped placeholders
  // (after escaping, [sigh] is still [sigh] — brackets are not XML-significant)
  r = r.replace(/\[sigh\]/gi, '<break time="400ms"/>');
  r = r.replace(/\[laughing\]/gi, '<break time="600ms"/>');
  r = r.replace(/\[short pause\]/gi, '<break time="200ms"/>');
  r = r.replace(/\[pause\]/gi, '<break time="500ms"/>');
  r = r.replace(/\[whisper\]([^[]*?)\[\/whisper\]/gi, '<prosody volume="x-soft">$1</prosody>');
  return r;
}

/** Run edge-tts CLI as a child process. Returns when the output file is written. */
async function runEdgeTtsCli(
  text: string,
  voice: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("edge-tts", ["--voice", voice, "--text", text, "--write-media", outputPath]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts CLI exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/** Get audio duration via ffprobe (the project already uses ffprobe elsewhere). */
async function ffprobeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      filePath,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err.slice(0, 200)}`));
      const v = parseFloat(out.trim());
      if (Number.isNaN(v)) return reject(new Error(`ffprobe non-numeric: ${out}`));
      resolve(v);
    });
  });
}

export const edgeTtsProvider: TtsProvider = {
  id: "edge-tts",
  name: "Microsoft Edge TTS (multilingual)",
  supportsLanguages: ["zh-CN", "zh-TW", "en-US", "en-GB", "ja-JP", "ko-KR", "es-ES", "fr-FR"],
  voices: [
    { id: "zh-CN-XiaoxiaoNeural", name: "晓晓 (Chinese, female, conversational)", lang: "zh-CN", tags: ["female", "warm"] },
    { id: "zh-CN-YunjianNeural",  name: "云健 (Chinese, male, calm)", lang: "zh-CN", tags: ["male", "calm"] },
    { id: "en-US-AriaNeural",     name: "Aria (English-US, female, neutral)", lang: "en-US", tags: ["female", "neutral"] },
    { id: "en-US-GuyNeural",      name: "Guy (English-US, male, casual)", lang: "en-US", tags: ["male", "casual"] },
  ],
  async generate(req: TtsRequest): Promise<TtsResult> {
    // edge-tts CLI accepts SSML when --text is wrapped; for simple expressive
    // tags we translate first, then pass the SSML-augmented text directly.
    const ssml = mapExpressiveTagsToSsml(req.text);
    await runEdgeTtsCli(ssml, req.voice, req.outputPath);
    const duration = await ffprobeDuration(req.outputPath);
    return {
      outputPath: req.outputPath,
      duration,
      // edge-tts default is 24kHz mono MP3
      sampleRate: 24000,
      channels: 1,
    };
  },
};
```

- [ ] **Step 5: Implement `registry.ts`**

```ts
// src/tts-providers/registry.ts

import { edgeTtsProvider } from "./edge-tts.js";
import type { TtsProvider } from "./types.js";

export interface ProviderPickOptions {
  language?: string;
  preferQuality?: boolean;
}

const ALL_PROVIDERS: TtsProvider[] = [
  edgeTtsProvider,
  // elevenLabsProvider — Phase 3.x
  // volcanoTtsProvider — Phase 3.x
];

/**
 * Picks a TTS provider for a request. Today only edge-tts is available,
 * so all paths return it. When ElevenLabs/Volcano land, this fans out to:
 *   - Chinese + voiceover style preference → Volcano (best zh prosody)
 *   - English + named-voice preference → ElevenLabs
 *   - Anything else → edge-tts (zero-cost fallback)
 */
export function pickProvider(opts: ProviderPickOptions = {}): TtsProvider {
  return edgeTtsProvider;
}

export function getProviderById(id: string): TtsProvider | null {
  return ALL_PROVIDERS.find((p) => p.id === id) ?? null;
}

export const ALL_TTS_PROVIDERS = ALL_PROVIDERS;
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run -c vitest.server.config.ts src/tts-providers/ 2>&1 | tail -10
```

Expected: all pass. (Smoke test will skip if `SKIP_TTS_SMOKE=1` is set.)

- [ ] **Step 7: Commit**

```bash
git add src/tts-providers/
git commit -m "$(cat <<'EOF'
feat(tts): edge-tts provider (Phase 3.E MVP)

Adds the TTS layer Phase 2's GenerationDialog already depends on:
  - src/tts-providers/types.ts: TtsRequest/TtsResult/TtsProvider
  - src/tts-providers/edge-tts.ts: Microsoft Edge TTS via CLI, with
    expressive-tag → SSML mapping ([sigh]/[laughing]/[whisper])
  - src/tts-providers/registry.ts: provider matrix and pickProvider()
    fallback chain (edge-tts only for now; ElevenLabs and Volcano TTS
    deferred to Phase 3.x)

Audit references:
  §6 — TTS at zero implementations today
  §11.4 — pip install edge-tts dep prereq landed in Task 3.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.F — Author `tts_generate.py` skill script + `POST /api/audio/tts` endpoint

**Audit risk §11.9:** `dispatchGeneration.test.ts` already asserts `script: "modules/assets/scripts/tts_generate.py"` and `model: "edge-tts/multilingual"`. This task creates the script at exactly that path with exactly those flag names so existing tests stay green.

**Files:**
- Create: `skills/autoviral/modules/assets/scripts/tts_generate.py`
- Create: `skills/autoviral/modules/assets/scripts/__tests__/test_tts_generate.py`
- Modify: `src/server/api.ts` — add `POST /api/audio/tts` handler (surgery — dirty file)

- [ ] **Step 1: Write failing Python tests**

Create `skills/autoviral/modules/assets/scripts/__tests__/test_tts_generate.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tts_generate import build_payload, parse_args


def test_build_payload_minimal():
    p = build_payload(
        text="Hello world",
        voice="en-US-AriaNeural",
        output="/tmp/test.mp3",
        style=None,
    )
    assert p["text"] == "Hello world"
    assert p["voice"] == "en-US-AriaNeural"
    assert p["output_path"] == "/tmp/test.mp3"
    assert "style" not in p or p["style"] is None


def test_build_payload_with_style():
    p = build_payload(
        text="Hi",
        voice="en-US-GuyNeural",
        output="/tmp/x.mp3",
        style="warm conversational",
    )
    assert p["style"] == "warm conversational"


def test_parse_args_defaults():
    args = parse_args(["--text", "Hi", "--voice", "Aria", "--output", "/x.mp3"])
    assert args.text == "Hi"
    assert args.voice == "Aria"
    assert args.output == "/x.mp3"
    assert args.style is None


def test_parse_args_with_style():
    args = parse_args([
        "--text", "Hi", "--voice", "Aria", "--output", "/x.mp3",
        "--style", "newscast",
    ])
    assert args.style == "newscast"
```

- [ ] **Step 2: Run failing tests**

```bash
python3 -m pytest skills/autoviral/modules/assets/scripts/__tests__/test_tts_generate.py -v 2>&1 | tail -10
```

Expected: ImportError.

- [ ] **Step 3: Implement `tts_generate.py`**

```python
#!/usr/bin/env python3
"""
AutoViral TTS Generation Script (Phase 3.F)

Wraps POST /api/audio/tts on the local backend, which delegates to the TTS
provider registry (Phase 3.E). The agent receives [autoviral:create-asset]
audio/tts envelopes and runs this script with --text/--voice/--output args.

This script is the user-facing CLI. The actual provider selection and
synthesis happens server-side.

Usage:
    python3 tts_generate.py \\
        --text "你好，欢迎来到 AutoViral" \\
        --voice zh-CN-XiaoxiaoNeural \\
        --output assets/audio/intro.mp3 \\
        [--style "warm conversational"]

Environment:
    AUTOVIRAL_BACKEND_URL — default http://localhost:3271
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from typing import Optional


def build_payload(
    text: str,
    voice: str,
    output: str,
    style: Optional[str] = None,
) -> dict:
    """Pure helper — produce the request body for POST /api/audio/tts."""
    p: dict = {"text": text, "voice": voice, "output_path": output}
    if style:
        p["style"] = style
    return p


def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        prog="tts_generate.py",
        description="Generate TTS audio via the AutoViral backend (edge-tts MVP).",
    )
    ap.add_argument("--text", required=True, help="Text to synthesize. SSML-style tags ([sigh]/[laughing]/[whisper]...[/whisper]) are mapped to SSML server-side.")
    ap.add_argument("--voice", required=True, help="Voice id (e.g. zh-CN-XiaoxiaoNeural, en-US-AriaNeural).")
    ap.add_argument("--output", required=True, help="Output file path (.mp3 recommended).")
    ap.add_argument("--style", help="Optional style instruction (currently used by ElevenLabs only — edge-tts ignores).")
    return ap.parse_args(argv)


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


def main(argv=None) -> int:
    args = parse_args(argv)
    payload = build_payload(args.text, args.voice, args.output, args.style)
    backend = os.environ.get("AUTOVIRAL_BACKEND_URL", "http://localhost:3271")
    req = urllib.request.Request(
        f"{backend}/api/audio/tts",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        die(f"TTS request failed: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:500]}")
    except urllib.error.URLError as e:
        die(f"TTS request failed: {e.reason}. Is the backend running at {backend}?")

    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        die(f"Backend returned non-JSON: {body[:200]}")

    if "outputPath" not in result:
        die(f"Backend response missing outputPath: {body[:200]}")

    print(result["outputPath"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Add `POST /api/audio/tts` handler** in `src/server/api.ts` (surgery — dirty file)

`src/server/api.ts` is in the 30-entry dirty list (the user's pre-existing carousel WIP). Use the snapshot pattern (proven in Tasks 1.3, 1.8, 1.9, 2.11):

```bash
# Snapshot before editing
cp src/server/api.ts /tmp/api-with-everything.ts
```

Edit `src/server/api.ts` — locate the existing `POST /api/audio/captions` handler (around line 1116) and add the new handler right after it. The handler:

```ts
// Phase 3.F — TTS endpoint
import { pickProvider, getProviderById } from "../tts-providers/registry.js";

app.post("/api/audio/tts", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.text || !body.voice || !body.output_path) {
    return c.json({ error: "TTS request missing required fields", required: ["text", "voice", "output_path"] }, 400);
  }
  const provider = pickProvider({ language: typeof body.language === "string" ? body.language : undefined });
  try {
    const r = await provider.generate({
      text: String(body.text),
      voice: String(body.voice),
      style: typeof body.style === "string" ? body.style : undefined,
      outputPath: String(body.output_path),
    });
    return c.json({ ok: true, outputPath: r.outputPath, duration: r.duration, sampleRate: r.sampleRate, channels: r.channels });
  } catch (e: any) {
    return c.json({ error: "TTS provider error", message: e?.message ?? String(e) }, 500);
  }
});
```

Then apply the surgery pattern to commit only this hunk:

```bash
# Re-stage only your intended changes
git checkout HEAD -- src/server/api.ts

# Re-apply ONLY the TTS endpoint hunk via Edit tool
# (use /tmp/api-with-everything.ts as reference for what your edits look like)

git add src/server/api.ts
git diff --cached src/server/api.ts | head -80
# Expected: only the import + the new POST /api/audio/tts handler

# Restore working tree
cp /tmp/api-with-everything.ts src/server/api.ts
```

- [ ] **Step 5: Run all tests** (Python script + dispatchGeneration regression)

```bash
python3 -m pytest skills/autoviral/modules/assets/scripts/__tests__/test_tts_generate.py -v 2>&1 | tail -10
# Expected: 4 pass

npx vitest --config web/vitest.config.ts run web/src/features/studio/generation/__tests__/dispatchGeneration.test.ts 2>&1 | tail -10
# Expected: 12 pass — the existing TTS test (which references "modules/assets/scripts/tts_generate.py") still works.
```

- [ ] **Step 6: Smoke test the endpoint**

```bash
# Start the backend in another terminal: npm run dev:backend
# Then:
curl -s -X POST http://localhost:3271/api/audio/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from AutoViral","voice":"en-US-AriaNeural","output_path":"/tmp/test-tts.mp3"}' | jq '.outputPath, .duration'
```

Expected: a path and a small float (e.g. 1.5 — duration of "Hello from AutoViral"). If you can't start the backend, skip and note as manual-verify follow-up.

- [ ] **Step 7: Commit (the Python script + the surgically-staged api.ts hunk)**

```bash
git add skills/autoviral/modules/assets/scripts/tts_generate.py \
        skills/autoviral/modules/assets/scripts/__tests__/test_tts_generate.py
# api.ts is already staged from Step 4

git commit -m "$(cat <<'EOF'
feat(skill+server): tts_generate.py + POST /api/audio/tts (Phase 3.F)

Adds the TTS skill script Phase 2's dispatchGeneration.test.ts already
expects at modules/assets/scripts/tts_generate.py. Pure-helper tests
cover build_payload + parse_args. The script POSTs to a new
/api/audio/tts endpoint that delegates to pickProvider() (Phase 3.E
edge-tts MVP).

Audit reference: §11.9 — test contract is locked at tts_generate.py /
edge-tts/multilingual; this task lands the implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.C — Implement `runRenderPipeline` orchestrator

**Files:**
- Create: `src/server/render-pipeline.ts`
- Create: `src/server/render-pipeline.test.ts`

This task is pure TS — composes Phase 3.A + 3.B + existing `mixAudioTracks` + existing `renderCompositionToMp4`.

- [ ] **Step 1: Write failing tests** (with mocked ffmpeg/Remotion subdeps)

`src/server/render-pipeline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy deps so the pipeline test runs in <1s
vi.mock("./remotion-renderer.js", () => ({
  renderCompositionToMp4: vi.fn(async (_comp, outDir) => `${outDir}/render-intermediate.mp4`),
}));
vi.mock("../audio-tools.js", async (orig) => {
  const real = await orig<typeof import("../audio-tools.js")>();
  return {
    ...real,
    mixAudioTracks: vi.fn(async (_opts) => undefined),
    normalizeLufs: vi.fn(async (_in, _out, _opts) => undefined),
    burnSubtitles: vi.fn(async (_opts) => undefined),
  };
});

import { runRenderPipeline } from "./render-pipeline";
import { renderCompositionToMp4 } from "./remotion-renderer.js";
import { mixAudioTracks, normalizeLufs, burnSubtitles } from "../audio-tools.js";
import type { Composition } from "../../web/src/features/studio/types";

const baseComp: Composition = {
  id: "c", workId: "w", fps: 30, width: 1080, height: 1920,
  duration: 4, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
  tracks: [], assets: [], provenance: [], exportPresets: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runRenderPipeline — minimal pipeline (no ducking, no burn)", () => {
  it("calls renderCompositionToMp4 then normalizeLufs (default -14)", async () => {
    const out = await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out" });
    expect(renderCompositionToMp4).toHaveBeenCalledOnce();
    expect(normalizeLufs).toHaveBeenCalledOnce();
    expect(mixAudioTracks).not.toHaveBeenCalled();
    expect(burnSubtitles).not.toHaveBeenCalled();
    expect(out).toMatch(/\.mp4$/);
  });
});

describe("runRenderPipeline — with ducking", () => {
  const compWithDuck: Composition = {
    ...baseComp,
    tracks: [
      { id: "audio-bgm", kind: "audio", label: "BGM", muted: false, hidden: false,
        clips: [{ id: "a1", kind: "audio", src: "/bgm.mp3", in: 0, out: 4, trackOffset: 0,
                  volume: 1, fadeIn: 0, fadeOut: 0, type: "bgm",
                  ducking: { ratio: 4, attack: 200, release: 1000 } }] },
      { id: "audio-vo", kind: "audio", label: "VO", muted: false, hidden: false,
        clips: [{ id: "a2", kind: "audio", src: "/vo.mp3", in: 0, out: 4, trackOffset: 0,
                  volume: 1, fadeIn: 0, fadeOut: 0, type: "voiceover" }] },
    ],
  };

  it("calls mixAudioTracks once when any AudioClip has ducking", async () => {
    await runRenderPipeline({ comp: compWithDuck, outDir: "/tmp/out" });
    expect(mixAudioTracks).toHaveBeenCalledOnce();
    const callArg = (mixAudioTracks as any).mock.calls[0][0];
    expect(callArg.tracks).toHaveLength(2);
    // The ducked BGM clip should produce a MixTrack with ducking trigger="voiceover"
    const bgmTrack = callArg.tracks.find((t: any) => t.type === "bgm");
    expect(bgmTrack.ducking).toEqual({ trigger: "voiceover", ratio: 4 });
  });
});

describe("runRenderPipeline — with burn-in subtitles", () => {
  const compWithText: Composition = {
    ...baseComp,
    tracks: [
      { id: "text-0", kind: "text", label: "Subtitles", muted: false, hidden: false,
        clips: [{ id: "t1", kind: "text", text: "Hi", trackOffset: 0, duration: 2,
                  style: { font: "Inter", size: 48, weight: 700, italic: false, tracking: 0, color: "#fff" },
                  position: { anchor: "bottom", xPct: 50, yPct: 85 } }] },
    ],
  };

  it("calls burnSubtitles when burnSubtitles option is true and there is a text track", async () => {
    await runRenderPipeline({ comp: compWithText, outDir: "/tmp/out", burnSubtitles: true });
    expect(burnSubtitles).toHaveBeenCalledOnce();
  });

  it("skips burnSubtitles when burnSubtitles=false (default)", async () => {
    await runRenderPipeline({ comp: compWithText, outDir: "/tmp/out" });
    expect(burnSubtitles).not.toHaveBeenCalled();
  });
});

describe("runRenderPipeline — onProgress hook", () => {
  it("emits stage events: render → loudnorm → encode (minimal)", async () => {
    const stages: string[] = [];
    await runRenderPipeline({
      comp: baseComp,
      outDir: "/tmp/out",
      onProgress: (s) => stages.push(s),
    });
    expect(stages).toContain("render");
    expect(stages).toContain("loudnorm");
    expect(stages).toContain("encode");
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx vitest run -c vitest.server.config.ts src/server/render-pipeline.test.ts 2>&1 | tail -10
```

Expected: all fail (module doesn't exist).

- [ ] **Step 3: Implement `render-pipeline.ts`**

```ts
// src/server/render-pipeline.ts

import { renderCompositionToMp4 } from "./remotion-renderer.js";
import {
  mixAudioTracks,
  normalizeLufs,
  burnSubtitles,
  compositionTextTrackToJson,
  type MixTrack,
} from "../audio-tools.js";
import { join } from "node:path";
import { rename } from "node:fs/promises";
import type { Composition } from "../../web/src/features/studio/types";

export interface RenderJobOptions {
  comp: Composition;
  outDir: string;
  /** When true, burn TextTrack clips into the video (animations frozen).
   *  Default false — soft-sub via Remotion <Text> remains. */
  burnSubtitles?: boolean;
  /** Override the loudness target. Default -14 (YouTube/抖音/TikTok). */
  loudnessTargetLufs?: number;
  /** Override the title used in the output filename. Defaults to
   *  comp.title if present, else "autoviral-export". */
  outputTitle?: string;
  /** Hook for the render queue / API client to surface progress. */
  onProgress?: (stage: "render" | "duck" | "loudnorm" | "burn" | "encode", pct: number) => void;
}

/**
 * Adapts AudioClip ducking to mixAudioTracks' MixTrack contract.
 *
 * For each AudioClip with `ducking`, emits a MixTrack with the same
 * `type` discriminator and a ducking config whose `trigger` is the type
 * of the FIRST AudioClip with `type: "voiceover"` (ducking always sides
 * with the voiceover when present). When no voiceover exists, the
 * ducking config is dropped and the clip plays at its base volume.
 */
function compositionToMixTracks(comp: Composition): MixTrack[] {
  const tracks: MixTrack[] = [];
  const allAudioClips = comp.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips.filter((c) => c.kind === "audio") as any[]);

  // Find the first voiceover clip (its type discriminates the trigger)
  const hasVoiceover = allAudioClips.some((c) => c.type === "voiceover");

  for (const clip of allAudioClips) {
    const mt: MixTrack = {
      source: clip.src,
      type: clip.type ?? "bgm",
      volume: clip.volume ?? 1,
      delay: clip.trackOffset,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
    };
    if (clip.ducking && hasVoiceover && clip.type !== "voiceover") {
      mt.ducking = {
        trigger: "voiceover",
        ratio: clip.ducking.ratio,
      };
    }
    tracks.push(mt);
  }
  return tracks;
}

export async function runRenderPipeline(opts: RenderJobOptions): Promise<string> {
  const target = opts.loudnessTargetLufs ?? -14;
  const onP = opts.onProgress ?? (() => undefined);

  // ─── Stage 1: Remotion render ─────────────────────────────────────────
  onP("render", 0);
  let workingPath = await renderCompositionToMp4(
    { ...opts.comp, title: opts.outputTitle ?? (opts.comp as any).title },
    opts.outDir,
  );
  onP("render", 1);

  // ─── Stage 2: ducking (optional, only if any audio clip has ducking) ──
  const audioClips = opts.comp.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips as any[]);
  const needsDucking = audioClips.some((c) => c.ducking);
  if (needsDucking) {
    onP("duck", 0);
    const ducked = workingPath.replace(/\.mp4$/, "-ducked.mp4");
    await mixAudioTracks({
      videoPath: workingPath,
      tracks: compositionToMixTracks(opts.comp),
      outputPath: ducked,
    });
    workingPath = ducked;
    onP("duck", 1);
  }

  // ─── Stage 3: subtitle burn (optional) ────────────────────────────────
  const hasTextTrack = compositionTextTrackToJson(opts.comp).length > 0;
  if (opts.burnSubtitles && hasTextTrack) {
    onP("burn", 0);
    const burned = workingPath.replace(/\.mp4$/, "-burned.mp4");
    await burnSubtitles({
      inputVideo: workingPath,
      comp: opts.comp,
      outputVideo: burned,
    });
    workingPath = burned;
    onP("burn", 1);
  }

  // ─── Stage 4: loudnorm two-pass ───────────────────────────────────────
  onP("loudnorm", 0);
  const normalized = workingPath.replace(/\.mp4$/, "-normalized.mp4");
  await normalizeLufs(workingPath, normalized, { target, truePeak: -1.5, lra: 11 });
  workingPath = normalized;
  onP("loudnorm", 1);

  // ─── Stage 5: final encode (rename — encoder profiles deferred to Phase 6) ───
  onP("encode", 0);
  const finalPath = join(opts.outDir, `final-${Date.now()}.mp4`);
  await rename(workingPath, finalPath);
  onP("encode", 1);

  return finalPath;
}
```

- [ ] **Step 4: Run the tests** — should pass

```bash
npx vitest run -c vitest.server.config.ts src/server/render-pipeline.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/server/render-pipeline.ts src/server/render-pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(server): runRenderPipeline orchestrator (Phase 3.C)

Composes the Remotion render + ffmpeg post-process chain:
  1. renderCompositionToMp4 (Remotion canvas → intermediate MP4)
  2. mixAudioTracks (only when any AudioClip has ducking)
  3. burnSubtitles (only when opts.burnSubtitles + a text track exists)
  4. normalizeLufs two-pass (default -14 LUFS, override via opts.loudnessTargetLufs)
  5. final rename to final-<ts>.mp4

compositionToMixTracks adapter maps AudioClip → MixTrack using the new
type discriminator (Phase 3.0 schema extension). Trigger is hard-coded
to "voiceover" — when a voiceover clip exists, all bgm/sfx/original
clips that have ducking configs duck to it. Phase 6 will widen this.

Onprogress hook emits 5 stages so the future render queue (Phase 7)
can drive a UI progress bar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.D — Rewire `POST /api/works/:id/render` to use `runRenderPipeline`

**Files:**
- Modify: `src/server/api.ts` — rewire the existing handler (surgery — dirty file)
- Modify: `src/server/__tests__/legacy-migration.test.ts` (or add a new test file) — verify the handler still type-checks and accepts the new optional `burnSubtitles`/`loudnessTargetLufs` body fields

- [ ] **Step 1: Snapshot api.ts**

```bash
cp src/server/api.ts /tmp/api-with-everything.ts
```

- [ ] **Step 2: Locate the existing render handler**

```bash
grep -n 'app.post.*\\/api\\/works\\/:id\\/render' src/server/api.ts
```

- [ ] **Step 3: Edit the handler in working tree**

Find the handler (post-Phase-1.9 it does `CompositionSchema.safeParse(yaml.load(raw))` then `renderCompositionToMp4`). Replace the `renderCompositionToMp4` call with `runRenderPipeline`. Pull `burnSubtitles` and `loudnessTargetLufs` from the request body (both optional):

```ts
// Replace the existing call:
//   const outFile = await renderCompositionToMp4({ ...parsed.data, title: w.title }, outDir);
// With:
const body = await c.req.json().catch(() => ({}));
const outFile = await runRenderPipeline({
  comp: { ...parsed.data, title: w.title } as any,
  outDir,
  burnSubtitles: !!body.burnSubtitles,
  loudnessTargetLufs:
    typeof body.loudnessTargetLufs === "number" ? body.loudnessTargetLufs : undefined,
});
```

Add the import at the top of api.ts (near other server imports):

```ts
import { runRenderPipeline } from "./server/render-pipeline.js";
```

(Wait — api.ts IS in `src/server/`, so the import is relative to the file location. Use `./render-pipeline.js`.)

- [ ] **Step 4: Apply surgery — restore baseline, re-apply only the intended hunks**

```bash
git checkout HEAD -- src/server/api.ts

# Use the Edit tool to apply ONLY the new import + the handler rewire.
# Reference /tmp/api-with-everything.ts to see your changes.

git add src/server/api.ts
git diff --cached src/server/api.ts | head -60
# Expected: only the import + the handler rewire. No carousel/AssetSidebar churn.

# Restore working tree carousel WIP
cp /tmp/api-with-everything.ts src/server/api.ts

git status --short src/server/api.ts
# Expected: " M" (working-tree-only after staging)
```

- [ ] **Step 5: Backend tsc** (no new test file in this task — handler change is exercised by integration with running server)

```bash
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0
```

- [ ] **Step 6: Run existing tests** to confirm no regression

```bash
npx vitest run -c vitest.server.config.ts 2>&1 | tail -10
# Expected: all existing backend tests still pass.
```

- [ ] **Step 7: Manual smoke test (optional but recommended)**

Start the backend, hit the render endpoint with a real work ID, verify the output MP4 has normalized loudness:

```bash
# In another terminal: npm run dev:backend
WORK_ID=w_20260408_1347_db8 # use any real existing work

curl -s -X POST "http://localhost:3271/api/works/$WORK_ID/render" \
  -H 'Content-Type: application/json' \
  -d '{"loudnessTargetLufs": -14}'

# After it returns, find the new output:
ls -lt ~/.autoviral/works/$WORK_ID/output/ | head -3

# Measure loudness of the new file:
LATEST=$(ls -t ~/.autoviral/works/$WORK_ID/output/*.mp4 | head -1)
ffmpeg -i "$LATEST" -af loudnorm=I=-14:LRA=11:tp=-1.5:print_format=json -f null - 2>&1 | grep -A 2 input_i | head -3
```

Expected: integrated_loudness ("input_i") near -14 (within ±1 LU).

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): rewire POST /api/works/:id/render to runRenderPipeline (Phase 3.D)

The render handler now goes through Phase 3.C's runRenderPipeline,
chaining Remotion → ducking → burn → loudnorm → final mux. New optional
request body fields:
  - burnSubtitles: boolean (default false)
  - loudnessTargetLufs: number (default -14)

UI export and agent-driven render now share the same audio fidelity:
fades audible, ducked BGM ducks, integrated loudness within ±0.5 LU.
This closes the architectural gap Phase 1's final review flagged
("UI export went through Remotion only; agent path went through
ffmpeg + Python — and they had different ceilings").

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.G — Author `audio-pipeline.md` skill doc + reconcile `audio-mixing.md`

**Files:**
- Create: `skills/autoviral/modules/assembly/capabilities/audio-pipeline.md`
- Modify: `skills/autoviral/modules/assembly/capabilities/audio-mixing.md` — fix the API contract drift (audit §11.10)

- [ ] **Step 1: Read references**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
sed -n '53,82p' docs/superpowers/plans/2026-04-28-skill-construction-brief.md  # frontmatter rules
sed -n '184,260p' docs/superpowers/plans/2026-04-28-skill-construction-brief.md  # operational template
cat skills/autoviral/modules/assembly/capabilities/audio-mixing.md  # the doc to reconcile
sed -n '966,1100p' src/server/api.ts  # actual /api/audio/mix handler shape (request body fields)
```

- [ ] **Step 2: Author `audio-pipeline.md`**

The doc is **operational-template** style (decision tree → recipes → gotchas). Target ~200 lines.

```markdown
---
name: assembly-audio-pipeline
description: 用于 UI 导出或 agent 驱动渲染需要端到端音频保真度时——例如 "BGM 在 voiceover 下要 duck"、"导出抖音版要 -14 LUFS"、"小红书版要 -16"、"硬烧字幕但保留软字幕做编辑"。给出 runRenderPipeline 的阶段决策树、平台 LUFS 表、burnSubtitles 的动画丢失约束。不用于：实时预览的音频处理（Remotion 浏览器内只支持 volume，不做 LUFS / ducking）。
---

# 音频管线统一（Phase 3）

`runRenderPipeline` 是 server-side 的渲染编排器。它把 Remotion 画布渲染、ffmpeg ducking、字幕硬烧、LUFS 二段归一化按顺序穿起来，让 UI 导出按钮和 agent 驱动渲染产出**完全相同保真度**的 MP4。

UI 浏览器侧（Remotion `<Audio>`）的能力上限是 **volume + fade**——`useCurrentFrame()` 驱动 interpolate 实现 fadeIn/fadeOut；ducking 和 LUFS 必须靠服务端 ffmpeg。

## 阶段决策树

```
runRenderPipeline(opts)
  ↓
[1] Remotion 渲染 → intermediate.mp4
  ↓
[2] 任何 AudioClip 有 ducking？
    └── 有 → mixAudioTracks（sidechaincompress trigger="voiceover"）→ ducked.mp4
    └── 无 → 跳过
  ↓
[3] opts.burnSubtitles=true 且有 text track？
    └── 是 → burnSubtitles（subtitle_burn.py，flat-list JSON）→ burned.mp4
    └── 否 → 跳过（保留软字幕由 TextTrackRenderer 在 Remotion 渲）
  ↓
[4] loudnorm 二段归一化（默认 -14 LUFS）→ normalized.mp4
  ↓
[5] 重命名为 final-<timestamp>.mp4
```

## 平台 LUFS 表

| 平台 | Target LUFS | True peak | LRA |
|---|---|---|---|
| YouTube（长视频/Shorts） | -14 | -1.0 | 11 |
| TikTok / Reels / Shorts | -14 | -1.0 | 11 |
| 抖音 | -14 | -1.0 | 11 |
| 小红书 / 视频号 | -16 | -1.0 | 9 |
| Bilibili | -14 | -1.0 | 11 |
| Apple Podcasts | -16 | -1.0 | 11 |
| Spotify | -14 | -1.0 | 11 |

调用时通过 `loudnessTargetLufs` body 字段覆盖默认 -14。

## AudioClip.type 的语义

Phase 3.0 在 `AudioClipSchema` 上加了 `type: "original"|"bgm"|"voiceover"|"sfx"`，默认 `"bgm"`。

- `"voiceover"` — 配音、旁白。**作为 ducking trigger**——其他 type 的 clip 在它之上播放时被压低。
- `"bgm"` — 背景音乐。会被 voiceover ducking。
- `"sfx"` — 音效（撞击、特效）。短促，不参与 ducking。
- `"original"` — 视频原声（保留时带过来的环境声）。GenerationDialog 创建的新 audio 默认不会是 original；这是从 jimeng 等 video-with-audio 生成路径回流的 clip 才会是 original。

`mixAudioTracks` 看的是这个字段决定 ducking 的 trigger。

## 硬烧字幕的动画丢失约束（D2）

`burnSubtitles=true` 的副作用：**TextClip 的 `animation` 字段（kinetic-pop / typewriter / slide-up / fade）会被丢弃**，最终 MP4 上的字幕是 subtitle_burn.py 的 5 种静态样式之一（默认 modern）。原因：

- subtitle_burn.py 用 Pillow + moviepy 逐帧渲染，没有 spring 动画引擎
- 段级 JSON 入参（`{start,end,text}`）也没有 word-level 时序，karaoke 风格的逐词高亮需要 word 级数据

**实践建议：** 默认 `burnSubtitles=false`，让 Remotion 软字幕持续供编辑使用（动画完整保留）。只在导出的最终成片需要兼容不支持软字幕的播放环境（部分平台 / 部分播放器）时打开 burn。

## ducking trigger 的限制（Phase 3 MVP）

当前实现：trigger 永远是 `"voiceover"`——即任何带 ducking 的 BGM/SFX/Original 都按"compose 中是否存在 voiceover"判定要不要 duck。如果 comp 没有 voiceover，ducking 不会触发，BGM 按 base volume 播。

未来：Phase 5 / Phase 6 会让 trigger 可配置（per-clip ducking → trigger by id 而非 type），支持 BGM 之间互相 duck（intro 段 BGM 在 build-up BGM 来时降）。

## 字体依赖（assertFontInstalled）

`burnSubtitles` 在调脚本前检查 `~/.autoviral/fonts/NotoSansCJKsc-Regular.otf`：

- 存在 → 透传给 subtitle_burn.py 的 `--font` flag
- 不存在 → 抛错并指明 `python3 skills/autoviral/modules/assets/scripts/font_manager.py install`

设计原因：`subtitle_burn.py` 的 font_manager 导入路径是死代码（指向不存在的 `modules/asset-generation/`，旧的 skill 名）。失败时报错应该清楚不晦涩。

## 调用方式

UI 导出按钮（`POST /api/works/:id/render`）：
```bash
curl -X POST http://localhost:3271/api/works/$ID/render \
  -H 'Content-Type: application/json' \
  -d '{"burnSubtitles": false, "loudnessTargetLufs": -14}'
```

Agent CLI 派发（通过 dispatchGeneration）：暂不直接派发渲染——agent 只生成素材，渲染由 UI 触发。

## See also

- `capabilities/audio-mixing.md` — `mixAudioTracks` 的具体 ffmpeg filter 链
- `capabilities/pro-captions.md` — 字幕生成（whisper → SRT/ASS）
- `capabilities/subtitle-aesthetics.md` — 字幕样式美学
- `references/platform-specs.md`（Phase 6）—— 平台编码 profile
- 主代码：`src/server/render-pipeline.ts`、`src/audio-tools.ts`
```

- [ ] **Step 3: Reconcile `audio-mixing.md`**

Open `audio-mixing.md`. The doc currently shows API examples with snake_case fields (`output_path`, `video_path`) — but the actual `POST /api/audio/mix` handler at api.ts:967 uses camelCase (`outputPath`, `videoPath`).

Change the doc's example POST body from:
```json
{
  "video_path": "...",
  "output_path": "..."
}
```

to:
```json
{
  "videoPath": "...",
  "outputFilename": "..."
}
```

(Or whatever the actual field names are — verify against api.ts:967-985.)

- [ ] **Step 4: Commit**

```bash
git add skills/autoviral/modules/assembly/capabilities/audio-pipeline.md \
        skills/autoviral/modules/assembly/capabilities/audio-mixing.md
git commit -m "$(cat <<'EOF'
docs(skill): add audio-pipeline.md + reconcile audio-mixing.md (Phase 3.G)

Documents the runRenderPipeline orchestrator: 5-stage decision tree,
platform LUFS table (抖音 -14 / 小红书 -16 / etc), AudioClip.type
semantics, animation-loss caveat for burnSubtitles=true, and the
ducking trigger="voiceover" MVP limitation.

Reconciles audio-mixing.md's example POST body with the actual API
contract (camelCase, audit §11.10).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 3. Phase 3 Acceptance Criteria

- [ ] Backend tsc clean: `npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] All vitest tests pass: backend (`vitest run -c vitest.server.config.ts`) and canonical web (`vitest --config web/vitest.config.ts run`). Web should still be at 47 files / 166 tests post-Phase-2.11; backend should grow by ~10 from Phase 2 (now ~58-65 tests with the new audio-tools / render-pipeline / tts-providers / tts_generate suites).
- [ ] All Python tests pass: `pytest skills/autoviral/modules/assets/scripts/__tests__ skills/autoviral/modules/assets/scripts/filter_retry/__tests__` should report 31 (Phase 2) + 4 (3.F) = 35 passing.
- [ ] Working tree dirty count remains 30 (matches session-start baseline).
- [ ] **Smoke test (manual):** UI export of a real work with a BGM track + voiceover + text track produces an MP4 with: BGM ducks under VO (audibly), integrated loudness within ±1 LU of -14, soft subtitles render in preview but are NOT burned (default `burnSubtitles=false`).
- [ ] **TTS smoke (manual):** `curl -X POST /api/audio/tts` with a 1-line Chinese prompt + `zh-CN-XiaoxiaoNeural` voice produces an MP3 ≥ 1KB.
- [ ] No carousel WIP swept into commits: `grep -c synthesiseLegacyCarousel src/server/api.ts` returns 2 in working tree, 0 in any Phase 3 commit.

---

## 4. Self-Review

**Spec coverage check (master plan §3.2 task list):**

| Master plan task | This plan's task | Status |
|---|---|---|
| 3.A normalizeLufs two-pass | Task 3.A | ✓ |
| 3.B burnSubtitles adapter | Task 3.B | ✓ |
| 3.C runRenderPipeline | Task 3.C | ✓ |
| 3.D POST /render rewire | Task 3.D | ✓ |
| 3.E TTS providers | Task 3.E (edge-tts MVP only — ElevenLabs/Volcano deferred to Phase 3.x with explicit note) |
| 3.F tts_generate.py | Task 3.F | ✓ |
| 3.G audio-pipeline.md | Task 3.G | ✓ |
| Audit §11.5 — AudioClip.type | Task 3.0 (new prereq) | ✓ |
| Audit §11.4 — pip install edge-tts | Task 3.0 step 1 | ✓ |
| Audit §11.10 — audio-mixing.md drift | Task 3.G step 3 | ✓ |
| Audit §11.11 — font dead-code | Task 3.B (assertFontInstalled) | ✓ |

All 7 master-plan tasks covered. 4 audit-derived risks resolved. Plan total: 8 tasks (3.0 + 3.A through 3.G).

**Placeholder scan:** No "TBD" / "implement later" / "similar to Task N" / "add appropriate error handling" patterns. Every step shows full code or full command.

**Type consistency:**
- `AudioClipSchema.type` (Task 3.0) → `compositionToMixTracks` (Task 3.C) → `MixTrack.type` (existing in audio-tools.ts) — same enum literal set.
- `LoudnormOptions` (Task 3.A) → `runRenderPipeline.opts.loudnessTargetLufs` (Task 3.C) — `target` field consistently named.
- `TtsProvider.generate(req)` (Task 3.E) → `pickProvider(opts).generate(...)` (Task 3.F endpoint) — request shape matches.
- `compositionTextTrackToJson` (Task 3.B) → `runRenderPipeline.compositionToMixTracks` (Task 3.C) — both adapters defined and used in 3.C.

**Cross-task references:**
- Task 3.B's `assertFontInstalled` is referenced by Task 3.G's audio-pipeline.md "字体依赖" section.
- Task 3.E's `mapExpressiveTagsToSsml` is referenced by Task 3.F's tts_generate.py via the server endpoint passing through.
- Task 3.D's request body fields (`burnSubtitles`, `loudnessTargetLufs`) match Task 3.C's `RenderJobOptions`.

**Plan complete.**
