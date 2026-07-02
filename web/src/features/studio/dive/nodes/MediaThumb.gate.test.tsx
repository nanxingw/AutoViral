import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MediaThumb } from "./MediaThumb";

// B5 (PRD-0010) — video nodes off-screen must NOT fetch metadata. MediaThumb
// gates the <video> src/preload behind an IntersectionObserver: no src +
// preload="none" until the node scrolls into view, then src + preload="metadata"
// (paints the poster). We drive a controllable IO stub so intersection is
// deterministic in happy-dom (which never lays out / fires IO on its own).

let ioCallback: IntersectionObserverCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class MockIO {
  constructor(cb: IntersectionObserverCallback) {
    ioCallback = cb;
  }
  observe = observe;
  unobserve = vi.fn();
  disconnect = disconnect;
  takeRecords = () => [];
  root = null;
  rootMargin = "";
  thresholds = [];
}

beforeEach(() => {
  ioCallback = null;
  observe.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("IntersectionObserver", MockIO as unknown as typeof IntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const videoAsset = {
  id: "clip1",
  kind: "video" as const,
  uri: "clips/s01.mp4",
  name: "Shot 1",
};

describe("MediaThumb — off-screen video preload gate", () => {
  it("renders a video WITHOUT src and preload=none before it enters the viewport", () => {
    render(<MediaThumb asset={videoAsset} />);
    const video = screen.getByTestId("dive-video") as HTMLVideoElement;
    // No src attribute → the browser fires no metadata request.
    expect(video.getAttribute("src")).toBeNull();
    expect(video.getAttribute("preload")).toBe("none");
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("loads src + preload=metadata once the node intersects the viewport", () => {
    render(<MediaThumb asset={videoAsset} />);
    const video = screen.getByTestId("dive-video") as HTMLVideoElement;
    act(() => {
      ioCallback?.(
        [
          {
            isIntersecting: true,
            target: video,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(video.getAttribute("src")).toBe("clips/s01.mp4");
    expect(video.getAttribute("preload")).toBe("metadata");
  });

  it("renders images eagerly (gate applies to video only)", () => {
    render(
      <MediaThumb
        asset={{ id: "img1", kind: "image", uri: "images/p.png", name: "pic" }}
      />,
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("images/p.png");
    // No IO needed for images.
    expect(screen.queryByTestId("dive-video")).toBeNull();
  });
});
