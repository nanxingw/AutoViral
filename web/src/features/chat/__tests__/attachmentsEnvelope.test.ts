import { describe, it, expect } from "vitest";
import { buildAttachmentsEnvelope } from "../useChatSocket";
import type { ChatAttachment } from "../types";

const att = (over: Partial<ChatAttachment> = {}): ChatAttachment => ({
  path: "assets/images/ref.png",
  url: "/api/works/w/assets/images/ref.png",
  name: "ref.png",
  kind: "image",
  ...over,
});

describe("buildAttachmentsEnvelope", () => {
  it("returns null when there are no attachments", () => {
    expect(buildAttachmentsEnvelope([])).toBeNull();
  });

  it("wraps each file with its workspace-relative path, kind, and name", () => {
    const env = buildAttachmentsEnvelope([
      att(),
      att({ path: "assets/video/clip.mp4", name: "clip.mp4", kind: "video" }),
    ]);
    expect(env).toContain("<attachments>");
    expect(env).toContain("</attachments>");
    // Paths are workspace-relative — the agent joins them onto its workspace
    // root (its cwd is the project root, not the work dir).
    expect(env).toContain('<file path="assets/images/ref.png" type="image" name="ref.png" />');
    expect(env).toContain('<file path="assets/video/clip.mp4" type="video" name="clip.mp4" />');
  });

  it("escapes quotes and angle brackets in the filename (no envelope injection)", () => {
    const env = buildAttachmentsEnvelope([att({ name: 'a"<b>.png' })]);
    expect(env).toContain("&quot;");
    expect(env).toContain("&lt;");
    expect(env).toContain("&gt;");
    expect(env).not.toContain('name="a"<b>.png"');
  });
});
