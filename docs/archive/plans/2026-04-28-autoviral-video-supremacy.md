# AutoViral 视频生产平台超越 Pneuma 主计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan-of-plans notice:** This document is a master roadmap covering 8 phases × multiple subsystems. **Phases 1 and 2 are written as fully-detailed TDD task lists and can be executed immediately.** Phases 3–8 are written as **file-level contracts + acceptance criteria**; before executing any of those phases, run `superpowers:writing-plans` again with that phase's section as input to expand it into TDD-grade tasks. The contracts shown for Phases 3–8 are precise enough that the expansion takes ~1 hour, not a fresh discovery pass.

**Goal:** Lift AutoViral from "AIGC video assembler with shallow timeline editing and split agent/UI rendering paths" into a professional creator-grade video platform that surpasses pandazki/pneuma-skills on creation flow depth, audio fidelity, platform-aware export, and editing primitives.

**Architecture:** Five reinforcing layers — (1) Provenance-DAG data model so every asset knows its lineage; (2) structured agent ↔ viewer notification protocol with locator cards; (3) unified server-side rendering pipeline (Remotion → ffmpeg post-process → mux LUFS-normalized audio) so UI export and agent automation reach the same capability ceiling; (4) ripple/snap/blade timeline editing with filmstrip + waveform thumbnails; (5) differentiators pneuma lacks: smart-crop reframe, platform export presets, render queue with progress streams, CLIP semantic asset search, keyframe automation, multi-provider video model coverage.

**Tech Stack:** TypeScript (Hono + Zod backend, React 18 + Vite + Zustand + TanStack Query frontend), Remotion 4 (`@remotion/bundler` + `@remotion/renderer` + `@remotion/player`), ffmpeg / ffprobe (audio analysis, mix, loudnorm, smart-crop, post-process), Python skills (librosa beat detection, stable-whisper captions, mediapipe / cv2 saliency, demucs stem separation, OpenCLIP semantic search), `@dnd-kit` for drag interactions, ReactFlow for provenance dive canvas, BullMQ + Redis for render queue, Vitest + Playwright for testing.

---

## 0. Phase Roadmap

| Phase | Name | Mode | Dependencies | Est. Sprints |
|---|---|---|---|---|
| **1** | Foundation — Provenance DAG + Schema 兑现 | Full TDD | none | 1 |
| **2** | Agent Protocol — Locator + Structured Generation + Filter-retry | Full TDD | Phase 1 |  1 |
| **3** | Audio Pipeline Unification — LUFS, TTS, Export-via-mix | Outline + contracts | Phase 1 | 1 |
| **4** | Timeline Editing — Split, Resize, Ripple, Filmstrip, Waveform | Outline + contracts | Phase 1 | 2 |
| **5** | Variant Switcher + Provenance Dive Views | Outline + contracts | Phase 1, 2, 4 | 1 |
| **6** | Smart Crop + Platform Export Presets | Outline + contracts | Phase 3 | 1 |
| **7** | Render Queue + Proxy / Draft Renders | Outline + contracts | Phase 3 | 1 |
| **8** | Differentiators — CLIP search, Keyframes, Speed ramp, Multi-provider video | Outline + contracts | Phase 3, 4 | 2+ |

**Dependency graph:**

```
   Phase 1 (data model)
       │
       ├──► Phase 2 (agent protocol)
       │        │
       │        └──► Phase 5 (variant + dive)
       │
       ├──► Phase 3 (audio pipeline)
       │        │
       │        ├──► Phase 6 (smart crop + presets)
       │        ├──► Phase 7 (render queue)
       │        └──► Phase 8 (differentiators)
       │
       └──► Phase 4 (timeline editing)
                │
                └──► Phase 8 (keyframes, speed ramp)
```

Phases 1 and 2 must land first — every other phase depends on the new schema and at least one agent-protocol primitive. Phase 3 and 4 are independent and can run in parallel after Phase 1.

---

## 1. Phase 1 — Foundation: Provenance DAG + Schema 兑现

**Why this is foundational:** AutoViral's current `composition.yaml` records "what's on the timeline" but not "where each asset came from". Without provenance, you can't build variant switchers, you can't compare two takes, you can't show the user "this clip's prompt was X". Pneuma's *entire* creator UX bets on the DAG. We adopt the same data shape but keep AutoViral's existing 4-track Composition (video/audio/text/overlay) and Zod-first validation. Same phase also pays down the schema-drift bugs (fadeIn/fadeOut/ducking declared but ignored, `kinetic-pop`/`typewriter` declared but unimplemented).

### 1.0 File Structure

```
web/src/features/studio/
├── types.ts                                            ← extend (assets[], provenance[], scenes[], captionStyle, exportPresets[])
├── __tests__/
│   ├── types.test.ts                                   ← NEW — Zod parse contracts
│   └── legacy-migration.test.ts                        ← NEW — synthesise assets+provenance from legacy comp
├── composition/tracks/
│   ├── AudioTrackRenderer.tsx                          ← rewrite — honour fadeIn/fadeOut
│   └── TextTrackRenderer.tsx                           ← extend — kinetic-pop + typewriter
├── services/composition.ts                             ← extend — load/save round-trips new fields
└── store.ts                                            ← extend — addAsset / addProvenance / removeAsset actions

src/server/
└── api.ts                                              ← extend — synthesiseLegacyComposition writes assets[]+provenance[]

src/
└── audio-tools.ts                                      ← clean redundant ternary at lines 270–274
```

### 1.1 Task 1.1 — Add `AssetEntry` and `ProvenanceEdge` Zod schemas

**Files:**
- Modify: `web/src/features/studio/types.ts` (add new schemas after `FiltersSchema`, before `VideoClipSchema`)
- Create: `web/src/features/studio/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test** in `web/src/features/studio/__tests__/types.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { AssetEntrySchema, ProvenanceEdgeSchema } from "../types";

describe("AssetEntrySchema", () => {
  it("parses a minimum valid image entry", () => {
    const r = AssetEntrySchema.parse({
      id: "asset-hero",
      uri: "/api/works/w_x/assets/images/hero.png",
      kind: "image",
      metadata: {},
    });
    expect(r.id).toBe("asset-hero");
    expect(r.kind).toBe("image");
    expect(r.tags).toBeUndefined();
  });

  it("preserves physical metadata fields verbatim", () => {
    const r = AssetEntrySchema.parse({
      id: "asset-clip-1",
      uri: "/api/works/w_x/assets/clips/c.mp4",
      kind: "video",
      metadata: { width: 1080, height: 1920, duration: 4.04, fps: 30, codec: "h264", sizeBytes: 1234567 },
    });
    expect(r.metadata.duration).toBe(4.04);
    expect(r.metadata.codec).toBe("h264");
    expect(r.metadata.sizeBytes).toBe(1234567);
  });

  it("rejects unknown kind", () => {
    expect(() =>
      AssetEntrySchema.parse({ id: "x", uri: "/a", kind: "weird", metadata: {} }),
    ).toThrow();
  });
});

