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

export const VideoClipSchema = z.object({
  id: z.string(),
  kind: z.literal("video"),
  src: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  trackOffset: z.number().min(0),
  transforms: TransformsSchema.default({}),
  filters: FiltersSchema.default({}),
});
export type VideoClip = z.infer<typeof VideoClipSchema>;

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
    .object({
      ratio: z.number(),
      attack: z.number(),
      release: z.number(),
    })
    .optional(),
  type: z.enum(["original", "bgm", "voiceover", "sfx"]).default("bgm"),
});
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

export const OverlayClipSchema = z.object({
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
});
export type OverlayClip = z.infer<typeof OverlayClipSchema>;

export type Clip = VideoClip | AudioClip | TextClip | OverlayClip;

export const TrackSchema = z.object({
  id: z.string(),
  kind: z.enum(["video", "audio", "text", "overlay"]),
  label: z.string(),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  clips: z.array(
    z.discriminatedUnion("kind", [
      VideoClipSchema,
      AudioClipSchema,
      TextClipSchema,
      OverlayClipSchema,
    ]),
  ),
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

const ASPECT_DIMS: Record<Aspect, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
  "4:5": [1080, 1350],
};

export function makeEmptyComposition(opts: {
  workId: string;
  aspect?: Aspect;
  duration?: number;
  fps?: 24 | 25 | 30 | 60;
}): Composition {
  const aspect = opts.aspect ?? "9:16";
  const [w, h] = ASPECT_DIMS[aspect];
  const now = new Date().toISOString();
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
        id: "video-0",
        kind: "video",
        label: "Video",
        muted: false,
        hidden: false,
        clips: [],
      },
      {
        id: "audio-0",
        kind: "audio",
        label: "BGM",
        muted: false,
        hidden: false,
        clips: [],
      },
      {
        id: "text-0",
        kind: "text",
        label: "Subtitles",
        muted: false,
        hidden: false,
        clips: [],
      },
      {
        id: "overlay-0",
        kind: "overlay",
        label: "Overlay",
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
