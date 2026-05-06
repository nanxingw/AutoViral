import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { TweaksPanel } from "../panels/Tweaks";
import { useComposition } from "../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
  makeAssetEntry,
} from "../../../test/composition-fixtures";

// Phase 6.F — AC1 integration test for Phase 6 acceptance criteria.
//
// AC1 (master plan §6.3): Picking 抖音 9:16 on a 16:9 comp opens a confirmation
// modal; on confirm, every video clip is reframed and comp dims update atomically.
// We mount the FULL TweaksPanel — only `fetch` is mocked.
//
// AC2 (master plan §6.3) — encode stage spawns ffmpeg with -c:v libx264 -b:v
// 8000k for the douyin preset — is verified by `src/server/render-pipeline.test.ts`
// ("AC2 — builds an ffmpeg command with -c:v libx264 -b:v 8000k for the douyin
// preset"). Per Phase 6.F plan's fallback note, AC2 lives in the server suite
// because vitest's web pool (happy-dom env) cannot reliably mock
// `node:child_process` for modules outside `web/`.

beforeEach(() => {
  const fetchMock = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse((init?.body ?? "{}") as string);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        asset: {
          id: `reframe_${body.videoId}`,
          uri: `/assets/reframed/${body.videoId}.mp4`,
          kind: "video",
          metadata: { width: 1080, height: 1920 },
          status: "ready",
        },
        edge: {
          fromAssetId: body.videoId,
          toAssetId: `reframe_${body.videoId}`,
          operation: {
            type: "reframe",
            actor: "system",
            timestamp: "2026-05-06T00:00:00Z",
            params: { strategyUsed: "face" },
          },
        },
        strategyUsed: "face",
      }),
    } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("Phase 6 acceptance criteria", () => {
  it("AC1: selecting 抖音 9:16 on a 16:9 comp opens modal → confirm → all clips reframed AND comp dims update", async () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/assets/a.mp4" }),
      makeVideoClip({ id: "v2", src: "/assets/b.mp4" }),
    ]);
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    comp.fps = 30;
    comp.assets = [
      makeAssetEntry({ id: "v1", uri: "/assets/a.mp4", kind: "video" }),
      makeAssetEntry({ id: "v2", uri: "/assets/b.mp4", kind: "video" }),
    ];
    useComposition.setState({ comp });
    render(<TweaksPanel open={true} workId="w" />);

    // Pick the douyin preset.
    fireEvent.change(screen.getByLabelText(/platform/i), {
      target: { value: "douyin-9-16" },
    });
    // Confirmation modal lists both clips.
    expect(screen.getByRole("dialog").textContent).toMatch(/v1/);
    expect(screen.getByRole("dialog").textContent).toMatch(/v2/);

    // Confirm.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });

    // Comp dimensions and preset updated atomically (D5).
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("9:16");
    expect(next.width).toBe(1080);
    expect(next.height).toBe(1920);
    expect(next.exportPresets[0].platform).toBe("douyin");

    // Both clips reframed and rebound.
    await waitFor(() => {
      const clips = next.tracks[0].clips as Array<{ id: string; src: string }>;
      expect(clips.find((c) => c.id === "v1")?.src).toBe(
        "/assets/reframed/v1.mp4",
      );
      expect(clips.find((c) => c.id === "v2")?.src).toBe(
        "/assets/reframed/v2.mp4",
      );
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
