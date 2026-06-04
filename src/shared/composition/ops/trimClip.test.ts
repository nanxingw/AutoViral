import { describe, it, expect } from "vitest";
import type { Composition, Clip, Keyframe } from "../../composition.js";
import { trimClip } from "./trimClip.js";
import { CompositionOpError } from "./errors.js";

// Minimal one-track composition. The op is a pure in-place mutator so we never
// run CompositionSchema.parse here (ADR-009 decision #2).
function compWith(clips: Clip[]): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 0,
    aspect: "9:16",
    tracks: [
      {
        id: "trk_v",
        kind: "video",
        label: "V1",
        displayOrder: 0,
        volume: 0,
        muted: false,
        hidden: false,
        clips: clips as never,
        transitions: [],
      },
    ],
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

function videoClip(p: {
  id: string;
  trackOffset: number;
  in: number;
  out: number;
  keyframes?: Keyframe[];
}): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: p.in,
    out: p.out,
    trackOffset: p.trackOffset,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...(p.keyframes ? { keyframes: p.keyframes } : {}),
  } as unknown as Clip;
}

function textClip(p: { id: string; trackOffset: number; duration: number }): Clip {
  return {
    id: p.id,
    kind: "text",
    text: "hi",
    trackOffset: p.trackOffset,
    duration: p.duration,
  } as unknown as Clip;
}

