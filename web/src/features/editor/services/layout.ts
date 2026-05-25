import type { Carousel, Layer, TextLayer } from "../types";
import { genLayerId } from "../types";
import { resolvePalette } from "../palettes";

type LayoutId = Carousel["globals"]["layout"];

// Editorial safe-margin matches the agent's default (carousel.yaml seed values
// land text at x=90 for a 1080-wide canvas — same proportion).
const PADDING = 90;

export function applyLayoutToTextLayer(
  layer: TextLayer,
  layout: LayoutId,
  canvasW: number,
  canvasH: number,
): TextLayer {
  if (layout === "centered") {
    // y = 0.4 of canvas height is the editorial "slightly-above-center"
    // headline anchor (matches the agent's seed value 520/1350 ≈ 0.385).
    // Resetting y here means: switching split → centered actually pulls
    // text back up, instead of leaving it stuck in the lower half.
    return {
      ...layer,
      box: {
        ...layer.box,
        x: PADDING,
        y: Math.round(canvasH * 0.4),
        w: canvasW - PADDING * 2,
      },
      style: { ...layer.style, align: "center" },
    };
  }
  if (layout === "left") {
    return {
      ...layer,
      box: { ...layer.box, x: PADDING, w: Math.round(canvasW * 0.6) },
      style: { ...layer.style, align: "left" },
    };
  }
  // split — upper half stays for the bg / image; text drops to the lower half
  // and centers within the canvas width.
  return {
    ...layer,
    box: {
      ...layer.box,
      x: PADDING,
      y: Math.round(canvasH * 0.5 + 60),
      w: canvasW - PADDING * 2,
    },
    style: { ...layer.style, align: "center" },
  };
}

export function applyLayoutToLayer(
  layer: Layer,
  layout: LayoutId,
  canvasW: number,
  canvasH: number,
): Layer {
  if (layer.kind === "text") {
    return applyLayoutToTextLayer(layer, layout, canvasW, canvasH);
  }
  return layer;
}

/**
 * Build a brand-new editorial text layer pre-styled from the carousel's
 * globals — the factory behind CopyTab's "+ add text layer" affordance (#43).
 *
 * The `addLayer` store action existed with full test coverage but had zero UI
 * call sites, so a blank slide (or any AI carousel without a text layer) left
 * the Copy tab a permanent dead end. This factory makes the new layer match
 * the rest of the deck: headline font, palette fg color, and current layout
 * placement — so an added layer reads as "part of the design", not a stray box.
 *
 * `text` starts empty so the canvas shows an editable placeholder and the Copy
 * tab's textarea is immediately ready for typing.
 */
export function makeTextLayer(car: Carousel): TextLayer {
  const fg = resolvePalette(car.globals.palette).fg;
  // Base box is a placeholder; applyLayoutToTextLayer immediately repositions
  // it (x / y / w / align) to match the active layout, so these seed numbers
  // only set size/weight/etc.
  const base: TextLayer = {
    id: genLayerId(),
    kind: "text",
    box: { x: 90, y: Math.round(car.height * 0.4), w: car.width - 180, h: 200, rotation: 0 },
    text: "",
    style: {
      font: car.globals.headlineFont,
      size: 64,
      weight: 700,
      italic: false,
      color: fg,
      align: "center",
      tracking: 0,
    },
  };
  return applyLayoutToTextLayer(base, car.globals.layout, car.width, car.height);
}
