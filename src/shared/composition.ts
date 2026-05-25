import { z } from "zod";

export const FPS_VALUES = [24, 25, 30, 60] as const;
export const ASPECTS = ["9:16", "1:1", "16:9", "4:5"] as const;
export type Aspect = (typeof ASPECTS)[number];

const TransformsSchema = z.object({
  scale: z.number().min(0.1).max(5).default(1),
  x: z.number().default(0),
  y: z.number().default(0),
  rotation: z.number().default(0),
});
export type Transforms = z.infer<typeof TransformsSchema>;

const FiltersSchema = z.object({
  lut: z.string().optional(),
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(-1).max(1).default(0),
  saturation: z.number().min(-1).max(1).default(0),
});
export type Filters = z.infer<typeof FiltersSchema>;

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
    "reframe",   // aspect-ratio reframe (smart crop) output
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

// ─── Keyframes ──────────────────────────────────────────────────────────────
// Phase 8.2 — keyframe curves on numeric clip properties. Each Keyframe self-
// tags via `property`; clips carry a flat `keyframes?: Keyframe[]` array (D2).
// We diverge from the master-plan §8.2 sketch (`prop`/`t`/`v`/`ease` short keys
// + hyphen-cased easings) to camelCase parallel to the rest of this file.

export const KeyframeEasingSchema = z.enum([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
]);
export type KeyframeEasing = z.infer<typeof KeyframeEasingSchema>;

export const KeyframePropertySchema = z.enum([
  "scale",
  "x",
  "y",
  "rotation",
  "opacity",
  "volume",
  // Phase 8.3 (D2/D11) — speed reuses the keyframes infrastructure rather than
  // a separate SpeedRampSchema. Per-clip semantics differ from transforms (D8):
  // speed feeds Remotion's playbackRate, NOT a CSS transform. AudioClip schema
  // accepts speed keyframes but the renderer/exporter ignore them in v1 (D1).
  "speed",
]);
export type KeyframeProperty = z.infer<typeof KeyframePropertySchema>;

export const KeyframeSchema = z.object({
  property: KeyframePropertySchema,
  time: z.number().min(0), // clip-local seconds
  value: z.number(),
  easing: KeyframeEasingSchema.default("linear"),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

// Phase 8.3.A — D4/D10: speed keyframes must lie in [0.1, 4.0]. We refine at
// the parent clip level (not on KeyframeSchema itself) because the property ×
// value constraint depends on `property === "speed"`; a free `value: number`
// inside KeyframeSchema lets non-speed keyframes (e.g. scale=10) pass through.
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 4.0;

function refineSpeedKeyframes<
  T extends { keyframes?: { property: string; value: number }[] },
>(val: T, ctx: z.RefinementCtx) {
  if (!val.keyframes) return;
  val.keyframes.forEach((kf, i) => {
    if (kf.property !== "speed") return;
    if (kf.value < SPEED_MIN || kf.value > SPEED_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keyframes", i, "value"],
        message: `speed keyframe value ${kf.value} out of range [${SPEED_MIN}, ${SPEED_MAX}]`,
      });
    }
  });
}

// Internal raw object schema — exported `VideoClipSchema` wraps this with the
// speed-keyframe superRefine. The raw form is also re-used inside the
// discriminatedUnion below (zod requires ZodObject members, not ZodEffects).
const VideoClipObjectSchema = z.object({
  id: z.string(),
  kind: z.literal("video"),
  src: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  trackOffset: z.number().min(0),
  transforms: TransformsSchema.default({}),
  filters: FiltersSchema.default({}),
  keyframes: z.array(KeyframeSchema).optional(),
});
export const VideoClipSchema = VideoClipObjectSchema.superRefine(
  refineSpeedKeyframes,
);
export type VideoClip = z.infer<typeof VideoClipSchema>;

