import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Carousel, Slide, Layer } from "./types";
import { makeEmptySlide } from "./types";

interface EditorState {
  car: Carousel | null;
  currentSlideId: string | null;
  selectionLayerId: string | null;
  loadCarousel: (c: Carousel) => void;
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
  updateSlideBg: (slideId: string, bg: Slide["bg"]) => void;
}

export const useEditor = create<EditorState>()(
  immer((set) => ({
    car: null,
    currentSlideId: null,
    selectionLayerId: null,
    loadCarousel: (c) =>
      set((s) => {
        s.car = c;
        s.currentSlideId = c.slides[0]?.id ?? null;
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
        copy.id = `${id}_dup_${Date.now().toString(36)}`;
        const idx = s.car.slides.findIndex((x) => x.id === id);
        s.car.slides.splice(idx + 1, 0, copy);
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
    updateSlideBg: (slideId, bg) =>
      set((s) => {
        if (!s.car) return;
        const sl = s.car.slides.find((x) => x.id === slideId);
        if (sl) sl.bg = bg;
      }),
  })),
);
