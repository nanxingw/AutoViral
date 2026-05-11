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