const AudioClipObjectSchema = z.object({
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
    .object({
      ratio: z.number(),
      attack: z.number(),
      release: z.number(),
    })
    .optional(),
  type: z.enum(["original", "bgm", "voiceover", "sfx"]).default("bgm"),
  keyframes: z.array(KeyframeSchema).optional(),
});
export const AudioClipSchema = AudioClipObjectSchema.superRefine(
  refineSpeedKeyframes,
);
export type AudioClip = z.infer<typeof AudioClipSchema>;

export const TextClipSchema = z.object({
  id: z.string(),
  kind: z.literal("text"),
  text: z.string(),
  trackOffset: z.number().min(0),
  duration: z.number().min(0),
  style: z
    .object({
      font: z.string().default("Inter"),
      size: z.number().default(64),
      weight: z.number().default(700),
      italic: z.boolean().default(false),
      tracking: z.number().default(0),
      color: z.string().default("#ffffff"),
      stroke: z
        .object({ width: z.number(), color: z.string() })
        .optional(),
    })
    .default({}),
  position: z
    .object({
      anchor: z.enum(["top", "center", "bottom"]).default("bottom"),
      xPct: z.number().default(50),
      yPct: z.number().default(85),
    })
    .default({}),
  animation: z
    .enum(["kinetic-pop", "typewriter", "slide-up", "fade"])
    .optional(),
});
export type TextClip = z.infer<typeof TextClipSchema>;

const OverlayClipObjectSchema = z.object({
  id: z.string(),
  kind: z.literal("overlay"),
  src: z.string(),
  trackOffset: z.number().min(0),
  duration: z.number().min(0),
  position: z.object({
    xPct: z.number(),
    yPct: z.number(),
    wPct: z.number(),
    hPct: z.number(),
  }),
  opacity: z.number().min(0).max(1).default(1),
  keyframes: z.array(KeyframeSchema).optional(),
});
export const OverlayClipSchema = OverlayClipObjectSchema.superRefine(
  refineSpeedKeyframes,
);
export type OverlayClip = z.infer<typeof OverlayClipSchema>;

export type Clip = VideoClip | AudioClip | TextClip | OverlayClip;

// Discriminated union uses the raw object schemas (zod doesn't accept
// ZodEffects as union members). The speed-keyframe range constraint is
// re-applied at the Track level via superRefine so a Composition.parse()
// also rejects out-of-range speed keyframes (D10).
// Phase D (issue #31) — TrackSchema id is now `trk_<uuid>`-prefixed; lane
// reordering moves to a dedicated `displayOrder` field so renaming/reordering
// a lane never shifts ids (Pitfall #1, multi-track-stacking PRD §Three pitfalls).
// `language` is optional and intended for subtitle/caption lanes (`CC1 zh`,
// `CC2 en`). Read-time migration of pre-Phase-D yaml is handled by
// `migrateLegacyTrackIds` (NOT by this schema — schema stays strict so that
// any new write must be in the canonical shape).
export const TRACK_ID_PREFIX_REGEX = /^trk_/;

export const TrackSchema = z
  .object({
    id: z.string().regex(TRACK_ID_PREFIX_REGEX, {
      message: "Track id must start with 'trk_' (Phase D — issue #31)",
    }),
    kind: z.enum(["video", "audio", "text", "overlay"]),
    label: z.string(),
    displayOrder: z.number().int().nonnegative(),
    language: z.string().optional(),
    muted: z.boolean().default(false),
    hidden: z.boolean().default(false),
    // Phase G (issue #34) — per-track mix gain in dB. 0 = unity (default).
    // Semantically only consumed when `kind === "audio"` —
    // `compositionToMixTracks` adds this on top of each clip's linear volume.
    // We don't gate the field on the discriminator at the schema layer because
    // `TrackSchema` is a single object (not a discriminated union over kind);
    // a default of 0 on text/video/overlay tracks is a safe no-op. The store
    // action `setTrackVolume` (issue #32) is the canonical writer.
    volume: z.number().default(0),
    clips: z.array(
      z.discriminatedUnion("kind", [
        VideoClipObjectSchema,
        AudioClipObjectSchema,
        TextClipSchema,
        OverlayClipObjectSchema,
      ]),
    ),
  })
  .superRefine((track, ctx) => {
    track.clips.forEach((clip, ci) => {
      if (clip.kind === "text") return;
      const kfs = (clip as { keyframes?: { property: string; value: number }[] })
        .keyframes;
      if (!kfs) return;
      kfs.forEach((kf, ki) => {
        if (kf.property !== "speed") return;
        if (kf.value < SPEED_MIN || kf.value > SPEED_MAX) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["clips", ci, "keyframes", ki, "value"],
            message: `speed keyframe value ${kf.value} out of range [${SPEED_MIN}, ${SPEED_MAX}]`,
          });
        }
      });
    });
  });
