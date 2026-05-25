import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { PlatformPresetSection } from "./PlatformPresetSection";
import { useComposition } from "../../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
  makeAssetEntry,
} from "../../../../test/composition-fixtures";

beforeEach(() => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      asset: {
        id: "reframed-1",
        uri: "/assets/r1.mp4",
        kind: "video",
        metadata: {},
        status: "ready",
      },
      edge: {
        fromAssetId: "v1",
        toAssetId: "reframed-1",
        operation: { type: "reframe" },
      },
      strategyUsed: "face",
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("PlatformPresetSection (Phase 6.D)", () => {
  it("renders the dropdown with all 8 platform presets", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    const select = screen.getByLabelText(/platform preset/i) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(labels).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/抖音/),
        expect.stringMatching(/小红书/),
        expect.stringMatching(/视频号/),
        expect.stringMatching(/Bilibili/),
        expect.stringMatching(/TikTok/),
        expect.stringMatching(/Reels/),
        expect.stringMatching(/Shorts/),
        expect.stringMatching(/YouTube/),
      ]),
    );
  });

  it("selecting a preset opens the confirmation dialog", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform preset/i), {
      target: { value: "douyin-9-16" },
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/抖音 9:16/);
  });

  it("dialog lists every video clip", () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/a.mp4" }),
      makeVideoClip({ id: "v2", src: "/b.mp4" }),
    ]);
    comp.assets = [
      makeAssetEntry({ id: "v1", uri: "/a.mp4", kind: "video" }),
      makeAssetEntry({ id: "v2", uri: "/b.mp4", kind: "video" }),
    ];
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform preset/i), {
      target: { value: "douyin-9-16" },
    });
    expect(screen.getByRole("dialog").textContent).toMatch(/v1/);
    expect(screen.getByRole("dialog").textContent).toMatch(/v2/);
  });

  it("cancel does NOT mutate the composition (D6)", () => {
    const comp = makeCompositionWithClips([]);
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform preset/i), {
      target: { value: "douyin-9-16" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("16:9");
    expect(next.width).toBe(1920);
    expect(next.exportPresets).toHaveLength(0);
  });

  it("confirm applies the preset (D5) and fires /api/video/reframe per video clip", async () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/a.mp4" }),
    ]);
    comp.assets = [makeAssetEntry({ id: "v1", uri: "/a.mp4", kind: "video" })];
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform preset/i), {
      target: { value: "douyin-9-16" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("9:16");
    expect(next.width).toBe(1080);
    expect(next.exportPresets[0].platform).toBe("douyin");
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/video/reframe",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("confirm rebinds each clip after its reframe response lands", async () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/a.mp4" }),
    ]);
    comp.assets = [makeAssetEntry({ id: "v1", uri: "/a.mp4", kind: "video" })];
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform preset/i), {
      target: { value: "douyin-9-16" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });
    await waitFor(() => {
      const clip = useComposition.getState().comp!.tracks[0].clips[0] as {
        src?: string;
      };
      expect(clip.src).toBe("/assets/r1.mp4");
    });
  });

  it("reframe failure does NOT flip the aspect and surfaces an error (#45 — no silent corruption)", async () => {
    // Backend returns 501 (deleted smart-crop scripts). Pre-fix this was
    // swallowed AFTER the aspect had already been flipped + autosaved, leaving
    // a corrupted mixed-aspect work. The transactional rewrite must leave the
    // composition completely untouched and tell the user.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 501,
        json: async () => ({ error: "missing", errorCode: "reframe_script_missing" }),
      })),
    );
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/a.mp4" }),
    ]);
    comp.assets = [makeAssetEntry({ id: "v1", uri: "/a.mp4", kind: "video" })];
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform preset/i), {
      target: { value: "douyin-9-16" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });
    const next = useComposition.getState().comp!;
    // aspect / dimensions / preset all UNCHANGED — no half-applied state.
    expect(next.aspect).toBe("16:9");
    expect(next.width).toBe(1920);
    expect(next.height).toBe(1080);
    expect(next.exportPresets).toHaveLength(0);
    // clip NOT rebound to a (nonexistent) reframed asset.
    expect((next.tracks[0].clips[0] as { src?: string }).src).toBe("/a.mp4");
    // user is told it failed.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
