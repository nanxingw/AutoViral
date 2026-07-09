import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useWorkAssets,
  isPipelineInternal,
  classifyExport,
  formatExportedAt,
} from "./assets";
import { apiFetch } from "@/lib/api";

// A7 (PRD-0010) — the fixture now also carries the pipeline-internal files the
// render/audio pipeline scatters through assets/ + output/ (a per-audio
// `.peaks.json` waveform cache and an ffmpeg `concat.txt`). The library must
// drop those BEFORE classification, otherwise they surface as TEXT "content".
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (_url: string) => ({
    assets: [
      "assets/clips/intro.mp4",
      "assets/clips/outro.mov",
      "output/final.webm",
      "assets/images/cover.png",
      "assets/images/cover.jpeg",
      "assets/audio/bgm.mp3",
      "assets/audio/bgm.mp3.peaks.json", // pipeline-internal — filtered
      "output/voiceover.m4a",
      "output/voiceover.opus",
      "assets/text/subtitles.srt",
      "assets/text/publish-text.md",
      "output/concat.txt", // pipeline-internal — filtered
      "assets/tmp/concat_list.txt", // pipeline-internal (underscore variant) — filtered
      "composition.yaml", // the composition document itself — filtered
      "carousel.yaml", // AE3-F3: carousel works' twin document — must also be filtered
      "weird.unknown",
    ],
  })),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("isPipelineInternal", () => {
  it("flags pipeline-internal files the pipeline writes into assets/ + output/", () => {
    expect(isPipelineInternal("assets/audio/bgm.mp3.peaks.json")).toBe(true);
    expect(isPipelineInternal("output/concat.txt")).toBe(true);
    expect(isPipelineInternal("output/concat-0.txt")).toBe(true);
    // underscore/dot separator variants — ffmpeg pipelines actually emit
    // concat_list.txt (AE E2E caught it leaking local paths into TEXT cards)
    expect(isPipelineInternal("assets/tmp/concat_list.txt")).toBe(true);
    expect(isPipelineInternal("output/concat.list.txt")).toBe(true);
    expect(isPipelineInternal("output/filelist_0.txt")).toBe(true);
    expect(isPipelineInternal("checkpoints/x.labels.json")).toBe(true);
    expect(isPipelineInternal("assets/images/partial.tmp")).toBe(true);
  });

  it("flags the composition + carousel documents (AE3-F3)", () => {
    // Both are the work's composition document, not creator text assets —
    // works.ts writes composition.yaml (video) / carousel.yaml (carousel) the
    // same way into the work dir. The old filter only knew composition.yaml, so
    // a carousel work's carousel.yaml leaked its raw YAML into the TEXT group as
    // a "content" snippet. Symmetric, filename-anchored so creator *.yaml stays.
    expect(isPipelineInternal("composition.yaml")).toBe(true);
    expect(isPipelineInternal("composition.yml")).toBe(true);
    expect(isPipelineInternal("carousel.yaml")).toBe(true);
    expect(isPipelineInternal("carousel.yml")).toBe(true);
    expect(isPipelineInternal("output/carousel.yaml")).toBe(true);
  });

  it("keeps creator-authored *.yaml notes (filename-anchored)", () => {
    // Only the two reserved document names are pipeline-internal; a creator may
    // legitimately drop notes.yaml / carousel-ideas.yaml into the tree.
    expect(isPipelineInternal("assets/text/notes.yaml")).toBe(false);
    expect(isPipelineInternal("assets/text/carousel-ideas.yaml")).toBe(false);
    expect(isPipelineInternal("assets/text/composition-notes.yaml")).toBe(false);
  });

  it("keeps real creator-facing text assets", () => {
    expect(isPipelineInternal("assets/text/subtitles.srt")).toBe(false);
    expect(isPipelineInternal("assets/text/publish-text.md")).toBe(false);
    // a bare "concat"/"filelist" prefix without a separator is creator content
    expect(isPipelineInternal("assets/text/concatenation-notes.txt")).toBe(false);
    expect(isPipelineInternal("assets/text/filelisting-guide.txt")).toBe(false);
    expect(isPipelineInternal("assets/clips/intro.mp4")).toBe(false);
    expect(isPipelineInternal("assets/audio/bgm.mp3")).toBe(false);
  });

  // S5/#027 — render-pipeline derived intermediates (Stage 1 raw render +
  // -ducked/-burned/-normalized). S5 now deletes these server-side on a
  // successful export, but this filter is the frontend's own defense-in-
  // depth against legacy files / a best-effort unlink failure — it must
  // never match a creator's own file living under assets/.
  it("flags output/ render-pipeline intermediates (S5)", () => {
    expect(isPipelineInternal("output/autoviral-export-2026-07-09-00-00-00.mp4")).toBe(true);
    expect(isPipelineInternal("output/x-ducked.mp4")).toBe(true);
    expect(isPipelineInternal("output/x-burned.mp4")).toBe(true);
    expect(isPipelineInternal("output/x-normalized.mp4")).toBe(true);
    expect(isPipelineInternal("output/autoviral-export-1-ducked.mp4")).toBe(true);
  });

  it("does NOT flag a creator's own similarly-named file under assets/ (S5)", () => {
    expect(isPipelineInternal("assets/my-ducked-track.mp4")).toBe(false);
    expect(isPipelineInternal("assets/autoviral-export-notes.mp4")).toBe(false);
  });

  // codex review (S5 finding, medium) — the PRE-Remotion ffmpeg pre-passes
  // (speed-ramp, timewarp, crop/flip) also write derived cache MP4s into
  // output/ BEFORE Stage 1 runs (render-pipeline.ts calls them ahead of the
  // `intermediatePaths` tracking that starts at Stage 1's output). Unlike the
  // Stage 1+ intermediates, S5 deliberately does NOT delete these — they are
  // a keyed ffmpeg-avoidance CACHE (applySpeedRampPrePass / applyTimeWarpPrePass
  // / applyTransformsPrePass all `stat()` the cache path first and skip the
  // ffmpeg invocation on a hit; src/server/speed-ramp-ffmpeg.ts, transforms-
  // ffmpeg.ts). So the fix is a library-visibility filter, not a delete: these
  // filenames must be hidden from CLIPS the same way the Stage-1 intermediates
  // are, without being removed from disk (naming: clip-<id>-speed-<n>.mp4 /
  // clip-<id>-timewarp-<hash>.mp4 / clip-<id>-cropflip-<hash>.mp4).
  it("flags pre-Remotion ffmpeg pre-pass caches (speed-ramp / timewarp / crop-flip) in output/ (S3/S5)", () => {
    expect(isPipelineInternal("output/clip-vc_1-speed-200.mp4")).toBe(true);
    expect(isPipelineInternal("output/clip-vc_1-timewarp-abc1234567.mp4")).toBe(true);
    expect(isPipelineInternal("output/clip-vc_1-cropflip-abc1234567.mp4")).toBe(true);
  });

  it("does NOT flag a creator's own clip-* file under assets/ (S3/S5)", () => {
    expect(isPipelineInternal("assets/clip-highlights-reel.mp4")).toBe(false);
    expect(isPipelineInternal("assets/clip-vc_1-speed-notes.mp4")).toBe(false);
  });

  // codex review (S3×S6 finding, medium) — the speed-ramp pre-pass cache key
  // was extended to fold in comp.fps (src/server/speed-ramp-ffmpeg.ts
  // speedRampCacheName), since PRD-0011 made fps user-editable and S3's
  // -g/-keyint_min GOP fix bakes fps into the cache file, so the filename
  // grew a `-fps<N>` suffix: clip-<id>-speed-<n>-fps<fps>.mp4. This regex
  // must keep matching or the new-format cache files leak into the asset
  // library as visible "clips" (the exact regression this filter exists to
  // prevent). The OLD no-suffix format is asserted too — it must stay
  // matched so cache files written before this fix (already on a creator's
  // disk) don't suddenly start leaking either.
  it("flags the fps-suffixed speed-ramp cache filename AND the legacy no-fps filename (PRD-0011×0012 interaction)", () => {
    expect(isPipelineInternal("output/clip-vc_1-speed-200-fps30.mp4")).toBe(true);
    expect(isPipelineInternal("output/clip-vc_1-speed-200-fps24.mp4")).toBe(true);
    expect(isPipelineInternal("output/clip-vc_1-speed-200.mp4")).toBe(true); // legacy, no fps suffix
  });

  it("does NOT flag the finished deliverable files themselves (S4)", () => {
    expect(isPipelineInternal("output/final-1717000000000.mp4")).toBe(false);
    expect(isPipelineInternal("output/proxy-1717000000000.mp4")).toBe(false);
  });
});

