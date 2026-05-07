import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Studio from "@/pages/Studio";
import { useComposition } from "@/features/studio/store";
import { useTheme } from "@/stores/theme";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => (
    <div data-testid="player" data-fps={props.fps} />
  ),
}));

vi.mock("@/features/studio/services/composition", () => ({
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

describe("Studio layout (Phase 9.1: react-resizable-panels)", () => {
  it("renders all expected resizable panels by id", () => {
    const { container } = mount();
    // react-resizable-panels emits data-panel-id on its panel root.
    const ids = Array.from(
      container.querySelectorAll("[data-panel-id]"),
    ).map((el) => el.getAttribute("data-panel-id"));
    expect(ids).toContain("chat");
    expect(ids).toContain("center");
    expect(ids).toContain("aside");
    expect(ids).toContain("preview");
    expect(ids).toContain("timeline");
  });

  it("renders ResizeHandles between panels", () => {
    const { getByTestId } = mount();
    expect(getByTestId("resize-handle-chat-center")).toBeInTheDocument();
    expect(getByTestId("resize-handle-center-aside")).toBeInTheDocument();
    expect(getByTestId("resize-handle-preview-timeline")).toBeInTheDocument();
  });

  it("mounts without throwing (smoke)", () => {
    expect(() => mount()).not.toThrow();
  });
});
