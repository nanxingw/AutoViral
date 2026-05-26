import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Editor, { serializeForDirty } from "./Editor";
import { makeEmptyCarousel } from "@/features/editor/types";

vi.mock("@/features/editor/services/carousel", () => ({
  loadCarousel: vi.fn(async () => null),
  saveCarousel: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ blocks: [] })),
}));

vi.mock("@/features/editor/hooks/useExport", () => ({
  useExport: () => ({
    setStage: vi.fn(),
    exportCurrent: vi.fn(),
    exportAll: vi.fn(),
  }),
}));

// Stage uses Konva — stub to avoid canvas in JSDOM.
vi.mock("@/features/editor/canvas/Stage", () => ({
  Stage: () => <div data-testid="stage-stub" />,
}));

// Stub TerminalPanel — its useEffect constructs `new WebSocket(...)` and
// xterm.js Terminal which neither happy-dom nor jsdom provide.
vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ workId }: { workId: string }) => (
    <div data-testid="terminal-panel-stub">TERMINAL · {workId}</div>
  ),
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/editor/w1"]}>
        <Routes>
          <Route path="/editor/:workId" element={<Editor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 2026-05-14 (Phase 1 agentic-terminal): Editor's left column now mounts
// TerminalPanel instead of ChatPanel — same agentic shell as Studio.
describe("Editor (Phase 1 agentic-terminal layout)", () => {
  it("renders the TerminalPanel in the left column", () => {
    mount();
    expect(screen.queryByTestId("terminal-panel-stub")).toBeTruthy();
  });

  it("does NOT mount the legacy SlidesNav in the left column", () => {
    mount();
    // SlidesNav header reads "Slides · N" — must be absent.
    expect(screen.queryByText(/^Slides\s*·/i)).toBeNull();
  });

  it("still renders the bottom Filmstrip tray (DRAG TO REORDER)", () => {
    mount();
    expect(screen.queryByText(/drag to reorder/i)).toBeTruthy();
  });
});

// #50 — autosave must key off content-dirtiness, not structural shape. The old
// guard (`slides.length<=1 && layers.length===0 → skip`) treated a single
// empty slide as "untouched" forever, so global edits (grain / palette / layout
// / bg) — which add no layer — were silently dropped. serializeForDirty is the
// fingerprint that fixes this: a global edit changes it even when the old guard
// would have short-circuited both carousels as "empty" and skipped the save.
describe("autosave dirtiness fingerprint (#50)", () => {
  it("ignores the volatile updatedAt timestamp", () => {
    const car = makeEmptyCarousel("w1");
    const later = { ...car, updatedAt: "2099-01-01T00:00:00.000Z" };
    expect(serializeForDirty(car)).toBe(serializeForDirty(later));
  });

  it("a grain edit on a single empty slide changes the fingerprint (the core bug)", () => {
    const base = makeEmptyCarousel("w1");
    // The exact scenario the old isEmpty guard mis-skipped: 1 slide, 0 layers.
    expect(base.slides.length).toBe(1);
    expect(base.slides[0].layers.length).toBe(0);
    const edited = {
      ...base,
      globals: { ...base.globals, effects: { ...base.globals.effects, grain: 0.99 } },
    };
    expect(serializeForDirty(edited)).not.toBe(serializeForDirty(base));
  });

  it("palette / layout / bg edits each change the fingerprint", () => {
    const base = makeEmptyCarousel("w1");
    const palette = { ...base, globals: { ...base.globals, palette: "noir" as const } };
    const layout = { ...base, globals: { ...base.globals, layout: "left" as const } };
    const bg = {
      ...base,
      slides: [{ ...base.slides[0], bg: { type: "image" as const, value: "/x.png" } }],
    };
    const baseline = serializeForDirty(base);
    expect(serializeForDirty(palette)).not.toBe(baseline);
    expect(serializeForDirty(layout)).not.toBe(baseline);
    expect(serializeForDirty(bg)).not.toBe(baseline);
  });

  it("an unedited reload of the same content is not dirty (blank slate stays unsaved)", () => {
    // Two pristine empties with the same id/workId fingerprint identically, so
    // the autosave effect skips the PUT — preserving the legacy auto-build path.
    const a = makeEmptyCarousel("w1");
    const b = { ...a }; // same identity fields, no edits
    expect(serializeForDirty(a)).toBe(serializeForDirty(b));
  });
});
