// Carousel domain schema — the SSoT for `carousel.yaml` (the carousel work type).
//
// Promoted from web/src/features/editor/types.ts to src/shared/ (ADR-006) so
// it is reachable by server + web + the `autoviral` CLI. The server now
// validates carousel mutations against CarouselSchema (bridge invariant #3,
// I08) and migrations can run on it (I10), symmetric with composition.ts.
//
// Pure zod + pure functions only — ZERO web/React imports — so it is safe to
// import from the web bundle (via the @shared alias) and unit-testable in
// isolation. web/src/features/editor/types.ts is now a thin re-export shim.

import { z } from "zod";

export const PALETTE_IDS = ["mono", "pastel", "neon", "earth", "noir"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

const Box = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number().default(0),
});

export const TextLayerSchema = z.object({
  id: z.string(),
  kind: z.literal("text"),
  box: Box,
  text: z.string(),
  style: z
    .object({
      font: z.enum(["serif", "sans", "mono"]).default("sans"),
      size: z.number().default(48),
      weight: z.number().default(700),
      italic: z.boolean().default(false),
      color: z.string().default("#111"),
      align: z.enum(["left", "center", "right"]).default("center"),
      tracking: z.number().default(0),
    })
    .default({}),
});

export const ImageLayerSchema = z.object({
  id: z.string(),
  kind: z.literal("image"),
  box: Box,
  src: z.string(),
  filters: z
    .object({
      blur: z.number().default(0),
      brightness: z.number().default(1),
      opacity: z.number().default(1),
    })
    .default({}),
});

export const ShapeLayerSchema = z.object({
  id: z.string(),
  kind: z.literal("shape"),
  box: Box,
  shape: z.enum(["rect", "circle", "line"]),
  fill: z.string().default("#0006"),
  stroke: z.string().nullable().default(null),
  strokeWidth: z.number().default(0),
});

export const StickerLayerSchema = z.object({
  id: z.string(),
  kind: z.literal("sticker"),
  box: Box,
  src: z.string(),
});

export const LayerSchema = z.discriminatedUnion("kind", [
  TextLayerSchema,
  ImageLayerSchema,
  ShapeLayerSchema,
  StickerLayerSchema,
]);
export type Layer = z.infer<typeof LayerSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type ImageLayer = z.infer<typeof ImageLayerSchema>;
export type ShapeLayer = z.infer<typeof ShapeLayerSchema>;
export type StickerLayer = z.infer<typeof StickerLayerSchema>;

export const SlideBgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gradient"), value: z.string() }),
  z.object({ type: z.literal("image"), value: z.string() }),
  z.object({ type: z.literal("solid"), value: z.string() }),
]);
export type SlideBg = z.infer<typeof SlideBgSchema>;

export const SlideSchema = z.object({
  id: z.string(),
  bg: SlideBgSchema,
  layers: z.array(LayerSchema),
});
export type Slide = z.infer<typeof SlideSchema>;

export const CarouselSchema = z.object({
  id: z.string(),
  workId: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  globals: z.object({
    headlineFont: z.enum(["serif", "sans", "mono"]).default("serif"),
    palette: z.enum(PALETTE_IDS).default("mono"),
    layout: z.enum(["centered", "left", "split"]).default("centered"),
    effects: z
      .object({
        grain: z.number().default(0.03),
        gradient: z.number().default(0.5),
        // #70 — DEPRECATED / unrendered. No renderer consumes `sharpen`
        // (EffectsOverlay is an additive overlay; sharpen needs a pixel
        // convolution on the image layers). The DesignTab slider was removed
        // as a deceptive dead control; the field is kept only so existing
        // carousel.yaml round-trips without a migration. Don't add a new UI
        // for it until a real Konva.Filters.Enhance render path (preview +
        // export) lands.
        sharpen: z.number().default(0),
      })
      .default({}),
  }),
  slides: z.array(SlideSchema).min(1),
  updatedAt: z.string(),
});
export type Carousel = z.infer<typeof CarouselSchema>;

let _seq = 0;
const uid = (p: string) =>
  `${p}_${Date.now().toString(36)}_${(++_seq).toString(36)}`;

/** Public layer-id generator. Shares the module-private `uid` counter so ids
 *  minted by UI affordances (e.g. CopyTab's "+ add text layer") can't collide
 *  with seed / duplicate ids. (#43 — wiring addLayer to the UI.) */
export const genLayerId = (): string => uid("t");

export function makeEmptySlide(): Slide {
  return {
    id: uid("s"),
    bg: {
      type: "gradient",
      value: "linear-gradient(135deg, #fafaf7 0%, #e8e6df 100%)",
    },
    layers: [],
  };
}

export function makeEmptyCarousel(workId: string): Carousel {
  return {
    id: uid("car"),
    workId,
    width: 1080,
    height: 1350,
    globals: {
      headlineFont: "serif",
      palette: "mono",
      layout: "centered",
      effects: { grain: 0.03, gradient: 0.5, sharpen: 0 },
    },
    slides: [makeEmptySlide()],
    updatedAt: new Date().toISOString(),
  };
}
