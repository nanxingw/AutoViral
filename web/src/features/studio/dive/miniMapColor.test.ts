import { describe, it, expect } from "vitest";
import { miniMapNodeColor } from "./miniMapColor";

// Item 6 — minimap nodes are tinted per type. Lock the mapping to theme tokens
// (never a hard-coded hex) so the map stays legible in both themes.

describe("miniMapNodeColor", () => {
  it("maps each Dive node type to a distinct theme token", () => {
    expect(miniMapNodeColor({ type: "visual" })).toBe("var(--accent-lo)");
    expect(miniMapNodeColor({ type: "audio" })).toBe("var(--status-running)");
    expect(miniMapNodeColor({ type: "text" })).toBe("var(--text-dimmer)");
    expect(miniMapNodeColor({ type: "sceneGroup" })).toBe("var(--glass-hi)");
  });

  it("falls back to a token (never a raw hex) for an unknown type", () => {
    const c = miniMapNodeColor({ type: "mystery" });
    expect(c.startsWith("var(--")).toBe(true);
  });

  it("visual / audio / text are all different colours", () => {
    const colors = new Set([
      miniMapNodeColor({ type: "visual" }),
      miniMapNodeColor({ type: "audio" }),
      miniMapNodeColor({ type: "text" }),
    ]);
    expect(colors.size).toBe(3);
  });
});
