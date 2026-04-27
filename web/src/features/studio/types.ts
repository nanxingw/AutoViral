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

export const CompositionSchema = z.object({
  id: z.string(),
  workId: z.string(),
  fps: z.union([
    z.literal(24),
    z.literal(25),
    z.literal(30),
    z.literal(60),
  ]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().min(0),
  aspect: z.enum(ASPECTS),
  tracks: z.array(TrackSchema),
  updatedAt: z.string(),
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
  };
}
