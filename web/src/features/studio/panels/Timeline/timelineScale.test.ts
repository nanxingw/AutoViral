import { describe, expect, it } from "vitest";
import { computeRulerScale } from "./timelineScale";

describe("computeRulerScale", () => {
  it("selects the first major interval whose spacing reaches 72px", () => {
    expect(
      computeRulerScale({ pxPerSecond: 720, duration: 10 }).majorInterval,
    ).toBe(0.1);
    expect(
      computeRulerScale({ pxPerSecond: 719, duration: 10 }).majorInterval,
    ).toBe(0.2);
    expect(
      computeRulerScale({ pxPerSecond: 144, duration: 10 }).majorInterval,
    ).toBe(0.5);
    expect(
      computeRulerScale({ pxPerSecond: 143.9, duration: 10 }).majorInterval,
    ).toBe(1);
  });

  it("keeps major ticks at least 72px apart throughout the supported zoom range", () => {
    for (const pxPerSecond of [5, 20, 50, 100, 300]) {
      const scale = computeRulerScale({ pxPerSecond, duration: 600 });
      expect(scale.majorInterval * pxPerSecond).toBeGreaterThanOrEqual(72);
    }
  });

  it("draws minor ticks only when their spacing is at least 8px", () => {
    const expanded = computeRulerScale({ pxPerSecond: 5, duration: 600 });
    expect(expanded.minorInterval * 5).toBeGreaterThanOrEqual(8);
    expect(expanded.showMinor).toBe(true);
    expect(expanded.ticks.some((tick) => tick.kind === "minor")).toBe(true);

    const folded = computeRulerScale({ pxPerSecond: 0.1, duration: 600 });
    expect(folded.minorInterval * 0.1).toBeLessThan(8);
    expect(folded.showMinor).toBe(false);
    expect(folded.ticks.every((tick) => tick.kind === "major")).toBe(true);
  });

  it("only emits ticks within one major interval beyond the viewport", () => {
    const scale = computeRulerScale({
      pxPerSecond: 50,
      duration: 100,
      viewportStart: 10,
      viewportEnd: 20,
    });

    expect(scale.majorInterval).toBe(2);
    expect(Math.min(...scale.ticks.map((tick) => tick.time))).toBeGreaterThanOrEqual(8);
    expect(Math.max(...scale.ticks.map((tick) => tick.time))).toBeLessThanOrEqual(22);
    expect(scale.ticks.some((tick) => tick.time < 10)).toBe(true);
    expect(scale.ticks.some((tick) => tick.time > 20)).toBe(true);
  });

  it("uses m:ss labels for ordinary scales", () => {
    const scale = computeRulerScale({
      pxPerSecond: 100,
      duration: 120,
      viewportStart: 60,
      viewportEnd: 64,
    });
    expect(scale.ticks.find((tick) => tick.time === 62)?.label).toBe("1:02");
  });

  it("uses m:ss.d labels when the major interval is below one second", () => {
    const scale = computeRulerScale({
      pxPerSecond: 720,
      duration: 10,
      viewportStart: 0,
      viewportEnd: 1,
    });
    expect(scale.ticks.find((tick) => tick.time === 0.1)?.label).toBe("0:00.1");
  });

  it("uses h:mm:ss labels for timelines over one hour", () => {
    const scale = computeRulerScale({
      pxPerSecond: 100,
      duration: 3_700,
      viewportStart: 3_660,
      viewportEnd: 3_664,
    });
    expect(scale.ticks.find((tick) => tick.time === 3_661)?.label).toBe("1:01:01");
  });

  it("returns a single zero tick for duration=0", () => {
    const scale = computeRulerScale({ pxPerSecond: 50, duration: 0 });
    expect(scale.ticks).toEqual([{ kind: "major", time: 0, label: "0:00" }]);
  });
});
