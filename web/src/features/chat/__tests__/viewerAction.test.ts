import { describe, it, expect } from "vitest";
import { extractViewerActions } from "../types";

describe("extractViewerActions", () => {
  it("returns input unchanged when no tags present", () => {
    const { cleaned, actions } = extractViewerActions("hello there");
    expect(cleaned).toBe("hello there");
    expect(actions).toEqual([]);
  });

  it("extracts a single select-slide action and strips the tag", () => {
    const { cleaned, actions } = extractViewerActions(
      `已切换到第 2 张 <viewer-action type="select-slide" data='{"id":"s2"}' /> 看看效果`,
    );
    expect(cleaned).toBe("已切换到第 2 张 看看效果");
    expect(actions).toEqual([{ type: "select-slide", data: { id: "s2" } }]);
  });

  it("extracts multiple actions in document order", () => {
    const text =
      `先选 <viewer-action type="select-slide" data='{"id":"s1"}' /> 再 <viewer-action type="set-frame" data='{"frame":120}' /> 完成`;
    const { actions } = extractViewerActions(text);
    expect(actions).toEqual([
      { type: "select-slide", data: { id: "s1" } },
      { type: "set-frame", data: { frame: 120 } },
    ]);
  });

  it("drops a tag with malformed JSON but keeps the rest of the text", () => {
    const { cleaned, actions } = extractViewerActions(
      `oops <viewer-action type="select-slide" data='{not json}' /> still here`,
    );
    expect(cleaned).toContain("oops");
    expect(cleaned).toContain("still here");
    expect(cleaned).not.toContain("viewer-action");
    expect(actions).toEqual([]);
  });

  it("supports single-quoted attributes too", () => {
    // Real-world payloads use double-quoted JSON inside single-quoted attrs
    // (no escaping needed). The other quote mix is regex-supported but not
    // useful in practice (can't put unescaped " inside a "..." HTML attr).
    const { actions } = extractViewerActions(
      `<viewer-action type='select-clip' data='{"clipId":"c1"}' />`,
    );
    expect(actions[0]).toMatchObject({
      type: "select-clip",
      data: { clipId: "c1" },
    });
  });
});
