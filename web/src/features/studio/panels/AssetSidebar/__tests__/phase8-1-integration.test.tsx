// Phase 8.1.D — integration test for the LibraryTab → SearchBox stack.
//
// AC1: typing "panda" returns the panda asset even when the asset id is
//      `asset-bamboo-eater-1` (no string match required, since the mocked
//      Python score is what drives the order).
// AC2: stub mode (open_clip not installed) shows the install hint and disables
//      the input.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LibraryTab } from "../LibraryTab";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

import { apiFetch } from "@/lib/api";

const _api = apiFetch as unknown as ReturnType<typeof vi.fn>;

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  _api.mockReset();
});

function routeBy(handlers: Record<string, unknown>): void {
  _api.mockImplementation(async (url: string) => {
    for (const [pat, val] of Object.entries(handlers)) {
      if (url.includes(pat)) return val;
    }
    throw new Error(`Unhandled URL: ${url}`);
  });
}

describe("Phase 8.1 integration — LibraryTab + SearchBox", () => {
  it("AC1: typing 'panda' renders the panda asset by score, regardless of filename", async () => {
    // Order matters — more-specific routes first because /api/works/.../assets
    // is a prefix of /api/works/.../assets/search.
    routeBy({
      "/assets/search": {
        stub: false,
        results: [
          { uri: "/api/works/phase8-1-test/assets/images/asset-bamboo-eater-1.png", kind: "image", score: 0.34 },
        ],
        searchMs: 87,
      },
      "/api/clip-index/status": {
        stub: false,
        model: "ViT-B-32",
        assetCount: 2,
        indexedAt: "2026-05-06T00:00:00Z",
      },
      "/api/works/phase8-1-test/assets": {
        assets: [
          // Filename gives no hint of "panda" — the index does the work.
          "assets/images/asset-bamboo-eater-1.png",
          "assets/images/random-other.png",
        ],
      },
    });

    wrap(<LibraryTab workId="phase8-1-test" />);

    const input = await screen.findByLabelText(/search assets/i);
    fireEvent.change(input, { target: { value: "panda" } });

    const list = await waitFor(
      () => screen.getByTestId("clip-search-results"),
      { timeout: 1500 },
    );
    await waitFor(() => {
      expect(within(list).getByText(/asset-bamboo-eater-1\.png/)).toBeInTheDocument();
    });
    expect(within(list).getByText(/0\.34/)).toBeInTheDocument();
  });

  it("AC2: stub mode renders the install hint and disables the input", async () => {
    routeBy({
      "/api/works/phase8-1-test/assets": { assets: [] },
      "/api/clip-index/status": {
        stub: true,
        reason: "open_clip_torch not installed",
      },
    });

    wrap(<LibraryTab workId="phase8-1-test" />);

    expect(await screen.findByText(/Semantic search unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/pip install/i)).toBeInTheDocument();
    const input = await screen.findByLabelText(/search assets/i);
    expect((input as HTMLInputElement).disabled).toBe(true);
  });
});
