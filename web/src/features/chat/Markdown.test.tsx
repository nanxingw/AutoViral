import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./Markdown";

// A3 (PRD-0010) — the shared Markdown component. Chat and the 剧本 preview both
// render agent/user markdown through this one component: ReactMarkdown +
// remarkGfm + the img→ChatInlineMedia / code→highlighter overrides + asset URL
// translation. These tests lock the three behaviours the slice promises the
// component preserves so a third consumer needs zero re-wiring.

describe("Markdown (shared component)", () => {
  it("renders a GFM table as a <table> (remarkGfm wired)", () => {
    const md = "| Shot | Beat |\n| --- | --- |\n| 1 | hook |";
    const { container } = render(<Markdown text={md} workId="w1" />);
    expect(container.querySelector("table")).not.toBeNull();
    // header row → two <th>, body row → two <td>.
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("translates a relative asset image path to /api/works/:id/assets/*", () => {
    const md = "![shot](assets/images/a.png)";
    const { container } = render(<Markdown text={md} workId="w42" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/api/works/w42/assets/images/a.png");
  });

  it("swaps a relative video asset into <video> (ChatInlineMedia img→video, url translated)", () => {
    const md = "![clip](assets/videos/a.mp4)";
    const { container } = render(<Markdown text={md} workId="w42" />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("/api/works/w42/assets/videos/a.mp4");
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps an already-absolute /api/works URL intact (no double-wrap)", () => {
    const md = "![shot](/api/works/w1/assets/images/a.png)";
    const { container } = render(<Markdown text={md} workId="w1" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/works/w1/assets/images/a.png",
    );
  });

  it("highlights a fenced code block through the hand-rolled pipeline (no regression)", () => {
    const md = "```yaml\nkey: value\n```";
    const { container } = render(<Markdown text={md} workId="w1" />);
    const code = container.querySelector("code.chat-hl");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("chat-hl-yaml");
    // the yaml key is tagged (hl-key span) — the highlighter ran, not raw text.
    expect(container.querySelector("code .hl-key")).not.toBeNull();
  });

  it("renders inline `code` as a plain <code> (no highlighter classes)", () => {
    const md = "use the `render` function";
    const { container } = render(<Markdown text={md} workId="w1" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).not.toContain("chat-hl");
  });
});
