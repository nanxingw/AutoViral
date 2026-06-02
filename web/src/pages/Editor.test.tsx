import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Editor, { serializeForDirty, carouselJumpToLocator } from "./Editor";
import { makeEmptyCarousel, type Layer } from "@/features/editor/types";
import { useEditor } from "@/features/editor/store";

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

// Stub ChatPanel — the carousel left column now mounts RightPane, which
// hosts the real ChatPanel (WebSocket + checkpoints + /api/status fetch).
// This is a layout test; we only assert the chat surface is present.
vi.mock("@/features/studio/panels/Chat", () => ({
  ChatPanel: ({ workId }: { workId: string }) => (
    <div data-testid="chat-panel-stub">CHAT · {workId}</div>
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

// 2026-06-02 (#1 carousel chat): Editor's left column now mounts the shared
// RightPane (Chat | Terminal tabs) — the same agent surface as Studio —
// instead of a bare TerminalPanel. Chat is the default-active tab (ADR-005),
// and the Terminal still lives behind its tab (kept mounted via display:none).
describe("Editor left column — agent surface (#1 carousel chat)", () => {
  it("mounts the agent ChatPanel (carousel now has a chat UI, not terminal-only)", () => {
    mount();
    expect(screen.queryByTestId("chat-panel-stub")).toBeTruthy();
  });

  it("still mounts the TerminalPanel (now the Terminal tab inside RightPane)", () => {
    mount();
    expect(screen.queryByTestId("terminal-panel-stub")).toBeTruthy();
  });

  it("offers both Chat and Terminal tabs", () => {
    mount();
    expect(screen.queryByRole("tab", { name: /chat/i })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /terminal/i })).toBeTruthy();
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

// #1 — the carousel agent emits <viewer-locator/> clicks; LocatorData has no
// slideId field, so carouselJumpToLocator treats `clipId` as a generic target
// id (slide → jump; layer → jump+select). It must NEVER fall through to
// ChatPanel's Studio default, which mutates the (wrong) video store.
describe("carouselJumpToLocator (#1 — agent locator → slide/layer nav)", () => {
  beforeEach(() => {
    // reset the shared editor store between cases
    useEditor.getState().loadCarousel(null);
  });

  it("jumps to a slide when clipId matches a slide id", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    useEditor.getState().addSlide(); // 2 slides; current is now slide 2
    const [s1, s2] = useEditor.getState().car!.slides.map((s) => s.id);
    expect(useEditor.getState().currentSlideId).toBe(s2);

    carouselJumpToLocator({ clipId: s1 });
    expect(useEditor.getState().currentSlideId).toBe(s1);
  });

  it("jumps to a layer's slide AND selects it when clipId is a layer id", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const headline: Layer = {
      id: "L_headline",
      kind: "text",
      box: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
      text: "标题",
      style: {
        font: "sans",
        size: 48,
        weight: 700,
        italic: false,
        color: "#111",
        align: "center",
        tracking: 0,
      },
    };
    useEditor.getState().addLayer(headline); // lands on slide 1
    useEditor.getState().addSlide(); // move current away to slide 2
    const slide1 = useEditor.getState().car!.slides[0].id;

    carouselJumpToLocator({ clipId: "L_headline" });
    expect(useEditor.getState().currentSlideId).toBe(slide1);
    expect(useEditor.getState().selectionLayerId).toBe("L_headline");
  });

  it("is a no-op for an unknown id (does not change the current slide)", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const before = useEditor.getState().currentSlideId;
    carouselJumpToLocator({ clipId: "does_not_exist" });
    expect(useEditor.getState().currentSlideId).toBe(before);
  });

  it("is a no-op when the locator carries no id", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const before = useEditor.getState().currentSlideId;
    carouselJumpToLocator({ time: 3.2 });
    expect(useEditor.getState().currentSlideId).toBe(before);
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
