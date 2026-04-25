import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./store";

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
