import { describe, it, expect } from "vitest";
import {
  transformsToFilterChain,
  buildTransformsFilterArgs,
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