export type Track = z.infer<typeof TrackSchema>;

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

// ─── R46 #4 — CaptionModel (overlay strategy) ───────────────────────────
// Per-word ASR output (segments) decoupled from visual line/block grouping
// (groups). Lets us regroup captions for different platforms / iterations
// without re-running Whisper. Companion to web/src/.../captions/types.ts —
// keep both files in sync if the shape changes.
export const CaptionSegmentSchema = z.object({
  segmentId: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string(),
});
export type CaptionSegment = z.infer<typeof CaptionSegmentSchema>;

export const CaptionGroupStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.union([z.number(), z.string()]),
  fontWeight: z.union([z.number(), z.string()]).optional(),
  color: z.string().optional(),
  background: z.string().optional(),
  padding: z.string().optional(),
  borderRadius: z.union([z.number(), z.string()]).optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  bottomOffsetPx: z.number().optional(),
  maxWidthFraction: z.number().min(0).max(1).optional(),
  textStroke: z
    .object({ widthPx: z.number(), color: z.string() })
    .optional(),
});
export type CaptionGroupStyle = z.infer<typeof CaptionGroupStyleSchema>;

export const CaptionAnimationSetSchema = z.object({
  entrance: z
    .object({
      duration: z.number().min(0),
      ease: z.string().optional(),
      type: z.enum(["slide-up", "scale-pop", "fade"]),
      staggerMs: z.number().optional(),
    })
    .optional(),
  highlight: z
    .object({
      activeColor: z.string(),
      dimColor: z.string(),
      activeScale: z.number().optional(),
      // H3 — extended type enum + type-specific parameters.
      // basic-color is the legacy default (color swap only).
      type: z
        .enum([
          "basic-color",
          "marker-sweep",
          "scribble",
          "burst",
          "slam",
          "elastic",
          "clip-reveal",
        ])
        .optional(),
      // marker-sweep: highlight bar sweep duration in seconds (default 0.3)
      sweepDuration: z.number().min(0).optional(),
      // scribble: path style — underline / circle / strike
      scribblePath: z.enum(["underline", "circle", "strike"]).optional(),
      // burst: radial-line count emanating from the active word (default 6)
      burstLineCount: z.number().int().min(1).max(24).optional(),
      // slam: scale-from value at activation peak (default 1.4)
      slamScale: z.number().min(1).max(3).optional(),
      // elastic: scale-overshoot magnitude (default 0.2)
      elasticOvershoot: z.number().min(0).max(1).optional(),
    })
    .optional(),
  exit: z
    .object({
      duration: z.number().min(0),
      ease: z.string().optional(),
      type: z.enum(["slide-down", "fade", "scale-out"]),
    })
    .optional(),
});
export type CaptionAnimationSet = z.infer<typeof CaptionAnimationSetSchema>;

export const CaptionGroupSchema = z.object({
  groupId: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  segmentIds: z.array(z.string()),
  style: CaptionGroupStyleSchema,
  animation: CaptionAnimationSetSchema.optional(),
});
export type CaptionGroup = z.infer<typeof CaptionGroupSchema>;

