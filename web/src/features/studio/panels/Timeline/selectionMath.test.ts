import { describe, expect, it } from "vitest";
import {
  clearTimelineSelection,
  computeGroupMoveOffsets,
  intersectingClipIds,
  reconcileTimelineSelection,
  replaceTimelineSelection,
  toggleTimelineSelection,
  unionTimelineSelection,
  type TimelineSelection,
} from "./selectionMath";

const EMPTY: TimelineSelection = {
  ids: [],
  primaryId: null,
  anchorId: null,
};

describe("timeline selection math", () => {
  it("replaces the selection and makes the clip primary + anchor", () => {
    expect(replaceTimelineSelection("b")).toEqual({
      ids: ["b"],
      primaryId: "b",
      anchorId: "b",
    });
  });

  it("toggles clips without producing duplicate ids", () => {
    const selected = toggleTimelineSelection(
      replaceTimelineSelection("a"),
      "b",
    );
    expect(selected).toEqual({
      ids: ["a", "b"],
      primaryId: "b",
      anchorId: "a",
    });

    expect(toggleTimelineSelection(selected, "b")).toEqual({
      ids: ["a"],
      primaryId: "a",
      anchorId: "a",
    });
  });

  it("unions new ids while preserving the existing primary and anchor", () => {
    expect(
      unionTimelineSelection(replaceTimelineSelection("a"), ["b", "a", "c"]),
    ).toEqual({
      ids: ["a", "b", "c"],
      primaryId: "a",
      anchorId: "a",
    });
  });

  it("selects clips whose rectangles intersect the marquee", () => {
    const ids = intersectingClipIds(
      [
        { id: "inside", trackId: "v1", left: 10, top: 10, right: 30, bottom: 30 },
        { id: "touching", trackId: "v1", left: 30, top: 20, right: 50, bottom: 40 },
        { id: "outside", trackId: "v1", left: 51, top: 10, right: 70, bottom: 30 },
      ],
      { left: 20, top: 0, right: 50, bottom: 35 },
    );
    expect(ids).toEqual(["inside", "touching"]);
  });

  it("marquee selection crosses track boundaries", () => {
    const ids = intersectingClipIds(
      [
        { id: "video", trackId: "v1", left: 10, top: 10, right: 40, bottom: 30 },
        { id: "audio", trackId: "a1", left: 15, top: 40, right: 45, bottom: 60 },
        { id: "later", trackId: "v2", left: 100, top: 70, right: 130, bottom: 90 },
      ],
      { left: 0, top: 0, right: 50, bottom: 65 },
    );
    expect(ids).toEqual(["video", "audio"]);
  });

  it("clears all selection fields for Escape", () => {
    expect(clearTimelineSelection()).toEqual(EMPTY);
  });

  it("reconciles ids and chooses a surviving primary after deletion", () => {
    const current: TimelineSelection = {
      ids: ["a", "b", "c"],
      primaryId: "b",
      anchorId: "a",
    };
    expect(reconcileTimelineSelection(current, new Set(["a", "c"]))).toEqual({
      ids: ["a", "c"],
      primaryId: "a",
      anchorId: "a",
    });
    expect(reconcileTimelineSelection(current, new Set())).toEqual(EMPTY);
  });

  it("computes group move offsets relative to the dragged primary", () => {
    const offsets = computeGroupMoveOffsets(
      [
        { id: "video", trackId: "v1", start: 2 },
        { id: "audio", trackId: "a1", start: 5.5 },
        { id: "caption", trackId: "t1", start: 1 },
      ],
      "video",
      10,
    );
    expect(Object.fromEntries(offsets)).toEqual({
      video: 10,
      audio: 13.5,
      caption: 9,
    });
  });
});
