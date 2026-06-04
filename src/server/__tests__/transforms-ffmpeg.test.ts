import { describe, it, expect } from "vitest";
import {
  transformsToFilterChain,
  buildTransformsFilterArgs,
  transformsCacheName,
} from "../transforms-ffmpeg.js";

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
