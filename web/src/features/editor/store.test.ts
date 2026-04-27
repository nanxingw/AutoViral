import { describe, it, expect, beforeEach } from "vitest";
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
