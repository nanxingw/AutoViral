import { describe, it, expect } from "vitest";
import { applyLayoutToTextLayer, applyLayoutToLayer } from "./layout";
import type { TextLayer, ImageLayer } from "../types";

const W = 1080;
const H = 1350;

function makeText(over: Partial<TextLayer> = {}): TextLayer {
  return {
    id: "t",
    kind: "text",
    box: { x: 200, y: 800, w: 500, h: 200, rotation: 0 },
    text: "hi",
    style: {
      font: "serif",
      size: 96,
      weight: 500,
      italic: false,
      color: "#000",
      align: "right",
      tracking: 0,
    },
    ...over,
  };
}

describe("applyLayoutToTextLayer", () => {
  it("centered: full-width, center align, y reset to editorial 0.4 anchor", () => {
    const out = applyLayoutToTextLayer(makeText(), "centered", W, H);
    expect(out.box.x).toBe(90);
    expect(out.box.w).toBe(900);
    expect(out.style.align).toBe("center");
    // y reset so split → centered actually pulls text back up.
    expect(out.box.y).toBe(540); // round(1350 * 0.4)
  });

  it("left: ~60% width with left align", () => {
    const out = applyLayoutToTextLayer(makeText(), "left", W, H);
    expect(out.box.x).toBe(90);
    expect(out.box.w).toBe(648);
    expect(out.style.align).toBe("left");
  });

  it("split: drops to lower half, center align", () => {
    const out = applyLayoutToTextLayer(makeText(), "split", W, H);
    expect(out.box.x).toBe(90);
    expect(out.box.y).toBe(735); // canvas.h * 0.5 + 60
    expect(out.box.w).toBe(900);
    expect(out.style.align).toBe("center");
  });

  it("preserves unrelated style fields (size / color / tracking)", () => {
    const out = applyLayoutToTextLayer(
      makeText({ style: { font: "sans", size: 64, weight: 700, italic: true, color: "#ff0", align: "right", tracking: 5 } }),
      "centered",
      W,
      H,
    );
    expect(out.style.size).toBe(64);
    expect(out.style.color).toBe("#ff0");
    expect(out.style.tracking).toBe(5);
    expect(out.style.italic).toBe(true);
  });
});

describe("applyLayoutToLayer", () => {
  it("non-text layers pass through unchanged", () => {
    const img: ImageLayer = {
      id: "i",
      kind: "image",
      box: { x: 100, y: 200, w: 300, h: 400, rotation: 0 },
      src: "x.png",
    };
    const out = applyLayoutToLayer(img, "centered", W, H);
    expect(out).toBe(img); // identity — no spread
  });
});
