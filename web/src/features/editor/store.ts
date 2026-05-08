import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Carousel, Slide, Layer, PaletteId } from "./types";
import { makeEmptySlide } from "./types";
import { applyLayoutToLayer } from "./services/layout";
import { PALETTES } from "./palettes";

interface EditorState {
  car: Carousel | null;
  currentSlideId: string | null;
  selectionLayerId: string | null;
  loadCarousel: (c: Carousel | null) => void;
  setCurrentSlide: (id: string) => void;
  addSlide: () => void;
  removeSlide: (id: string) => void;
  duplicateSlide: (id: string) => void;
  reorderSlides: (from: number, to: number) => void;
  addLayer: (l: Layer) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  setSelectionLayer: (id: string | null) => void;
  updateGlobals: (patch: Partial<Carousel["globals"]>) => void;
  /** Switch the carousel's layout template AND reposition every text layer
   *  on every slide to match. This is destructive to manual nudges — by
   *  design: a layout button is supposed to *re-layout*, not just toggle a
   *  flag. Falls back to plain updateGlobals when there's no carousel. */
  applyLayout: (layout: Carousel["globals"]["layout"]) => void;
  /** Switch the headline font globally — overwrites every text layer's
   *  style.font on every slide. Same destructive-by-design semantics as
   *  applyLayout: a global control means a global re-skin. */
  applyHeadlineFont: (font: Carousel["globals"]["headlineFont"]) => void;
  /** Switch the palette globally. Overwrites every text layer's
   *  style.color with palette.fg and every solid bg's value with
   *  palette.bg. Image-typed backgrounds are preserved (those are
   *  user-chosen art, not theme colors). */
  applyPalette: (id: PaletteId) => void;
  updateSlideBg: (slideId: string, bg: Slide["bg"]) => void;
}

export const useEditor = create<EditorState>()(
  immer((set) => ({
    car: null,
    currentSlideId: null,
    selectionLayerId: null,
    loadCarousel: (c) =>
      set((s) => {
        // Accept null — Editor.tsx calls loadCar(null) during workId-switch
        // reset to clear stale state before the new carousel loads. Earlier
        // version dereferenced c.slides[0] and crashed. (Codex round 2 #1)
        s.car = c;
        s.currentSlideId = c ? (c.slides[0]?.id ?? null) : null;
        s.selectionLayerId = null;
      }),
    setCurrentSlide: (id) =>
      set((s) => {
        s.currentSlideId = id;
        s.selectionLayerId = null;
      }),
    addSlide: () =>
      set((s) => {
        if (!s.car) return;
        const ns = makeEmptySlide();
        s.car.slides.push(ns);
        s.currentSlideId = ns.id;
      }),
    removeSlide: (id) =>
      set((s) => {
        if (!s.car || s.car.slides.length <= 1) return;
        s.car.slides = s.car.slides.filter((x) => x.id !== id);
        if (s.currentSlideId === id) s.currentSlideId = s.car.slides[0].id;
      }),
    duplicateSlide: (id) =>
      set((s) => {
        if (!s.car) return;
        const orig = s.car.slides.find((x) => x.id === id);
        if (!orig) return;
        const copy: Slide = JSON.parse(JSON.stringify(orig));
        const dupSuffix = Date.now().toString(36);
        copy.id = `${id}_dup_${dupSuffix}`;
        // Regenerate every layer's id — without this, updateLayer (which finds
        // the first matching id across all slides) edited the original slide's
        // layer instead of the duplicate's. (Codex review 2026-04-27)
        copy.layers = copy.layers.map((l, i) => ({ ...l, id: `${l.id}_dup_${dupSuffix}_${i}` }));
        const idx = s.car.slides.findIndex((x) => x.id === id);
        s.car.slides.splice(idx + 1, 0, copy);
        s.currentSlideId = copy.id;
      }),
    reorderSlides: (from, to) =>
      set((s) => {
        if (!s.car) return;
        const [m] = s.car.slides.splice(from, 1);
        s.car.slides.splice(to, 0, m);
      }),
    addLayer: (l) =>
      set((s) => {
        if (!s.car || !s.currentSlideId) return;
        const slide = s.car.slides.find((x) => x.id === s.currentSlideId);
        if (!slide) return;
        (slide.layers as Layer[]).push(l);
        s.selectionLayerId = l.id;
      }),
    updateLayer: (id, patch) =>
      set((s) => {
        if (!s.car) return;
        for (const sl of s.car.slides) {
          const layer = sl.layers.find((x) => x.id === id);
          if (layer) {
            Object.assign(layer, patch);
            break;
          }
        }
      }),
    removeLayer: (id) =>
      set((s) => {
        if (!s.car) return;
        for (const sl of s.car.slides)
          sl.layers = sl.layers.filter((x) => x.id !== id);
        if (s.selectionLayerId === id) s.selectionLayerId = null;
      }),
    setSelectionLayer: (id) =>
      set((s) => {
        s.selectionLayerId = id;
      }),
    updateGlobals: (patch) =>
      set((s) => {
        if (s.car) Object.assign(s.car.globals, patch);
      }),
    applyLayout: (layout) =>
      set((s) => {
        if (!s.car) return;
        s.car.globals.layout = layout;
        const w = s.car.width;
        const h = s.car.height;
        for (const sl of s.car.slides) {
          sl.layers = sl.layers.map((l) => applyLayoutToLayer(l, layout, w, h));
        }
      }),
    applyHeadlineFont: (font) =>
      set((s) => {
        if (!s.car) return;
        s.car.globals.headlineFont = font;
        for (const sl of s.car.slides) {
          for (const l of sl.layers) {
            if (l.kind === "text") l.style.font = font;
          }
        }
      }),
    applyPalette: (id) =>
      set((s) => {
        if (!s.car) return;
        const p = PALETTES[id];
        if (!p) return;
        s.car.globals.palette = id;
        for (const sl of s.car.slides) {
          // Solid bg follows the palette; image bg stays (user-chosen art).
          if (sl.bg.type === "solid") sl.bg.value = p.bg;
          for (const l of sl.layers) {
            if (l.kind === "text") l.style.color = p.fg;
          }
        }
      }),
    updateSlideBg: (slideId, bg) =>
      set((s) => {
        if (!s.car) return;
        const sl = s.car.slides.find((x) => x.id === slideId);
        if (sl) sl.bg = bg;
      }),
  })),
);
