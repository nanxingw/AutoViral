import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Studio from "@/pages/Studio";
import { useComposition } from "@/features/studio/store";
import { useTheme } from "@/stores/theme";

// codex review (F5 finding, high, PRD-0011): a fresh video work with NO
// composition.yaml yet used to seed via the bare `makeEmptyComposition({
// workId })` factory (default fps 30), bypassing the content-type registry's
// short-video manifest (registry.ts seedFactory: fps 24 — Seedance's
// ffprobe-confirmed native rate). This test proves the UI no-yaml path now
// lands on fps=24, mirroring registry.test.ts's coverage of the manifest
// itself and composition-ops.test.ts's coverage of the CLI/bridge no-yaml
// path — closing the "only the pure factory is tested" gap the review named.

vi.mock("@remotion/player", () => ({
  Player: (props: any) => <div data-testid="player" data-fps={props.fps} />,
}));

// found=null (no composition.yaml on disk yet) is the "fresh work" state
// Studio.tsx's typo-guard effect seeds against.
vi.mock("@/features/studio/services/composition", () => ({
  loadComposition: vi.fn(async () => null),
  saveComposition: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ workId }: { workId: string }) => (
    <div data-testid="terminal-panel-stub">TERMINAL · {workId}</div>
  ),
}));

vi.mock("@/features/studio/panels/Chat", () => ({
  ChatPanel: ({ workId }: { workId: string }) => (
    <div data-testid="chat-panel-stub">CHAT · {workId}</div>
  ),
}));

// /api/works must list "w1" as a real (non-typo) short-video work so the
// typo-guard effect's `workInList === true` branch fires the seed.
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes("/chat")) return { blocks: [] };
    if (url.includes("/assets")) return { assets: [] };
    if (url === "/api/works") {
      return {
        works: [
          {
            id: "w1",
            title: "fresh video work",
            type: "short-video",
            status: "draft",
            thumbnail: null,
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    }
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

describe("Studio fresh-work seed (F5, PRD-0011)", () => {
  it("seeds a brand-new short-video work at fps=24, not the bare factory's 30 default", async () => {
    mount();
    await waitFor(() => {
      expect(useComposition.getState().comp).not.toBeNull();
    });
    expect(useComposition.getState().comp?.fps).toBe(24);
  });
});
