import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportSinglePng, exportAllPngs } from "./exportPng";
import { useEditor } from "../store";
import { makeEmptyCarousel } from "../types";

describe("exportSinglePng", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("calls stage.toDataURL with pixelRatio 2 + image/png and triggers a download", () => {
    const toDataURL = vi.fn().mockReturnValue("data:image/png;base64,abc");
    const clicked = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLAnchorElement;
      if (tag === "a") {
        el.click = clicked;
      }
      return el;
    });

    exportSinglePng({ toDataURL }, "out.png");
    expect(toDataURL).toHaveBeenCalledWith({
      pixelRatio: 2,
      mimeType: "image/png",
    });
    expect(clicked).toHaveBeenCalled();
  });
});

describe("exportAllPngs", () => {
  beforeEach(() => {
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    });
  });

  it("captures every slide in order", async () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addSlide();
    useEditor.getState().addSlide();
    const calls: string[] = [];
    const capture = vi.fn(async (id: string) => {
      calls.push(id);
      return "data:image/png;base64,xyz";
    });
    await exportAllPngs("car_x", capture);
    const ids = useEditor.getState().car!.slides.map((s) => s.id);
    expect(calls).toEqual(ids);
  });
});
