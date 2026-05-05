import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { WorkSummary } from "@/queries/works";
import { WorksGrid } from "./WorksGrid";

function renderGrid(works: WorkSummary[]) {
  return render(
    <MemoryRouter>
      <WorksGrid works={works} filter="all" />
    </MemoryRouter>,
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
