import { describe, it, expect } from "vitest";
import type { Clip } from "../../composition.js";
import { patchClipProps } from "./patchClipProps.js";
import { CompositionOpError } from "./errors.js";

function videoClip(): Clip {
  return {
    id: "v1",
    kind: "video",
    src: "assets/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  } as unknown as Clip;
}

function audioClip(): Clip {
  return {
    id: "a1",
    kind: "audio",
    src: "assets/x.mp3",
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
  } as unknown as Clip;
}

function textClip(): Clip {
  return {
    id: "t1",
    kind: "text",
    text: "hi",
    trackOffset: 0,
    duration: 5,
    style: {
      font: "Inter",
      size: 64,
      weight: 700,
      italic: false,
      tracking: 0,
      color: "#ffffff",
    },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
  } as unknown as Clip;
}

function overlayClip(): Clip {
  return {
    id: "o1",
    kind: "overlay",
    src: "assets/x.png",
    trackOffset: 0,
    duration: 5,
    position: { xPct: 0, yPct: 0, wPct: 50, hPct: 50 },
    opacity: 1,
  } as unknown as Clip;
}

describe("@shared composition ops — patchClipProps", () => {
  it("writes a nested transforms.scale path to the right place (in-place)", () => {
    const clip = videoClip();
    patchClipProps(clip, { "transforms.scale": 2 });
    expect((clip as any).transforms.scale).toBe(2);
    // sibling transform fields untouched
    expect((clip as any).transforms.x).toBe(0);
  });

  it("writes a nested filters.brightness path", () => {
    const clip = videoClip();
    patchClipProps(clip, { "filters.brightness": 0.5 });
    expect((clip as any).filters.brightness).toBe(0.5);
    expect((clip as any).filters.contrast).toBe(0);
  });

  it("writes the top-level video fitMode (S16 — clip set --fit-mode is reachable)", () => {
    const clip = videoClip();
    patchClipProps(clip, { fitMode: "contain" });
    expect((clip as any).fitMode).toBe("contain");
    // unrelated fields untouched
    expect((clip as any).transforms.scale).toBe(1);
  });

  it("REJECTS fitMode on a non-video clip (text) — not a settable property there", () => {
    const clip = textClip();
    expect(() => patchClipProps(clip, { fitMode: "contain" })).toThrow(
      CompositionOpError,
    );
  });

  it("writes nested transforms.crop.* + transforms.flipH/flipV (S18 — clip set crop/flip reachable)", () => {
    const clip = videoClip();
    patchClipProps(clip, {
      "transforms.crop.x": 0.1,
      "transforms.crop.y": 0.2,
      "transforms.crop.w": 0.5,
      "transforms.crop.h": 0.6,
      "transforms.flipH": true,
      "transforms.flipV": true,
    });
    expect((clip as any).transforms.crop).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.6,
    });
    expect((clip as any).transforms.flipH).toBe(true);
    expect((clip as any).transforms.flipV).toBe(true);
    // sibling transform fields untouched
    expect((clip as any).transforms.scale).toBe(1);
  });

  it("REJECTS crop / flip on a non-video clip (text) — not settable there", () => {
    const clip = textClip();
    expect(() =>
      patchClipProps(clip, { "transforms.crop.x": 0.1 }),
    ).toThrow(CompositionOpError);
    expect(() => patchClipProps(clip, { "transforms.flipH": true })).toThrow(
      CompositionOpError,
    );
  });

  it("writes top-level freezeAtSec + reverse (S19 — clip set freeze/reverse reachable)", () => {
    const clip = videoClip();
    patchClipProps(clip, { freezeAtSec: 1.5, reverse: true });
    expect((clip as any).freezeAtSec).toBe(1.5);
    expect((clip as any).reverse).toBe(true);
    // sibling fields untouched
    expect((clip as any).transforms.scale).toBe(1);
  });

  it("REJECTS freezeAtSec / reverse on a non-video clip (text) — not settable there", () => {
    const clip = textClip();
    expect(() => patchClipProps(clip, { freezeAtSec: 1.5 })).toThrow(
      CompositionOpError,
    );
    expect(() => patchClipProps(clip, { reverse: true })).toThrow(
      CompositionOpError,
    );
  });

  it("writes a top-level scalar (audio volume)", () => {
    const clip = audioClip();
    patchClipProps(clip, { volume: 0.3 });
    expect((clip as any).volume).toBe(0.3);
  });

  it("writes nested fade + ducking.ratio for audio", () => {
    const clip = audioClip();
    patchClipProps(clip, { fadeIn: 0.5, "ducking.ratio": 0.4 });
    expect((clip as any).fadeIn).toBe(0.5);
    expect((clip as any).ducking.ratio).toBe(0.4);
  });

  it("deep-merges a single ducking.ratio leaf when ducking already exists (siblings survive)", () => {
    const clip = audioClip();
    (clip as any).ducking = { ratio: 0.5, attack: 0.1, release: 0.2 };
    patchClipProps(clip, { "ducking.ratio": 0.9 });
    expect((clip as any).ducking.ratio).toBe(0.9);
    // the sibling leaves must NOT be clobbered by the single-leaf write.
    expect((clip as any).ducking.attack).toBe(0.1);
    expect((clip as any).ducking.release).toBe(0.2);
  });

  it("writes nested style.color + position.anchor for text", () => {
    const clip = textClip();
    patchClipProps(clip, { "style.color": "#ff0000", "position.anchor": "top" });
    expect((clip as any).style.color).toBe("#ff0000");
    expect((clip as any).style.weight).toBe(700); // sibling untouched
    expect((clip as any).position.anchor).toBe("top");
  });

  it("writes overlay opacity + nested position.wPct", () => {
    const clip = overlayClip();
    patchClipProps(clip, { opacity: 0.5, "position.wPct": 80 });
    expect((clip as any).opacity).toBe(0.5);
    expect((clip as any).position.wPct).toBe(80);
  });

  it("REJECTS an unknown / misspelled key with CompositionOpError{code:4} — never silently strips", () => {
    const clip = videoClip();
    expect(() => patchClipProps(clip, { "transforms.scal": 2 })).toThrow(
      CompositionOpError,
    );
    let code: number | undefined;
    try {
      patchClipProps(clip, { "transforms.scal": 2 });
    } catch (err) {
      code = (err as CompositionOpError).code;
    }
    expect(code).toBe(4);
    // and it must NOT have written anything
    expect((clip as any).transforms).not.toHaveProperty("scal");
  });

  it("REJECTS a top-level unknown key", () => {
    const clip = videoClip();
    expect(() => patchClipProps(clip, { bogus: 1 })).toThrow(CompositionOpError);
  });

  it("per-kind whitelist: a field legal on kind A is rejected on kind B", () => {
    // `volume` is an audio field; on a VIDEO clip it must be rejected.
    const video = videoClip();
    expect(() => patchClipProps(video, { volume: 0.3 })).toThrow(
      CompositionOpError,
    );
    // `transforms.scale` is a video field; on a TEXT clip it must be rejected.
    const text = textClip();
    expect(() => patchClipProps(text, { "transforms.scale": 2 })).toThrow(
      CompositionOpError,
    );
    // `ducking.ratio` is audio-only; on an overlay clip it must be rejected.
    const overlay = overlayClip();
    expect(() => patchClipProps(overlay, { "ducking.ratio": 0.4 })).toThrow(
      CompositionOpError,
    );
  });

  it("rejecting one key leaves the clip untouched (all-or-nothing, no partial write)", () => {
    const clip = videoClip();
    // one good key, one bad key — the bad one must abort the whole patch.
    expect(() =>
      patchClipProps(clip, { "transforms.scale": 2, bogus: 1 }),
    ).toThrow(CompositionOpError);
    // the good key must NOT have landed
    expect((clip as any).transforms.scale).toBe(1);
  });

  it("never lets a patch overwrite id or kind", () => {
    const clip = videoClip();
    expect(() => patchClipProps(clip, { id: "hacked" })).toThrow(
      CompositionOpError,
    );
    expect(() => patchClipProps(clip, { kind: "audio" })).toThrow(
      CompositionOpError,
    );
  });
});