describe("classifyExport (S4 / #027)", () => {
  it("classifies output/final-<ms>.mp4 as an export, not a proxy", () => {
    expect(classifyExport("output/final-1717000000000.mp4")).toEqual({
      isExport: true,
      isProxyExport: false,
      exportedAt: 1717000000000,
    });
  });

  it("classifies output/proxy-<ms>.mp4 as an export AND flags it as a proxy", () => {
    expect(classifyExport("output/proxy-1717000000000.mp4")).toEqual({
      isExport: true,
      isProxyExport: true,
      exportedAt: 1717000000000,
    });
  });

  it("is case-insensitive on the prefix", () => {
    expect(classifyExport("output/FINAL-42.mp4").isExport).toBe(true);
  });

  it("does not classify a plain assets/**.mp4 source clip as an export", () => {
    expect(classifyExport("assets/clips/intro.mp4")).toEqual({
      isExport: false,
      isProxyExport: false,
    });
  });

  it("does not classify a render-pipeline intermediate as an export", () => {
    expect(classifyExport("output/autoviral-export-1.mp4").isExport).toBe(false);
    expect(classifyExport("output/x-ducked.mp4").isExport).toBe(false);
  });

  it("does not classify output/final.webm (no timestamp, wrong ext) as an export", () => {
    expect(classifyExport("output/final.webm").isExport).toBe(false);
  });

  // E2E gap 3 (2026-07-09) — EXPORT_RE required a purely-numeric epoch-ms
  // suffix, so a hand-renamed/historical deliverable like `final-30fps.mp4`
  // fell out of EXPORTS and drowned in CLIPS with source clips. The prefix
  // (`final-`/`proxy-`) already disambiguates from render-pipeline
  // intermediates (autoviral-export-*, *-ducked/-burned/-normalized never
  // start with final-/proxy- — render-pipeline.ts:631-632), so the suffix
  // can be any non-numeric stem too.
  it("classifies output/final-<non-numeric-stem>.mp4 (hand-named export) as an export with no timestamp", () => {
    expect(classifyExport("output/final-30fps.mp4")).toEqual({
      isExport: true,
      isProxyExport: false,
      exportedAt: undefined,
    });
  });

  it("classifies output/proxy-<non-numeric-stem>.mp4 as a proxy export with no timestamp", () => {
    expect(classifyExport("output/proxy-review-cut.mp4")).toEqual({
      isExport: true,
      isProxyExport: true,
      exportedAt: undefined,
    });
  });

  // Regression — the relaxed suffix must NOT swallow render-pipeline
  // intermediates, which are filtered upstream by isPipelineInternal() and
  // never start with the final-/proxy- prefix in the first place.
  it("still does not classify an autoviral-export-*-ducked.mp4 intermediate as an export", () => {
    expect(
      classifyExport("output/autoviral-export-2026-07-09-00-00-00-ducked.mp4").isExport,
    ).toBe(false);
  });
});

