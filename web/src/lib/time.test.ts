import { describe, it, expect } from "vitest";
import { secToTimecode } from "./time";

describe("secToTimecode", () => {
  it("formats 0", () => expect(secToTimecode(0)).toBe("00:00.00"));
  it("formats minutes:seconds.frames", () => expect(secToTimecode(73.5)).toBe("01:13.50"));
});