describe("ProvenanceEdgeSchema", () => {
  it("parses a generate edge with null fromAssetId", () => {
    const r = ProvenanceEdgeSchema.parse({
      toAssetId: "asset-hero",
      fromAssetId: null,
      operation: {
        type: "generate",
        actor: "agent",
        agentId: "autoviral-imagegen",
        timestamp: "2026-04-28T10:00:00Z",
        params: { model: "openai/gpt-5.4-image-2", prompt: "panda" },
      },
    });
    expect(r.fromAssetId).toBeNull();
    expect(r.operation.type).toBe("generate");
    expect(r.operation.params.model).toBe("openai/gpt-5.4-image-2");
  });

  it("parses a derive edge with non-null fromAssetId", () => {
    const r = ProvenanceEdgeSchema.parse({
      toAssetId: "asset-panda-v2",
      fromAssetId: "asset-panda-v1",
      operation: {
        type: "derive",
        actor: "agent",
        timestamp: "2026-04-28T10:01:00Z",
        params: {},
      },
    });
    expect(r.fromAssetId).toBe("asset-panda-v1");
  });

  it("rejects invalid operation.type", () => {
    expect(() =>
      ProvenanceEdgeSchema.parse({
        toAssetId: "x",
        fromAssetId: null,
        operation: { type: "magic", actor: "agent", timestamp: "t", params: {} },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/nanjiayan/Desktop/AutoViral/autoviral && npx vitest run web/src/features/studio/__tests__/types.test.ts`
Expected: FAIL — `Cannot find module '../types'` does not export `AssetEntrySchema` (or similar).

- [ ] **Step 3: Add the schemas** to `web/src/features/studio/types.ts` (insert after line 21 — i.e. immediately after `FiltersSchema` definition):

```ts
// ─── Asset registry ─────────────────────────────────────────────────────────
// AssetEntry promotes raw file paths to a first-class object with semantic id
// and physical metadata. metadata holds ONLY physical/format properties (size,
// dimensions, duration, codec). All "how the asset came to exist" fields
// (model, prompt, seed, costUsd, durationMs) live on ProvenanceEdge.params,
// NEVER on metadata. This separation is borrowed from pneuma; it's the rule
// that prevents schema drift.

export const AssetMetadataSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  fps: z.number().optional(),
  codec: z.string().optional(),
  sampleRate: z.number().optional(),
  channels: z.number().optional(),
  sizeBytes: z.number().optional(),
});
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;

export const AssetEntrySchema = z.object({
  id: z.string(),
  uri: z.string(),
  kind: z.enum(["image", "video", "audio", "subtitle"]),
  name: z.string().optional(),
  metadata: AssetMetadataSchema.default({}),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  status: z.enum(["pending", "ready", "failed"]).default("ready"),
});
export type AssetEntry = z.infer<typeof AssetEntrySchema>;

// ─── Provenance graph ───────────────────────────────────────────────────────
// One edge per asset. fromAssetId === null means the asset is a root (user
// upload, third-party import, or pure-text generation with no source asset).
// fromAssetId === <id> means the new asset was derived from that one (variant,
// edit, trim, mix). operation.params is intentionally Record<string,any> — the
// shape varies per operation.type and we don't constrain it at the schema layer.

export const ProvenanceOperationSchema = z.object({
  type: z.enum([
    "generate",  // text → asset
    "derive",    // asset → asset (variant, edit, regen)
    "upload",    // user upload from disk
    "import",    // third-party import (URL, screen recording, etc.)
    "trim",      // clip-level trim that produces a new physical asset
    "mix",       // multi-track audio mix output
    "caption",   // STT → SRT/ASS asset
    "grade",     // color-graded variant
  ]),
  actor: z.enum(["user", "agent", "system"]),
  agentId: z.string().optional(),
  timestamp: z.string(),
  label: z.string().optional(),
  params: z.record(z.any()).default({}),
});
export type ProvenanceOperation = z.infer<typeof ProvenanceOperationSchema>;

export const ProvenanceEdgeSchema = z.object({
  toAssetId: z.string(),
  fromAssetId: z.string().nullable(),
  operation: ProvenanceOperationSchema,
});
export type ProvenanceEdge = z.infer<typeof ProvenanceEdgeSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/nanjiayan/Desktop/AutoViral/autoviral && npx vitest run web/src/features/studio/__tests__/types.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/types.ts web/src/features/studio/__tests__/types.test.ts
git commit -m "feat(types): add AssetEntry and ProvenanceEdge Zod schemas

Promotes raw asset paths into first-class entries with physical metadata
and adds a separate provenance graph layer (assetId → operation → params).
This is the data-model foundation for variants, dive views, and structured
generation in subsequent phases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 1.2 Task 1.2 — Extend `Composition` with `assets[]`, `provenance[]`, `scenes[]`, `captionStyle`, `exportPresets[]`

**Files:**
- Modify: `web/src/features/studio/types.ts:122-138` (the existing `CompositionSchema`)
- Modify: `web/src/features/studio/__tests__/types.test.ts` (extend)

- [ ] **Step 1: Add failing tests** for the new Composition fields. Append to `types.test.ts`:

```ts
import { CompositionSchema, makeEmptyComposition } from "../types";

describe("CompositionSchema (extended)", () => {
  it("accepts a composition with assets, provenance, scenes, captionStyle", () => {
    const r = CompositionSchema.parse({
      id: "c_w_x",
      workId: "w_x",
      fps: 30,
      width: 1080,
      height: 1920,
      duration: 4,
      aspect: "9:16",
      tracks: [],
      updatedAt: "2026-04-28T10:00:00Z",
      assets: [
        { id: "asset-hero", uri: "/api/works/w_x/assets/images/h.png",
          kind: "image", metadata: { width: 1080, height: 1920 } },
      ],
      provenance: [
        { toAssetId: "asset-hero", fromAssetId: null,
          operation: { type: "generate", actor: "agent",
            timestamp: "2026-04-28T10:00:00Z", params: {} } },
      ],
      scenes: [
        { id: "scene-hook", order: 0, title: "Hook",
          memberClipIds: [], memberAssetIds: ["asset-hero"], intent: "hook" },
      ],
      captionStyle: {
        fontSize: 40, color: "#fff", background: "rgba(0,0,0,0.65)",
        bottomPercent: 0.08, fontWeight: 600, maxWidthPercent: 0.95,
      },
      exportPresets: [],
    });
    expect(r.assets).toHaveLength(1);
    expect(r.provenance).toHaveLength(1);
    expect(r.scenes?.[0].intent).toBe("hook");
    expect(r.captionStyle?.fontSize).toBe(40);
  });

  it("defaults assets/provenance to empty arrays when omitted (backward compat)", () => {
    const r = CompositionSchema.parse({
      id: "c_legacy",
      workId: "w_legacy",
      fps: 30,
      width: 1080,
      height: 1920,
      duration: 0,
      aspect: "9:16",
      tracks: [],
      updatedAt: "2026-04-28T10:00:00Z",
    });
    expect(r.assets).toEqual([]);
    expect(r.provenance).toEqual([]);
  });

  it("makeEmptyComposition seeds empty assets/provenance/scenes", () => {
    const c = makeEmptyComposition({ workId: "w_new" });
    expect(c.assets).toEqual([]);
    expect(c.provenance).toEqual([]);
    expect(c.scenes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** — verify failure: tests fail because `CompositionSchema` does not yet have `assets`/`provenance`/`scenes`/`captionStyle`/`exportPresets` fields and `makeEmptyComposition` does not seed them.

- [ ] **Step 3: Extend the schema** in `web/src/features/studio/types.ts`. Add the supporting schemas before `CompositionSchema`:

```ts
// ─── Scenes ─────────────────────────────────────────────────────────────────
// Scenes are semantic groupings of clip ids — "this is the hook section",
// "this is the payoff". They have no rendering effect; they're purely a
// planning + dive-canvas affordance. order is the user's intended sequence,
// independent of timeline order. memberAssetIds lets a scene reference assets
// not yet placed (e.g. an unused alt take that belongs to the same scene).

export const SceneSchema = z.object({
  id: z.string(),
  order: z.number(),
  title: z.string(),
  prompt: z.string().optional(),
  memberClipIds: z.array(z.string()).default([]),
  memberAssetIds: z.array(z.string()).default([]),
  intent: z.enum(["hook", "build", "payoff", "cta"]).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

// ─── Caption styling default ────────────────────────────────────────────────
// Project-level default caption style. Individual TextClips can override per
// clip. This is what the unified subtitle renderer (Phase 3 task) consumes.

export const CaptionStyleSchema = z.object({
  fontSize: z.number().default(40),
  color: z.string().default("#ffffff"),
  background: z.string().default("rgba(0,0,0,0.65)"),
  bottomPercent: z.number().default(0.08),
  fontWeight: z.number().default(600),
  maxWidthPercent: z.number().default(0.95),
  lineHeight: z.number().default(1.4),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

// ─── Export presets ─────────────────────────────────────────────────────────
// Per-platform export configuration. Phase 6 will expand this with full ffmpeg
// post-process chains. Phase 1 only locks the schema so old composition.yaml
// files round-trip without losing data.

export const ExportPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  platform: z.enum([
    "douyin", "xiaohongshu", "weixin-channels", "bilibili",
    "tiktok", "reels", "shorts", "youtube-long", "custom",
  ]),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  videoBitrate: z.number(),
  audioBitrate: z.number(),
  codec: z.enum(["h264", "h265", "vp9", "av1"]).default("h264"),
  container: z.enum(["mp4", "mov", "webm"]).default("mp4"),
  maxDurationSec: z.number().optional(),
  loudnessTargetLufs: z.number().default(-14),
  safeZonePct: z.number().default(0.05),
  notes: z.string().optional(),
});
export type ExportPreset = z.infer<typeof ExportPresetSchema>;
```

Then replace `CompositionSchema` (lines 122–138) with the extended version:

```ts
export const CompositionSchema = z.object({
  id: z.string(),
  workId: z.string(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().min(0),
  aspect: z.enum(ASPECTS),
  tracks: z.array(TrackSchema),
  updatedAt: z.string(),
  // ─── New in Phase 1 ─────────────────────────────────────────────────────
  assets: z.array(AssetEntrySchema).default([]),
  provenance: z.array(ProvenanceEdgeSchema).default([]),
  scenes: z.array(SceneSchema).optional(),
  captionStyle: CaptionStyleSchema.optional(),
  exportPresets: z.array(ExportPresetSchema).default([]),
});
export type Composition = z.infer<typeof CompositionSchema>;
```

- [ ] **Step 4: Run the test** — passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/types.ts web/src/features/studio/__tests__/types.test.ts
git commit -m "feat(types): extend Composition with assets/provenance/scenes/captionStyle/exportPresets

These fields are optional + default to [] so existing composition.yaml files
continue to load. Subsequent tasks populate them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 1.3 Task 1.3 — Server-side legacy migration: synthesise `assets[]` and `provenance[]` for old comps

**Files:**
- Modify: `src/server/api.ts:248-361` (the existing `synthesiseLegacyComposition` function and its caller in `GET /api/works/:id/composition`)
- Create: `src/server/__tests__/legacy-migration.test.ts`

- [ ] **Step 1: Write a failing test** in `src/server/__tests__/legacy-migration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { synthesiseLegacyAssetsAndProvenance } from "../api";
import type { Composition } from "../../../web/src/features/studio/types";

describe("synthesiseLegacyAssetsAndProvenance", () => {
  it("creates one AssetEntry per VideoClip and one ProvenanceEdge with type=import", () => {
    const legacy: Composition = {
      id: "c_w1", workId: "w1", fps: 30, width: 1080, height: 1920,
      duration: 4, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
      tracks: [
        { id: "video-0", kind: "video", label: "Video", muted: false, hidden: false,
          clips: [{ id: "clip-1", kind: "video",
            src: "/api/works/w1/assets/clips/shot1.mp4",
            in: 0, out: 4, trackOffset: 0,
            transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
            filters: { brightness: 0, contrast: 0, saturation: 0 } }] },
      ],
      assets: [], provenance: [], exportPresets: [],
    };
    const enriched = synthesiseLegacyAssetsAndProvenance(legacy);
    expect(enriched.assets).toHaveLength(1);
    expect(enriched.assets[0].uri).toBe("/api/works/w1/assets/clips/shot1.mp4");
    expect(enriched.assets[0].kind).toBe("video");
    expect(enriched.provenance).toHaveLength(1);
    expect(enriched.provenance[0].fromAssetId).toBeNull();
    expect(enriched.provenance[0].operation.type).toBe("import");
    expect(enriched.provenance[0].operation.actor).toBe("system");
  });

  it("does not duplicate AssetEntry when assets[] is already populated", () => {
    const already: Composition = {
      id: "c_w2", workId: "w2", fps: 30, width: 1080, height: 1920,
      duration: 4, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
      tracks: [{ id: "video-0", kind: "video", label: "Video",
        muted: false, hidden: false, clips: [
          { id: "clip-x", kind: "video", src: "/a/clips/x.mp4",
            in: 0, out: 4, trackOffset: 0,
            transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
            filters: { brightness: 0, contrast: 0, saturation: 0 } }] }],
      assets: [{ id: "asset-x", uri: "/a/clips/x.mp4", kind: "video",
        metadata: {}, status: "ready" }],
      provenance: [{ toAssetId: "asset-x", fromAssetId: null,
        operation: { type: "upload", actor: "user",
          timestamp: "2026-04-27T00:00:00Z", params: {} } }],
      exportPresets: [],
    };
    const r = synthesiseLegacyAssetsAndProvenance(already);
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0].id).toBe("asset-x");
    expect(r.provenance[0].operation.type).toBe("upload");
  });
});
```

- [ ] **Step 2: Run** — fails (function doesn't exist yet).

- [ ] **Step 3: Add the synthesiser** to `src/server/api.ts`. Insert immediately after the existing `synthesiseLegacyComposition` function:

```ts
import {
  type Composition,
  type AssetEntry,
  type ProvenanceEdge,
} from "../../web/src/features/studio/types";

/**
 * For compositions that pre-date Phase 1 (no assets/provenance arrays), walk
 * every clip's `src` and produce one AssetEntry per unique uri plus one
 * `import` provenance edge per asset. Idempotent: if assets[] is already
 * populated, the comp is returned unchanged.
 */
export function synthesiseLegacyAssetsAndProvenance(
  comp: Composition,
): Composition {
  if (comp.assets.length > 0) return comp;

  const assets: AssetEntry[] = [];
  const provenance: ProvenanceEdge[] = [];
  const seen = new Map<string, string>(); // uri → assetId

  for (const track of comp.tracks) {
    for (const clip of track.clips) {
      // Only video / audio / overlay clips reference a `src`. Text clips inline.
      if (clip.kind === "text") continue;
      const src = (clip as { src: string }).src;
      if (!src) continue;
      if (seen.has(src)) continue;

      const id = `asset-${clip.id}`;
      seen.set(src, id);

      const kind: AssetEntry["kind"] =
        clip.kind === "video" ? "video"
        : clip.kind === "audio" ? "audio"
        : "image"; // overlay → still image

      assets.push({
        id,
        uri: src,
        kind,
        name: src.split("/").pop() ?? id,
        metadata: {},
        status: "ready",
      });
      provenance.push({
        toAssetId: id,
        fromAssetId: null,
        operation: {
          type: "import",
          actor: "system",
          timestamp: comp.updatedAt,
          label: "legacy migration — pre-Phase-1 composition",
          params: {},
        },
      });
    }
  }

  return { ...comp, assets, provenance };
}
```

Then patch the GET handler at `src/server/api.ts:248` so the returned composition is always enriched. Find the existing handler block:

```ts
app.get("/api/works/:id/composition", async (c) => {
  // ... existing read logic ...
  // existing returns parsed composition or synthesiseLegacyComposition(...)
});
```

Wrap the final return in `synthesiseLegacyAssetsAndProvenance(...)`:

```ts
const parsed = CompositionSchema.parse(rawYaml);
const enriched = synthesiseLegacyAssetsAndProvenance(parsed);
return c.json(enriched);
```

(Apply the same wrap to the legacy-synth branch; both should call `synthesiseLegacyAssetsAndProvenance` before returning.)

- [ ] **Step 4: Run the test** — passes.

- [ ] **Step 5: Manual smoke test** — start the backend (`npm run dev:backend`) and curl an existing work:

```bash
curl -s 'http://localhost:3271/api/works/w_20260408_1347_db8/composition' | jq '.assets | length, .provenance | length'
```

Expected: both numbers > 0 (matches the number of unique `src` values in the comp).

- [ ] **Step 6: Commit**

```bash
git add src/server/api.ts src/server/__tests__/legacy-migration.test.ts
git commit -m "feat(server): synthesise assets[]+provenance[] for legacy compositions

GET /api/works/:id/composition now enriches every returned composition
with one AssetEntry per unique clip src and one type=import provenance
edge. Idempotent: comps that already carry assets/provenance round-trip
unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 1.4 Task 1.4 — Tighten `AudioTrackRenderer` to honour `fadeIn` / `fadeOut` / `volume`

**Files:**
- Rewrite: `web/src/features/studio/composition/tracks/AudioTrackRenderer.tsx`
- Create: `web/src/features/studio/composition/tracks/__tests__/AudioTrackRenderer.test.tsx`

The current renderer (26 lines) ignores `fadeIn`/`fadeOut`/`ducking`. Remotion's `<Audio>` component does not natively interpolate volume, so we wrap it with `interpolate()` driven by `useCurrentFrame()`.

- [ ] **Step 1: Write the failing test** in `__tests__/AudioTrackRenderer.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { computeAudioVolumeForFrame } from "../AudioTrackRenderer";

describe("computeAudioVolumeForFrame", () => {
  // Clip: trackOffset=0, in=0, out=10s, volume=1.0, fadeIn=2, fadeOut=2 @ 30fps
  const clip = { volume: 1.0, fadeIn: 2, fadeOut: 2, in: 0, out: 10 } as const;
  const fps = 30;

  it("returns 0 at the very start of fadeIn (frame 0)", () => {
    expect(computeAudioVolumeForFrame(clip, 0, fps)).toBeCloseTo(0, 3);
  });

  it("returns full volume at the end of fadeIn (frame 60)", () => {
    expect(computeAudioVolumeForFrame(clip, 60, fps)).toBeCloseTo(1, 3);
  });

  it("returns full volume in the middle of the clip (frame 150)", () => {
    expect(computeAudioVolumeForFrame(clip, 150, fps)).toBeCloseTo(1, 3);
  });

  it("returns 0 at the very end of fadeOut (frame 300)", () => {
    expect(computeAudioVolumeForFrame(clip, 300, fps)).toBeCloseTo(0, 3);
  });

  it("returns volume * 0.5 at the midpoint of fadeOut (frame 270)", () => {
    expect(computeAudioVolumeForFrame(clip, 270, fps)).toBeCloseTo(0.5, 3);
  });

  it("ignores fades when both are 0", () => {
    const flat = { volume: 0.8, fadeIn: 0, fadeOut: 0, in: 0, out: 5 };
    expect(computeAudioVolumeForFrame(flat, 0, fps)).toBeCloseTo(0.8, 3);
    expect(computeAudioVolumeForFrame(flat, 75, fps)).toBeCloseTo(0.8, 3);
  });
});
```

- [ ] **Step 2: Run** — fails (`computeAudioVolumeForFrame` not exported).

- [ ] **Step 3: Rewrite** `AudioTrackRenderer.tsx`:

```tsx
import { Sequence, Audio, useVideoConfig, useCurrentFrame } from "remotion";
import type { AudioClip, Track } from "../../types";

/**
 * Pure helper for testability: returns the effective volume for an audio
 * clip at a given frame counted from the clip's local 0 (i.e. inside the
 * Sequence). Both fadeIn and fadeOut are linear ramps in clip-local seconds.
 */
export function computeAudioVolumeForFrame(
  clip: { volume: number; fadeIn: number; fadeOut: number; in: number; out: number },
  localFrame: number,
  fps: number,
): number {
  const localSec = localFrame / fps;
  const dur = clip.out - clip.in;
  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;
  let v = clip.volume;
  if (fadeIn > 0 && localSec < fadeIn) {
    v *= Math.max(0, Math.min(1, localSec / fadeIn));
  }
  if (fadeOut > 0 && localSec > dur - fadeOut) {
    const t = (dur - localSec) / fadeOut;
    v *= Math.max(0, Math.min(1, t));
  }
  return Math.max(0, v);
}

function AudioClipRenderer({
  clip,
}: {
  clip: AudioClip;
}) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const v = computeAudioVolumeForFrame(clip, frame, fps);
  return (
    <Audio
      src={clip.src}
      startFrom={Math.round(clip.in * fps)}
      endAt={Math.round(clip.out * fps)}
      volume={v}
    />
  );
}

export function AudioTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.muted) return null;
  return (
    <>
      {(track.clips as AudioClip[]).map((c) => {
        const from = Math.round(c.trackOffset * fps);
        const dur = Math.max(1, Math.round((c.out - c.in) * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <AudioClipRenderer clip={c} />
          </Sequence>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Run the test** — passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/composition/tracks/AudioTrackRenderer.tsx \
        web/src/features/studio/composition/tracks/__tests__/AudioTrackRenderer.test.tsx
git commit -m "fix(audio): honour AudioClip.fadeIn/fadeOut in Remotion preview renderer

Previously the AudioTrackRenderer only passed clip.volume; fadeIn/fadeOut
were declared in the schema but ignored. Adds computeAudioVolumeForFrame
as a pure helper so the linear-ramp logic is unit-testable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> **Note on ducking:** AudioClip.ducking is honoured server-side in Phase 3 by piping every export through `mixAudioTracks`. Remotion's `<Audio>` cannot do sidechain compression in the browser; ducking will only fire on the rendered MP4, never during in-browser preview. This is documented in Phase 3.

### 1.5 Task 1.5 — Implement `kinetic-pop` and `typewriter` animations in `TextTrackRenderer`

**Files:**
- Modify: `web/src/features/studio/composition/tracks/TextTrackRenderer.tsx`
- Create: `web/src/features/studio/composition/tracks/__tests__/textAnimations.test.ts`

- [ ] **Step 1: Write failing tests** in `__tests__/textAnimations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeKineticPopScale,
  computeTypewriterChars,
} from "../TextTrackRenderer";

describe("computeKineticPopScale", () => {
  it("starts at 0 at frame 0", () => {
    expect(computeKineticPopScale(0, 30)).toBeCloseTo(0, 2);
  });
  it("overshoots above 1.0 mid-pop", () => {
    const v = computeKineticPopScale(6, 30);
    expect(v).toBeGreaterThan(1.0);
    expect(v).toBeLessThanOrEqual(1.2);
  });
  it("settles to 1.0 by frame 18", () => {
    expect(computeKineticPopScale(18, 30)).toBeCloseTo(1.0, 1);
  });
  it("stays at 1.0 after frame 30", () => {
    expect(computeKineticPopScale(45, 30)).toBeCloseTo(1.0, 2);
  });
});

describe("computeTypewriterChars", () => {
  it("reveals 0 chars at frame 0", () => {
    expect(computeTypewriterChars("hello world", 0, 30)).toBe(0);
  });
  it("reveals all chars after the typing window", () => {
    expect(computeTypewriterChars("hi", 60, 30)).toBe(2);
  });
  it("reveals chars proportionally during the typing window", () => {
    // 11 chars over 22 frames (2 fps-per-char by default)
    expect(computeTypewriterChars("hello world", 11, 30)).toBeGreaterThanOrEqual(5);
    expect(computeTypewriterChars("hello world", 11, 30)).toBeLessThanOrEqual(7);
  });
  it("never returns more than text length", () => {
    expect(computeTypewriterChars("ab", 1000, 30)).toBe(2);
  });
});
```

- [ ] **Step 2: Run** — fails.

- [ ] **Step 3: Extend** `TextTrackRenderer.tsx`. Replace the file contents with:

```tsx
import {
  Sequence,
  AbsoluteFill,
  useVideoConfig,
  interpolate,
  spring,
  useCurrentFrame,
} from "remotion";
import type { TextClip, Track } from "../../types";
import { resolvePosition } from "../layout/positionResolve";

// ─── Animation primitives (pure, exported for tests) ───────────────────────

/**
 * Kinetic-pop: spring-driven scale from 0 → 1.05 (overshoot) → 1.0.
 * Damping intentionally low for a brisk attention-grabbing entrance.
 */
export function computeKineticPopScale(frame: number, fps: number): number {
  return spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.6, stiffness: 180 },
    durationInFrames: 18,
  });
}

/**
 * Typewriter: number of chars to reveal at the given frame. Default cadence
 * is 2 frames per character (≈15 chars/sec @ 30fps), capped at text length.
 */
export function computeTypewriterChars(
  text: string,
  frame: number,
  fps: number,
  framesPerChar = 2,
): number {
  const max = text.length;
  const revealed = Math.floor(frame / framesPerChar);
  return Math.max(0, Math.min(max, revealed));
}

// ─── Component ─────────────────────────────────────────────────────────────

function AnimatedText({ clip }: { clip: TextClip }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const pos = resolvePosition(clip.position, { width, height });

  let opacity = 1;
  let yOffset = 0;
  let scale = 1;
  let renderedText = clip.text;

  switch (clip.animation) {
    case "fade":
      opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
      break;
    case "slide-up":
      yOffset = interpolate(frame, [0, 12], [40, 0], { extrapolateRight: "clamp" });
      break;
    case "kinetic-pop":
      scale = computeKineticPopScale(frame, fps);
      // Light fade-in companion so the pop doesn't appear from solid full
      opacity = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: "clamp" });
      break;
    case "typewriter":
      renderedText = clip.text.slice(0, computeTypewriterChars(clip.text, frame, fps));
      break;
    default:
      break;
  }

  return (
    <div
      style={{
        ...pos,
        opacity,
        transform: `${pos.transform} translateY(${yOffset}px) scale(${scale})`,
        transformOrigin: "center center",
        fontFamily: clip.style.font,
        fontSize: clip.style.size,
        fontWeight: clip.style.weight,
        fontStyle: clip.style.italic ? "italic" : "normal",
        letterSpacing: clip.style.tracking,
        color: clip.style.color,
        textShadow: clip.style.stroke
          ? `0 0 ${clip.style.stroke.width}px ${clip.style.stroke.color}`
          : undefined,
        whiteSpace: "pre-wrap",
        textAlign: "center",
      }}
    >
      {renderedText}
    </div>
  );
}

