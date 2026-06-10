import { describe, it, expect } from "vitest";
import {
  semanticFilename,
  fuseVariantPrompt,
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