export const CaptionModelSchema = z.object({
  modelId: z.string(),
  audioTrackId: z.string().nullable().optional(),
  segments: z.array(CaptionSegmentSchema),
  groups: z.array(CaptionGroupSchema),
  defaultAnim: CaptionAnimationSetSchema.optional(),
  language: z.string().optional(),
});
export type CaptionModel = z.infer<typeof CaptionModelSchema>;

export const CaptionStrategySchema = z.enum(["burn", "overlay"]);
export type CaptionStrategy = z.infer<typeof CaptionStrategySchema>;

// ─── H2 — Composition variables ─────────────────────────────────────────────
// Declarative variables on the composition for ${id} interpolation across
// any string field. Pattern adopted from hyperframes' data-composition-
// variables; see ADR-001 (we absorb hyperframes techniques as native).
//
// At render time, src/composition/variables/resolve() walks the composition
// tree replacing every "${id}" token in string values with the resolved
// concrete value (declared default + composition-level override +
// --variables CLI override). Type coercion happens at the substitution
// site: numbers and booleans stringify; colors stay strings as hex; enums
// substitute the chosen value.
export const VariableTypeSchema = z.enum([
  "string",
  "number",
  "color",
  "boolean",
  "enum",
]);
export type VariableType = z.infer<typeof VariableTypeSchema>;

export const VariableEnumOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type VariableEnumOption = z.infer<typeof VariableEnumOptionSchema>;

export const VariableDeclarationSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, {
      message: "variable id must be a valid identifier",
    }),
  type: VariableTypeSchema,
  label: z.string(),
  // `default` carries the declared default. Type-correctness is checked at
  // validateDeclarations() time, not by zod here — zod can't express
  // "string when type is string, number when type is number, ..." cleanly,
  // and the runtime validator catches it with a better error message.
  default: z.union([z.string(), z.number(), z.boolean()]),
  options: z.array(VariableEnumOptionSchema).optional(),
});
export type VariableDeclaration = z.infer<typeof VariableDeclarationSchema>;

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
  // ─── R46 #4 — overlay-strategy captions ─────────────────────────────────
  // Optional, default behaviour unchanged. Set captionStrategy="overlay"
  // and provide `captions` to render captions via the Remotion
  // <CaptionsLayer> component instead of libass hard-burn (Stage 3).
  // captionStrategy="burn" or absent = legacy libass path.
  captions: CaptionModelSchema.optional(),
  captionStrategy: CaptionStrategySchema.optional(),
  // H2 — optional list of declarative variables. Empty/absent means the
  // composition is not parametrized; resolve() is a no-op. makeEmpty*
  // does not produce a `variables` key so backward compat is preserved.
  variables: z.array(VariableDeclarationSchema).optional(),
});
export type Composition = z.infer<typeof CompositionSchema>;

const ASPECT_DIMS: Record<Aspect, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
  "4:5": [1080, 1350],
};

/**
 * Mint a fresh `trk_<uuid8>` id. Centralised so any track-creation site
 * (defaults, migration, store actions) uses the same shape and the regex
 * in {@link TrackSchema} stays in sync. We slice the uuid to 8 chars — that's
 * 32 bits of entropy, more than enough to avoid collisions inside a single
 * composition (no composition is going to hold 65k tracks) and short enough
 * to fit on screen in dev tools.
 */
export function newTrackId(): string {
  // `crypto.randomUUID()` is available in Node 19+ and all modern browsers;
  // our minimum runtime is well past that. We slice the FIRST hex segment
  // (8 chars) — the canonical uuid format starts with 8 hex digits.
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `trk_${uuid.slice(0, 8)}`;
}

/**
 * Find a track by content (kind + displayOrder) instead of by raw id. This
 * is the Pitfall-#1 dodge from the multi-track-stacking PRD: any code that
 * used to hardcode "audio-0" should look up by kind+order so that adding /
 * removing / renaming lanes doesn't break the reference.
 *
 * Returns `undefined` if no track matches; callers should treat that as
 * "lane no longer exists" (e.g. user deleted it) and degrade gracefully.
 */
