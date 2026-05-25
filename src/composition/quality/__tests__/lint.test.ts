import { describe, it, expect } from "vitest";
import { lintComposition, exitCodeFor } from "../lint.js";
import { makeEmptyComposition } from "../../../shared/composition.js";

function withTracks(comp: ReturnType<typeof makeEmptyComposition>, tracks: unknown[]) {
  return { ...comp, tracks } as never;
}

describe("lintComposition (H1.1)", () => {
  it("clean composition produces zero findings", () => {
    const comp = makeEmptyComposition({ workId: "w_clean" });
    const r = lintComposition(comp);
    expect(r.findings).toEqual([]);
    expect(exitCodeFor(r)).toBe(0);
  });

  it("schema-invalid input fails with one or more schema-invalid findings", () => {
    const r = lintComposition({ not: "a composition" });
    expect(r.counts.error).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.ruleId === "schema-invalid")).toBe(true);
    expect(exitCodeFor(r)).toBe(6);
  });

  it("detects track-overlap on the same track", () => {
    const base = makeEmptyComposition({ workId: "w_overlap" });
    const comp = withTracks(base, [
      {
        id: "trk_v",
        kind: "video",
        label: "v",
        displayOrder: 0,
        clips: [
          {
            id: "vc_a",
            kind: "video",
            src: "assets/a.mp4",
            in: 0,
            out: 5,
            trackOffset: 0,
          },
          {
            id: "vc_b",
            kind: "video",
            src: "assets/b.mp4",
            in: 0,
            out: 4,
            trackOffset: 3, // [3, 7] overlaps vc_a's [0, 5]
          },
        ],
      },
    ]);
    const r = lintComposition(comp);
    const overlap = r.findings.find((f) => f.ruleId === "track-overlap");
    expect(overlap).toBeDefined();
    expect(overlap?.message).toMatch(/vc_b/);
    expect(exitCodeFor(r)).toBe(6);
  });

  it("adjacent (non-overlapping) clips don't trigger track-overlap", () => {
    const base = makeEmptyComposition({ workId: "w_adjacent" });
    const comp = withTracks(base, [
      {
        id: "trk_v",
        kind: "video",
        label: "v",
        displayOrder: 0,
        clips: [
          { id: "a", kind: "video", src: "assets/a.mp4", in: 0, out: 5, trackOffset: 0 },
          { id: "b", kind: "video", src: "assets/b.mp4", in: 0, out: 5, trackOffset: 5 },
        ],
      },
    ]);
    const r = lintComposition(comp);
    expect(r.findings.some((f) => f.ruleId === "track-overlap")).toBe(false);
  });

  it("orphan-clip (src looks like asset id not in registry) is a warning", () => {
    const base = makeEmptyComposition({ workId: "w_orphan" });
    const comp = withTracks(base, [
      {
        id: "trk_v",
        kind: "video",
        label: "v",
        displayOrder: 0,
        clips: [
          {
            id: "vc_z",
            kind: "video",
            src: "missingAssetId", // no slash, no extension → flagged
            in: 0,
            out: 2,
            trackOffset: 0,
          },
        ],
      },
    ]);
    const r = lintComposition(comp);
    const orphan = r.findings.find((f) => f.ruleId === "orphan-clip");
    expect(orphan?.severity).toBe("warning");
    expect(exitCodeFor(r)).toBe(5);
  });

  it("dangling-segment-id flags caption groups pointing at missing segments", () => {
    const base = makeEmptyComposition({ workId: "w_caps" });
    const comp = {
      ...base,
      captions: {
        modelId: "m1",
        audioTrackId: null,
        segments: [
          { segmentId: "seg_1", start: 0, end: 1, text: "a" },
        ],
        groups: [
          {
            groupId: "grp_1",
            start: 0,
            end: 1,
            segmentIds: ["seg_1", "seg_9000"], // seg_9000 dangles
            style: {
              fontSize: 56,
              color: "#fff",
              background: "rgba(0,0,0,0.5)",
              padding: "4px 8px",
              borderRadius: 4,
              textAlign: "center",
              bottomOffsetPx: 120,
            },
          },
        ],
      },
    } as never;
    const r = lintComposition(comp);
    const dangling = r.findings.find(
      (f) => f.ruleId === "dangling-segment-id",
    );
    expect(dangling).toBeDefined();
    expect(dangling?.message).toMatch(/seg_9000/);
  });

  it("missing-asset triggers only when workDir is provided", () => {
    const base = makeEmptyComposition({ workId: "w_assets" });
    const comp = {
      ...base,
      assets: [
        {
          id: "asset_x",
          kind: "video" as const,
          uri: "/this/path/does/not/exist.mp4",
          status: "ready" as const,
        },
      ],
    };
    // Without workDir → no missing-asset check
    const rNoWd = lintComposition(comp);
    expect(
      rNoWd.findings.some((f) => f.ruleId === "missing-asset"),
    ).toBe(false);
    // With workDir → check fires
    const rWd = lintComposition(comp, { workDir: "/tmp/does-not-exist" });
    expect(
      rWd.findings.find((f) => f.ruleId === "missing-asset"),
    ).toBeDefined();
  });

  it("exitCodeFor: clean = 0, warning-only = 5, error = 6", () => {
    expect(exitCodeFor({ findings: [], counts: { error: 0, warning: 0, info: 0 } })).toBe(0);
    expect(
      exitCodeFor({
        findings: [],
        counts: { error: 0, warning: 2, info: 0 },
      }),
    ).toBe(5);
    expect(
      exitCodeFor({
        findings: [],
        counts: { error: 1, warning: 0, info: 0 },
      }),
    ).toBe(6);
  });
});
