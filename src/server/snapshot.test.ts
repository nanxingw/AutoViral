// I21 — orchestration tests for renderSnapshot. We mock the Remotion still
// renderer (no Chromium) and write real composition.yaml / carousel.yaml +
// asset fixtures to a temp work root, then assert:
//   • video work → detects video, computes the right FRAME (from --at or the
//     focus playhead) and forwards it + the comp to renderCompositionStill,
//     returns the PNG path under output/.
//   • carousel work → picks the right SLIDE (--slide or first), resolves its
//     bg image to disk, and returns that path with textLayersComposited:false
//     (base-only); a real exported output/ page resolves via glob and is flagged
//     textLayersComposited:true. Missing artifact → clear throw.
//   • bgImageAssetRel parses both /api/works/<id>/assets/... and bare relative.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { makeEmptyComposition } from "../shared/composition.js";
import { makeEmptyCarousel, type Carousel } from "../shared/carousel.js";

// Mock the heavy Remotion still path — capture the args it receives.
const renderCompositionStillMock = vi.fn(
  async (_comp: unknown, opts: { outFile: string; frame: number }) => opts.outFile,
);
vi.mock("./remotion-still.js", () => ({
  renderCompositionStill: (comp: unknown, opts: { outFile: string; frame: number }) =>
    renderCompositionStillMock(comp, opts),
}));

const focus = await import("../focus/index.js");
const { renderSnapshot, bgImageAssetRel } = await import("./snapshot.js");

async function writeComposition(
  root: string,
  workId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(join(root, workId), { recursive: true });
  const comp = { ...makeEmptyComposition({ workId }), fps: 30, duration: 12, ...overrides };
  await writeFile(
    join(root, workId, "composition.yaml"),
    yaml.dump(comp, { lineWidth: -1 }),
    "utf8",
  );
}

async function writeCarousel(root: string, workId: string, carousel: Carousel): Promise<void> {
  await mkdir(join(root, workId), { recursive: true });
  await writeFile(
    join(root, workId, "carousel.yaml"),
    yaml.dump(carousel, { lineWidth: -1 }),
    "utf8",
  );
}

let root: string;

beforeEach(async () => {
  renderCompositionStillMock.mockClear();
  focus.reset();
  root = await mkdtemp(join(tmpdir(), "autoviral-snapshot-test-"));
});

describe("bgImageAssetRel", () => {
  it("strips the /api/works/<id>/assets/ prefix and decodes segments", () => {
    expect(
      bgImageAssetRel("w1", {
        type: "image",
        value: "/api/works/w1/assets/assets/images/scene%2001.png",
      }),
    ).toBe("assets/images/scene 01.png");
  });
  it("passes a bare work-relative path through", () => {
    expect(
      bgImageAssetRel("w1", { type: "image", value: "assets/images/a.png" }),
    ).toBe("assets/images/a.png");
  });
  it("returns null for non-image / data / remote backgrounds", () => {
    expect(bgImageAssetRel("w1", { type: "gradient", value: "#000,#fff" })).toBeNull();
    expect(bgImageAssetRel("w1", { type: "solid", value: "#000" })).toBeNull();
    expect(bgImageAssetRel("w1", { type: "image", value: "data:image/png;base64,AAA" })).toBeNull();
    expect(bgImageAssetRel("w1", { type: "image", value: "https://x.test/a.png" })).toBeNull();
  });
});

describe("renderSnapshot — video", () => {
  it("renders a still at the FRAME implied by --at and returns a PNG under output/", async () => {
    await writeComposition(root, "wv", { fps: 30, duration: 12 });
    const result = await renderSnapshot({ workId: "wv", at: 2, worksRoot: root });
    expect(result.kind).toBe("video-still");
    // A Remotion still is faithful — overlays/text are baked into the PNG.
    expect(result.textLayersComposited).toBe(true);
    expect(result.path).toBe(join(root, "wv", "output", "snapshot-frame-60.png"));
    expect(renderCompositionStillMock).toHaveBeenCalledTimes(1);
    const [comp, opts] = renderCompositionStillMock.mock.calls[0];
    expect((comp as { fps: number }).fps).toBe(30);
    expect(opts.frame).toBe(60); // 2s * 30fps
    expect(opts.outFile).toBe(result.path);
  });

  it("defaults to the current focus playhead when --at is omitted", async () => {
    await writeComposition(root, "wv2", { fps: 30, duration: 12 });
    focus.write("wv2", { playheadSec: 4 });
    const result = await renderSnapshot({ workId: "wv2", worksRoot: root });
    expect(renderCompositionStillMock.mock.calls[0][1].frame).toBe(120); // 4s * 30
    expect(result.path).toContain("snapshot-frame-120.png");
  });

  it("snapshots frame 0 when no --at and no focus set", async () => {
    await writeComposition(root, "wv3");
    await renderSnapshot({ workId: "wv3", worksRoot: root });
    expect(renderCompositionStillMock.mock.calls[0][1].frame).toBe(0);
  });
});

