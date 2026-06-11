import { describe, it, expect } from "vitest";
import {
  semanticFilename,
  fuseVariantPrompt,
  absolutizeWorkspaceUri,
} from "../dispatchGeneration.js";

// B3 — the death-envelope machinery (buildGenerationNotification /
// resolveScriptForRequest, which told the agent to run four non-existent *.py
// scripts) was retired. Generation now direct-dispatches to real endpoints from
// GenerationDialog (see GenerationDialog.providers.test.tsx for those wiring
// assertions). What remains here are the two pure helpers the dialog uses to
// build endpoint bodies.

describe("semanticFilename", () => {
  it("slugifies the prompt and appends a base36 time suffix + extension", () => {
    const name = semanticFilename("Panda Eating Bamboo!", "png", 0);
    expect(name).toBe("panda-eating-bamboo-0.png");
  });

  it("makes two calls at different times produce distinct names (no clobber)", () => {
    const a = semanticFilename("warm cinematic pad", "mp3", 1000);
    const b = semanticFilename("warm cinematic pad", "mp3", 2000);
    expect(a).not.toBe(b);
    expect(a.endsWith(".mp3")).toBe(true);
    expect(b.endsWith(".mp3")).toBe(true);
  });

  it("preserves CJK characters in the slug", () => {
    const name = semanticFilename("熊猫吃竹子", "png", 0);
    expect(name).toContain("熊猫吃竹子");
    expect(name.endsWith(".png")).toBe(true);
  });

  it("falls back to 'asset' when the prompt has no slug-able characters", () => {
    const name = semanticFilename("!!! @@@ ###", "png", 5);
    expect(name).toBe("asset-5.png");
  });

  it("caps the slug length at 40 characters", () => {
    const long = "a".repeat(200);
    const name = semanticFilename(long, "png", 0);
    const slug = name.split("-0.png")[0];
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe("fuseVariantPrompt", () => {
  it("appends the change direction onto the source prompt", () => {
    const fused = fuseVariantPrompt("panda drooping head", "slower droop");
    expect(fused).toBe("panda drooping head\n\nChange: slower droop");
  });

  it("returns just the change direction when the source prompt is empty", () => {
    expect(fuseVariantPrompt("", "make it warmer")).toBe("make it warmer");
    expect(fuseVariantPrompt(null, "make it warmer")).toBe("make it warmer");
  });

  it("returns just the source prompt when there is no change direction", () => {
    expect(fuseVariantPrompt("panda drooping head", undefined)).toBe(
      "panda drooping head",
    );
    expect(fuseVariantPrompt("panda drooping head", "   ")).toBe(
      "panda drooping head",
    );
  });

  it("trims surrounding whitespace on both fields", () => {
    expect(fuseVariantPrompt("  base  ", "  delta  ")).toBe(
      "base\n\nChange: delta",
    );
  });
});

describe("absolutizeWorkspaceUri (B3 review fix — derive anchor must reach the provider)", () => {
  const origin = "http://localhost:3271";

  it("prefixes a same-origin relative `/api/...` uri with the origin", () => {
    // openrouter-image DROPS a non-http/data referenceImage; seedance hands
    // firstFrameImage to OpenRouter's server-side fetch. A relative path fails
    // both — so it must become absolute before dispatch.
    expect(
      absolutizeWorkspaceUri("/api/works/w1/assets/images/x.png", origin),
    ).toBe("http://localhost:3271/api/works/w1/assets/images/x.png");
  });

  it("passes through an already-absolute http(s) url untouched", () => {
    expect(absolutizeWorkspaceUri("https://cdn.example.com/a.png", origin)).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(absolutizeWorkspaceUri("http://x/y.png", origin)).toBe("http://x/y.png");
  });

  it("passes through a data: uri untouched", () => {
    const data = "data:image/png;base64,AAAA";
    expect(absolutizeWorkspaceUri(data, origin)).toBe(data);
  });

  it("anchors a bare relative path (no leading slash) under origin/", () => {
    expect(absolutizeWorkspaceUri("assets/images/x.png", origin)).toBe(
      "http://localhost:3271/assets/images/x.png",
    );
  });

  it("returns undefined for empty / whitespace / nullish input (so dispatch omits the field)", () => {
    expect(absolutizeWorkspaceUri(undefined, origin)).toBeUndefined();
    expect(absolutizeWorkspaceUri(null, origin)).toBeUndefined();
    expect(absolutizeWorkspaceUri("", origin)).toBeUndefined();
    expect(absolutizeWorkspaceUri("   ", origin)).toBeUndefined();
  });
});
