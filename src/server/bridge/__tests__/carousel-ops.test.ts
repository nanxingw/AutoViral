// Unit test for carousel-ops (I08) — the carousel analogue of
// composition-ops.test.ts. Verifies the read/write/mutate round-trip and the
// load-bearing invariant: an invalid mutation is REJECTED and leaves
// carousel.yaml untouched on disk (atomic write).

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { makeEmptyCarousel, type Carousel } from "../../../shared/carousel.js";
import {
  readCarouselFor,
  writeCarouselFor,
  mutateCarouselFor,
  carouselPathFor,
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
