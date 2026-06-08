import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { mswServer } from "@/test/msw";
import type { WorkSummary } from "@/queries/works";
import { WorksGrid } from "./WorksGrid";

function renderGrid(works: WorkSummary[]) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorksGrid works={works} filter="all" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseWork: WorkSummary = {
  id: "w1",
  title: "T",
  type: "short-video",
  status: "ready",
  thumbnail: null,
  updatedAt: "2026-01-01T00:00:00Z",
  coverIsVideo: false,
};

describe("WorksGrid cover priority", () => {
  it("renders an <img> when coverImage is provided and not a video", () => {
    const { container } = renderGrid([
      {
        id: "w1",
        title: "T",
        type: "short-video",
        status: "published",
        thumbnail: null,
        updatedAt: "2026-01-01T00:00:00Z",
        coverImage: "/api/works/w1/assets/cover.png",
        coverIsVideo: false,
      },
    ]);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("cover.png");
  });

  // R115 F523 — content-bearing covers must surface a meaningful alt to
  // SR users (title + work type), not the empty decorative "".
  it("uses a meaningful alt that combines title + type (F523)", () => {
    const { container } = renderGrid([
      {
        id: "w1",
        title: "春日咖啡指南",
        type: "image-text",
        status: "published",
        thumbnail: null,
        updatedAt: "2026-01-01T00:00:00Z",
        coverImage: "/api/works/w1/assets/cover.png",
        coverIsVideo: false,
      },
    ]);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    const alt = img!.getAttribute("alt") ?? "";
    expect(alt).not.toBe("");
    expect(alt).toContain("春日咖啡指南");
    // EN locale is default in tests; assert against the EN cover-alt template.
    expect(alt).toMatch(/image-text cover|图文封面/);
  });

  // R115 F523 — when title is blank, fall back to localized "Untitled" so
  // SR users still hear *something* descriptive instead of an empty alt.
  it("falls back to localized Untitled in alt when title is blank (F523)", () => {
    const { container } = renderGrid([
      {
        id: "w-empty-title",
        title: "",
        type: "short-video",
        status: "draft",
        thumbnail: null,
        updatedAt: "2026-01-01T00:00:00Z",
        coverImage: "/api/works/w-empty-title/assets/cover.png",
        coverIsVideo: false,
      },
    ]);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    const alt = img!.getAttribute("alt") ?? "";
    expect(alt).not.toBe("");
    expect(alt).toMatch(/Untitled|未命名/);
  });

  it("renders a <video> element when coverImage is a video", () => {
    const { container } = renderGrid([
      {
        id: "w2",
        title: "V",
        type: "short-video",
        status: "published",
        thumbnail: null,
        updatedAt: "2026-01-01T00:00:00Z",
        coverImage: "/api/works/w2/assets/clip.mp4",
        coverIsVideo: true,
      },
    ]);
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  // R115 F523 — video covers also carry meaning; we surface alt via
  // aria-label since <video> doesn't accept the alt attribute.
  it("video cover gets aria-label with title + short-video type (F523)", () => {
    const { container } = renderGrid([
      {
        id: "w2",
        title: "海风咖啡馆",
        type: "short-video",
        status: "ready",
        thumbnail: null,
        updatedAt: "2026-01-01T00:00:00Z",
        coverImage: "/api/works/w2/assets/clip.mp4",
        coverIsVideo: true,
      },
    ]);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    const label = video!.getAttribute("aria-label") ?? "";
    expect(label).toContain("海风咖啡馆");
    expect(label).toMatch(/short-video cover|短视频封面/);
  });

  it("falls back to a deterministic gradient div when no cover is supplied", () => {
    const { container } = renderGrid([
      {
        id: "w-empty",
        title: "Empty",
        type: "short-video",
        status: "draft",
        thumbnail: null,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    // Fallback div has an inline-style gradient background.
    const fallback = container.querySelector('div[style*="linear-gradient"]');
    expect(fallback).not.toBeNull();
  });
});

// B4 — a transient 404 on the cover URL set `failed=true` and the card was
// stuck on the grey fallback gradient forever, because the error guard was
// never reset when useWorks refetch attached the real cover (new URL). The
// fix (useEffect resetting `failed` on cover change) must let the new cover
// re-mount and try to render.
describe("WorksGrid — cover error recovery (B4)", () => {
  function rerenderGrid(rerender: ReturnType<typeof renderGrid>["rerender"], works: WorkSummary[]) {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <WorksGrid works={works} filter="all" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("a transient cover 404 then a new cover URL re-attempts the cover (does not stay on fallback)", () => {
    const { container, rerender } = renderGrid([
      { ...baseWork, coverImage: "/api/works/w1/assets/cover-pending.png" },
    ]);

    // The first cover URL 404s before the bytes land → onError latches failed.
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    // Card falls back to the gradient div, no <img> rendered.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('div[style*="linear-gradient"]')).not.toBeNull();

    // useWorks refetch attaches the real cover (new URL). The card must
    // re-attempt rendering that cover, not stay stuck on the fallback.
    rerenderGrid(rerender, [
      { ...baseWork, coverImage: "/api/works/w1/assets/cover-final.png" },
    ]);

    const recovered = container.querySelector("img");
    expect(recovered).not.toBeNull();
    expect(recovered!.getAttribute("src")).toContain("cover-final.png");
  });

  it("recovers a video cover after a transient error when the URL changes", () => {
    const { container, rerender } = renderGrid([
      { ...baseWork, coverImage: "/api/works/w1/assets/clip-pending.mp4", coverIsVideo: true },
    ]);

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    fireEvent.error(video!);
    expect(container.querySelector("video")).toBeNull();

    rerenderGrid(rerender, [
      { ...baseWork, coverImage: "/api/works/w1/assets/clip-final.mp4", coverIsVideo: true },
    ]);

    const recovered = container.querySelector("video");
    expect(recovered).not.toBeNull();
    expect(recovered!.getAttribute("src")).toContain("clip-final.mp4");
  });
});

describe("WorksGrid — delete flow", () => {
  it("hovers card → ⋯ menu → Delete opens confirm → DELETE fires", async () => {
    let deleteCalled = false;
    mswServer.use(
      http.delete("/api/works/w1", () => {
        deleteCalled = true;
        return HttpResponse.json({ deleted: true });
      }),
    );
    renderGrid([
      {
        id: "w1",
        title: "My work",
        type: "image-text",
        status: "draft",
        thumbnail: null,
        updatedAt: new Date().toISOString(),
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$|^删除$/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    // The dialog title interpolates the work title, e.g. 'Delete "My work"?'
    expect(dialog).toHaveTextContent(/My work/);

    // The "Delete" inside the alertdialog is a plain button, not a menuitem
    const confirmBtn = screen
      .getAllByRole("button", { name: /^delete$|^删除$/i })
      .find((b) => b.closest('[role="alertdialog"]'));
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);
    await waitFor(() => expect(deleteCalled).toBe(true));
  });

  it("Cancel in confirm closes dialog without DELETE", async () => {
    let deleteCalled = false;
    mswServer.use(
      http.delete("/api/works/w1", () => {
        deleteCalled = true;
        return HttpResponse.json({ deleted: true });
      }),
    );
    renderGrid([
      {
        id: "w1",
        title: "My work",
        type: "image-text",
        status: "draft",
        thumbnail: null,
        updatedAt: new Date().toISOString(),
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$|^删除$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$|^取消$/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleteCalled).toBe(false);
  });

  it("clicking ⋯ menu does not bubble navigation through Link", () => {
    renderGrid([
      {
        id: "w1",
        title: "My work",
        type: "image-text",
        status: "draft",
        thumbnail: null,
        updatedAt: new Date().toISOString(),
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    // If propagation wasn't stopped, MemoryRouter would have navigated and unmounted the menu.
    expect(
      screen.getByRole("menuitem", { name: /^delete$|^删除$/i }),
    ).toBeInTheDocument();
  });
});
