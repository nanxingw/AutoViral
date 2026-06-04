import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  transformsToFilterChain,
  buildTransformsFilterArgs,
  transformsCacheName,
  applyTransformsPrePass,
} from "../transforms-ffmpeg.js";
import { CompositionSchema } from "../../shared/composition.js";
import type { Composition, VideoClip } from "../../shared/composition.js";

// S18 (US 27/28) — crop + flip FFMPEG EXPORT CONSUMPTION proof. crop / flipH /
// flipV are NOT dead schema fields: this asserts the ffmpeg filtergraph the
// export builds actually contains `crop=`, `hflip`, `vflip` for the right
// transforms — the mirror image of the Remotion preview clip-path/scaleX(-1)
// (WYSIWYG by construction). We do NOT run ffmpeg (host has none); we assert
// the generated filtergraph STRING, exactly like buildSpeedRampFilterArgs.
//
// crop is normalised [0,1]; ffmpeg crop=w:h:x:y takes PIXELS, so the chain
// multiplies by the source dimensions: crop=W*w:H*h:W*x:H*y.

describe("transformsToFilterChain (S18 ffmpeg crop+flip consumption)", () => {
  const W = 1080;
  const H = 1920;

  it("no crop/flip → empty chain (old work, no-op)", () => {
    expect(transformsToFilterChain({ scale: 1, x: 0, y: 0, rotation: 0 }, W, H)).toBe(
      "",
    );
  });

  it("flipH → 'hflip'", () => {
    expect(
      transformsToFilterChain(
        { scale: 1, x: 0, y: 0, rotation: 0, flipH: true },
        W,
        H,
      ),
    ).toBe("hflip");
  });

  it("flipV → 'vflip'", () => {
    expect(
      transformsToFilterChain(
        { scale: 1, x: 0, y: 0, rotation: 0, flipV: true },
        W,
        H,
      ),
    ).toBe("vflip");
  });

  it("flipH + flipV → 'hflip,vflip'", () => {
    expect(
      transformsToFilterChain(
        { scale: 1, x: 0, y: 0, rotation: 0, flipH: true, flipV: true },
        W,
        H,
      ),
    ).toBe("hflip,vflip");
  });

  it("crop {x:0.1,y:0.2,w:0.5,h:0.6} → crop=W*w:H*h:W*x:H*y in PIXELS", () => {
    const chain = transformsToFilterChain(
      { scale: 1, x: 0, y: 0, rotation: 0, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } },
      W,
      H,
    );
    // crop=out_w:out_h:x:y  =  1080*0.5 : 1920*0.6 : 1080*0.1 : 1920*0.2
    //                        = 540 : 1152 : 108 : 384
    expect(chain).toContain("crop=");
    expect(chain).toBe("crop=540:1152:108:384");
  });

  it("crop + flipH → crop runs FIRST, then hflip (comma-chained)", () => {
    const chain = transformsToFilterChain(
      {
        scale: 1,
        x: 0,
        y: 0,
        rotation: 0,
        crop: { x: 0, y: 0, w: 0.5, h: 1 },
        flipH: true,
      },
      W,
      H,
    );
    expect(chain).toBe("crop=540:1920:0:0,hflip");
  });
});

describe("buildTransformsFilterArgs (S18 — full ffmpeg argv)", () => {
  it("wraps the chain in -vf and the in/out paths", () => {
    const args = buildTransformsFilterArgs("in.mp4", "out.mp4", "crop=540:1920:0:0,hflip");
    expect(args).toContain("-i");
    expect(args).toContain("in.mp4");
    expect(args).toContain("out.mp4");
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toBe("crop=540:1920:0:0,hflip");
  });
});

describe("transformsToFilterChain crop basis is the SOURCE frame, not the canvas (S18 review fix high)", () => {
  // The review caught that crop= was being multiplied by comp.width/height
  // (canvas dims). crop is NORMALISED fractions of the SOURCE, so the basis MUST
  // be the source video's real pixel dims. A 1280×720 source cropped to the left
  // half is crop=640:720:0:0 — NOT 540×... (canvas) and NOT clamped to canvas.
  it("uses the real source dims (1280×720), not a 1080×1920 canvas", () => {
    const chain = transformsToFilterChain(
      { scale: 1, x: 0, y: 0, rotation: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 } },
      1280,
      720,
    );
    expect(chain).toBe("crop=640:720:0:0");
  });

  it("clamps a crop window that would overrun the source so ffmpeg never gets a too-big size", () => {
    // x=0.8 w=0.5 → out_w would be 0.5*W and x=0.8*W → x+out_w=1.3*W > W.
    // (CropSchema now rejects this on write, but a legacy/in-memory comp could
    // still carry it — the chain must clamp, not emit an invalid crop=.)
    const chain = transformsToFilterChain(
      { scale: 1, x: 0, y: 0, rotation: 0, crop: { x: 0.8, y: 0, w: 0.5, h: 0.5 } },
      1000,
      1000,
    );
    // out_w clamped so x + out_w <= W: x=800, out_w<=200.
    const m = chain.match(/^crop=(\d+):(\d+):(\d+):(\d+)$/);
    expect(m).not.toBeNull();
    const [, ow, oh, ox, oy] = m!.map(Number);
    expect(ox + ow).toBeLessThanOrEqual(1000);
    expect(oy + oh).toBeLessThanOrEqual(1000);
    expect(ow).toBeGreaterThan(0);
    expect(oh).toBeGreaterThan(0);
  });
});

