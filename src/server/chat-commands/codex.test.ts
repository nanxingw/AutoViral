import { describe, expect, it } from "vitest";
import { codexBackend } from "../chat-backends/codex.js";

describe("codex slash-command adapter", () => {
  it.each(["compact", "model", "review"])(
    "explicitly rejects unmapped /%s and never turns it into an exec prompt",
    (name) => {
      const result = codexBackend.resolveCommand({ name, args: name === "model" ? "haiku" : "" });
      expect(result).toMatchObject({
        status: "unsupported",
        errorCode: "unsupported_command",
        command: name,
      });
      expect(result).not.toHaveProperty("prompt");
    },
  );
});