describe("formatExportedAt (S4 / #027)", () => {
  it("formats an epoch-ms timestamp as MM/DD HH:mm (UTC, deterministic)", () => {
    // 2026-07-09T14:32:00.000Z
    expect(formatExportedAt(Date.UTC(2026, 6, 9, 14, 32, 0))).toBe("07/09 14:32");
  });

  it("zero-pads single-digit month/day/hour/minute", () => {
    // 2026-01-02T03:04:00.000Z
    expect(formatExportedAt(Date.UTC(2026, 0, 2, 3, 4, 0))).toBe("01/02 03:04");
  });
});

describe("useWorkAssets", () => {
  it("buckets assets into CLIPS / IMAGES / AUDIO / TEXT and drops 'other'", async () => {
    const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const groups = result.current.data!;
    const byKey = Object.fromEntries(groups.map((g) => [g.group, g]));
    expect(byKey.CLIPS.count).toBe(3);
    expect(byKey.IMAGES.count).toBe(2);
    expect(byKey.AUDIO.count).toBe(3); // mp3, m4a, opus
    expect(byKey.TEXT.count).toBe(2); // srt, md
    expect(byKey.AUDIO.items.some((i) => i.path.endsWith(".opus"))).toBe(true);
    expect(groups.flatMap((g) => g.items).map((i) => i.path)).not.toContain(
      "weird.unknown",
    );
  });

  it("filters pipeline-internal files out of every group", async () => {
    const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const allPaths = result.current.data!.flatMap((g) => g.items).map((i) => i.path);
    expect(allPaths).not.toContain("assets/audio/bgm.mp3.peaks.json");
    expect(allPaths).not.toContain("output/concat.txt");
    expect(allPaths).not.toContain("assets/tmp/concat_list.txt");
    // AE3-F3 — the composition documents must never surface as TEXT snippets.
    expect(allPaths).not.toContain("composition.yaml");
    expect(allPaths).not.toContain("carousel.yaml");
  });

  it("keeps real text assets in the TEXT group", async () => {
    const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const text = result.current.data!.find((g) => g.group === "TEXT")!;
    expect(text.items.map((i) => i.path).sort()).toEqual([
      "assets/text/publish-text.md",
      "assets/text/subtitles.srt",
    ]);
  });

  // S4/#027 — deliverables split out of CLIPS into their own EXPORTS group.
  describe("EXPORTS group (S4 / #027)", () => {
    it("groups output/final-*.mp4 and output/proxy-*.mp4 into EXPORTS, flags proxy, keeps assets/**.mp4 in CLIPS", async () => {
      (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        assets: [
          "assets/clips/intro.mp4",
          "output/final-1717000000000.mp4",
          "output/proxy-1717000001000.mp4",
        ],
      });
      const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const groups = result.current.data!;
      const byKey = Object.fromEntries(groups.map((g) => [g.group, g]));

      expect(byKey.CLIPS.count).toBe(1);
      expect(byKey.CLIPS.items[0].path).toBe("assets/clips/intro.mp4");
      expect(byKey.CLIPS.items[0].isExport).toBeFalsy();

      expect(byKey.EXPORTS.count).toBe(2);
      const final = byKey.EXPORTS.items.find((i) => i.path.includes("final"))!;
      const proxy = byKey.EXPORTS.items.find((i) => i.path.includes("proxy"))!;
      expect(final.isExport).toBe(true);
      expect(final.isProxyExport).toBe(false);
      expect(final.exportedAt).toBe(1717000000000);
      expect(proxy.isExport).toBe(true);
      expect(proxy.isProxyExport).toBe(true);
      expect(proxy.exportedAt).toBe(1717000001000);
    });

    it("filters render-pipeline intermediates so a single export adds at most 2 EXPORTS entries (final + proxy)", async () => {
      (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        assets: [
          "output/autoviral-export-2026-07-09-00-00-00.mp4",
          "output/autoviral-export-2026-07-09-00-00-00-ducked.mp4",
          "output/autoviral-export-2026-07-09-00-00-00-ducked-normalized.mp4",
          "output/final-1717000000000.mp4",
        ],
      });
      const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const allItems = result.current.data!.flatMap((g) => g.items);
      // Only the final deliverable survives the filter — the three
      // render-pipeline intermediates never reach any group.
      expect(allItems).toHaveLength(1);
      expect(allItems[0].path).toBe("output/final-1717000000000.mp4");
    });

    // E2E gap 3 (2026-07-09) — a hand-named/historical deliverable
    // (`final-30fps.mp4`) must still land in EXPORTS, not CLIPS, and must
    // not blow up on a missing timestamp.
    it("groups a hand-named output/final-30fps.mp4 into EXPORTS without a timestamp badge", async () => {
      (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        assets: [
          "assets/clips/intro.mp4",
          "output/final-30fps.mp4",
          "output/autoviral-export-2026-07-09-00-00-00-ducked.mp4",
        ],
      });
      const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const groups = result.current.data!;
      const byKey = Object.fromEntries(groups.map((g) => [g.group, g]));

      expect(byKey.CLIPS.count).toBe(1);
      expect(byKey.EXPORTS.count).toBe(1);
      const item = byKey.EXPORTS.items[0];
      expect(item.path).toBe("output/final-30fps.mp4");
      expect(item.isExport).toBe(true);
      expect(item.isProxyExport).toBe(false);
      expect(item.exportedAt).toBeUndefined();
    });

    it("hides the EXPORTS group entirely when there are no deliverables yet (empty-group hiding, matches existing groups)", async () => {
      const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const groupNames = result.current.data!.map((g) => g.group);
      expect(groupNames).not.toContain("EXPORTS");
    });
  });

  it("returns empty array when workId is null", async () => {
    const { result } = renderHook(() => useWorkAssets(null), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.data).toBeUndefined();
  });

  it("encodes path segments in url", async () => {
    const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const item = result.current.data!.find((g) => g.group === "CLIPS")!.items[0];
    expect(item.url).toBe("/api/works/w1/assets/assets/clips/intro.mp4");
  });
});