export function TextTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as TextClip[]).map((c) => (
        <Sequence
          key={c.id}
          from={Math.round(c.trackOffset * fps)}
          durationInFrames={Math.max(1, Math.round(c.duration * fps))}
        >
          <AbsoluteFill>
            <AnimatedText clip={c} />
          </AbsoluteFill>
        </Sequence>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Run the tests** — passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/composition/tracks/TextTrackRenderer.tsx \
        web/src/features/studio/composition/tracks/__tests__/textAnimations.test.ts
git commit -m "feat(text): implement kinetic-pop and typewriter animations

Both were declared in TextClipSchema but the renderer only handled fade
and slide-up. Adds spring-driven pop with damping=12 and proportional
char-reveal typewriter. Exports computeKineticPopScale and
computeTypewriterChars as pure helpers for unit testing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 1.6 Task 1.6 — Add `addAsset` / `addProvenance` / `removeAsset` actions to the studio store

**Files:**
- Modify: `web/src/features/studio/store.ts:131` (extend the existing Zustand+immer store)
- Modify: `web/src/features/studio/__tests__/store.test.ts` (or create if missing)

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";

describe("studio store provenance actions", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: makeEmptyComposition({ workId: "w_test" }),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
    });
  });

  it("addAsset appends to comp.assets", () => {
    useComposition.getState().addAsset({
      id: "asset-x", uri: "/api/works/w_test/assets/clips/x.mp4",
      kind: "video", metadata: {}, status: "ready",
    });
    expect(useComposition.getState().comp!.assets).toHaveLength(1);
    expect(useComposition.getState().comp!.assets[0].id).toBe("asset-x");
  });

  it("addProvenance appends to comp.provenance", () => {
    useComposition.getState().addProvenance({
      toAssetId: "asset-x", fromAssetId: null,
      operation: { type: "generate", actor: "agent",
        timestamp: "2026-04-28T10:00:00Z", params: {} },
    });
    expect(useComposition.getState().comp!.provenance).toHaveLength(1);
  });

  it("removeAsset removes the asset and its provenance edge(s)", () => {
    const s = useComposition.getState();
    s.addAsset({ id: "asset-y", uri: "/y", kind: "image",
      metadata: {}, status: "ready" });
    s.addProvenance({ toAssetId: "asset-y", fromAssetId: null,
      operation: { type: "generate", actor: "agent",
        timestamp: "t", params: {} } });
    s.addProvenance({ toAssetId: "asset-z", fromAssetId: "asset-y",
      operation: { type: "derive", actor: "agent",
        timestamp: "t", params: {} } });
    s.removeAsset("asset-y");
    expect(useComposition.getState().comp!.assets).toHaveLength(0);
    // Edges where toAssetId === asset-y are removed; edges that DERIVED from
    // asset-y keep their fromAssetId so the lineage stays visible (broken-link
    // state is reconciled by the dive view in Phase 5).
    expect(useComposition.getState().comp!.provenance).toHaveLength(1);
    expect(useComposition.getState().comp!.provenance[0].toAssetId).toBe("asset-z");
  });
});
```

- [ ] **Step 2: Run** — fails (actions don't exist).

- [ ] **Step 3: Extend** `web/src/features/studio/store.ts`. Add to the action interface and implementation:

```ts
import type { AssetEntry, ProvenanceEdge } from "./types";

interface CompositionStore {
  // ... existing ...
  addAsset: (asset: AssetEntry) => void;
  addProvenance: (edge: ProvenanceEdge) => void;
  removeAsset: (assetId: string) => void;
}

// In the store factory:
addAsset: (asset) =>
  set((s) => {
    if (!s.comp) return;
    if (s.comp.assets.some((a) => a.id === asset.id)) return;
    s.comp.assets.push(asset);
  }),

addProvenance: (edge) =>
  set((s) => {
    if (!s.comp) return;
    s.comp.provenance.push(edge);
  }),

removeAsset: (assetId) =>
  set((s) => {
    if (!s.comp) return;
    s.comp.assets = s.comp.assets.filter((a) => a.id !== assetId);
    s.comp.provenance = s.comp.provenance.filter((e) => e.toAssetId !== assetId);
  }),
```

- [ ] **Step 4: Run the tests** — passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/store.ts web/src/features/studio/__tests__/store.test.ts
git commit -m "feat(store): add addAsset/addProvenance/removeAsset actions

Phase 2's locator + structured generation needs first-class store mutations
for the asset registry. Actions de-duplicate on add and clean dangling edges
on remove (edges with this asset as TARGET; edges deriving FROM this asset
keep their fromAssetId so lineage stays visible).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 1.7 Task 1.7 — Clean redundant ternary in `audio-tools.ts`

**Files:**
- Modify: `src/audio-tools.ts:269-274`

- [ ] **Step 1: Inspect the redundancy.** Lines 270–274 read:

```ts
const finalLabels = tracks.map((_, i) => {
  // If ducked, use the ducked label (t{i}); otherwise use the original label
  return hasDucking[i] ? `t${i}` : `t${i}`;
});
```

Both ternary branches return the same string. Whether ducked or not, the FINAL label is `t${i}` (for non-ducked tracks the label was emitted directly as `t${i}`; for ducked tracks the sidechain output is named `t${i}` per line 265). The ternary is dead code.

- [ ] **Step 2: Replace** lines 270–274 with:

```ts
// Final label is `t${i}` regardless of ducking — non-ducked tracks emit
// directly with that label (line 236), and ducked tracks' sidechain output
// is also labeled `t${i}` (line 265). The hasDucking branch is preserved
// here for documentation purposes only.
const finalLabels = tracks.map((_, i) => `t${i}`);
```

- [ ] **Step 3: Run existing audio tests** to confirm no regression:

```bash
npx vitest run src/__tests__/audio-tools.test.ts
```

(If no test file exists for audio-tools, manually verify with: start backend, POST a mix request through `/api/audio/mix`, check the resulting MP4 plays back with the expected ducking and fades.)

- [ ] **Step 4: Commit**

```bash
git add src/audio-tools.ts
git commit -m "chore(audio): remove dead ternary in mixAudioTracks finalLabels

Both branches returned the same string — non-ducked tracks emit directly
with label t<i>, and ducked tracks' sidechain output is also labeled
t<i>, so the conditional was always redundant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 1.8 Task 1.8 — Safe-name + ISO-stamp render output filenames

**Files:**
- Modify: `src/server/remotion-renderer.ts:21`

The current renderer writes `final-${Date.now()}.mp4` which is opaque. Pneuma's pattern (`safeTitle.replace(/[^\w.-]+/g, "-") + ISOstamp + ".mp4"`) is 3 lines and immediately readable in Finder.

- [ ] **Step 1: Write a unit test** for the helper. Create `src/server/__tests__/safeFilename.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSafeOutputFilename } from "../remotion-renderer";

describe("buildSafeOutputFilename", () => {
  it("lowercases and slugifies the title", () => {
    const f = buildSafeOutputFilename("My Big Title!", new Date("2026-04-28T12:34:56Z"));
    expect(f).toBe("my-big-title-2026-04-28-12-34-56.mp4");
  });
  it("strips non-word characters incl. CJK", () => {
    const f = buildSafeOutputFilename("春日咖啡 — Carousel", new Date("2026-04-28T00:00:00Z"));
    // 春日咖啡 is dropped, em-dash dropped, "Carousel" kept
    expect(f.endsWith("-carousel-2026-04-28-00-00-00.mp4")).toBe(true);
  });
  it("falls back to autoviral-export when title is empty", () => {
    const f = buildSafeOutputFilename("", new Date("2026-04-28T00:00:00Z"));
    expect(f).toBe("autoviral-export-2026-04-28-00-00-00.mp4");
  });
});
```

- [ ] **Step 2: Run** — fails.

- [ ] **Step 3: Modify** `src/server/remotion-renderer.ts`. Add the helper above `renderCompositionToMp4`:

```ts
export function buildSafeOutputFilename(
  title: string | undefined,
  now: Date = new Date(),
): string {
  const safe = (title ?? "")
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "autoviral-export";
  const stamp = now
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `${safe}-${stamp}.mp4`;
}
```

Then change the existing line `const outFile = join(outDir, \`final-${Date.now()}.mp4\`);` to accept an optional title from caller. Update the function signature:

```ts
export async function renderCompositionToMp4(
  comp: { duration: number; fps: number; width: number; height: number; title?: string; [k: string]: unknown },
  outDir: string,
): Promise<string> {
  // ... existing bundle/select/render code ...
  const outFile = join(outDir, buildSafeOutputFilename(comp.title));
  // ... rest unchanged ...
}
```

The `title` is passed through `inputProps` from the API handler at `src/server/api.ts:466` (`POST /api/works/:id/render`); locate that handler and ensure it spreads `work.title` into the `comp` argument before calling `renderCompositionToMp4`.

- [ ] **Step 4: Run tests** — passes.

- [ ] **Step 5: Smoke test** — render a work via the UI export button, verify the output filename in `~/.autoviral/works/<id>/output/` reads e.g. `my-work-2026-04-28-12-34-56.mp4`.

