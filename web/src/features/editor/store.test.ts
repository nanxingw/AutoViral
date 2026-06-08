import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEditor } from "./store";
import { makeEmptyCarousel } from "./types";
import type { Layer } from "./types";

describe("useEditor store", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("loadCarousel selects first slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    expect(useEditor.getState().currentSlideId).toBe(c.slides[0].id);
  });

  it("addSlide appends and selects new slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addSlide();
    expect(useEditor.getState().car!.slides).toHaveLength(2);
    expect(useEditor.getState().currentSlideId).toBe(
      useEditor.getState().car!.slides[1].id,
    );
  });

  it("addLayer pushes to current slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    const layer: Layer = {
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
      text: "Hi",
      style: {
        font: "sans",
        size: 48,
        weight: 700,
        italic: false,
        color: "#111",
        align: "center",
        tracking: 0,
      },
    };
    useEditor.getState().addLayer(layer);
    expect(useEditor.getState().car!.slides[0].layers).toHaveLength(1);
  });

  it("updateLayer patches an existing layer", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    const layer: Layer = {
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
      text: "Hi",
      style: {
        font: "sans",
        size: 48,
        weight: 700,
        italic: false,
        color: "#111",
        align: "center",
        tracking: 0,
      },
    };
    useEditor.getState().addLayer(layer);
    useEditor.getState().updateLayer("t1", { text: "Bye" });
    const updated = useEditor.getState().car!.slides[0].layers[0];
    expect((updated as { text: string }).text).toBe("Bye");
  });

  it("removeLayer drops the layer and clears selection", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    const layer: Layer = {
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
      text: "Hi",
      style: {
        font: "sans",
        size: 48,
        weight: 700,
        italic: false,
        color: "#111",
        align: "center",
        tracking: 0,
      },
    };
    useEditor.getState().addLayer(layer);
    useEditor.getState().setSelectionLayer("t1");
    useEditor.getState().removeLayer("t1");
    expect(useEditor.getState().car!.slides[0].layers).toHaveLength(0);
    expect(useEditor.getState().selectionLayerId).toBeNull();
  });

  it("reorderSlides moves slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addSlide();
    useEditor.getState().addSlide();
    const ids = useEditor.getState().car!.slides.map((s) => s.id);
    useEditor.getState().reorderSlides(0, 2);
    expect(useEditor.getState().car!.slides.map((s) => s.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
    ]);
  });

  it("duplicateSlide inserts a copy after the source", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    const id = c.slides[0].id;
    useEditor.getState().duplicateSlide(id);
    const slides = useEditor.getState().car!.slides;
    expect(slides).toHaveLength(2);
    expect(slides[0].id).toBe(id);
    expect(slides[1].id).not.toBe(id);
  });

  it("duplicateSlide mints collision-proof ids even within the same millisecond (B5)", () => {
    // Freeze Date.now so the bare-Date.now() id scheme would produce
    // byte-identical ids on two dups. The collision-proof generators must
    // disambiguate via their monotonic counter.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T00:00:00.000Z"));
    try {
      const c = makeEmptyCarousel("w1");
      useEditor.getState().loadCarousel(c);
      const sourceId = c.slides[0].id;
      // seed one text layer on the source slide so duplicates carry a layer
      const layer: Layer = {
        id: "t-seed",
        kind: "text",
        box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
        text: "Hi",
        style: {
          font: "sans",
          size: 48,
          weight: 700,
          italic: false,
          color: "#111",
          align: "center",
          tracking: 0,
        },
      };
      useEditor.getState().addLayer(layer);

      // two dups of the SAME source slide, same frozen millisecond
      useEditor.getState().duplicateSlide(sourceId);
      useEditor.getState().duplicateSlide(sourceId);

      const slides = useEditor.getState().car!.slides;
      // 2 copies inserted after the source (+ original) = 3 slides
      const copies = slides.filter((s) => s.id !== sourceId);
      expect(copies).toHaveLength(2);

      // all 4 ids — 2 copy slide ids + each copy's single layer id — must be
      // mutually distinct.
      const ids = [
        copies[0].id,
        copies[1].id,
        copies[0].layers[0].id,
        copies[1].layers[0].id,
      ];
      expect(new Set(ids).size).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removeSlide refuses to drop the last one", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    const id = c.slides[0].id;
    useEditor.getState().removeSlide(id);
    expect(useEditor.getState().car!.slides).toHaveLength(1);
  });

  it("removeSlide removes a non-last slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addSlide();
    const ids = useEditor.getState().car!.slides.map((s) => s.id);
    useEditor.getState().removeSlide(ids[0]);
    expect(useEditor.getState().car!.slides).toHaveLength(1);
    expect(useEditor.getState().car!.slides[0].id).toBe(ids[1]);
  });

  it("updateGlobals merges patch", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().updateGlobals({ palette: "noir" });
    expect(useEditor.getState().car!.globals.palette).toBe("noir");
  });

  it("applyHeadlineFont overwrites every text layer's font on every slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    // seed a serif text layer on slide 1, dup the slide, then add a sans text on the copy
    const layer: Layer = {
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
      text: "Hi",
      style: {
        font: "serif",
        size: 48,
        weight: 700,
        italic: false,
        color: "#111",
        align: "center",
        tracking: 0,
      },
    };
    useEditor.getState().addLayer(layer);
    useEditor.getState().duplicateSlide(c.slides[0].id);
    useEditor.getState().applyHeadlineFont("mono");
    const fonts = useEditor
      .getState()
      .car!.slides.flatMap((s) => s.layers)
      .filter((l): l is Extract<Layer, { kind: "text" }> => l.kind === "text")
      .map((l) => l.style.font);
    expect(fonts.every((f) => f === "mono")).toBe(true);
    expect(useEditor.getState().car!.globals.headlineFont).toBe("mono");
  });

  it("applyPalette overwrites text color + solid bg, leaves image bg alone", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    // seed: slide 1 solid bg + text, slide 2 image bg + text
    useEditor
      .getState()
      .updateSlideBg(c.slides[0].id, { type: "solid", value: "#fff" });
    const text: Layer = {
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
      text: "Hi",
      style: {
        font: "serif",
        size: 48,
        weight: 700,
        italic: false,
        color: "#000",
        align: "center",
        tracking: 0,
      },
    };
    useEditor.getState().addLayer(text);
    useEditor.getState().addSlide();
    const slide2Id = useEditor.getState().car!.slides[1].id;
    useEditor
      .getState()
      .updateSlideBg(slide2Id, { type: "image", value: "/some.png" });
    useEditor.getState().applyPalette("neon");
    const car = useEditor.getState().car!;
    // neon palette: bg=#0a0b0f, fg=#fafaf7
    expect(car.globals.palette).toBe("neon");
    expect(car.slides[0].bg).toEqual({ type: "solid", value: "#0a0b0f" });
    // image bg is preserved
    expect(car.slides[1].bg).toEqual({ type: "image", value: "/some.png" });
    const txt = car.slides[0].layers[0] as Extract<Layer, { kind: "text" }>;
    expect(txt.style.color).toBe("#fafaf7");
  });

  it("updateSlideBg replaces background", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor
      .getState()
      .updateSlideBg(c.slides[0].id, { type: "solid", value: "#000" });
    expect(useEditor.getState().car!.slides[0].bg).toEqual({
      type: "solid",
      value: "#000",
    });
  });
});
