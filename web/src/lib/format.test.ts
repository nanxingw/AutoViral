import { describe, it, expect } from "vitest";
import { compactNumber, fmtDelta } from "./format";

describe("compactNumber", () => {
  it("formats thousands with k", () => expect(compactNumber(2847)).toBe("2.8K"));
  it("formats millions with M", () => expect(compactNumber(1_200_000)).toBe("1.2M"));
  it("keeps small numbers raw", () => expect(compactNumber(42)).toBe("42"));
});

describe("fmtDelta", () => {
  it("renders positive with up arrow", () => expect(fmtDelta(0.123)).toBe("↑ 12.3%"));
  it("renders negative with down arrow", () => expect(fmtDelta(-0.04)).toBe("↓ 4.0%"));
  it("renders zero with em dash", () => expect(fmtDelta(0)).toBe("— 0%"));
});