- [ ] **Step 6: Commit**

```bash
git add src/server/remotion-renderer.ts src/server/__tests__/safeFilename.test.ts
git commit -m "feat(render): safe-slug + ISO-stamp render output filenames

Switches from opaque final-<epoch>.mp4 to <slug-title>-<iso>.mp4 so the
output is readable in Finder. Empty/CJK-only titles fall back to
autoviral-export.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 1.9 Phase 1 Acceptance Criteria

- [ ] All Phase 1 unit tests pass: `npx vitest run web/src/features/studio/__tests__ src/server/__tests__`.
- [ ] Type-check clean: `npx tsc --noEmit`.
- [ ] Existing UI flows (open Studio, export an MP4, edit a TextClip) still work.
- [ ] An old work (created before Phase 1) loaded into Studio shows non-empty `composition.assets[]` and `composition.provenance[]` after auto-migration.
- [ ] Audio clips with `fadeIn=2, fadeOut=2` audibly fade in and out in the Remotion preview (browser).
- [ ] A TextClip with `animation: "kinetic-pop"` visibly springs into place; one with `animation: "typewriter"` reveals char-by-char.
- [ ] Render output file is `<slug>-<iso>.mp4`.

### 1.10 Phase 1 Done — Commit a milestone tag

```bash
git tag -a phase-1-foundation -m "Phase 1 — Provenance DAG + schema 兑现 complete"
```

---

## 2. Phase 2 — Agent Protocol: Locator + Structured Generation + Filter-retry

**Why now:** With the data model in place, the next force-multiplier is teaching the agent to *talk* about it. Pneuma's biggest creator-flow win is the `[clipcraft:create-asset]` / `[clipcraft:generate-variant]` notification protocol plus `<viewer-locator>` cards. We port both to AutoViral and add local Dreamina/Jimeng filter-retry rules (their content classifiers are stricter than seedance's).

### 2.0 File Structure

```
src/
├── ws-bridge.ts                                              ← extend ALLOWED_STREAM_TYPES + ChatBlock union
└── server/
    └── api.ts                                                ← extend (no new routes; tool-handler hook for locator)

web/src/features/
├── chat/
│   ├── types.ts                                              ← extend StreamBlockType + LocatorBlock interface
│   ├── store.ts                                              ← already has push() — ensure locator survives
│   └── LocatorBlock.tsx                                      ← NEW
├── studio/
│   ├── panels/Chat/index.tsx                                 ← extend — render LocatorBlock when type=locator
│   └── generation/
│       ├── dispatchGeneration.ts                             ← NEW — port of pneuma protocol
│       └── GenerationDialog.tsx                              ← NEW — modal with image/video/audio sub-forms

skills/autoviral/modules/assets/
├── capabilities/
│   ├── reference-directives.md                               ← NEW — @image1/@video1/@audio1 + role table
│   ├── filter-retries.md                                     ← NEW — Dreamina + Jimeng signatures
│   ├── character-consistency.md                              ← NEW — photo-body/sketch-head sheet
│   └── structured-generation.md                              ← NEW — [autoviral:create-asset] / [autoviral:generate-variant] protocol
├── scripts/
│   ├── make_character_sheet.py                               ← NEW — char sheet via OpenRouter+gpt-5.4-image-2 edit mode
│   └── filter_retry/
│       ├── detect_signature.py                               ← NEW — stdin: error JSON; stdout: {sig, recovery}
│       └── __init__.py
└── references/
    └── reference-roles.md                                    ← NEW — full role vocabulary table for agent

skills/autoviral/SKILL.md                                     ← extend — pointers to new capabilities + locator protocol
```

### 2.1 Task 2.1 — Add `locator` to chat block types

**Files:**
- Modify: `src/ws-bridge.ts:30-37` (`ChatBlock` interface) and line 125 (`ALLOWED_STREAM_TYPES`)
- Modify: `web/src/features/chat/types.ts` (`StreamBlockType` union + `LocatorBlock` interface)
- Create: `web/src/features/chat/__tests__/locator.test.ts`

- [ ] **Step 1: Write a failing test** in `web/src/features/chat/__tests__/locator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLocatorTag, type LocatorData } from "../types";

describe("parseLocatorTag", () => {
  it("extracts label + data from a viewer-locator tag", () => {
    const md = `Some prose <viewer-locator label="→ shot 2" data='{"clipId":"clip-2","time":4.5,"assetId":"asset-shot2"}' /> trailing.`;
    const r = parseLocatorTag(md);
    expect(r).not.toBeNull();
    expect(r!.label).toBe("→ shot 2");
    expect(r!.data.clipId).toBe("clip-2");
    expect(r!.data.time).toBe(4.5);
    expect(r!.data.assetId).toBe("asset-shot2");
  });
  it("returns null when there is no locator tag", () => {
    expect(parseLocatorTag("plain text")).toBeNull();
  });
  it("tolerates single quotes around the data attribute", () => {
    const md = `<viewer-locator label='asset' data='{"assetId":"x"}' />`;
    expect(parseLocatorTag(md)?.data.assetId).toBe("x");
  });
});
```

- [ ] **Step 2: Run** — fails.

- [ ] **Step 3: Extend** `web/src/features/chat/types.ts`:

```ts
export type StreamBlockType =
  | "user"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "ask_question"
  | "locator"; // NEW

export interface LocatorData {
  clipId?: string;
  time?: number;     // seconds, can be fractional
  assetId?: string;
  trackId?: string;
}

export interface LocatorBlock {
  id: string;
  type: "locator";
  label: string;
  data: LocatorData;
  timestamp?: number;
}

const LOCATOR_RX =
  /<viewer-locator\s+label\s*=\s*(?:"([^"]+)"|'([^']+)')\s+data\s*=\s*(?:"([^"]+)"|'([^']+)')\s*\/?>/i;

export function parseLocatorTag(
  text: string,
): { label: string; data: LocatorData } | null {
  const m = text.match(LOCATOR_RX);
  if (!m) return null;
  const label = m[1] ?? m[2] ?? "";
  const dataRaw = m[3] ?? m[4] ?? "{}";
  try {
    const data = JSON.parse(dataRaw) as LocatorData;
    return { label, data };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run** — passes.

- [ ] **Step 5: Extend the server-side ChatBlock**. In `src/ws-bridge.ts:30-37`, replace the `ChatBlock` interface:

```ts
export interface ChatBlock {
  type: "user" | "text" | "thinking" | "tool_use" | "tool_result" | "locator";
  text?: string;       // user / text / thinking / tool_use(serialized) / tool_result
  toolName?: string;   // tool_use / tool_result
  collapsed?: boolean;
  timestamp?: number;
  source?: "creator" | "evaluator";
  // ─── Locator-specific fields ───
  label?: string;
  data?: { clipId?: string; time?: number; assetId?: string; trackId?: string };
}
```

And update `ALLOWED_STREAM_TYPES` at line 125:

```ts
const ALLOWED_STREAM_TYPES = new Set([
  "user", "text", "thinking", "tool_use", "tool_result", "locator",
]);
```

- [ ] **Step 6: Commit**

```bash
git add src/ws-bridge.ts web/src/features/chat/types.ts \
        web/src/features/chat/__tests__/locator.test.ts
git commit -m "feat(chat): add 'locator' stream block type + tag parser

Locator blocks let the agent emit clickable jump-points like
<viewer-locator label='→ shot 2' data='{\"clipId\":\"clip-2\",\"time\":4.5}' />
that the chat panel renders as pill buttons. Server allows the new type
through; client parses inline tags from text blocks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 2.2 Task 2.2 — Build the `LocatorBlock` UI component

**Files:**
- Create: `web/src/features/chat/LocatorBlock.tsx`
- Create: `web/src/features/chat/__tests__/LocatorBlock.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LocatorBlockView } from "../LocatorBlock";

describe("LocatorBlockView", () => {
  it("renders the label", () => {
    const { getByText } = render(
      <LocatorBlockView label="→ shot 2" data={{ clipId: "c-2", time: 4.5 }} onJump={() => {}} />,
    );
    expect(getByText("→ shot 2")).toBeTruthy();
  });

  it("calls onJump with the data on click", () => {
    const onJump = vi.fn();
    const { getByRole } = render(
      <LocatorBlockView label="hop" data={{ clipId: "c-9", time: 12 }} onJump={onJump} />,
    );
    fireEvent.click(getByRole("button"));
    expect(onJump).toHaveBeenCalledWith({ clipId: "c-9", time: 12 });
  });
});
```

- [ ] **Step 2: Run** — fails.

- [ ] **Step 3: Implement** `web/src/features/chat/LocatorBlock.tsx`:

```tsx
import type { LocatorData } from "./types";

export function LocatorBlockView({
  label,
  data,
  onJump,
}: {
  label: string;
  data: LocatorData;
  onJump: (d: LocatorData) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(data)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        marginRight: 6,
        borderRadius: 12,
        border: "1px solid var(--accent)",
        background: "rgba(168, 197, 214, 0.1)",
        color: "var(--accent)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.05em",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 4: Run the test** — passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/chat/LocatorBlock.tsx \
        web/src/features/chat/__tests__/LocatorBlock.test.tsx
git commit -m "feat(chat): LocatorBlockView pill button component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 2.3 Task 2.3 — Wire `LocatorBlock` into the Studio Chat panel

**Files:**
- Modify: `web/src/features/studio/panels/Chat/index.tsx` (the message rendering block)

- [ ] **Step 1: Locate** the `block.type === "text"` branch in `Chat/index.tsx`. The current rendering is `<ReactMarkdown>{block.text}</ReactMarkdown>`. We will pre-process the markdown to extract any locator tags and render them as React components.

- [ ] **Step 2: Add a helper** above the component that splits a text body into segments:

```tsx
import { parseLocatorTag, type LocatorData } from "@/features/chat/types";
import { LocatorBlockView } from "@/features/chat/LocatorBlock";

const LOCATOR_RX =
  /<viewer-locator\s+label\s*=\s*(?:"([^"]+)"|'([^']+)')\s+data\s*=\s*(?:"([^"]+)"|'([^']+)')\s*\/?>/gi;

interface LocatorSegment { kind: "locator"; label: string; data: LocatorData; }
interface MarkdownSegment { kind: "markdown"; text: string; }

function segmentTextWithLocators(text: string): Array<LocatorSegment | MarkdownSegment> {
  const out: Array<LocatorSegment | MarkdownSegment> = [];
  let lastIdx = 0;
  for (const m of text.matchAll(LOCATOR_RX)) {
    if (m.index === undefined) continue;
    if (m.index > lastIdx) out.push({ kind: "markdown", text: text.slice(lastIdx, m.index) });
    const label = m[1] ?? m[2] ?? "";
    const dataRaw = m[3] ?? m[4] ?? "{}";
    try {
      const data = JSON.parse(dataRaw) as LocatorData;
      out.push({ kind: "locator", label, data });
    } catch {
      // bad JSON — render the raw tag as text
      out.push({ kind: "markdown", text: m[0] });
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push({ kind: "markdown", text: text.slice(lastIdx) });
  return out;
}
```

- [ ] **Step 3: Modify** the text-block render to use `segmentTextWithLocators` and connect to the studio store:

```tsx
import { useComposition } from "@/features/studio/store";

function jumpTo(data: LocatorData) {
  const s = useComposition.getState();
  if (data.clipId) s.setSelection({ trackId: "", clipId: data.clipId });
  if (typeof data.time === "number" && s.comp) {
    s.setFrame(Math.round(data.time * s.comp.fps));
  }
}

// inside the text-block render:
const segments = segmentTextWithLocators(block.text ?? "");
return (
  <div className="md-bubble">
    {segments.map((seg, i) =>
      seg.kind === "markdown" ? (
        <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
      ) : (
        <LocatorBlockView key={i} label={seg.label} data={seg.data} onJump={jumpTo} />
      ),
    )}
  </div>
);
```

- [ ] **Step 4: Manual smoke test** — run the dev server, paste this into a chat message manually (via the WS test harness or by editing chat.json):

```
Generated shot 2. <viewer-locator label="→ shot 2 @ 04:00" data='{"clipId":"clip-shot2","time":4}' />
```

Expected: pill button renders next to the text; clicking it selects the clip and seeks the playhead to 4 seconds.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/panels/Chat/index.tsx
git commit -m "feat(chat): render inline <viewer-locator/> as clickable pills

Splits text blocks into markdown segments interleaved with LocatorBlockViews.
Clicking a pill selects the target clip and seeks the playhead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 2.4 Task 2.4 — Implement `dispatchGeneration` (structured create + variant requests)

**Files:**
- Create: `web/src/features/studio/generation/dispatchGeneration.ts`
- Create: `web/src/features/studio/generation/__tests__/dispatchGeneration.test.ts`

This is the AutoViral port of pneuma's `dispatchGeneration.ts` (478 lines), adapted to AutoViral's providers (Dreamina/Jimeng for video, OpenRouter `gpt-5.4-image-2` for image, Lyria 3 Pro for music, plus a TTS provider added in Phase 3). The schema is intentionally identical to pneuma's so prompts/skills can be cross-referenced; only `script` paths and `provenance_hint.model` differ.

- [ ] **Step 1: Write failing tests**:

```ts
import { describe, it, expect } from "vitest";
import {
  buildGenerationNotification,
  type GenerationRequest,
} from "../dispatchGeneration";

describe("buildGenerationNotification — create image", () => {
  const req: GenerationRequest = {
    mode: "create",
    params: { kind: "image", prompt: "panda eating bamboo", aspectRatio: "9:16" },
  };
  const n = buildGenerationNotification(req);

  it("uses the autoviral:create-asset tag", () => {
    expect(n.type).toBe("autoviral:create-asset");
    expect(n.summary).toBe("/autoviral:create-asset");
  });
  it("embeds a fenced JSON block with the script + script_args", () => {
    expect(n.message).toContain("```json");
    expect(n.message).toContain('"script": "modules/assets/scripts/openrouter_generate.py"');
    expect(n.message).toContain('"--aspect-ratio": "9:16"');
  });
  it("provenance_hint has from_asset_id=null + operation_type=generate", () => {
    expect(n.message).toContain('"operation_type": "generate"');
    expect(n.message).toContain('"from_asset_id": null');
  });
});

