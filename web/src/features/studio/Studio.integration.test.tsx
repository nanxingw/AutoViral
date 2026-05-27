import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Studio from "@/pages/Studio";
import { useComposition } from "./store";
import { makeEmptyComposition, type VideoClip } from "./types";
import { useTheme } from "@/stores/theme";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => (
    <div
      data-testid="player"
      data-fps={props.fps}
      data-comp-w={props.compositionWidth}
    />
  ),
}));

vi.mock("./services/composition", () => ({
  loadComposition: vi.fn(async () => null),
  saveComposition: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

// Stub TerminalPanel — its useEffect constructs `new WebSocket(...)` and
// xterm.js Terminal which the test env (happy-dom) does not provide.
vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ workId }: { workId: string }) => (
    <div data-testid="terminal-panel-stub">TERMINAL · {workId}</div>
  ),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes("/chat")) return { blocks: [] };
    if (url.includes("/assets")) return { assets: [] };
    // Studio's load flow (Round 16 typo-guard) only auto-creates an empty
    // composition once the works list confirms the workId exists — otherwise
    // it routes to NotFound. With loadComposition mocked to null, the Player
    // never renders unless useWorks resolves with w1 present. Seed it.
    if (url.endsWith("/api/works"))
      return [
        {
          id: "w1",
          title: "W1",
          type: "short-video",
          status: "draft",
          thumbnail: null,
          updatedAt: "2026-05-09T00:00:00Z",
        },
      ];
    return {};
  }),
}));

beforeEach(() => {
  useComposition.setState({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
  });
  useTheme.setState({ theme: "dark" });
});

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/studio/w1"]}>
        <Routes>
          <Route path="/studio/:workId" element={<Studio />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Studio integration", () => {
  it("mounts with empty composition and renders Player", async () => {
    const { findByTestId } = mount();
    const player = await findByTestId("player");
    expect(player.getAttribute("data-fps")).toBe("30");
  });

  it("adding a clip surfaces it on the timeline", async () => {
    mount();
    await new Promise((r) => setTimeout(r, 10));
    const c = useComposition.getState().comp ?? makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    const v: VideoClip = {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 4,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    };
    // Phase D (issue #31) — resolve the video lane by kind, since track ids
    // are now `trk_<uuid>` (no more hardcoded "video-0").
    const videoTrackId = useComposition
      .getState()
      .comp!.tracks.find((t) => t.kind === "video")!.id;
    useComposition.getState().addClip(videoTrackId, v);
    const tracks = useComposition.getState().comp!.tracks;
    expect(tracks[0].clips).toHaveLength(1);
  });

  it("Settings toggle reveals the floating TweaksPanel and theme writes through (A2)", async () => {
    const { findByTestId, queryByTestId } = mount();
    await findByTestId("player");
    expect(queryByTestId("tweaks-panel")).toBeNull();
    fireEvent.click(await findByTestId("settings-toggle"));
    const lightBtn = await findByTestId("theme-toggle-light");
    fireEvent.click(lightBtn);
    expect(useTheme.getState().theme).toBe("light");
  });
});
