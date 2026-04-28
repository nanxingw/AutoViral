import { describe, it, expect } from "vitest";
import {
  computeKineticPopScale,
  computeTypewriterChars,
} from "../TextTrackRenderer";

describe("computeKineticPopScale", () => {
  it("starts at 0 at frame 0", () => {
    expect(computeKineticPopScale(0, 30)).toBeCloseTo(0, 2);
  });
  it("overshoots above 1.0 mid-pop", () => {
    const v = computeKineticPopScale(6, 30);
    expect(v).toBeGreaterThan(1.0);
    expect(v).toBeLessThanOrEqual(1.2);
  });
  it("settles to 1.0 by frame 18", () => {
    expect(computeKineticPopScale(18, 30)).toBeCloseTo(1.0, 1);
  });
  it("stays at 1.0 after frame 30", () => {
    expect(computeKineticPopScale(45, 30)).toBeCloseTo(1.0, 2);
  });
});

describe("computeTypewriterChars", () => {
  it("reveals 0 chars at frame 0", () => {
    expect(computeTypewriterChars("hello world", 0, 30)).toBe(0);
  });
  it("reveals all chars after the typing window", () => {
    expect(computeTypewriterChars("hi", 60, 30)).toBe(2);
  });
  it("reveals chars proportionally during the typing window", () => {
    // 11 chars over 22 frames (2 fps-per-char by default)
    expect(computeTypewriterChars("hello world", 11, 30)).toBeGreaterThanOrEqual(5);
    expect(computeTypewriterChars("hello world", 11, 30)).toBeLessThanOrEqual(7);
  });
  it("never returns more than text length", () => {
    expect(computeTypewriterChars("ab", 1000, 30)).toBe(2);
  });
});