describe("buildGenerationNotification — variant video", () => {
  const req: GenerationRequest = {
    mode: "variant",
    params: {
      kind: "video", prompt: "(frozen)", changeDirection: "slower droop",
      duration: "4", aspectRatio: "9:16",
    },
    source: {
      id: "asset-panda-v1", name: "Panda v1",
      uri: "/api/works/w_x/assets/clips/panda-v1.mp4",
      sourcePrompt: "panda drooping head", sourceModel: "dreamina/seedance-pro",
      sourceWidth: 1080, sourceHeight: 1920, sourceAspectRatio: "9:16",
      sourceDuration: 4, sourceVoice: null,
    },
  };
  const n = buildGenerationNotification(req);

  it("uses the autoviral:generate-variant tag", () => {
    expect(n.type).toBe("autoviral:generate-variant");
  });
  it("auto-wires source.uri as --image-url for the from-image script", () => {
    expect(n.message).toContain('"--image-url": "/api/works/w_x/assets/clips/panda-v1.mp4"');
    expect(n.message).toContain('"script": "modules/assets/scripts/dreamina_generate.py from-image"');
  });
  it("operation_type=derive + from_asset_id=source.id", () => {
    expect(n.message).toContain('"operation_type": "derive"');
    expect(n.message).toContain('"from_asset_id": "asset-panda-v1"');
  });
});

describe("buildGenerationNotification — TTS", () => {
  const req: GenerationRequest = {
    mode: "create",
    params: {
      kind: "audio", subKind: "tts",
      prompt: "你好，这是测试旁白",
      voice: "zh-CN-XiaoxiaoNeural", changeDirection: undefined,
    },
  };
  const n = buildGenerationNotification(req);
  it("routes to the TTS script with --voice", () => {
    expect(n.message).toContain('"script": "modules/assets/scripts/tts_generate.py"');
    expect(n.message).toContain('"--voice": "zh-CN-XiaoxiaoNeural"');
  });
});
```

- [ ] **Step 2: Run** — fails (file not yet created).

- [ ] **Step 3: Implement** `dispatchGeneration.ts`. The structure mirrors pneuma's; the AutoViral-specific bits are the `script` paths and `provenance_hint.model`. Key differences:

- Image script: `modules/assets/scripts/openrouter_generate.py` (positional prompt, `--aspect-ratio` or `--image-size`).
- Video script: `modules/assets/scripts/dreamina_generate.py` for default; `from-image` subcommand for image-anchored.
- BGM script: `modules/assets/scripts/music_generate.py` (Lyria 3).
- TTS script: `modules/assets/scripts/tts_generate.py` (added in Phase 3 — the Phase 2 dispatcher already references it; the script lands in Phase 3 task 3.X).

```ts
export type AssetKind = "image" | "video" | "audio";
export type RequestMode = "create" | "variant";

export interface ImageParams {
  kind: "image"; prompt: string; changeDirection?: string;
  aspectRatio?: string; width?: number; height?: number; style?: string;
}
export interface VideoParams {
  kind: "video"; prompt: string; changeDirection?: string;
  duration: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5" | "3:4" | "21:9" | "auto";
  resolution?: "720p" | "1080p"; imageUrl?: string;
}
export interface AudioParams {
  kind: "audio"; subKind: "tts" | "bgm"; prompt: string; changeDirection?: string;
  voice?: string; durationSeconds?: number;
}
export type GenerationParams = ImageParams | VideoParams | AudioParams;

export interface GenerationRequest {
  mode: RequestMode;
  params: GenerationParams;
  source?: {
    id: string; name: string;
    uri?: string | null;
    sourcePrompt?: string | null; sourceModel?: string | null;
    sourceWidth?: number | null; sourceHeight?: number | null;
    sourceAspectRatio?: string | null;
    sourceDuration?: number | null; sourceVoice?: string | null;
  };
}

export interface ViewerNotification {
  type: string; severity: "info" | "warning";
  summary: string; message: string;
}

const TAG_CREATE = "autoviral:create-asset";
const TAG_VARIANT = "autoviral:generate-variant";

export function buildGenerationNotification(req: GenerationRequest): ViewerNotification {
  const tag = req.mode === "variant" ? TAG_VARIANT : TAG_CREATE;
  const summary = buildSummary(req);
  const payload = buildPayload(req);
  const instructions = buildInstructions(req);
  return {
    type: tag, severity: "warning", summary: `/${tag}`,
    message: `[${tag}] ${summary}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n${instructions}`,
  };
}

function buildSummary(req: GenerationRequest): string {
  const kind = req.params.kind;
  if (req.mode === "variant" && req.source) {
    const change = truncate(req.params.changeDirection ?? "", 80);
    return `Generate a variant of ${req.source.name} (${req.source.id}) — ${kind} — change: "${change}"`;
  }
  return `Create a new asset — ${kind} — "${truncate(req.params.prompt, 80)}"`;
}

interface JsonPayload {
  mode: RequestMode; kind: AssetKind; sub_kind?: "tts" | "bgm";
  prompt?: string; change_direction?: string;
  params: Record<string, unknown>;
  source?: {
    asset_id: string; asset_name: string;
    uri?: string | null; prompt?: string | null; model?: string | null;
    width?: number | null; height?: number | null;
    aspect_ratio?: string | null; duration?: number | null; voice?: string | null;
  };
  script: string;
  script_args: Record<string, string | number>;
  provenance_hint: {
    operation_type: "generate" | "derive";
    from_asset_id: string | null;
    agent_id: string; label: string; model: string;
  };
}

function buildPayload(req: GenerationRequest): JsonPayload {
  const isVariant = req.mode === "variant";
  const base: Omit<JsonPayload, "params" | "script" | "script_args" | "provenance_hint"> = {
    mode: req.mode, kind: req.params.kind,
  };
  if (isVariant) base.change_direction = req.params.changeDirection ?? "";
  else base.prompt = req.params.prompt;
  if (req.params.kind === "audio") (base as JsonPayload).sub_kind = req.params.subKind;
  if (req.source) {
    base.source = {
      asset_id: req.source.id, asset_name: req.source.name,
      uri: req.source.uri ?? null,
      prompt: req.source.sourcePrompt ?? null, model: req.source.sourceModel ?? null,
      width: req.source.sourceWidth ?? null, height: req.source.sourceHeight ?? null,
      aspect_ratio: req.source.sourceAspectRatio ?? null,
      duration: req.source.sourceDuration ?? null, voice: req.source.sourceVoice ?? null,
    };
  }
  const r = resolveScriptForRequest(req);
  return { ...base, params: r.params, script: r.script, script_args: r.scriptArgs, provenance_hint: r.provenance };
}

interface Resolved {
  params: Record<string, unknown>;
  script: string;
  scriptArgs: Record<string, string | number>;
  provenance: JsonPayload["provenance_hint"];
}

function resolveScriptForRequest(req: GenerationRequest): Resolved {
  const operationType: "generate" | "derive" = req.mode === "variant" ? "derive" : "generate";
  const fromAssetId = req.mode === "variant" ? (req.source?.id ?? null) : null;
  const p = req.params;

  switch (p.kind) {
    case "image": {
      const aspectRatio = p.aspectRatio ?? "1:1";
      const args: Record<string, string | number> = {};
      if (p.width && p.height) args["--image-size"] = `${p.width}x${p.height}`;
      else args["--aspect-ratio"] = aspectRatio;
      // openrouter_generate.py takes prompt as a flag --prompt (verify against Phase 1 audit).
      // If the script accepts positional, change the runner instructions in
      // structured-generation.md accordingly.
      args["--prompt"] = p.prompt;
      return {
        params: {
          prompt: p.prompt, aspect_ratio: aspectRatio,
          width: p.width ?? null, height: p.height ?? null, style: p.style ?? null,
        },
        script: "modules/assets/scripts/openrouter_generate.py",
        scriptArgs: args,
        provenance: {
          operation_type: operationType, from_asset_id: fromAssetId,
          agent_id: "autoviral-imagegen",
          label: "openai/gpt-5.4-image-2", model: "openai/gpt-5.4-image-2",
        },
      };
    }
    case "video": {
      const isVariant = req.mode === "variant";
      const autoImageUrl = isVariant && req.source?.uri ? req.source.uri : null;
      const resolvedImageUrl = p.imageUrl ?? autoImageUrl;
      const useFromImage = !!resolvedImageUrl;
      const args: Record<string, string | number> = {
        "--prompt": p.prompt, "--duration": p.duration,
      };
      if (p.aspectRatio) args["--aspect-ratio"] = p.aspectRatio;
      if (p.resolution) args["--resolution"] = p.resolution;
      if (useFromImage) args["--image-url"] = resolvedImageUrl as string;
      const modelId = useFromImage ? "dreamina/seedance-pro/image-to-video"
                                   : "dreamina/seedance-pro/text-to-video";
      return {
        params: {
          prompt: p.prompt, duration: p.duration,
          aspect_ratio: p.aspectRatio ?? "auto",
          resolution: p.resolution ?? "720p",
          image_url: resolvedImageUrl ?? null,
        },
        script: useFromImage
          ? "modules/assets/scripts/dreamina_generate.py from-image"
          : "modules/assets/scripts/dreamina_generate.py",
        scriptArgs: args,
        provenance: {
          operation_type: operationType, from_asset_id: fromAssetId,
          agent_id: "autoviral-videogen", label: modelId, model: modelId,
        },
      };
    }
    case "audio": {
      const isTts = p.subKind === "tts";
      const args: Record<string, string | number> = isTts
        ? { "--text": p.prompt }
        : { "--prompt": p.prompt };
      if (isTts && p.voice) args["--voice"] = p.voice;
      if (!isTts && p.durationSeconds) args["--duration"] = p.durationSeconds;
      return {
        params: {
          sub_kind: p.subKind, prompt: p.prompt,
          voice: p.voice ?? null, duration_seconds: p.durationSeconds ?? null,
        },
        script: isTts ? "modules/assets/scripts/tts_generate.py"
                      : "modules/assets/scripts/music_generate.py",
        scriptArgs: args,
        provenance: {
          operation_type: operationType, from_asset_id: fromAssetId,
          agent_id: isTts ? "autoviral-tts" : "autoviral-bgm",
          label: isTts ? "edge-tts/multilingual" : "google/lyria-3-pro-preview",
          model: isTts ? "edge-tts/multilingual" : "google/lyria-3-pro-preview",
        },
      };
    }
  }
}

