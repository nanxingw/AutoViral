import { describe, it, expect } from "vitest";
import { buildEditorViewerContext } from "./viewerContext";
import { makeEmptyCarousel } from "../types";
import type { TextLayer } from "../types";

describe("buildEditorViewerContext", () => {
  it("returns null when no carousel is loaded", () => {
    expect(buildEditorViewerContext(null, null, null)).toBeNull();
  });

  it("emits a viewer-context block with carousel summary on bare load", () => {
    const car = makeEmptyCarousel("w1");
    const out = buildEditorViewerContext(car, car.slides[0].id, null);
    expect(out).toContain('<viewer-context mode="image-text-editor">');
    expect(out).toContain("</viewer-context>");
    expect(out).toContain("carousel: 1 slide");
    expect(out).toContain("currentSlide: index=1/1");
    expect(out).toContain("selectedLayer: <none>");
  });

  it("includes text layer details when one is selected", () => {
    const car = makeEmptyCarousel("w1");
    const layer: TextLayer = {
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      text: "晨光 慢煮一杯",
      style: {
        font: "serif",
        size: 128,
        weight: 500,
        italic: true,
        color: "#2a3a4a",
        align: "center",
        tracking: 0,
      },
    };
    car.slides[0].layers.push(layer);
    const out = buildEditorViewerContext(car, car.slides[0].id, "t1");
    expect(out).toContain("selectedLayer: kind=text");
    expect(out).toContain('text="晨光 慢煮一杯"');
    expect(out).toContain("font=serif");
    expect(out).toContain("color=#2a3a4a");
  });

  it("truncates long text previews to 40 chars", () => {
    const car = makeEmptyCarousel("w1");
    const longText = "a".repeat(80);
    const layer: TextLayer = {
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      text: longText,
      style: {
        font: "serif",
        size: 128,
        weight: 500,
        italic: false,
        color: "#000",
        align: "center",
        tracking: 0,
      },
    };
    car.slides[0].layers.push(layer);
    const out = buildEditorViewerContext(car, car.slides[0].id, "t1") ?? "";
    // 40 a's + ellipsis (single character …)
    expect(out).toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…");
    expect(out).not.toContain("a".repeat(41));
  });
});
