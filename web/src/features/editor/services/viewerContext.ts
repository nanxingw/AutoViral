import type { Carousel, Layer, TextLayer } from "../types";

/**
 * Build a `<viewer-context>` block describing the editor's current selection
 * + carousel summary. Prepended to outgoing chat messages so the agent can
 * answer "this layer", "the second slide", etc. without asking which.
 *
 * Mirrors the pattern in pneuma's clipcraft mode (extractContext in
 * pneuma-mode.ts) — the agent reads the tag from the user message and
 * threads it into its planning. We don't echo the tag in the local chat
 * bubble; only the WS frame carries it.
 *
 * Returns null when there's no work loaded (nothing meaningful to say).
 */
export function buildEditorViewerContext(
  car: Carousel | null,
  currentSlideId: string | null,
  selectionLayerId: string | null,
): string | null {
  if (!car) return null;

  const slideIdx = currentSlideId
    ? car.slides.findIndex((s) => s.id === currentSlideId)
    : -1;
  const slide = slideIdx >= 0 ? car.slides[slideIdx] : null;
  const layer: Layer | null =
    slide && selectionLayerId
      ? slide.layers.find((l) => l.id === selectionLayerId) ?? null
      : null;

  const lines: string[] = [];
  lines.push(`mode: image-text-editor`);
  lines.push(
    `carousel: ${car.slides.length} slide(s), ${car.width}×${car.height}, palette=${car.globals.palette}, font=${car.globals.headlineFont}, layout=${car.globals.layout}`,
  );

  if (slide) {
    const bgDesc =
      slide.bg.type === "solid"
        ? `solid ${slide.bg.value}`
        : slide.bg.type === "image"
          ? `image`
          : `gradient`;
    lines.push(
      `currentSlide: index=${slideIdx + 1}/${car.slides.length}, id=${slide.id}, bg=${bgDesc}, layers=${slide.layers.length}`,
    );
  }

  if (layer) {
    if (layer.kind === "text") {
      const t = layer as TextLayer;
      const preview = t.text.length > 40 ? `${t.text.slice(0, 40)}…` : t.text;
      lines.push(
        `selectedLayer: kind=text, id=${t.id}, text=${JSON.stringify(preview)}, font=${t.style.font}, size=${t.style.size}, color=${t.style.color}`,
      );
    } else if (layer.kind === "image") {
      lines.push(`selectedLayer: kind=image, id=${layer.id}, src=${layer.src}`);
    } else {
      lines.push(`selectedLayer: kind=${layer.kind}, id=${layer.id}`);
    }
  } else {
    lines.push(`selectedLayer: <none>`);
  }

  return `<viewer-context mode="image-text-editor">\n${lines.join("\n")}\n</viewer-context>`;
}