describe("@shared composition ops — trimClip", () => {
  it("sets out directly on a video clip, in place, recomputing duration", () => {
    // clip on timeline 0..6 (in:0 out:6).
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })]);
    trimClip(comp, { clipId: "a", out: 4 });
    const c = (comp.tracks[0].clips as Clip[])[0] as any;
    expect(c.in).toBeCloseTo(0);
    expect(c.out).toBeCloseTo(4);
    expect(c.trackOffset).toBeCloseTo(0);
    expect(comp.duration).toBeCloseTo(4);
  });

  it("sets in directly, anchoring trackOffset (source-window trim)", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 2, in: 1, out: 7 })]);
    trimClip(comp, { clipId: "a", in: 3 });
    const c = (comp.tracks[0].clips as Clip[])[0] as any;
    expect(c.in).toBeCloseTo(3);
    expect(c.out).toBeCloseTo(7);
    expect(c.trackOffset).toBeCloseTo(2); // anchor stays put
    // clip duration shrank to out-in = 4 → timeline end 2+4 = 6
    expect(comp.duration).toBeCloseTo(6);
  });

  it("does NOT replace the comp/track references — mutates the SAME objects (decision #1)", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })]);
    const before = comp;
    const beforeTrack = comp.tracks[0];
    const beforeClips = comp.tracks[0].clips;
    trimClip(comp, { clipId: "a", out: 4 });
    expect(comp).toBe(before);
    expect(comp.tracks[0]).toBe(beforeTrack);
    expect(comp.tracks[0].clips).toBe(beforeClips);
  });

  // ── adjacency cap clamp — out can't push the clip-end past the next clip ──
  it("clamps out at the next clip's trackOffset (no overlap)", () => {
    // a: timeline 0..4 ; b: timeline 6..10. Trying to extend a's out to 12
    // would push a's end to 12 — overlapping b. Cap = b.trackOffset (6) ⇒
    // out clamped to in + (6-0) = 6.
    const comp = compWith([
      videoClip({ id: "a", trackOffset: 0, in: 0, out: 4 }),
      videoClip({ id: "b", trackOffset: 6, in: 0, out: 4 }),
    ]);
    trimClip(comp, { clipId: "a", out: 12 });
    const a = (comp.tracks[0].clips as Clip[]).find((x) => x.id === "a") as any;
    expect(a.out).toBeCloseTo(6);
    // a's timeline end (0 + (6-0)) must not exceed b.trackOffset (6)
    expect(a.trackOffset + (a.out - a.in)).toBeLessThanOrEqual(6 + 1e-6);
  });

  // S7 fix-up (MEDIUM) — both-edges in one call must not let an extend-LEFT of
  // `in` (which grows clip duration) push the clip-end past the next clip. The
  // old code capped `out` against the OLD `in`, then shrank `in` afterwards →
  // clip-end = trackOffset + (out - newIn) ended up larger than the cap.
  it("both edges: extend-left in after capping out still respects the adjacency cap", () => {
    // a: timeline 0..4 (in:2 out:6) ; b: timeline 6..10. Ask out=12 (caps to
    // in+6=8 against b@6) AND in=0 (extend-left, grows duration). Final clip-end
    // must be <= b.trackOffset (6), never overlap b.
    const comp = compWith([
      videoClip({ id: "a", trackOffset: 0, in: 2, out: 6 }),
      videoClip({ id: "b", trackOffset: 6, in: 0, out: 4 }),
    ]);
    trimClip(comp, { clipId: "a", in: 0, out: 12 });
    const a = (comp.tracks[0].clips as Clip[]).find((x) => x.id === "a") as any;
    expect(a.trackOffset + (a.out - a.in)).toBeLessThanOrEqual(6 + 1e-6);
  });

  // ── minimum duration floors ──
  it("floors out at in + MIN_CLIP_DUR (0.05) — can't collapse to zero width", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 2, out: 6 })]);
    trimClip(comp, { clipId: "a", out: 2 }); // would set out=in → zero width
    const a = (comp.tracks[0].clips as Clip[])[0] as any;
    expect(a.out).toBeCloseTo(2.05);
  });

  it("caps in at out - MIN_CLIP_DUR — can't cross the out edge", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 4 })]);
    trimClip(comp, { clipId: "a", in: 99 }); // way past out
    const a = (comp.tracks[0].clips as Clip[])[0] as any;
    expect(a.in).toBeCloseTo(4 - 0.05);
  });

  it("floors in at 0 (can't go negative)", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 2, out: 6 })]);
    trimClip(comp, { clipId: "a", in: -5 });
    const a = (comp.tracks[0].clips as Clip[])[0] as any;
    expect(a.in).toBeCloseTo(0);
  });

  // ── keyframe rebase ──
  it("drops/clamps keyframes past the new end when shrinking out (.a half)", () => {
    // clip-local window [0,6]; opacity kf at local 1 and local 5. Trim out to 4
    // (newDur=4) ⇒ kf past 4 dropped, boundary added at 4.
    const comp = compWith([
      videoClip({
        id: "a",
        trackOffset: 0,
        in: 0,
        out: 6,
        keyframes: [
          { property: "opacity", time: 1, value: 0.2, easing: "linear" },
          { property: "opacity", time: 5, value: 1, easing: "linear" },
        ],
      }),
    ]);
    trimClip(comp, { clipId: "a", out: 4 });
    const a = (comp.tracks[0].clips as Clip[])[0] as any;
    const times = (a.keyframes as Keyframe[]).map((k) => k.time);
    expect(Math.max(...times)).toBeLessThanOrEqual(4 + 1e-6);
    // boundary added at the new local end (4)
    expect(times.some((t) => Math.abs(t - 4) < 1e-6)).toBe(true);
  });

  it("leaves keyframes UNTOUCHED when moving in (trackOffset is the anchor)", () => {
    // S7 fix-up — keyframe `time` is trackOffset-relative (each renderer mounts
    // the clip in `<Sequence from={trackOffset*fps}>` and reads useCurrentFrame;
    // `clip.in` only feeds `<Video startFrom={in*fps}>`). trimClip keeps
    // trackOffset FIXED and only shifts `in`, so the keyframe time ORIGIN does
    // not move — keyframes must NOT rebase. (The old code copied the store's
    // left-edge resize rebase, but that resize ALSO moves trackOffset by the
    // same delta — which trimClip deliberately does not.)
    const kfs: Keyframe[] = [
      { property: "opacity", time: 1, value: 0.2, easing: "linear" },
      { property: "opacity", time: 5, value: 1, easing: "linear" },
    ];
    const comp = compWith([
      videoClip({
        id: "a",
        trackOffset: 0,
        in: 0,
        out: 6,
        keyframes: kfs.map((k) => ({ ...k })),
      }),
    ]);
    trimClip(comp, { clipId: "a", in: 2 });
    const a = (comp.tracks[0].clips as Clip[])[0] as any;
    // IDENTICAL to the input — times, values, easings all preserved.
    expect(a.keyframes).toEqual(kfs);
  });

  // ── illegal params → CompositionOpError{code:4} ──
  it("throws code:4 for an unknown clipId", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })]);
    try {
      trimClip(comp, { clipId: "nope", out: 4 });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 when neither in nor out is provided", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })]);
    try {
      trimClip(comp, { clipId: "a" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 when in >= out as supplied together", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })]);
    try {
      trimClip(comp, { clipId: "a", in: 5, out: 3 });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 for a duration-based (text) clip — no in/out window", () => {
    const comp = compWith([textClip({ id: "t", trackOffset: 0, duration: 4 })]);
    try {
      trimClip(comp, { clipId: "t", out: 2 });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });
});
