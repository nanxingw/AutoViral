import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./store";
import type { StreamBlock } from "./types";

describe("chat store", () => {
  beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

  it("appends user blocks", () => {
    useChatStore.getState().push({ type: "user", text: "hi" });
    expect(useChatStore.getState().blocks).toHaveLength(1);
    expect(useChatStore.getState().blocks[0].type).toBe("user");
  });

  it("toggles streaming flag", () => {
    useChatStore.getState().setStreaming(true);
    expect(useChatStore.getState().streaming).toBe(true);
  });
});

describe("useChatStore.setBlocks", () => {
  beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

  it("replaces the entire blocks array", () => {
    useChatStore.getState().push({ type: "user", text: "old" });
    expect(useChatStore.getState().blocks).toHaveLength(1);
    const seeded: StreamBlock[] = [
      { id: "h1", ts: 1, type: "user", text: "seeded-1" },
      { id: "h2", ts: 2, type: "text", text: "seeded-2" },
    ];
    useChatStore.getState().setBlocks(seeded);
    expect(useChatStore.getState().blocks).toEqual(seeded);
  });
});