describe("applyTransformsPrePass (S18 — the render-pipeline Stage 0.5 boundary: builds the cache + STRIPS consumed crop/flip so Remotion doesn't re-apply)", () => {
  // transformsToFilterChain / transformsCacheName are unit-tested above, but the
  // function actually wired into render-pipeline Stage 0.5 is applyTransformsPrePass
  // — and its LAST-MILE guarantee (strip crop/flipH/flipV off the clip so the
  // Remotion stage doesn't crop/mirror a SECOND time → WYSIWYG by construction)
  // had zero direct coverage. This pins it. We avoid a real ffmpeg by
  // pre-creating the cache file so the prepass takes the stat() cache-HIT branch.
  function compWithCropFlipClip(extra: Partial<VideoClip>): Composition {
    return CompositionSchema.parse({
      id: "comp1",
      workId: "w1",
      fps: 30,
      width: 1080,
      height: 1920,
      duration: 5,
      aspect: "9:16",
      updatedAt: "2026-06-05T00:00:00.000Z",
      tracks: [
        {
          id: "trk_v1",
          kind: "video",
          label: "Video",
          displayOrder: 0,
          clips: [
            {
              id: "v1",
              kind: "video",
              src: "assets/clip.mp4",
              in: 0,
              out: 5,
              trackOffset: 0,
              transforms: {
                scale: 1,
                x: 0,
                y: 0,
                rotation: 0,
                ...((extra.transforms ?? {}) as object),
              },
              filters: { brightness: 0, contrast: 0, saturation: 0 },
            },
          ],
        },
      ],
    });
  }

  it("a clip WITH crop+flip → src rewritten to the cache file AND crop/flipH/flipV STRIPPED (Remotion won't double-apply)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prepass-"));
    try {
      const comp = compWithCropFlipClip({
        transforms: {
          scale: 1,
          x: 0,
          y: 0,
          rotation: 0,
          crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
          flipH: true,
          flipV: true,
        },
      });
      const clipIn = comp.tracks[0]!.clips[0]! as VideoClip;
      // Pre-create the cache file so the prepass takes the cache-HIT branch and
      // never spawns ffmpeg (the host has none). The name is derived from the
      // SAME transformsCacheName the prepass uses, proving it resolved a non-empty
      // crop/flip chain (only crop/flip clips get a cache name).
      const cacheName = transformsCacheName(clipIn.id, clipIn.transforms);
      const cachePath = join(dir, cacheName);
      await writeFile(cachePath, "fake-mp4");

      // probeDims is injectable so no real ffprobe runs.
      const probeDims = vi.fn(async () => ({ width: 1280, height: 720 }));
      const out = await applyTransformsPrePass(comp, dir, undefined, probeDims);

      const clipOut = out.tracks[0]!.clips[0]! as VideoClip;
      // (a) the filtergraph WAS built + baked: src now points at the cache file.
      expect(clipOut.src).toBe(cachePath);
      // (b) the LAST-MILE strip: the consumed crop/flip fields are gone, so the
      // Remotion stage renders the (already cropped/mirrored) cache MP4 once.
      expect(clipOut.transforms.crop).toBeUndefined();
      expect(clipOut.transforms.flipH).toBeUndefined();
      expect(clipOut.transforms.flipV).toBeUndefined();
      // sibling transform fields survive (only crop/flip are consumed).
      expect(clipOut.transforms.scale).toBe(1);
      // the INPUT comp is never mutated (ADR-style: returns a fresh comp).
      expect(clipIn.transforms.crop).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
      expect(clipIn.src).toBe("assets/clip.mp4");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a clip with NEITHER crop nor flip → left BYTE-IDENTICAL (no probe, no strip, no cache)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prepass-"));
    try {
      const comp = compWithCropFlipClip({});
      const probeDims = vi.fn(async () => ({ width: 1280, height: 720 }));
      const out = await applyTransformsPrePass(comp, dir, undefined, probeDims);
      const clipOut = out.tracks[0]!.clips[0]! as VideoClip;
      // untouched src; no ffprobe ever fired for a no-op clip.
      expect(clipOut.src).toBe("assets/clip.mp4");
      expect(probeDims).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("transformsCacheName encodes crop/flip params into the cache key (S18 review fix high)", () => {
  // The review caught that the cache filename was clip-{id}-cropflip.mp4 — it
  // ignored the crop/flip params, so changing the crop region re-served the OLD
  // cached file forever. The name MUST change when ANY param changes (mirroring
  // speed-ramp's clip-{id}-speed-{round(k*100)}.mp4).
  it("two different crops on the same clip produce DIFFERENT cache names", () => {
    const a = transformsCacheName("v1", {
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      crop: { x: 0, y: 0, w: 0.5, h: 0.5 },
    });
    const b = transformsCacheName("v1", {
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    });
    expect(a).not.toBe(b);
    expect(a).toContain("v1");
    expect(a).toMatch(/\.mp4$/);
  });

  it("flipping a clip changes its cache name (params, not just id)", () => {
    const noFlip = transformsCacheName("v1", { scale: 1, x: 0, y: 0, rotation: 0, flipH: false });
    const flipH = transformsCacheName("v1", { scale: 1, x: 0, y: 0, rotation: 0, flipH: true });
    expect(flipH).not.toBe(noFlip);
  });

  it("is deterministic for the same params (cache HIT path still works)", () => {
    const t = {
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
      flipV: true,
    };
    expect(transformsCacheName("v1", t)).toBe(transformsCacheName("v1", t));
  });
});
