import { describe, it, expect } from "vitest";
import { CarouselSchema, makeEmptyCarousel, makeEmptySlide } from "./types";

describe("Carousel schema", () => {
  it("makes an empty carousel with 1 slide and 4:5 dims", () => {
    const c = makeEmptyCarousel("w1");
    const parsed = CarouselSchema.parse(c);
    expect(parsed.width).toBe(1080);
    expect(parsed.height).toBe(1350);
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.slides[0].layers).toEqual([]);
  });

  it("rejects invalid layout", () => {
    const c = makeEmptyCarousel("w1");
    (c.globals as { layout: string }).layout = "bogus";
    expect(() => CarouselSchema.parse(c)).toThrow();
  });

  it("makeEmptySlide returns a unique id and gradient bg", () => {
    const s1 = makeEmptySlide();
    const s2 = makeEmptySlide();
    expect(s1.id).not.toBe(s2.id);
    expect(s1.bg.type).toBe("gradient");
  });
});