function buildInstructions(req: GenerationRequest): string {
  if (req.mode === "variant") {
    return [
      "Handling (variant):",
      "1. Parse the JSON block above. Note: `source` holds frozen identity (original prompt, model, dimensions, aspect, duration). `change_direction` is the user's delta — NOT a full prompt.",
      "2. Synthesize the final prompt by fusing `source.prompt` with `change_direction`. Keep subject, setting, lighting, palette identical unless the change direction explicitly demands otherwise.",
      "3. Honour source format: keep the same `--aspect-ratio` / `--duration` / `--image-size` as the source unless the change direction asks for a different size/length.",
      "4. For image variants of small deltas (text swap, grain, color tweak), prefer adding `--ref-image <source.uri>` to route through edit mode.",
      "5. Run the script in `script` with the flags in `script_args`. Append `--output <path>`.",
      "6. Edit `composition.yaml`: append the new asset to `assets[]` and a `derive` edge to `provenance[]` using `provenance_hint`. `fromAssetId` = source asset id.",
      "7. DO NOT add a clip to any track — leave timeline placement to the user.",
      "8. Emit a <viewer-locator/> card pointing to the new asset when you confirm.",
    ].join("\n");
  }
  return [
    "Handling (create):",
    "1. Parse the JSON block above.",
    "2. Pick a semantic asset id (e.g. `asset-panda-intro`) — never a UUID.",
    "3. Pick a relative output path under `assets/{kind}/`.",
    "4. Run the script in `script` with the flags in `script_args`. Append `--output <path>`.",
    "5. Edit `composition.yaml`: append the new asset to `assets[]` and a `generate` edge to `provenance[]` using `provenance_hint`. `fromAssetId` = null.",
    "6. DO NOT add a clip to any track.",
    "7. Emit a <viewer-locator/> card pointing to the new asset when you confirm.",
  ].join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
```

- [ ] **Step 4: Run the tests** — passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/generation/dispatchGeneration.ts \
        web/src/features/studio/generation/__tests__/dispatchGeneration.test.ts
git commit -m "feat(generation): structured [autoviral:create-asset]/generate-variant protocol

Port of pneuma's dispatchGeneration.ts adapted to AutoViral's providers:
gpt-5.4-image-2 for image, dreamina/seedance-pro for video, Lyria 3 for
BGM, edge-tts for TTS. Variant mode auto-wires source.uri as --image-url
for video, freezes source format unless change_direction overrides.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 2.5 Task 2.5 — `GenerationDialog` UI

**Files:**
- Create: `web/src/features/studio/generation/GenerationDialog.tsx`
- Modify: `web/src/features/studio/panels/Inspector/index.tsx` (or a new sidebar action) to mount the dialog

> **Brief skeleton; expand via writing-plans before execution.** The dialog is a Radix `Dialog` wrapper around three sub-forms (image / video / audio). On submit it builds a `GenerationRequest`, calls `buildGenerationNotification`, and posts the notification through a new `POST /api/works/:id/notify` endpoint or directly via the existing chat-send WS path. The agent reads the message and runs the dispatched script.

```tsx
// Expected exports:
export function GenerationDialog({ workId, source, onClose }: {
  workId: string;
  source?: GenerationRequest["source"]; // populated for variants
  onClose: () => void;
}): JSX.Element;

// Form switching: tabs for image/video/audio (with sub-tabs tts/bgm).
// On submit: build notification, send via WS bridge with type:"user" but
// flagged as a system notification (use existing chat send infrastructure).
```

- [ ] Acceptance: clicking "Create asset" in the asset sidebar opens the dialog; submitting a image form posts a `[autoviral:create-asset]` chat message with the JSON payload; the agent (running) parses it and runs `openrouter_generate.py`; after generation the new asset shows up in `composition.assets[]` and the chat receives a confirming text + locator block.

### 2.6 Task 2.6 — `skills/autoviral/modules/assets/capabilities/structured-generation.md`

This is the agent-facing handler spec — it tells the agent how to react when a `[autoviral:create-asset]` or `[autoviral:generate-variant]` message lands in chat. Mirror the structure of pneuma's `references/workflows.md` Workflow 5 but adapted to AutoViral's `composition.yaml` + script paths.

- [ ] **Step 1: Author** the document. Skeleton:

````markdown
# Structured generation notifications

When the user fills out the in-app generation dialog, the viewer dispatches a
single chat message tagged `[autoviral:create-asset]` or
`[autoviral:generate-variant]` containing a fenced JSON payload.

## Payload shape

(Embed an annotated example for both create and variant modes — copy the
shapes from dispatchGeneration.ts JsonPayload, with field-by-field commentary.)

## Handler (identical for both tags)

1. Parse the JSON. Don't reason about the human summary line.
2. Pick a semantic asset id — `asset-<topic>-<version>`. Never a UUID.
3. Pick an output path under `assets/{kind}/`.
4. Run the script in `script` with `script_args`. Append `--output <path>`.
   - For images, prompt is passed as `--prompt` (positional in pneuma; flag
     in AutoViral's openrouter_generate.py).
5. After the script exits 0, edit `composition.yaml`:
   - Append `{ id, uri, kind, name, metadata, status: "ready" }` to assets[].
     metadata holds ONLY physical properties (width, height, duration, fps,
     codec). Run ffprobe to fill them.
   - Append `{ toAssetId, fromAssetId, operation }` to provenance[]. Use
     `provenance_hint.operation_type / from_asset_id / agent_id / label / model`
     verbatim. operation.params should also carry the `prompt` (top-level)
     plus any params from the payload.
   - operation.timestamp = same ISO string as the asset's createdAt (omit
     createdAt if you don't have a stable monotonic source).
6. DO NOT add a clip to any track. The user places assets onto the timeline
   themselves.
7. Emit a <viewer-locator/> card so the user can click through to the new asset:
   `<viewer-locator label="✦ asset-panda-intro" data='{"assetId":"asset-panda-intro"}' />`
8. Save composition.yaml. The viewer auto-rehydrates.

## What you should NOT do

- Do not modify the source asset (variants).
- Do not reinterpret the prompt — pass it to the script unchanged.
- Do not ignore script_args — if you override a flag, the user's intent is lost.
- Do not print the JSON back to the user. Short confirm only.

## Variant rules

(Embed the "fuse, don't rewrite" rules from pneuma's workflows.md — keep
subject/setting/lighting unless the change_direction asks otherwise.)
````

- [ ] **Step 2: Commit** the doc.

### 2.7 Task 2.7 — `capabilities/reference-directives.md` (AutoViral version)

Port pneuma's `reference-directives.md` to AutoViral's video provider (Dreamina/Jimeng/Seedance). The `@imageN/@videoN/@audioN` addressing language is provider-agnostic; verify it works against Dreamina (it does, per the seedance-pro spec). Document role vocabulary identical to pneuma's: character identity, first-frame anchor, destination scene, mid-scene setting, camera-motion transfer, style transfer, prop add, POV shift, audio bed.

- [ ] **Acceptance:** `dreamina_generate.py reference --image-url ... --image-url ... --video-url ... --prompt "@image1 enters @image2 with the camera motion of @video1"` produces a video that follows the directive roles. (Manual verification.)

### 2.8 Task 2.8 — `capabilities/filter-retries.md` (Dreamina + Jimeng signatures)

Pneuma's filter-retries.md targets seedance two signatures. Dreamina (Seedance 2.0) shares Signature B (output-audio rejection) verbatim. Dreamina/Jimeng image-side filters reject differently — extract the actual error envelopes from a few captured failures and document them.

- [ ] **Step 1: Capture real error responses** by running `dreamina_generate.py reference` with a known-failing photo (a photorealistic face). Append the verbatim stderr to a fixture file `skills/autoviral/modules/assets/fixtures/filter-error-dreamina-A.json`.

- [ ] **Step 2: Document each signature** with: key tokens to match, what the signature means, recovery (character-sheet flow / `--no-audio` / fallback to Jimeng).

- [ ] **Step 3: Commit.**

### 2.9 Task 2.9 — `make_character_sheet.py`

Port `make-character-sheet.mjs` (171 lines, fal.ai nano-banana-2/edit) to AutoViral's stack: use OpenRouter `openai/gpt-5.4-image-2` in edit mode (which `openrouter_generate.py` already supports via `--ref-image`). The 4-panel prompt (photo-body / sketch-head front, profile, back; pencil portrait + typewriter OUTFIT/CHARACTER text) is **identical** — the prompt is what defeats the image-side filter, not the model. Just verify it survives gpt-5.4-image-2.

```python
# Skeleton:
# python skills/autoviral/modules/assets/scripts/make_character_sheet.py \
#   --source-url assets/images/hero.jpg \
#   --outfit "黑色风衣, 白衬衫, 牛仔裤" \
#   --traits "30岁男性, 东亚人, 沉稳" \
#   --output assets/images/character-sheet-hero.jpg

import argparse, base64, json, os, sys, urllib.request
from pathlib import Path

PROMPT_TEMPLATE = """Create a 16:9 character reference design sheet of the
character shown in the source image. Layout: 4 tall vertical panels of equal
width arranged side by side with no gaps, pure black background throughout.

Panel 1 (far left): photographic front view full body of the same character,
wearing {outfit}, neutral standing pose with arms at sides and empty hands,
soft studio lighting, standing on solid black floor. Replace the head
(shoulders up) with a clean white-line pencil sketch of the frontal head on
the black background, showing eyes, nose, mouth, hairline.

Panel 2: photographic left-profile side view full body of the same character,
same outfit, same lighting, facing left. Replace the head with a clean
white-line pencil sketch of a left-profile head on the black background.

Panel 3: photographic back view full body of the same character, same outfit,
same lighting. Replace the head with a clean white-line pencil sketch of the
back of the head showing hair only.

Panel 4 (far right): TOP HALF = detailed pencil graphite portrait on off-white
sketch paper showing the character's face in frontal head-and-shoulders
framing, preserving the facial identity from the source image, fine pencil
shading, visible pencil strokes and cross-hatching, all features (eyes, nose,
lips, jaw, hairline) clearly readable — this is a hand-drawn portrait study,
NOT a photograph. BOTTOM HALF = clean white typewriter-style English text on
the black background, formatted as a character design document. First section
header 'OUTFIT' followed by bullet points listing: {outfit}. Second section
header 'CHARACTER' followed by bullet points listing: {traits}. Thin
horizontal divider lines between sections. Professional game/animation
character design reference-sheet aesthetic.

All four panels must show the SAME character. Preserve the face, hair, skin
tone, build, and proportions from the source image. Do not invent a different
character."""
# ... rest of the script: parse args, build prompt, call OpenRouter via the
# same client patterns as openrouter_generate.py edit mode, write output.
```

- [ ] **Acceptance:** Running on a photorealistic AI-generated character image produces a 16:9 4-panel sheet that **passes** Dreamina's reference-mode image filter (manual verification with a captured Signature-A failure case).

### 2.10 Task 2.10 — `filter_retry/detect_signature.py`

Pure CLI helper. Stdin: API error JSON. Stdout: `{"signature": "A"|"B"|"unknown", "recovery_hint": "..."}`. The agent calls this when a generation fails to determine the right recovery action without prompt-engineering its way through the regex itself.

```python
# Skeleton: read stdin, JSON.parse, walk for "loc": ["body", "image_urls"]
# + "partner_validation_failed" → signature A. "loc": ["body", "generated_video"]
# + "Output audio has sensitive content" → signature B. Anything else → unknown.
# Return JSON to stdout with a recovery_hint.
```

- [ ] **Tests:** `pytest skills/autoviral/modules/assets/scripts/filter_retry/test_detect_signature.py` covering both signatures plus an unknown error.

### 2.11 Phase 2 Acceptance Criteria

- [ ] All Phase 2 unit tests pass.
- [ ] Agent receives `[autoviral:create-asset]` notifications, runs the dispatched script, edits `composition.yaml` correctly. Verified end-to-end with one image generation through the dialog.
- [ ] Agent emits at least one `<viewer-locator/>` card per session that the user can click to jump.
- [ ] When Dreamina returns a Signature-A 422, the agent runs `make_character_sheet.py`, retries, and succeeds (manual end-to-end test).
- [ ] When Dreamina returns a Signature-B 422, the agent retries with `--no-audio` (no character-sheet involved).

### 2.12 Phase 2 Done

```bash
git tag -a phase-2-protocol -m "Phase 2 — Locator + structured generation + filter-retry"
```

---

## 3. Phase 3 — Audio Pipeline Unification (Outline + Contracts)

> **Expand-before-execute notice:** This phase has 6 tasks (LUFS, TTS, render-pipeline merge, ducking-end-to-end, smart audio analysis caching, mix endpoint UI). Before starting, run `superpowers:writing-plans` against this section to expand each task into TDD steps. The contracts below lock the interfaces; the expansion only adds test-first scaffolding.

**Why this phase:** Today UI export → Remotion → MP4 (ignores fade/duck/burn-in). Agent path → ffmpeg/Python (full audio fidelity). We unify by routing **every** export through a server-side **render pipeline** that runs Remotion first then ffmpeg post-process for: ducking, LUFS normalization, hard subtitle burn (optional), LUT (optional), platform encode profile (Phase 6 lights this up).

### 3.0 File Structure

```
src/server/
├── render-pipeline.ts                         ← NEW — orchestrates Remotion → ffmpeg post-process
└── api.ts                                     ← extend POST /api/works/:id/render to call render-pipeline

src/
├── audio-tools.ts                             ← extend with normalizeLufs, applyLut3d, burnSubtitles
└── tts-providers/                             ← NEW dir
    ├── edge-tts.ts                            ← Microsoft Edge TTS wrapper
    ├── elevenlabs.ts                          ← ElevenLabs wrapper (premium)
    ├── volcano-tts.ts                         ← 火山 (suitable for Chinese)
    ├── registry.ts                            ← provider matrix + fallback chain
    └── types.ts

skills/autoviral/modules/assembly/
├── capabilities/
│   ├── ducking-and-lufs.md                    ← NEW — when to use which target
│   └── audio-pipeline.md                      ← NEW — end-to-end flow
└── scripts/
    └── audio/
        ├── loudnorm.py                        ← NEW — two-pass loudnorm wrapper
        └── voice_clone.py                     ← NEW — ElevenLabs voice clone
```

### 3.1 Key Contracts

**`src/server/render-pipeline.ts`:**

```ts
import { renderCompositionToMp4 } from "./remotion-renderer";
import { mixAudioTracks, normalizeLufs } from "../audio-tools";
import { burnSubtitlesIfRequested } from "../audio-tools";
import type { Composition, ExportPreset } from "../../web/src/features/studio/types";

export interface RenderJobOptions {
  comp: Composition;
  outDir: string;
  preset?: ExportPreset;
  burnSubtitles?: boolean;     // burn TextClips into video instead of leaving as overlay
  loudnessTargetLufs?: number; // overrides preset; default -14
  onProgress?: (stage: "render" | "duck" | "loudnorm" | "burn" | "encode", pct: number) => void;
}

export async function runRenderPipeline(opts: RenderJobOptions): Promise<string> {
  // 1. Remotion render → intermediate.mp4 (untouched audio, no burn-in subs)
  // 2. If any AudioClip has ducking, run mixAudioTracks on the intermediate
  //    (passing comp.tracks → MixTrack[] adapter)
  // 3. If burnSubtitles, render subtitles via subtitle_burn.py + ffmpeg overlay
  // 4. Apply loudnorm two-pass to target LUFS
  // 5. If preset specifies platform encode profile, run final ffmpeg pass
  //    with the preset's bitrate/codec/container/safe-zone metadata
  // 6. Return final output path
}
```

**`src/audio-tools.ts:normalizeLufs`:**

```ts
export interface LoudnormOptions {
  target: number;     // e.g. -14 (YouTube/TikTok), -16 (Spotify/Apple)
  truePeak: number;   // e.g. -1.5 dBTP
  lra: number;        // loudness range, e.g. 11
}

/**
 * Two-pass EBU R128 loudness normalization. First pass measures
 * input_i, input_lra, input_tp, input_thresh; second pass applies
 * loudnorm with measured= values to hit the exact target without
 * pumping. Quoted from FFmpeg loudnorm filter docs.
 */
export async function normalizeLufs(
  inputPath: string,
  outputPath: string,
  opts: LoudnormOptions = { target: -14, truePeak: -1.5, lra: 11 },
): Promise<void> {
  // Pass 1: ffmpeg -i input -af loudnorm=I=...:LRA=...:tp=...:print_format=json -f null -
  //   parse JSON from stderr to extract measured_*
  // Pass 2: ffmpeg -i input -af loudnorm=I=...:LRA=...:tp=...:measured_I=...:measured_LRA=...:measured_TP=...:measured_thresh=...:linear=true:print_format=summary -c:v copy -c:a aac -ar 48000 output
}
```

**TTS provider contract `src/tts-providers/types.ts`:**

```ts
export interface TtsRequest {
  text: string;
  voice: string;       // provider-specific id; registry.ts maps semantic names
  language?: string;
  speed?: number;      // 0.5..2.0
  style?: string;      // "warm conversational", "newscast", etc.
  outputPath: string;  // .mp3 / .wav / .ogg
}

export interface TtsResult {
  outputPath: string;
  duration: number;    // seconds, measured via ffprobe
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

### 3.2 Task List (high-level — expand via writing-plans)

- **3.A** — Implement `normalizeLufs` two-pass with unit test against a known-quiet WAV (target -14, expected post-normalize integrated_loudness within 0.5 LU).
- **3.B** — Implement `burnSubtitles` adapter that calls existing `subtitle_burn.py` from server with a temp ASS file derived from `composition.tracks[type=text]`.
- **3.C** — Implement `runRenderPipeline` end-to-end. Unit-test stage progression with mocked `mixAudioTracks` / `normalizeLufs` / `burnSubtitles`.
- **3.D** — Replace the body of `POST /api/works/:id/render` to call `runRenderPipeline(comp, outDir)` instead of `renderCompositionToMp4` directly. Pass through `opts.preset` from the request body.
- **3.E** — Add the three TTS providers (edge-tts, elevenlabs, volcano). Add a fallback chain in `registry.ts`: prefer volcano-tts for Chinese (zh-*), elevenlabs for English with named voices, edge-tts as zero-cost fallback.
- **3.F** — Author `tts_generate.py` skill script — same arg surface as `dispatchGeneration.ts` already references (`--text` / `--voice` / `--style` / `--output`). Internally calls a server endpoint at `POST /api/audio/tts` that delegates to the registry.
- **3.G** — Document audio pipeline in `skills/autoviral/modules/assembly/capabilities/audio-pipeline.md` with the platform LUFS table:

```
| Platform | Target LUFS | True peak | LRA |
|---|---|---|---|
| YouTube | -14 | -1.0 | 11 |
| TikTok / Reels / Shorts | -14 | -1.0 | 11 |
| 抖音 | -14 | -1.0 | 11 |
| 小红书 / 视频号 | -16 | -1.0 | 9 |
| Bilibili | -14 | -1.0 | 11 |
| Apple Podcasts | -16 | -1.0 | 11 |
| Spotify | -14 | -1.0 | 11 |
```

### 3.3 Phase 3 Acceptance Criteria

- [ ] UI export button now produces an MP4 with **identical** audio fidelity as the agent path: faded audio clips fade audibly, ducked BGM ducks under voiceover, integrated loudness measures within ±0.5 LU of the target.
- [ ] Composition with a `text-0` track and `burnSubtitles: true` in render request produces an MP4 with hard-burned subtitles (no soft sub track).
- [ ] TTS endpoint delivers audible Chinese voiceover from a 3-line prompt within 5 seconds; expressive tags (`[sigh]`, `[laughing]`) are honoured by edge-tts.
- [ ] Provider fallback works: with elevenlabs key removed, English TTS request still succeeds via edge-tts.

---

## 4. Phase 4 — Timeline Editing: Split, Resize, Ripple, Filmstrip, Waveform (Outline + Contracts)

> **Expand-before-execute notice:** Run `superpowers:writing-plans` against this section before starting. Each component has clear test cases (snap math, ripple math, filmstrip cache invalidation) that need TDD scaffolding.

### 4.0 File Structure

```
web/src/features/studio/panels/Timeline/
├── hooks/
│   ├── useFrameExtractor.ts                  ← NEW — port pneuma 159-line filmstrip hook verbatim
│   ├── useWaveform.ts                        ← REWRITE — bucket peaks, promise dedupe
│   ├── useClipResize.ts                      ← NEW — port pneuma 274-line resize hook
│   └── useSplitHoverSnap.ts                  ← NEW — blade-tool snap to clip edges
├── snapPoints.ts                             ← NEW — port pneuma 99 lines
├── dragEngine.ts                             ← NEW — port pneuma 122 lines (computeRipplePreview, snapDraggedStart)
├── rippleDelete.ts                           ← NEW — 40 lines
├── collapseGaps.ts                           ← NEW — 30 lines
├── BladeTool.tsx                             ← NEW
├── Track.tsx                                 ← EXTEND — pass frameInterval to filmstrip; mount waveform on audio kind
├── Clip.tsx                                  ← EXTEND — left/right resize handles; hover state
├── Playhead.tsx                              ← REWRITE — interactive scrub
└── store actions:
    src/web/.../studio/store.ts               ← EXTEND — splitClip, resizeClip, rippleDeleteClip, collapseGaps actions
```

### 4.1 Key Contracts (port verbatim from pneuma where indicated)

**`snapPoints.ts`** (verbatim port; license is permissive enough to copy with attribution comment):

```ts
export interface SnapPoint { time: number; label: string; }

export function collectSnapPoints(
  composition: Composition | null,
  excludeClipIds: ReadonlySet<string>,
  playheadTime: number,
): SnapPoint[] { /* ...verbatim from /tmp/pneuma-skills/.../snapPoints.ts... */ }

export function snapToNearest(
  candidate: number,
  points: readonly SnapPoint[],
  threshold: number,
): { time: number; snappedTo: number | null } { /* ...verbatim... */ }

export function snapDraggedStartToPoints(
  candidateStart: number,
  draggedDuration: number,
  points: readonly SnapPoint[],
  threshold: number,
): { start: number; snapTime: number | null } { /* ...verbatim... */ }
```

**`dragEngine.ts`:**

```ts
export function computeRipplePreview(
  clips: readonly Clip[],
  draggedClipId: string,
  draggedNewStart: number,
): Map<string, number> { /* ...verbatim from pneuma — overlap-then-cascade + pinned-clip pass... */ }

export function snapDraggedStart(
  clips: readonly Clip[],
  draggedClipId: string,
  candidateStart: number,
  snapThresholdSeconds: number,
): { start: number; snapTime: number | null } { /* ...verbatim... */ }
```

**`rippleDelete.ts`:**

```ts
export function rippleDeleteClip(
  trackId: string,
  clipId: string,
  store: { getState: () => CompStoreState; setState: (s: Partial<CompStoreState>) => void },
): void {
  // 1. find the clip; remove it from track.clips
  // 2. for every clip with startTime > removed.startTime, shift left by removed.duration
  // 3. recompute composition.duration
}
```

**`collapseGaps.ts`:**

```ts
export function collapseGapsOnTrack(track: Track): Track {
  let cursor = 0;
  const newClips = track.clips.slice().sort((a, b) => a.trackOffset - b.trackOffset).map((c) => {
    if (Math.abs(c.trackOffset - cursor) > 1e-6) c = { ...c, trackOffset: cursor };
    cursor += clipDuration(c);
    return c;
  });
  return { ...track, clips: newClips };
}
```

**`useFrameExtractor.ts`** (verbatim port — 159 lines, hidden video + canvas + jpeg dataURL cache, `Math.max(t, 0.05)` poster-frame avoidance).

**`Playhead.tsx`** (rewrite — interactive scrub):

```tsx
export function Playhead({ pxPerSecond, fps }: { pxPerSecond: number; fps: number }) {
  const frame = useComposition((s) => s.currentFrame);
  const setFrame = useComposition((s) => s.setFrame);
  const x = (frame / fps) * pxPerSecond;
  const dragRef = useRef<{ startX: number; startFrame: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startFrame: frame };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const newFrame = Math.max(0, d.startFrame + Math.round((dx / pxPerSecond) * fps));
    setFrame(newFrame);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ position: "absolute", left: x, /* ...visual styles... */ cursor: "ew-resize" }}
    />
  );
}
```

### 4.2 Task List (high-level)

- **4.A** — Port `snapPoints.ts` + tests (3 functions × ~3 cases each).
- **4.B** — Port `dragEngine.ts` + tests (overlap cascade, pinned-clip preservation, snap to clip edge / playhead / 0).
- **4.C** — Implement `rippleDeleteClip` + `collapseGapsOnTrack` + tests.
- **4.D** — Implement `useFrameExtractor` (verbatim) + extend `Track.tsx` to render the filmstrip behind video clips.
- **4.E** — Rewrite `useWaveform` for promise-deduped 128-peak decode + extend `Track.tsx` to render waveform behind audio clips.
- **4.F** — Implement left/right resize handles in `Clip.tsx` driven by `useClipResize`. Test snap-to-edge.
- **4.G** — Implement `BladeTool.tsx` for click-to-split. Test split math (a clip at `[2, 8)` split at `t=5` becomes two clips `[2, 5)` and `[5, 8)` with their own ids).
- **4.H** — Make `Playhead.tsx` interactive (pointer-drag scrubs).
- **4.I** — Add store actions `splitClip(clipId, atSec)`, `resizeClip(clipId, edge, newTime)`, `rippleDeleteClip(clipId)`, `collapseGaps(trackId)`.
- **4.J** — Wire keyboard shortcuts in `useShortcuts.ts`: `S` → split at playhead on selected track, `Shift+Backspace` → ripple delete selected, `Cmd+Shift+G` → collapse gaps on selected track.

### 4.3 Phase 4 Acceptance Criteria

- [ ] User can drag a clip; preview shows ripple cascade under the dragged clip; snap line appears at clip edges + playhead + 0.
- [ ] User can grab the right edge of a video clip and drag — the clip's `out` time updates; snap fires near other clip edges.
- [ ] User can press `S` over a clip — the clip splits at the playhead into two clips with new ids.
- [ ] User can press `Shift+Backspace` — selected clip is removed and later clips shift left.
- [ ] User scrubs the playhead by dragging — preview updates each frame.
- [ ] Each video clip on the timeline shows a filmstrip of thumbnails (one every 0.5s); audio clips show a 128-peak waveform.

---

## 5. Phase 5 — Variant Switcher + Provenance Dive Views (Outline + Contracts)

> **Expand-before-execute notice.** Depends on Phases 1, 2, 4.

### 5.0 File Structure

```
web/src/features/studio/panels/Inspector/
├── VariantSwitcher.tsx                       ← NEW — walk DAG, show siblings, "USE THIS"
└── DiveCanvas.tsx                            ← NEW — ReactFlow tree of provenance ancestors+descendants

web/src/features/studio/dive/
├── nodes/
│   ├── VisualNode.tsx                        ← image / video tile w/ thumbnail
│   ├── AudioNode.tsx                         ← waveform tile
│   ├── TextNode.tsx                          ← caption tile
│   └── NodeShell.tsx                         ← common chrome + USE THIS button
├── useTreeLayout.ts                          ← layout algorithm for provenance DAG
└── useVariantPointer.ts                      ← active-variant selection
```

### 5.1 Key Contracts

```ts
export function walkProvenance(
  comp: Composition,
  rootAssetId: string,
): { ancestors: AssetEntry[]; descendants: AssetEntry[]; siblings: AssetEntry[] } {
  // ancestors: trace fromAssetId chain backward (one path; provenance is a DAG so
  //   typically there's a primary parent). Stop at fromAssetId === null.
  // descendants: BFS of edges where fromAssetId === currentNode, then their
  //   descendants, etc.
  // siblings: assets that share the same fromAssetId as rootAssetId (variants).
}

export function rebindClip(
  comp: Composition,
  clipId: string,
  newAssetId: string,
): Composition { /* update the clip's src to the new asset's uri */ }
```

### 5.2 Task List (high-level)

- **5.A** — `walkProvenance` + tests (linear ancestry, branching descendants, sibling discovery).
- **5.B** — `VariantSwitcher.tsx` mounted in Inspector → shows siblings of the selected clip's bound asset; click "USE THIS" rebinds the clip.
- **5.C** — `DiveCanvas.tsx` ReactFlow: nodes for each asset in the provenance DAG, edges for `fromAssetId` links, USE-THIS buttons on each.
- **5.D** — `useTreeLayout` — Dagre or similar to layout the DAG.

### 5.3 Acceptance Criteria

- [ ] Selecting a clip whose asset has 2 derived siblings shows both in the Variant Switcher; clicking "USE THIS" on a sibling rebinds the clip and the preview updates.
- [ ] DiveCanvas opens for any asset in the comp; shows full ancestry + descendants; clicking USE THIS in a descendant rebinds.

---

## 6. Phase 6 — Smart Crop + Platform Export Presets (Outline + Contracts)

### 6.0 File Structure

```
skills/autoviral/modules/assembly/scripts/
└── smart_crop/
    ├── saliency.py                           ← mediapipe face + cv2 saliency → ROI box per second
    ├── crop_9_16.py                          ← ffmpeg crop+scale w/ ROI interpolation
    ├── strategies.py                         ← face / saliency / center-of-mass dispatchers
    └── tests/

src/server/
└── api.ts                                    ← extend POST /api/video/reframe { videoId, fromAspect, toAspect, strategy }

web/src/features/studio/panels/Tweaks/
└── CompositionSection.tsx                    ← extend — platform preset dropdown + smart-crop toggle

skills/autoviral/modules/assembly/references/
└── platform-specs.md                         ← NEW — full preset table
```

### 6.1 Key Contracts

**`platform-specs.md` table:**

| Platform | Aspect | Resolution | FPS | Codec | Container | Video bitrate | Audio bitrate | LUFS | Max duration | Safe zone |
|---|---|---|---|---|---|---|---|---|---|---|
| 抖音 | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s/180s | bottom 18% |
| 小红书视频 | 9:16 / 1:1 | 1080×1920 / 1080×1080 | 30 | H.264 | mp4 | 6 Mbps | 192 kbps | -16 | 60s | bottom 12% |
| 视频号 | 9:16 / 1:1 | 1080×1920 / 1080×1080 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s | bottom 15% |
| Bilibili | 16:9 | 1920×1080 | 30 | H.264 | mp4 | 6 Mbps | 192 kbps | -14 | unlimited | none |
| TikTok | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s | bottom 18% |
| Reels | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 10 Mbps | 192 kbps | -14 | 90s | bottom 15% |
| Shorts | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 10 Mbps | 192 kbps | -14 | 60s | bottom 15% |
| YouTube long | 16:9 | 1920×1080 | 30/60 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | unlimited | bottom 5% |

**`smart_crop/strategies.py`:**

```python
# Three strategies:
#   "face"   — track largest face; ROI follows face center; pad to safe-zone.
#   "saliency" — OpenCV BackgroundSubtractor / GBVS; ROI follows saliency mass.
#   "center" — fixed crop, source center (degenerate; useful when no faces/motion).
#
# Output: per-frame {x, y, w, h} list, smoothed by rolling mean (window=15 frames).
```

### 6.2 Task List

- **6.A** — Implement `saliency.py` + tests with a face-only fixture and a saliency-only fixture.
- **6.B** — Implement `crop_9_16.py` — ffmpeg `crop=W:H:'X':'Y'` with ROI interpolation per frame via `geq` or pre-built filter graph.
- **6.C** — `POST /api/video/reframe` endpoint — accepts video asset id + target aspect + strategy, runs the script, registers the new asset + provenance edge.
- **6.D** — Studio Tweaks dropdown: 8 platform presets + custom; selecting a preset updates `comp.width`/`height`/`fps`, sets `comp.exportPresets[0]` for the export pipeline, optionally triggers smart-crop on existing video clips.
- **6.E** — Render pipeline (Phase 3) honours `preset.codec`/`videoBitrate`/`audioBitrate`/`loudnessTargetLufs` in the post-process ffmpeg pass.

### 6.3 Acceptance Criteria

- [ ] Selecting "抖音 9:16" preset on a 16:9 composition triggers a confirmation modal; on confirm, every video clip is reframed via face-track strategy and the comp's width/height update.
- [ ] Exported MP4 hits the preset's bitrate within ±10%, codec exactly, and loudness within ±0.5 LU.

---

## 7. Phase 7 — Render Queue + Proxy / Draft Renders (Outline + Contracts)

### 7.0 File Structure

```
src/server/
├── render-queue/
│   ├── job.ts                               ← Job model: id, type, status, progress, log, result
│   ├── store.ts                             ← sqlite-backed persistence (better-sqlite3)
│   ├── worker.ts                            ← processes jobs serially or with concurrency=N
│   └── ws.ts                                ← /ws/render/jobs/:id progress stream
└── api.ts                                   ← extend POST /api/works/:id/render → enqueue + return jobId

web/src/features/studio/
├── panels/TopBar.tsx                        ← REPLACE export button with queue-aware version
└── render-status/
    ├── ExportProgress.tsx                   ← NEW — modal showing job stages
    └── useRenderJob.ts                      ← NEW — subscribe via ws to a jobId
```

### 7.1 Key Contracts

```ts
export interface RenderJob {
  id: string;
  workId: string;
  type: "full" | "proxy";
  presetId?: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number; // 0..1
  stage?: "render" | "duck" | "loudnorm" | "burn" | "encode";
  log: Array<{ at: string; level: "info" | "warn" | "error"; msg: string }>;
  outputPath?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export class RenderQueue {
  enqueue(opts: RenderJobOptions): RenderJob;
  cancel(jobId: string): void;
  get(jobId: string): RenderJob | null;
  list(workId: string): RenderJob[];
  // emits "progress" events on a per-jobId EventEmitter
}
```

### 7.2 Task List

- **7.A** — Implement `RenderQueue` with sqlite persistence; concurrency = 1 (Remotion is heavy).
- **7.B** — Convert `POST /api/works/:id/render` to enqueue and return `{ jobId }`. Add `GET /api/render/jobs/:id`, `DELETE /api/render/jobs/:id`, and `GET /ws/render/jobs/:id`.
- **7.C** — Add `runRenderPipeline` proxy mode: half-resolution + 24 fps + lower bitrate, used when `type === "proxy"`. Proxy renders complete in ~3× faster.
- **7.D** — `ExportProgress.tsx` — modal showing the 5 stages + per-stage progress bar; handles failure with re-queue button.
- **7.E** — `TopBar.tsx` — replace synchronous export with: click → enqueue full render → open `ExportProgress`; chevron menu offers "Quick proxy export" → enqueue proxy.

### 7.3 Acceptance Criteria

- [ ] Click export — modal shows queued → running (render) → running (duck) → running (loudnorm) → done in real-time.
- [ ] Cancel mid-render aborts the worker and frees Remotion resources.
- [ ] Proxy export of a 60s 1080p comp finishes ≤30s; full export ≤2 min.
- [ ] Failed render (e.g. missing asset) surfaces an error with a retry option; the job log is visible.

---

## 8. Phase 8 — Differentiators (Outline + Contracts)

> **Expand-before-execute notice. Each task here is its own mini-project.** Run writing-plans separately for: CLIP search, keyframes, speed ramp, multi-provider video, frame interpolation/upscaling, lip-sync.

### 8.1 CLIP Semantic Search Over Local Asset Library

**Files:**
```
skills/autoviral/modules/research/scripts/clip_index/
├── build_index.py                           ← OpenCLIP ViT-L/14 → faiss/sqlite-vss
├── search.py                                ← query → top-K asset uris
└── tests/

src/server/
├── api.ts                                   ← extend GET /api/works/:id/assets/search?q=...
└── clip-index.ts                            ← Node ↔ Python bridge

web/src/features/studio/panels/AssetSidebar/
└── SearchBox.tsx                            ← NEW — debounced search box with semantic results
```

**Contract:** `POST /api/clip-index/build { workId? }` builds embedding index for all assets (or per-work). `GET /api/works/:id/assets/search?q=...&topK=20` returns ranked asset ids with similarity score.

**Acceptance:** Searching "panda" returns the panda assets even when the asset id is `asset-bamboo-eater-1` (no string match required).

### 8.2 Keyframes (volume / transform / opacity curves)

**Files:**
```
web/src/features/studio/types.ts             ← extend Clip schemas with optional keyframes[]
web/src/features/studio/composition/tracks/  ← Audio + Video + Overlay renderers consume keyframes via interpolate()
web/src/features/studio/panels/Inspector/Keyframes.tsx  ← NEW — keyframe editor panel
```

**Schema extension:**

```ts
export const KeyframeSchema = z.object({
  property: z.enum(["volume", "x", "y", "scale", "rotation", "opacity"]),
  t: z.number(), // clip-local seconds
  value: z.number(),
  ease: z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "spring"]).default("linear"),
});
```

Each clip schema gains optional `keyframes: z.array(KeyframeSchema).optional()`.

**Acceptance:** A `VideoClip` with keyframes `[{prop:"scale",t:0,v:1},{prop:"scale",t:2,v:1.2}]` zooms from 1.0 to 1.2× over the first 2 seconds.

### 8.3 Speed Ramp / Time Remap

**Files:**
```
web/src/features/studio/types.ts             ← VideoClip gains optional speedRamps[]
web/src/features/studio/composition/tracks/VideoTrackRenderer.tsx
                                             ← apply playbackRate via Sequence wrapping
skills/autoviral/modules/assembly/scripts/
└── speed_ramp.py                            ← server-side ffmpeg setpts/atempo for export-side accuracy
```

**Schema:**

```ts
export const SpeedRampSchema = z.object({
  fromSec: z.number(), // clip-local seconds
  toSec: z.number(),
  fromRate: z.number().default(1),
  toRate: z.number(),  // 0.25..4.0
  ease: z.enum(["linear", "ease-in", "ease-out"]).default("linear"),
});
```

**Acceptance:** A clip with one speed ramp from `1×` at `t=0` to `0.5×` at `t=1` plays at half-speed for the second half of the first second; render output preserves the ramp.

### 8.4 Multi-Provider Video Coverage

**Files:**
```
src/providers/
├── runway.ts                                ← Runway Gen3
├── kling.ts                                 ← 可灵
├── hailuo.ts                                ← 海螺
├── minimax.ts                               ← MiniMax T2V
├── luma.ts                                  ← Luma Dream Machine (English)
└── registry.ts                              ← extend fallback chain + region-aware default

skills/autoviral/modules/assets/scripts/
└── multi_provider_video.py                  ← unified CLI dispatching to providers above
```

**Contract:** Each provider exports `generate(prompt, opts) → { localPath, jobId, costUsd, durationMs, model }`. `registry.ts` exposes `pickProvider({ region, language, refImage, audio })` for smart routing.

**Acceptance:** With both Dreamina and Runway keys configured, `dispatchGeneration` for an English prompt without character ref routes to Runway; Chinese prompt with character ref routes to Dreamina/Jimeng.

### 8.5 Frame Interpolation + Super-Resolution (post-process)

**Files:**
```
skills/autoviral/modules/assembly/scripts/
├── enhance/
│   ├── rife_interp.py                       ← RIFE 4K → 60fps
│   ├── esrgan_upscale.py                    ← Real-ESRGAN 1080p → 4K
│   └── stabilize.py                         ← vid.stab two-pass
```

Document recommended chain in `assembly/capabilities/video-enhancement.md`: RIFE → ESRGAN → stab → grade → encode.

### 8.6 Lip-Sync (Wav2Lip)

**Files:**
```
skills/autoviral/modules/assets/scripts/
└── lipsync_wav2lip.py                       ← Wav2Lip pretrained weights → lip-synced output

src/server/api.ts                            ← POST /api/video/lipsync { videoId, audioId }
```

**Acceptance:** Given a talking-head clip + a TTS voiceover with a different cadence, produces a new asset with synced lips; provenance edge `derive` with `params.lipsync_source_audio_id`.

---

## 9. Global Acceptance Criteria

A tag of `phase-8-supremacy` requires every Phase milestone tag plus:

- [ ] Studio "导出" button produces a platform-preset MP4 indistinguishable from agent-driven assembly: ducked BGM, normalized loudness, hard-burned subtitles, smart-cropped to platform aspect.
- [ ] User can select any clip → see its provenance → click "Try variant" → fill the dialog → agent produces a variant in <60s → variant appears in Inspector → click "USE THIS" → preview rebinds.
- [ ] Timeline supports drag/snap/ripple, blade-tool split, edge resize, ripple delete, collapse gaps, scrubbable playhead, filmstrip thumbnails on video clips, waveform on audio clips, beat-snap.
- [ ] Render queue handles 5 simultaneous user requests serially with progress streams over WS; cancellation works.
- [ ] CLIP search finds assets by semantic query, not filename.
- [ ] Keyframe-driven animations (volume curve, scale curve) play correctly in preview AND export.
- [ ] At least 3 video providers are wired with smart routing.
- [ ] At least 3 platform export presets pass platform-publication QA without manual rework.

---

## 10. Execution Handbook — How to expand each phase

For Phases 3–8, before starting work:

1. **Open this document** at the relevant phase section.
2. **Re-invoke** `superpowers:writing-plans` with the phase section as the spec.
3. The skill will produce a per-phase TDD plan saved to `docs/superpowers/plans/2026-MM-DD-autoviral-phase-N-<name>.md`.
4. Each per-phase plan inherits the file structure + key contracts above; the expansion only adds:
   - failing-test-first scaffolding
   - exact CLI commands and expected output
   - frequent commit boundaries
5. Execute via `superpowers:subagent-driven-development` (recommended) — dispatch one subagent per task with two-stage review.

For Phases 1 and 2 (this document), use `superpowers:executing-plans` directly — they're already TDD-formed.

---

## 11. Cross-cutting Concerns

### 11.1 Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "reactflow": "^11.x",                 // Phase 5 dive canvas
    "wavesurfer.js": "^7.x",              // already present per audit, ensure ≥7
    "better-sqlite3": "^11.x",            // Phase 7 queue persistence
    "@radix-ui/react-dialog": "^1.x"      // Phase 2 generation dialog
  }
}
```

Python (per-environment, document in `skills/autoviral/SKILL.md` env probe):

```
mediapipe                 # Phase 6 face tracking
opencv-python             # Phase 6 saliency
faiss-cpu                 # Phase 8 CLIP index
open_clip_torch           # Phase 8 CLIP encoder
demucs                    # Phase 3 stem separation (optional)
```

### 11.2 Testing strategy

- **Unit**: Vitest for TypeScript (Phase 1–7 component logic), pytest for Python scripts (filter-retry, smart-crop, beat-detect).
- **Integration**: API-level tests for `POST /api/works/:id/render`, `POST /api/video/reframe`, `POST /api/audio/tts` exercise full server path with real ffmpeg + mocked LLM/T2V calls.
- **End-to-end**: Playwright covers (1) generation dialog → agent run → asset registered, (2) timeline edit → export → MP4 plays back as expected, (3) variant flow.

### 11.3 Migration safety

- Every schema extension in Phase 1 is backward-compatible (new fields default to `[]` / `undefined`).
- The legacy synthesiser preserves old `composition.yaml` shape on first read; on first save the new fields persist.
- Render queue Phase 7 keeps the synchronous `POST .../render` path under a query flag `?async=false` for one full sprint to allow downstream tooling to migrate.

### 11.4 Rollback

If any phase introduces a regression in production:

1. Tag the broken state for forensics: `git tag -a regression-phase-N -m "..."`.
2. Revert to previous milestone tag: `git revert phase-N-<name>..HEAD` and push.
3. File a post-mortem in `docs/postmortem/` referencing the regression tag.

The CHANGELOG.md should gain a "Phase N — <name>" entry on every milestone tag.

---

## Self-Review

**Spec coverage check:** Every gap from the comparative analysis is addressed:

| Gap | Phase / Task |
|---|---|
| Provenance DAG | 1.1, 1.2, 1.3, 1.6 |
| Schema drift (fadeIn/fadeOut/ducking/kinetic-pop/typewriter) | 1.4, 1.5 |
| Locator card | 2.1, 2.2, 2.3 |
| Structured generation protocol | 2.4, 2.5, 2.6 |
| Reference directives language | 2.7 |
| Filter-retry decision tree | 2.8 |
| Character sheet (anti-filter) | 2.9 |
| Audio path unification (UI export gets ducking/fade/burn) | 3.A, 3.B, 3.C, 3.D |
| LUFS normalization | 3.A |
| TTS | 3.E, 3.F |
| Variant switcher | 5.B |
| Provenance dive view | 5.C |
| Smart crop reframe | 6.A, 6.B, 6.C |
| Platform export presets | 6.D, 6.E |
| Render queue + progress | 7.A, 7.B, 7.D |
| Proxy renders | 7.C |
| Filmstrip thumbnails | 4.D |
| Waveform thumbnails | 4.E |
| Split / resize / ripple delete / collapse gaps | 4.B, 4.C, 4.F, 4.G, 4.I |
| Interactive playhead | 4.H |
| CLIP semantic search | 8.1 |
| Keyframes | 8.2 |
| Speed ramp | 8.3 |
| Multi-provider video | 8.4 |
| Frame interp / upscale / stabilize | 8.5 |
| Lip-sync | 8.6 |
| File-name safety | 1.8 |
| Audio-tools redundant ternary cleanup | 1.7 |

**Placeholder scan:** Phase 1 + Phase 2 task steps are all concrete with code blocks. Phases 3–8 use file-level contracts + acceptance criteria + an explicit "expand via writing-plans before execution" notice; this is the documented compromise for the master-plan-of-plans format.

**Type consistency:** `AssetEntry`, `ProvenanceEdge`, `Composition`, `GenerationRequest`, `RenderJob` shapes are defined once in Phase 1 + 2 + 7 and referenced consistently by all later phases. `script` paths use `modules/assets/scripts/...` consistently across `dispatchGeneration.ts` and `structured-generation.md`.

---

**Plan complete.**
