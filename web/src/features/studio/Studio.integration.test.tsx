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

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes("/chat")) return { blocks: [] };
    if (url.includes("/assets")) return { assets: [] };
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
    useComposition.getState().addClip("video-0", v);
    const tracks = useComposition.getState().comp!.tracks;
    expect(tracks[0].clips).toHaveLength(1);
  });

  it("Theme toggle in the floating TweaksPanel writes to the theme store (A2)", async () => {
    const { findByTestId } = mount();
    await findByTestId("player");
    const lightBtn = await findByTestId("theme-toggle-light");
    fireEvent.click(lightBtn);
    expect(useTheme.getState().theme).toBe("light");
  });
});
