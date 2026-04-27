import { describe, it, expect } from "vitest";
import { resolvePosition } from "./positionResolve";

describe("resolvePosition", () => {
  it("center anchor at 50/50", () => {
    const s = resolvePosition(
      { anchor: "center", xPct: 50, yPct: 50 },
      { width: 1080, height: 1920 },
    );
    expect(s.left).toBe("50%");
    expect(s.top).toBe("50%");
    expect(String(s.transform)).toContain("translate(-50%, -50%)");
  });
  it("bottom anchor: translate -50% on x only", () => {
    const s = resolvePosition(
      { anchor: "bottom", xPct: 50, yPct: 90 },
      { width: 1080, height: 1920 },
    );
    expect(String(s.transform)).toContain("translateX(-50%)");
    expect(String(s.transform)).not.toContain("translateY");
  });
});
