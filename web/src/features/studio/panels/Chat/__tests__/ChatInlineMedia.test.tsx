import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ChatInlineMedia } from "../index";

describe("ChatInlineMedia", () => {
  it("renders <img> for image-extension src", () => {
    const { container } = render(<ChatInlineMedia src="/api/works/w/assets/foo.png" alt="hi" />);
    const img = container.querySelector("img");
    const video = container.querySelector("video");
    expect(img).not.toBeNull();
    expect(video).toBeNull();
    expect(img?.getAttribute("src")).toBe("/api/works/w/assets/foo.png");
    expect(img?.getAttribute("alt")).toBe("hi");
  });

  it("renders <video> for .mp4 / .mov / .webm src", () => {
    for (const ext of ["mp4", "mov", "webm"]) {
      const { container } = render(<ChatInlineMedia src={`/x/y.${ext}`} alt="" />);
      const video = container.querySelector("video");
      const img = container.querySelector("img");
      expect(video, `expected video for .${ext}`).not.toBeNull();
      expect(img, `did NOT expect img for .${ext}`).toBeNull();
      expect(video?.getAttribute("src")).toBe(`/x/y.${ext}`);
      expect(video?.hasAttribute("controls")).toBe(true);
      expect(video?.hasAttribute("muted")).toBe(true);
    }
  });

  it("query string after extension still classifies correctly", () => {
    const { container } = render(<ChatInlineMedia src="/x.mp4?t=0,3" alt="" />);
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders nothing when src is undefined", () => {
    const { container } = render(<ChatInlineMedia src={undefined} alt="" />);
    expect(container.firstChild).toBeNull();
  });
});
