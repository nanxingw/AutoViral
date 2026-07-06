import { describe, it, expect } from "vitest";
import { seedBlocksFromHistory } from "../seed";

// PRD-0010 CE fix-verify LOW finding: the LIVE assistant_text path strips
// <viewer-action> tags (useChatSocket → extractViewerActions), but the reseed
// path mapped persisted text verbatim, so after a page reload old assistant
// bubbles showed raw `<viewer-action ... />` markup. Strip on reseed too so the
// tag never surfaces to the user on either path. (Reload must NOT re-dispatch —
// stripping is display-only here; the store isn't touched.)
describe("seedBlocksFromHistory — viewer-action tag stripping", () => {
  it("strips a viewer-action tag from a reseeded text block", () => {
    const [block] = seedBlocksFromHistory([
      {
        id: "hist_0",
        type: "text",
        text: `已切到第 3 秒 <viewer-action type="set-frame" data='{"frame":90}' /> 看看`,
      },
    ]);
    expect(block.text).toBe("已切到第 3 秒 看看");
    expect(block.text).not.toContain("viewer-action");
  });

  it("leaves tag-free text untouched", () => {
    const [block] = seedBlocksFromHistory([
      { id: "h", type: "text", text: "普通回复，没有标签" },
    ]);
    expect(block.text).toBe("普通回复，没有标签");
  });

  it("strips multiple tags and preserves surrounding prose", () => {
    const [block] = seedBlocksFromHistory([
      {
        type: "text",
        text: `先 <viewer-action type="select-slide" data='{"id":"s1"}' /> 再 <viewer-action type="select-layer" data='{"id":"l1"}' /> 完成`,
      },
    ]);
    expect(block.text).not.toContain("viewer-action");
    expect(block.text).toContain("先");
    expect(block.text).toContain("完成");
  });

  it("does not touch non-text blocks (tool_use payload kept verbatim)", () => {
    const raw = `{"cmd":"<viewer-action fake>"}`;
    const [block] = seedBlocksFromHistory([
      { type: "tool_use", text: raw, toolName: "Bash" },
    ]);
    // tool payloads are data, not prose — never rewrite them
    expect(block.text).toBe(raw);
  });
});
