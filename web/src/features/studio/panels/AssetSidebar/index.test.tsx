import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetSidebar } from "./index";
import { useComposition } from "@/features/studio/store";
import { makeAssetGraph, makeVideoClip } from "../../../../test/composition-fixtures";

// Default mock — discriminate by URL so SearchBox's clip-index calls don't
// collide with the assets list call. (Phase 8.1.C added /api/clip-index/* fan-
// out from the LibraryTab → SearchBox tree.)
const _defaultAssets = {
  assets: [
    "assets/clips/intro.mp4",
    "output/final.mp4",
    "assets/images/cover.png",
  ],
};
// Partial mock — keep the real exports (notably `ApiError`, which ScriptTab's
// errorMessage() does `instanceof` against on its mount-load failure path) and
// only stub apiFetch. A bare object mock would drop ApiError → the Script tab's
// load-error handler would throw on the missing export.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (url: string) => {
      if (url.includes("/api/clip-index/status")) return { stub: true, reason: "no_index" };
      if (url.includes("/assets/search")) return { stub: false, results: [], searchMs: 1 };
      if (url.includes("/api/clip-index/build")) return { ok: true, stub: false, assetCount: 0, model: "ViT-B-32", indexedAt: "x", durationMs: 1 };
      return _defaultAssets;
    }),
  };
});

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset selection so existing AssetSidebar tests start on the Library tab.
  useComposition.setState({ comp: null, selection: null });
  // The Script tab's mount-load reads plan/script.md via raw `fetch` (a plain
  // text/markdown channel, off the mocked apiFetch). Stub it to a benign empty
  // plan so activating the Script tab resolves quietly (no load-error path).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (): string => "text/markdown; charset=utf-8" } as unknown as Headers,
      text: async (): Promise<string> => "",
      json: async (): Promise<unknown> => ({ ok: true }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssetSidebar", () => {
  it("renders Assets header and bucketed group chips", async () => {
    wrap(<AssetSidebar workId="w1" />);
    expect(await screen.findByText("Assets")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/CLIPS · 2/)).toBeTruthy();
      expect(screen.getByText(/IMAGES · 1/)).toBeTruthy();
    });
  });

  it("shows NO ASSETS empty state when no buckets", async () => {
    const mod = await import("@/lib/api");
    // Override the asset list specifically; SearchBox calls still get the
    // default discriminating mock above.
    (mod.apiFetch as any).mockImplementationOnce(async (url: string) => {
      if (url.includes("/api/clip-index/status")) return { stub: true, reason: "no_index" };
      if (url.includes("/assets/search")) return { stub: false, results: [], searchMs: 1 };
      return { assets: [] };
    });
    // Subsequent calls fall through to the default mock; force assets-list to
    // return [] for any later refetch.
    (mod.apiFetch as any).mockImplementation(async (url: string) => {
      if (url.includes("/api/clip-index/status")) return { stub: true, reason: "no_index" };
      if (url.includes("/assets/search")) return { stub: false, results: [], searchMs: 1 };
      if (url.includes("/api/clip-index/build")) return { ok: true, stub: false, assetCount: 0, model: "ViT-B-32", indexedAt: "x", durationMs: 1 };
      return { assets: [] };
    });
    wrap(<AssetSidebar workId="w1" />);
    await waitFor(() => expect(screen.getByText("NO ASSETS")).toBeTruthy());
  });

  it("the Generate button opens the GenerationDialog (Phase 2 §2.5)", async () => {
    // #91 — the AI generator now lives behind its own "Generate with AI"
    // button. The old "Upload"-labelled "+" that used to open this dialog was
    // an a11y mislabel (it triggers a real file upload now), so target the
    // dedicated generate control instead.
    wrap(<AssetSidebar workId="w1" />);
    const generate = await screen.findByRole("button", { name: /generate with ai/i });
    fireEvent.click(generate);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });
});

describe("AssetSidebar tabs (Phase 5.B)", () => {
  it("starts on the Library tab when nothing is selected", () => {
    useComposition.setState({ comp: null, selection: null });
    wrap(<AssetSidebar workId="w" />);
    expect(screen.getByRole("tab", { name: /library/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("auto-activates the Inspector tab when a clip becomes selected", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: null });
    wrap(<AssetSidebar workId="w" />);
    // Trigger the store update in act() so the effect flushes synchronously.
    act(() => {
      useComposition.setState({ selection: "c" });
    });
    expect(screen.getByRole("tab", { name: /inspector/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("manual click on Library tab keeps the user's choice", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: "c" });
    wrap(<AssetSidebar workId="w" />);
    // Effect fires on mount, then user toggles back.
    fireEvent.click(screen.getByRole("tab", { name: /library/i }));
    expect(screen.getByRole("tab", { name: /library/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("AssetSidebar — Script tab (S3 · PRD-0007)", () => {
  it("renders all three tabs: Library, Inspector, Script", () => {
    useComposition.setState({ comp: null, selection: null });
    wrap(<AssetSidebar workId="w" />);
    expect(screen.getByRole("tab", { name: /library/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /inspector/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /script/i })).toBeInTheDocument();
  });

  it("clicking the Script tab activates it and shows the ScriptTab panel", () => {
    // Empty scenes → ScriptTab renders its onboarding empty state, which is a
    // user-visible marker that the script panel (not inspector/library) mounted.
    const comp = makeAssetGraph({ ids: ["solo"] });
    useComposition.setState({ comp, selection: null });
    wrap(<AssetSidebar workId="w" />);
    fireEvent.click(screen.getByRole("tab", { name: /script/i }));
    expect(screen.getByRole("tab", { name: /script/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // ScriptTab's empty state is the proof the script panel rendered.
    expect(screen.getByText(/no storyboard yet/i)).toBeInTheDocument();
  });

  it("staying on the Script tab is sticky — a new selection does NOT yank to Inspector", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: null });
    wrap(<AssetSidebar workId="w" />);
    // User parks on the Script tab.
    fireEvent.click(screen.getByRole("tab", { name: /script/i }));
    // Then a clip becomes selected on the timeline.
    act(() => {
      useComposition.setState({ selection: "c" });
    });
    // The script tab must remain active — NOT auto-switch to inspector.
    expect(screen.getByRole("tab", { name: /script/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /inspector/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("library→inspector auto-switch is NOT regressed by the script-sticky guard", () => {
    // Parked on Library (default), a new selection must still jump to Inspector.
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: null });
    wrap(<AssetSidebar workId="w" />);
    expect(screen.getByRole("tab", { name: /library/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    act(() => {
      useComposition.setState({ selection: "c" });
    });
    expect(screen.getByRole("tab", { name: /inspector/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
