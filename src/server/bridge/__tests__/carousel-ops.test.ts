// Unit test for carousel-ops (I08) — the carousel analogue of
// composition-ops.test.ts. Verifies the read/write/mutate round-trip and the
// load-bearing invariant: an invalid mutation is REJECTED and leaves
// carousel.yaml untouched on disk (atomic write).

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  LayerSchema,
  makeEmptyCarousel,
  type Carousel,
  type Layer,
  type TextLayer,
} from "../../../shared/carousel.js";
import {
  readCarouselFor,
  writeCarouselFor,
  mutateCarouselFor,
  carouselPathFor,
  applyLayerPatch,
} from "../carousel-ops.js";

describe("carousel-ops — read / write / mutate", () => {
  let workRoot: string;
  let workId: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-carousel-test-"));
    workId = "w_test";
    await mkdir(join(workRoot, workId), { recursive: true });
    const seed = makeEmptyCarousel(workId);
    await writeFile(
      join(workRoot, workId, "carousel.yaml"),
      yaml.dump(seed, { lineWidth: -1 }),
      "utf8",
    );
  });

  it("round-trips through validate → write → read", async () => {
    const before = await readCarouselFor({ workId, worksRoot: workRoot });
    await writeCarouselFor({ workId, worksRoot: workRoot }, before);
    const after = await readCarouselFor({ workId, worksRoot: workRoot });
    expect(after.workId).toBe(workId);
    expect(after.slides.length).toBe(before.slides.length);
  });

  it("rejects an invalid carousel WITHOUT touching disk", async () => {
    const target = carouselPathFor({ workId, worksRoot: workRoot });
    const before = await readFile(target, "utf8");
    // slides:[] violates `.min(1)` — must throw, disk must be unchanged.
    const bogus = { ...(await readCarouselFor({ workId, worksRoot: workRoot })), slides: [] } as unknown as Carousel;
    await expect(
      writeCarouselFor({ workId, worksRoot: workRoot }, bogus),
    ).rejects.toThrow();
    const after = await readFile(target, "utf8");
    expect(after).toBe(before);
  });

  it("mutateCarouselFor appends a slide and persists it", async () => {
    const before = await readCarouselFor({ workId, worksRoot: workRoot });
    const next = await mutateCarouselFor({ workId, worksRoot: workRoot }, (c) => ({
      ...c,
      slides: [...c.slides, { id: "s_added", bg: { type: "solid", value: "#000" }, layers: [] }],
    }));
    expect(next.slides.length).toBe(before.slides.length + 1);
    const raw = await readFile(carouselPathFor({ workId, worksRoot: workRoot }), "utf8");
    const parsed = yaml.load(raw) as { slides: Array<{ id: string }> };
    expect(parsed.slides.some((s) => s.id === "s_added")).toBe(true);
  });

  it("mutateCarouselFor SEEDS a blank carousel on a fresh work (no carousel.yaml yet → no ENOENT)", async () => {
    // A freshly-created image-text work has no carousel.yaml on disk — the
    // Editor holds makeEmptyCarousel in memory and only writes on first save.
    // The most common agent path (create work → `autoviral carousel add-slide`)
    // must NOT ENOENT; the mutator seeds the canonical blank carousel and the
    // write materialises carousel.yaml. (Symmetry with composition first-write.)
    const freshRoot = await mkdtemp(join(tmpdir(), "autoviral-carousel-fresh-"));
    const freshId = "w_fresh";
    await mkdir(join(freshRoot, freshId), { recursive: true }); // NB: no carousel.yaml
    const blankSlides = makeEmptyCarousel(freshId).slides.length; // canonical blank = 1
    const next = await mutateCarouselFor({ workId: freshId, worksRoot: freshRoot }, (c) => ({
      ...c,
      slides: [...c.slides, { id: "s_first", bg: { type: "solid", value: "#123456" }, layers: [] }],
    }));
    expect(next.slides.length).toBe(blankSlides + 1);
    expect(next.slides.some((s) => s.id === "s_first")).toBe(true);
    // carousel.yaml is now materialised on disk with the seeded + appended slides.
    const raw = await readFile(carouselPathFor({ workId: freshId, worksRoot: freshRoot }), "utf8");
    expect((yaml.load(raw) as { slides: unknown[] }).slides.length).toBe(blankSlides + 1);
  });

  it("mutateCarouselFor rejects a bad layer kind and leaves the file untouched", async () => {
    const target = carouselPathFor({ workId, worksRoot: workRoot });
    const before = await readFile(target, "utf8");
    await expect(
      mutateCarouselFor({ workId, worksRoot: workRoot }, (c) => ({
        ...c,
        slides: c.slides.map((s, i) =>
          i === 0
            ? { ...s, layers: [{ id: "x", kind: "bogus", box: { x: 0, y: 0, w: 1, h: 1 } } as any] }
            : s,
        ),
      })),
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(before);
  });

  // S2 — write-path broadcast. mutateCarouselFor fires onCommitted ONLY after
  // the atomic write succeeds so routes broadcast "carousel-changed" the
  // instant disk is consistent (replaces fs.watch).
  it("mutateCarouselFor calls onCommitted exactly once with the new carousel on success", async () => {
    const seen: Carousel[] = [];
    const next = await mutateCarouselFor(
      { workId, worksRoot: workRoot },
      (c) => ({
        ...c,
        slides: [...c.slides, { id: "s_added", bg: { type: "solid", value: "#000" }, layers: [] }],
      }),
      (committed) => {
        seen.push(committed);
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(next);
    expect(seen[0].slides.some((s) => s.id === "s_added")).toBe(true);
  });

  it("mutateCarouselFor does NOT call onCommitted when validation fails", async () => {
    const target = carouselPathFor({ workId, worksRoot: workRoot });
    const before = await readFile(target, "utf8");
    let called = false;
    await expect(
      mutateCarouselFor(
        { workId, worksRoot: workRoot },
        (c) => ({
          ...c,
          slides: c.slides.map((s, i) =>
            i === 0
              ? { ...s, layers: [{ id: "x", kind: "bogus", box: { x: 0, y: 0, w: 1, h: 1 } } as any] }
              : s,
          ),
        }),
        () => {
          called = true;
        },
      ),
    ).rejects.toThrow();
    expect(called).toBe(false);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  // S2 fix-up — symmetric with composition-ops: a throwing onCommitted (a
  // broadcast that fails) must NOT invalidate a carousel write that already
  // landed. Pre-hardening, the exception would propagate out and the route
  // would 400/500 on a write that actually succeeded.
  it("mutateCarouselFor tolerates a throwing onCommitted: the write still lands and it does NOT reject", async () => {
    const target = carouselPathFor({ workId, worksRoot: workRoot });
    const next = await mutateCarouselFor(
      { workId, worksRoot: workRoot },
      (c) => ({
        ...c,
        slides: [
          ...c.slides,
          { id: "s_committed", bg: { type: "solid", value: "#000" }, layers: [] },
        ],
      }),
      () => {
        throw new Error("broadcast blew up");
      },
    );
    expect(next.slides.some((s) => s.id === "s_committed")).toBe(true);
    expect(await readFile(target, "utf8")).toContain("s_committed");
  });
});

// applyLayerPatch — the carousel twin of `patchClipProps` (S11): a `set-layer`
// onto an EXISTING layer id must DEEP-MERGE (preserve unsupplied fields) rather
// than REPLACE (the pre-fix bug that reset box/style to defaults on a `--text`
// edit). A new/absent id still CREATEs with per-kind defaults.
describe("carousel-ops — applyLayerPatch (set-layer create vs patch)", () => {
  // A fully-styled text layer to patch against — every field NON-default so a
  // reset-to-default regression is visible.
  function styledTextLayer(): TextLayer {
    return LayerSchema.parse({
      id: "t_styled",
      kind: "text",
      box: { x: 120, y: 240, w: 600, h: 180, rotation: 12 },
      text: "原始标题",
      style: {
        font: "serif",
        size: 96,
        weight: 400,
        italic: true,
        color: "#ff0066",
        align: "left",
        tracking: 8,
      },
    }) as TextLayer;
  }

  it("CREATE: no matching id → mints id + fills per-kind defaults", () => {
    const out = applyLayerPatch([], {
      kind: "text",
      box: { x: 0, y: 0, w: 100, h: 50 },
      text: "新",
    });
    expect(out.kind).toBe("text");
    expect(typeof out.id).toBe("string");
    expect(out.id.length).toBeGreaterThan(0);
    // zod defaults filled for the unsupplied style leaves.
    expect((out as TextLayer).style.font).toBe("sans");
    expect((out as TextLayer).style.size).toBe(48);
    expect((out as TextLayer).style.color).toBe("#111");
  });

  it("CREATE: an explicit new --id is preserved (not re-minted)", () => {
    const out = applyLayerPatch([], {
      id: "t_brand_new",
      kind: "image",
      box: { x: 0, y: 0, w: 10, h: 10 },
      src: "/x.png",
    });
    expect(out.id).toBe("t_brand_new");
    expect(out.kind).toBe("image");
  });

  // THE BUG (red before fix): patching ONLY --text on an existing styled layer
  // must keep box + every style leaf. Pre-fix the route rebuilt the layer from
  // {kind, box?, text} alone and zod reset font/size/weight/italic/color/align/
  // tracking to defaults.
  it("PATCH: changing only `text` preserves box and ALL style fields", () => {
    const base = styledTextLayer();
    const out = applyLayerPatch([base], {
      id: "t_styled",
      kind: "text",
      text: "改后的标题",
    }) as TextLayer;
    expect(out.id).toBe("t_styled");
    expect(out.text).toBe("改后的标题"); // the one field we changed
    // box preserved verbatim (the killer regression).
    expect(out.box).toEqual({ x: 120, y: 240, w: 600, h: 180, rotation: 12 });
    // every style leaf preserved.
    expect(out.style.font).toBe("serif");
    expect(out.style.size).toBe(96);
    expect(out.style.weight).toBe(400);
    expect(out.style.italic).toBe(true);
    expect(out.style.color).toBe("#ff0066");
    expect(out.style.align).toBe("left");
    expect(out.style.tracking).toBe(8);
  });

  it("PATCH: a partial `style` deep-merges (only the supplied leaf changes)", () => {
    const base = styledTextLayer();
    const out = applyLayerPatch([base], {
      id: "t_styled",
      kind: "text",
      style: { color: "#00ff00" },
    }) as TextLayer;
    expect(out.style.color).toBe("#00ff00"); // changed
    // siblings preserved.
    expect(out.style.font).toBe("serif");
    expect(out.style.size).toBe(96);
    expect(out.style.weight).toBe(400);
    expect(out.style.tracking).toBe(8);
    // text + box untouched.
    expect(out.text).toBe("原始标题");
    expect(out.box.w).toBe(600);
  });

  it("PATCH: a partial `box` deep-merges (only the supplied coordinate changes)", () => {
    const base = styledTextLayer();
    const out = applyLayerPatch([base], {
      id: "t_styled",
      kind: "text",
      box: { x: 999 },
    }) as TextLayer;
    expect(out.box.x).toBe(999); // changed
    expect(out.box.y).toBe(240); // preserved
    expect(out.box.w).toBe(600); // preserved
    expect(out.box.h).toBe(180); // preserved
    expect(out.box.rotation).toBe(12); // preserved
  });

  it("PATCH: --italic / --tracking land on the layer", () => {
    const base = styledTextLayer();
    const out = applyLayerPatch([base], {
      id: "t_styled",
      kind: "text",
      style: { italic: false, tracking: -3 },
    }) as TextLayer;
    expect(out.style.italic).toBe(false);
    expect(out.style.tracking).toBe(-3);
    // other style fields preserved.
    expect(out.style.size).toBe(96);
    expect(out.style.color).toBe("#ff0066");
  });

  it("PATCH: rejects a kind change on a matched id (kind is immutable)", () => {
    const base = styledTextLayer();
    expect(() =>
      applyLayerPatch([base], {
        id: "t_styled",
        kind: "image",
        src: "/x.png",
      }),
    ).toThrow(/kind/i);
  });

  it("PATCH on a shape layer preserves fill/stroke when only changing the shape's box", () => {
    const shape: Layer = LayerSchema.parse({
      id: "t_shape",
      kind: "shape",
      box: { x: 10, y: 20, w: 300, h: 300 },
      shape: "circle",
      fill: "#abcdef",
      stroke: "#123456",
      strokeWidth: 4,
    });
    const out = applyLayerPatch([shape], {
      id: "t_shape",
      kind: "shape",
      box: { w: 500 },
    });
    expect(out.kind).toBe("shape");
    if (out.kind !== "shape") throw new Error("expected shape");
    expect(out.box.w).toBe(500); // changed
    expect(out.box.h).toBe(300); // preserved
    expect(out.shape).toBe("circle"); // preserved
    expect(out.fill).toBe("#abcdef"); // preserved
    expect(out.stroke).toBe("#123456"); // preserved
    expect(out.strokeWidth).toBe(4); // preserved
  });
});
