import { describe, expect, it } from "vitest";
import { listChatCommands, resolveChatCommand } from "./registry.js";

// Preset tests (copied verbatim from PRD-0013 S9):
// - registry 分类/过滤/unknown→unsupported 永不降级 prompt。
// - claude.ts init 解析捕获 slash_commands+skills、重复 init 更新、去重。
// - `ws-bridge-slash-command.test.ts`（spawn-mock 先例：ws-bridge-resume-prompt 模式）：/compact 的 positional prompt **精确等于** `/compact`；/model haiku 走 session setter且下轮 spawn 带 --model haiku；busy/断线/错误恢复。
// - codex adapter：/compact 等未映射显式拒绝。
// - CommandMenu：过滤/键盘/ARIA/句中 "/" 与 URL 不触发/IME composing Enter 不误执行；sendCommand 不含信封。

const activeSession = {
  exists: true,
  connected: true,
  idle: true,
  hasHistory: true,
};

describe("chat command registry", () => {
  it("keeps local, translate, and passthrough classification stable while filtering by backend capabilities", () => {
    const claude = listChatCommands({
      backend: "claude",
      session: activeSession,
      capabilities: {
        slashCommands: ["compact", "review", "logout"],
        skills: ["review", "logout"],
      },
    });
    const codex = listChatCommands({
      backend: "codex",
      session: activeSession,
      capabilities: { slashCommands: [], skills: [] },
    });

    expect(claude.find((entry) => entry.name === "model")?.kind).toBe("local");
    expect(claude.find((entry) => entry.name === "compact")?.kind).toBe("passthrough");
    expect(claude.find((entry) => entry.name === "review")?.kind).toBe("passthrough");
    expect(claude.some((entry) => entry.name === "logout")).toBe(false);
    expect(codex.find((entry) => entry.name === "compact")?.availability).toMatchObject({
      available: false,
      reasonCode: "unsupported_by_backend",
    });
    expect(codex.some((entry) => entry.name === "review")).toBe(false);
    expect(claude.every((entry) => entry.backend === "claude")).toBe(true);
    expect(codex.every((entry) => entry.backend === "codex")).toBe(true);
  });

  it("returns structured unsupported_command for unknown or denied commands and never supplies a prompt", () => {
    const base = {
      backend: "claude" as const,
      session: activeSession,
      capabilities: {
        slashCommands: ["compact", "logout"],
        skills: ["logout"],
      },
    };

    const unknown = resolveChatCommand({ ...base, name: "does-not-exist", args: "" });
    const denied = resolveChatCommand({ ...base, name: "logout", args: "" });

    expect(unknown).toMatchObject({ status: "unsupported", errorCode: "unsupported_command" });
    expect(denied).toMatchObject({ status: "unsupported", errorCode: "unsupported_command" });
    expect(unknown).not.toHaveProperty("prompt");
    expect(denied).not.toHaveProperty("prompt");
  });

  it("builds an exact provider prompt only after an available command resolves", () => {
    const resolved = resolveChatCommand({
      backend: "claude",
      session: activeSession,
      capabilities: { slashCommands: ["compact"], skills: [] },
      name: "/compact",
      args: "",
    });
    expect(resolved).toMatchObject({ status: "ready", prompt: "/compact" });
  });
});
