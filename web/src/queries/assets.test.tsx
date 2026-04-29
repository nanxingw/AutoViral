import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useWorkAssets } from "./assets";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (_url: string) => ({
    assets: [
      "assets/clips/intro.mp4",
      "assets/clips/outro.mov",
      "output/final.webm",
      "assets/images/cover.png",
      "assets/images/cover.jpeg",
      "assets/audio/bgm.mp3",
      "output/voiceover.m4a",
      "output/voiceover.opus",
      "scripts/script.txt",
      "chat.json",
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

describe("useWorkAssets", () => {
  it("buckets assets into CLIPS / IMAGES / AUDIO / TEXT and drops 'other'", async () => {
    const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const groups = result.current.data!;
    const byKey = Object.fromEntries(groups.map((g) => [g.group, g]));
    expect(byKey.CLIPS.count).toBe(3);
    expect(byKey.IMAGES.count).toBe(2);
    expect(byKey.AUDIO.count).toBe(3); // mp3, m4a, opus
    expect(byKey.TEXT.count).toBe(2);
    expect(byKey.AUDIO.items.some((i) => i.path.endsWith(".opus"))).toBe(true);
    expect(groups.flatMap((g) => g.items).map((i) => i.path)).not.toContain(
      "weird.unknown",
    );
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
