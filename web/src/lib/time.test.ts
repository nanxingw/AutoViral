import { describe, it, expect } from "vitest";
import { secToTimecode } from "./time";

describe("secToTimecode", () => {
  it("formats 0", () => expect(secToTimecode(0)).toBe("00:00.00"));
  it("formats minutes:seconds.frames", () => expect(secToTimecode(73.5)).toBe("01:13.50"));
  it("rounds correctly across the minute boundary", () => {
    expect(secToTimecode(59.999)).toBe("01:00.00");
  });
  it("rounds correctly across the 2-minute boundary", () => {
    expect(secToTimecode(119.999)).toBe("02:00.00");
  });
});