describe("renderSnapshot — carousel", () => {
  function carouselWith(slides: Carousel["slides"]): Carousel {
    return { ...makeEmptyCarousel("wc"), slides };
  }

  it("returns the FIRST slide's bg image path by default", async () => {
    const car = carouselWith([
      { id: "s1", bg: { type: "image", value: "assets/images/one.png" }, layers: [] },
      { id: "s2", bg: { type: "image", value: "assets/images/two.png" }, layers: [] },
    ]);
    await writeCarousel(root, "wc", car);
    // Materialise the bg file so the existence check passes.
    await mkdir(join(root, "wc", "assets", "images"), { recursive: true });
    await writeFile(join(root, "wc", "assets", "images", "one.png"), "x", "utf8");

    const result = await renderSnapshot({ workId: "wc", worksRoot: root });
    expect(result.kind).toBe("carousel-slide");
    expect(result.path).toBe(join(root, "wc", "assets", "images", "one.png"));
    // The bg-fallback PNG is the slide BACKGROUND only — Konva text/shape/sticker
    // layers are never composited server-side, so the flag must be false so the
    // agent doesn't infer text layout/overflow from a base-only image.
    expect(result.textLayersComposited).toBe(false);
    // No Remotion still for a carousel.
    expect(renderCompositionStillMock).not.toHaveBeenCalled();
  });

  it("resolves a specific --slide by id", async () => {
    const car = carouselWith([
      { id: "s1", bg: { type: "image", value: "assets/images/one.png" }, layers: [] },
      { id: "s2", bg: { type: "image", value: "assets/images/two.png" }, layers: [] },
    ]);
    await writeCarousel(root, "wc", car);
    await mkdir(join(root, "wc", "assets", "images"), { recursive: true });
    await writeFile(join(root, "wc", "assets", "images", "two.png"), "x", "utf8");

    const result = await renderSnapshot({ workId: "wc", slide: "s2", worksRoot: root });
    expect(result.path).toBe(join(root, "wc", "assets", "images", "two.png"));
  });

  it("prefers an already-exported page over the bg image", async () => {
    const car = carouselWith([
      { id: "s1", bg: { type: "image", value: "assets/images/one.png" }, layers: [] },
    ]);
    await writeCarousel(root, "wc", car);
    await mkdir(join(root, "wc", "output"), { recursive: true });
    await writeFile(join(root, "wc", "output", `${car.id}-01.png`), "x", "utf8");

    const result = await renderSnapshot({ workId: "wc", worksRoot: root });
    expect(result.path).toBe(join(root, "wc", "output", `${car.id}-01.png`));
    // A real exported page IS the deliverable with text layers baked in ⇒ faithful.
    expect(result.textLayersComposited).toBe(true);
  });

  it("globs an exported page by name suffix regardless of the prefix scheme", async () => {
    // FIX 3 — the exporter's exact filename prefix isn't hard-coded; any
    // output/*.{png,jpg,webp} whose name ends with the zero-padded page number
    // matches. Here the second slide's page is "page-02.png".
    const car = carouselWith([
      { id: "s1", bg: { type: "gradient", value: "#000,#fff" }, layers: [] },
      { id: "s2", bg: { type: "gradient", value: "#111,#eee" }, layers: [] },
    ]);
    await writeCarousel(root, "wc", car);
    await mkdir(join(root, "wc", "output"), { recursive: true });
    await writeFile(join(root, "wc", "output", "page-02.png"), "x", "utf8");

    const result = await renderSnapshot({ workId: "wc", slide: "s2", worksRoot: root });
    expect(result.path).toBe(join(root, "wc", "output", "page-02.png"));
    expect(result.textLayersComposited).toBe(true);
  });

  it("throws a clear error when an unknown --slide is given", async () => {
    const car = carouselWith([
      { id: "s1", bg: { type: "image", value: "assets/images/one.png" }, layers: [] },
    ]);
    await writeCarousel(root, "wc", car);
    await expect(
      renderSnapshot({ workId: "wc", slide: "nope", worksRoot: root }),
    ).rejects.toThrow(/slide "nope" not found/);
  });

  it("throws an actionable error when the slide has no on-disk visual yet", async () => {
    const car = carouselWith([
      { id: "s1", bg: { type: "gradient", value: "#000,#fff" }, layers: [] },
    ]);
    await writeCarousel(root, "wc", car);
    await expect(
      renderSnapshot({ workId: "wc", worksRoot: root }),
    ).rejects.toThrow(/no snapshot artifact/);
  });
});

describe("renderSnapshot — detection", () => {
  it("throws when neither deliverable exists", async () => {
    await mkdir(join(root, "empty"), { recursive: true });
    await expect(
      renderSnapshot({ workId: "empty", worksRoot: root }),
    ).rejects.toThrow(/no composition.yaml or carousel.yaml/);
  });
});
