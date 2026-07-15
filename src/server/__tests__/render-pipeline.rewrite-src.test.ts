// PRD-0014 S18 E2E r2 · M1 [critical] — the 变速导出 regression's SECOND root
// cause (the first, ENOENT, was S18 A `de38975`).
//
// The pre-Remotion ffmpeg pre-passes (speed-ramp / time-warp / crop-flip) bake
// their cache to an ABSOLUTE filesystem path under the work's `output/` dir and
// write it straight into `clip.src` (S18 A absolutised the input so ffprobe
// stops ENOENT-ing). Stage 1 then runs `rewriteClipSrcsToAbsolute`, whose
// `resolveOne` USED to blindly origin-prefix ANY `/`-leading string:
//
//     /Users/…/works/<id>/output/clip-…-speedvar.mp4
//   → http://localhost:3271/Users/…/works/<id>/output/clip-…-speedvar.mp4
//
// NO route serves that path, so the SPA catch-all returns index.html (200
// text/html) and Remotion's compositor decodes the HTML as video →
// "Invalid data found when processing input" — the export dies before frame 0.
//
// The SERVED-URL context is exactly the blind spot the S16 consistency gate
// papered over: its `startFsServer` serves ANY absolute path, so the broken
// http://…/Users/… URL fetched fine there while PRODUCTION (only the
// /api/works/:id/assets/* route exists) SPA-fell-back to HTML. These tests lock
// the URL `resolveOne` mints to one the REAL asset route can serve, for the WHOLE
// pre-pass family (speed static/variable, audio speed, time-warp, crop/flip all
// emit an absolute cache path under <workRoot>/<id>/output/).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rewriteClipSrcsToAbsolute } from "../render-pipeline.js";
import type { Composition } from "../../shared/composition.js";

const PORT = "3271";
let savedPort: string | undefined;

beforeEach(() => {
  savedPort = process.env.AUTOVIRAL_PORT;
  process.env.AUTOVIRAL_PORT = PORT;
});
afterEach(() => {
  if (savedPort === undefined) delete process.env.AUTOVIRAL_PORT;
  else process.env.AUTOVIRAL_PORT = savedPort;
});

function compWithSrc(workId: string, src: string): Composition {
  return {
    id: "c",
    workId,
    fps: 30,
    width: 1080,
    height: 1920,
    tracks: [
      {
        id: "trk_v",
        kind: "video",
        label: "V",
        muted: false,
        hidden: false,
        volume: 1,
        displayOrder: 0,
        clips: [
          { id: "vc1", kind: "video", src, in: 0, out: 2, trackOffset: 0 },
        ],
      },
    ],
    assets: [],
    provenance: [],
    exportPresets: [],
  } as unknown as Composition;
}

function firstSrc(comp: Composition): string {
  return (comp.tracks[0].clips[0] as { src: string }).src;
}

describe("rewriteClipSrcsToAbsolute — pre-pass absolute cache path → SERVED asset URL (M1)", () => {
  it("maps a speed pre-pass ABSOLUTE cache path under <workRoot>/<id>/output/ to /api/works/<id>/assets/output/… (NOT http://…/Users/…)", () => {
    const workId = "w42";
    const absCache =
      "/Users/foo/.autoviral/works/w42/output/clip-vc1-speedvar-deadbeef01.mp4";
    const out = firstSrc(rewriteClipSrcsToAbsolute(compWithSrc(workId, absCache)));

    // The BUG form (what the SPA catch-all silently 200s to HTML for).
    expect(out).not.toBe(`http://localhost:${PORT}${absCache}`);
    expect(out).not.toContain("/Users/");
    // The SERVED form the real /api/works/:id/assets/* route resolves.
    expect(out).toBe(
      `http://localhost:${PORT}/api/works/w42/assets/output/clip-vc1-speedvar-deadbeef01.mp4`,
    );
  });

  it("survives an AUTOVIRAL_WORKS_ROOT that does NOT contain the literal /works/ (keyed on <id>/output/)", () => {
    // resolvePrePassSourcePath derives the cache base from outDir, which follows
    // AUTOVIRAL_WORKS_ROOT — so the abs path need not contain "/works/". The map
    // must key on the exact workId + a known asset-root segment.
    const workId = "w42";
    const absCache = "/srv/media/w42/output/clip-vc1-cropflip-abc123.mp4";
    const out = firstSrc(rewriteClipSrcsToAbsolute(compWithSrc(workId, absCache)));
    expect(out).toBe(
      `http://localhost:${PORT}/api/works/w42/assets/output/clip-vc1-cropflip-abc123.mp4`,
    );
    expect(out).not.toContain("/srv/media/");
  });

  it("audio speed pre-pass .m4a cache under output/ maps to a served URL too", () => {
    const workId = "w7";
    const absCache = "/Users/x/.autoviral/works/w7/output/clip-a1-speedaud-0f0f0f0f0f.m4a";
    const out = firstSrc(rewriteClipSrcsToAbsolute(compWithSrc(workId, absCache)));
    expect(out).toBe(
      `http://localhost:${PORT}/api/works/w7/assets/output/clip-a1-speedaud-0f0f0f0f0f.m4a`,
    );
  });

  it("still origin-prefixes a genuine page-absolute /api/works/<id>/assets/… URL (unchanged)", () => {
    const out = firstSrc(
      rewriteClipSrcsToAbsolute(
        compWithSrc("w1", "/api/works/w1/assets/clips/intro.mp4"),
      ),
    );
    expect(out).toBe(`http://localhost:${PORT}/api/works/w1/assets/clips/intro.mp4`);
  });

  it("still maps a plain work-relative src (regression — the common case)", () => {
    const out = firstSrc(
      rewriteClipSrcsToAbsolute(compWithSrc("w1", "assets/clips/intro.mp4")),
    );
    expect(out).toBe(`http://localhost:${PORT}/api/works/w1/assets/clips/intro.mp4`);
  });

  it("leaves an http/data scheme src untouched", () => {
    const out = firstSrc(
      rewriteClipSrcsToAbsolute(compWithSrc("w1", "https://cdn.example.com/a.mp4")),
    );
    expect(out).toBe("https://cdn.example.com/a.mp4");
  });

  it("keeps origin-prefix for an absolute path NOT under this work (bespoke test FS-server fixtures)", () => {
    // A tmpdir fixture served by the consistency-gate's startFsServer has no
    // <workId>/output/ marker — it must stay origin-prefixed so those setups work.
    const abs = "/tmp/av-cgate-full-XXXX/clip-spd-speedvar-99.mp4";
    const out = firstSrc(rewriteClipSrcsToAbsolute(compWithSrc("cgate", abs)));
    expect(out).toBe(`http://localhost:${PORT}${abs}`);
  });
});
