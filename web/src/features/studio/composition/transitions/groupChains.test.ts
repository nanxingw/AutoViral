import { describe, it, expect } from "vitest";
import { groupChains } from "./groupChains";
import type { VideoClip, Transition } from "../../types";

// #54 Phase 1 — VideoTrackRenderer relies on this to fold transition-linked
// adjacents into a TransitionSeries chain; standalone clips stay as
// length-1 chains (= plain Sequence, back-compat).

function clip(id: string, trackOffset: number): VideoClip {
  return {
    id, kind: "video", src: "x.mp4",
    in: 0, out: 3, trackOffset,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}
function tr(id: string, afterClipId: string): Transition {
  return { id, afterClipId, preset: "cross-dissolve", durationSec: 0.5, alignment: "center", easing: "linear" };
}

describe("groupChains (#54)", () => {
  it("standalone clips → length-1 chains (back-compat behaviour)", () => {
    const out = groupChains([clip("a", 0), clip("b", 3), clip("c", 6)], []);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.clips.length === 1 && c.transitions.length === 0)).toBe(true);
  });

  it("one transition between two clips → one length-2 chain", () => {
    const out = groupChains([clip("a", 0), clip("b", 3)], [tr("tr1", "a")]);
    expect(out).toHaveLength(1);
    expect(out[0].clips.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out[0].transitions.map((t) => t.id)).toEqual(["tr1"]);
  });

  it("two consecutive transitions extend a chain (A-B-C)", () => {
    const out = groupChains(
      [clip("a", 0), clip("b", 3), clip("c", 6)],
      [tr("tr1", "a"), tr("tr2", "b")],
    );
    expect(out).toHaveLength(1);
    expect(out[0].clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(out[0].transitions.map((t) => t.id)).toEqual(["tr1", "tr2"]);
  });

  it("a transition + a standalone produces a chain AND a standalone", () => {
    const out = groupChains(
      [clip("a", 0), clip("b", 3), clip("c", 6)],
      [tr("tr1", "a")],
    );
    expect(out).toHaveLength(2);
    expect(out[0].clips.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out[1].clips.map((c) => c.id)).toEqual(["c"]);
  });

  it("sorts clips by trackOffset before grouping (input order doesn't matter)", () => {
    const out = groupChains(
      [clip("b", 3), clip("a", 0), clip("c", 6)],
      [tr("tr1", "a")],
    );
    expect(out[0].clips.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
