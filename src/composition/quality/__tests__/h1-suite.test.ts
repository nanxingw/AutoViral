import { describe, it, expect } from "vitest";
import { inspectComposition } from "../inspect.js";
import { validateComposition } from "../validate.js";
import { animationMap, asciiGantt } from "../animation-map.js";
import { makeEmptyComposition } from "../../../shared/composition.js";

const baseCaptionStyle = {
  fontSize: 56,
  color: "#ffffff",
  background: "rgba(0,0,0,0.55)",
  padding: "4px 8px",
  borderRadius: 4,
  textAlign: "center" as const,
  bottomOffsetPx: 120,
};

function compWithCaptions(
  workId: string,
  groupOverrides: Partial<typeof baseCaptionStyle> = {},
  segmentText = "Hello world",
) {
  const base = makeEmptyComposition({ workId });
  return {
    ...base,
    captions: {
      modelId: "m1",
      audioTrackId: null,
      segments: [{ segmentId: "seg_1", start: 0, end: 2, text: segmentText }],
      groups: [
        {
          groupId: "g1",
          start: 0,
          end: 2,
          segmentIds: ["seg_1"],
          style: { ...baseCaptionStyle, ...groupOverrides },
          animation: {
            entrance: { duration: 0.18, type: "slide-up" as const },
            exit: { duration: 0.18, type: "fade" as const },
            highlight: { activeColor: "#a8c5d6", dimColor: "#888" },
          },
        },
      ],
    },
  };
}

describe("inspect (H1.2)", () => {
  it("clean composition produces zero findings", () => {
    const comp = makeEmptyComposition({ workId: "w_clean" });
    const r = inspectComposition(comp);
    expect(r.findings).toEqual([]);
  });

  it("flags caption-out-of-canvas when bottomOffset + line height exceeds frame", () => {
    const comp = compWithCaptions("w_oob", { bottomOffsetPx: 1900 });
    const r = inspectComposition(comp);
    expect(
      r.findings.find((f) => f.ruleId === "caption-out-of-canvas"),
    ).toBeDefined();
  });

  it("flags text-line-too-long for over-wide captions", () => {
    const comp = compWithCaptions(
      "w_long",
      {},
      "this is a really long caption that absolutely should not fit on one line because it would overflow the safe margins of the composition canvas",
    );
    const r = inspectComposition(comp);
    expect(
      r.findings.find((f) => f.ruleId === "text-line-too-long"),
    ).toBeDefined();
  });
});

describe("validate (H1.3 WCAG)", () => {
  it("white-on-mostly-opaque-black passes AA", () => {
    const comp = compWithCaptions("w_pass", {
      color: "#ffffff",
      background: "rgba(0,0,0,0.95)",
    });
    const r = validateComposition(comp);
    expect(r.findings).toEqual([]);
  });

  it("low-contrast gray-on-gray fails AA", () => {
    const comp = compWithCaptions("w_fail", {
      color: "#888888",
      background: "rgba(120,120,120,0.4)",
    });
    const r = validateComposition(comp);
    const fail = r.findings.find((f) => f.ruleId === "wcag-aa-contrast");
    expect(fail).toBeDefined();
    expect(fail?.ratio).toBeLessThan(fail?.threshold ?? 4.5);
  });
});

describe("animation-map (H1.4)", () => {
  it("emits entrance + exit tweens per caption group", () => {
    const comp = compWithCaptions("w_anim");
    const r = animationMap(comp);
    expect(r.tweens).toHaveLength(2);
    expect(r.tweens[0]?.description).toMatch(/entrance/);
    expect(r.tweens[1]?.description).toMatch(/exit/);
  });

  it("detects dead zones >1s with no tweens", () => {
    const base = makeEmptyComposition({ workId: "w_dead", duration: 10 });
    const comp = {
      ...base,
      captions: {
        modelId: "m1",
        audioTrackId: null,
        segments: [{ segmentId: "seg_1", start: 0, end: 1, text: "hi" }],
        groups: [
          {
            groupId: "g1",
            start: 0,
            end: 1,
            segmentIds: ["seg_1"],
            style: baseCaptionStyle,
            animation: {
              entrance: { duration: 0.2, type: "slide-up" as const },
              exit: { duration: 0.2, type: "fade" as const },
            },
          },
        ],
      },
    };
    const r = animationMap(comp);
    // Dead zone from t=1s → t=10s
    expect(r.deadZones.length).toBeGreaterThan(0);
    expect(r.deadZones[0]?.durationSec).toBeGreaterThanOrEqual(8);
  });

  it("asciiGantt produces one row per tween", () => {
    const r = animationMap(compWithCaptions("w_gantt"));
    const lines = asciiGantt(r).split("\n");
    expect(lines).toHaveLength(2);
  });
});
