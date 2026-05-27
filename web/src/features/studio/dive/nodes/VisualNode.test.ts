import { describe, it, expect } from "vitest";
import { isVideoAsset } from "./VisualNode";

// #84 — VisualNode rendered EVERY asset via <img>, but short-video work clips
// are .mp4 → an <img> can't decode them → blank gray card (complete:true,
// naturalWidth:0). isVideoAsset is the branch predicate that routes video
// assets to <video> instead. `kind` is authoritative; URI extension is a
// defensive fallback for older assets whose kind wasn't set.

describe("isVideoAsset (#84)", () => {
  it("true when kind is video (schema-authoritative), even with no extension", () => {
    expect(isVideoAsset({ kind: "video", uri: "clips/s01" })).toBe(true);
  });

  it("true for a .mp4 URI even when kind is missing/wrong", () => {
    // Older works may not have kind set correctly; the extension saves us.
    expect(isVideoAsset({ kind: "image", uri: "clips/s01.mp4" })).toBe(true);
  });

  it("matches mov / webm / m4v / mkv extensions", () => {
    for (const ext of ["mov", "webm", "m4v", "mkv"]) {
      expect(isVideoAsset({ kind: "image", uri: `clips/x.${ext}` })).toBe(true);
    }
  });

  it("matches a video extension followed by a query string or hash", () => {
    expect(isVideoAsset({ kind: "image", uri: "clips/s01.mp4?v=2" })).toBe(true);
    expect(isVideoAsset({ kind: "image", uri: "clips/s01.mp4#t=3" })).toBe(true);
  });

  it("false for an image asset (kind image + image extension)", () => {
    expect(isVideoAsset({ kind: "image", uri: "images/panda.png" })).toBe(false);
    expect(isVideoAsset({ kind: "image", uri: "images/panda.jpg" })).toBe(false);
  });

  it("does NOT false-positive on 'mp4' appearing mid-path (extension anchored)", () => {
    expect(isVideoAsset({ kind: "image", uri: "images/mp4-thumbnail.png" })).toBe(false);
  });
});