export function findTrack(
  comp: { tracks: Track[] } | null | undefined,
  kind: Track["kind"],
  displayOrder: number,
): Track | undefined {
  if (!comp) return undefined;
  return comp.tracks.find(
    (t) => t.kind === kind && t.displayOrder === displayOrder,
  );
}

/**
 * Read-time migration for compositions written before Phase D (issue #31).
 *
 * Pre-Phase-D yaml uses semantic track ids (`video-0` / `audio-0` /
 * `text-0` / `overlay-0`) and has no `displayOrder` field. Loading such a
 * file straight into the post-Phase-D `CompositionSchema` would fail the
 * `^trk_/` regex. This helper rewrites those ids transparently before
 * `CompositionSchema.parse`, so old yaml round-trips without manual
 * intervention. On the next write the new shape is persisted to disk.
 *
 * Design notes:
 * - Returns a NEW object; never mutates `raw` in place. Important for tests
 *   that snapshot the input.
 * - Only touches track-level fields (`id`, `displayOrder`); clip ids, kinds,
 *   labels, language, muted/hidden, and the `clips` array are byte-equal
 *   preserved.
 * - If `raw` is not the expected shape (not an object, no `tracks` array) we
 *   return it unchanged — `CompositionSchema.parse` will produce the proper
 *   structured error downstream.
 * - Already-migrated tracks (`id` already `trk_…`) keep their id and have
 *   `displayOrder` assigned from array index if missing. This means running
 *   the migration twice is a no-op for the second pass.
 */
const LEGACY_TRACK_ID_REGEX = /^(video|audio|text|overlay)-\d+$/;

export function migrateLegacyTrackIds(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const tracks = obj.tracks;
  if (!Array.isArray(tracks)) return raw;

  const migratedTracks = tracks.map((t, idx) => {
    if (!t || typeof t !== "object") return t;
    const track = t as Record<string, unknown>;
    const currentId = typeof track.id === "string" ? track.id : "";
    const needsIdRewrite = LEGACY_TRACK_ID_REGEX.test(currentId);
    const hasDisplayOrder = typeof track.displayOrder === "number";
    if (!needsIdRewrite && hasDisplayOrder) return track;
    return {
      ...track,
      id: needsIdRewrite ? newTrackId() : track.id,
      displayOrder: hasDisplayOrder ? track.displayOrder : idx,
    };
  });

  return { ...obj, tracks: migratedTracks };
}

export function makeEmptyComposition(opts: {
  workId: string;
  aspect?: Aspect;
  duration?: number;
  fps?: 24 | 25 | 30 | 60;
}): Composition {
  const aspect = opts.aspect ?? "9:16";
  const [w, h] = ASPECT_DIMS[aspect];
  const now = new Date().toISOString();
  // Phase D (issue #31) — 4 default lanes matching the Resolve-inspired
  // open-the-box layout (PRD §Track schema migration). Order is fixed:
  // V1 video / A1 BGM / A2 VO / CC1 zh.
  return {
    id: `c_${opts.workId}`,
    workId: opts.workId,
    fps: opts.fps ?? 30,
    width: w,
    height: h,
    duration: opts.duration ?? 0,
    aspect,
    tracks: [
      {
        id: newTrackId(),
        kind: "video",
        label: "V1",
        displayOrder: 0,
        muted: false,
        hidden: false,
        clips: [],
      },
      {
        id: newTrackId(),
        kind: "audio",
        label: "A1 · BGM",
        displayOrder: 1,
        muted: false,
        hidden: false,
        clips: [],
      },
      {
        id: newTrackId(),
        kind: "audio",
        label: "A2 · VO",
        displayOrder: 2,
        muted: false,
        hidden: false,
        clips: [],
      },
      {
        id: newTrackId(),
        kind: "text",
        label: "CC1",
        displayOrder: 3,
        language: "zh",
        muted: false,
        hidden: false,
        clips: [],
      },
    ],
    updatedAt: now,
    assets: [],
    provenance: [],
    exportPresets: [],
  };
}
