import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useWorkAssets, isPipelineInternal } from "./assets";

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
