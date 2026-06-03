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
});
