import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SearchBox } from "./SearchBox";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
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

// Route helper — apiFetch is called with a URL; dispatch on it.
function route(handlers: Record<string, unknown | ((url: string) => unknown)>): void {
  _api.mockImplementation(async (url: string) => {
    for (const [pat, val] of Object.entries(handlers)) {
      if (url.includes(pat)) {
        return typeof val === "function" ? (val as (u: string) => unknown)(url) : val;
      }
    }
    throw new Error(`Unhandled URL in test: ${url}`);
  });
}

describe("SearchBox", () => {
  it("renders the search input and a Build index button when no index exists", async () => {
    route({
      "/api/clip-index/status": { stub: true, reason: "no_index" },
    });
    wrap(<SearchBox workId="w1" debounceMs={0} />);
    expect(await screen.findByLabelText(/search assets/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /build index/i })).toBeInTheDocument();
  });

  it("clicking Build index fires the POST mutation and shows Building…", async () => {
    let resolveBuild!: (v: unknown) => void;
    const buildPromise = new Promise((r) => { resolveBuild = r; });
    route({
      "/api/clip-index/status": { stub: true, reason: "no_index" },
      "/api/clip-index/build": () => buildPromise,
    });
    wrap(<SearchBox workId="w1" debounceMs={0} />);
    const btn = await screen.findByRole("button", { name: /build index/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /building/i })).toBeInTheDocument();
    });
    resolveBuild({ ok: true, stub: false, assetCount: 3, model: "ViT-B-32", indexedAt: "x", durationMs: 1 });
    // Verify POST happened
    await waitFor(() => {
      const calls = _api.mock.calls.map((c) => c[0]);
      expect(calls.some((u: string) => u.includes("/api/clip-index/build"))).toBe(true);
    });
  });

  it("typing a query (>=2 chars) fires a debounced search", async () => {
    route({
      "/api/clip-index/status": { stub: false, model: "ViT-B-32", assetCount: 3, indexedAt: "x" },
      "/api/works/w1/assets/search": {
        stub: false,
        results: [{ uri: "assets/images/panda.png", kind: "image", score: 0.42 }],
        searchMs: 12,
      },
    });
    wrap(<SearchBox workId="w1" debounceMs={0} />);
    const input = await screen.findByLabelText(/search assets/i);
    fireEvent.change(input, { target: { value: "panda" } });
    await waitFor(() => {
      const calls = _api.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes("/assets/search?q=panda"))).toBe(true);
    });
  });

  // #55 — feature retired in refactor: server returns
  // {stub:true, reason:"clip_index_removed_in_refactor"}. UI must (1) render
  // an honest banner explaining unavailability, (2) disable the input, and
  // (3) NOT render the dead "Build index" button (the regression vector).
  it("renders the retired banner and hides the build button when feature is removed (#55)", async () => {
    route({
      "/api/clip-index/status": {
        stub: true,
        reason: "clip_index_removed_in_refactor",
        assetCount: 0,
      },
    });
    wrap(<SearchBox workId="w1" debounceMs={0} />);
    expect(await screen.findByTestId("clip-index-removed-banner")).toBeInTheDocument();
    const input = screen.getByLabelText(/search assets/i) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /build index/i })).toBeNull();
  });

  it("renders a stub install banner when status reports open_clip missing", async () => {
    route({
      "/api/clip-index/status": { stub: true, reason: "open_clip_torch not installed" },
    });
    wrap(<SearchBox workId="w1" debounceMs={0} />);
    expect(await screen.findByText(/Semantic search unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/pip install/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/search assets/i) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("renders 'No matches' when results array is empty", async () => {
    route({
      "/api/clip-index/status": { stub: false, model: "ViT-B-32", assetCount: 3, indexedAt: "x" },
      "/api/works/w1/assets/search": { stub: false, results: [], searchMs: 5 },
    });
    wrap(<SearchBox workId="w1" debounceMs={0} />);
    const input = await screen.findByLabelText(/search assets/i);
    fireEvent.change(input, { target: { value: "nothing" } });
    await waitFor(() => {
      expect(screen.getByText(/NO MATCHES FOR/i)).toBeInTheDocument();
    });
  });

  it("renders ranked results with thumbnails (filename) and score chips", async () => {
    route({
      "/api/clip-index/status": { stub: false, model: "ViT-B-32", assetCount: 3, indexedAt: "x" },
      "/api/works/w1/assets/search": {
        stub: false,
        results: [
          { uri: "assets/images/panda.png", kind: "image", score: 0.42 },
          { uri: "assets/clips/cute.mp4", kind: "video", score: 0.21 },
        ],
        searchMs: 12,
      },
    });
    wrap(<SearchBox workId="w1" debounceMs={0} />);
    const input = await screen.findByLabelText(/search assets/i);
    fireEvent.change(input, { target: { value: "panda" } });
    const list = await screen.findByTestId("clip-search-results");
    await waitFor(() => {
      expect(list).toHaveTextContent("panda.png");
      expect(list).toHaveTextContent("0.42");
      expect(list).toHaveTextContent("cute.mp4");
      expect(list).toHaveTextContent("0.21");
    });
  });
});
