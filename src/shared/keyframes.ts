import type {
  CubicBezierEasing,
  Keyframe,
  KeyframeEasing,
  KeyframeProperty,
} from "./composition.js";
import { CubicBezierEasingSchema, DISCRETE_KEYFRAME_EASINGS } from "./composition.js";
import { Easing } from "remotion";

/** Time-equality tolerance for dedup at the same (property, time). ~one-quarter of a 60 fps frame. */
export const KEYFRAME_TIME_EPSILON = 1e-4;

// PRD-0014 S12 — cubic-bezier evaluation is Remotion's `Easing.bezier(x1,y1,x2,y2)`
// (the What mandates preview/export interpolation route through it, so a custom
// curve renders IDENTICALLY here, in the Remotion preview, and on export, and we
// inherit Remotion's precision + upgrade semantics rather than a repo-local
// Newton/bisection copy that could drift). `Easing.bezier` precomputes a sample
// table on construction, so we memoise the built timing functions (the discrete
// presets are constant; custom curves are keyed by their control points) to keep
// the per-frame `interpolateProperty` hot path allocation-free after warm-up.
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);

const customBezierCache = new Map<string, (t: number) => number>();
function cubicBezierFn(p: readonly [number, number, number, number]): (t: number) => number {
  const key = `${p[0]},${p[1]},${p[2]},${p[3]}`;
  let fn = customBezierCache.get(key);
  if (!fn) {
    fn = Easing.bezier(p[0], p[1], p[2], p[3]);
    customBezierCache.set(key, fn);
  }
  return fn;
}

// PRD-0014 S12 — a KeyframeEasing is EITHER a discrete preset string OR a custom
// cubic-bezier object. This guard narrows the union so `applyEasing` (and any
// consumer) can branch. `null`/`undefined` are not easings.
export function isCubicBezierEasing(
  e: KeyframeEasing | undefined | null,
): e is CubicBezierEasing {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as CubicBezierEasing).type === "cubic-bezier"
  );
}

/**
 * Validate a cubic-bezier control-point tuple `[x1,y1,x2,y2]`. The x control
 * points must be finite ∈ [0,1] (a timing function must be single-valued in x);
 * y is finite but unbounded (overshoot / bounce curves are allowed).
 */
export function isValidBezierPoints(p: unknown): p is [number, number, number, number] {
  if (!Array.isArray(p) || p.length !== 4) return false;
  const [x1, y1, x2, y2] = p as unknown[];
  const finite = [x1, y1, x2, y2].every(
    (n) => typeof n === "number" && Number.isFinite(n),
  );
  if (!finite) return false;
  return (
    (x1 as number) >= 0 &&
    (x1 as number) <= 1 &&
    (x2 as number) >= 0 &&
    (x2 as number) <= 1
  );
}

/**
 * Is `e` a well-formed KeyframeEasing? True for a discrete preset name or a
 * `{type:"cubic-bezier", p:[x1,y1,x2,y2]}` object with in-range x control points.
 * The shared validity gate the ops layer consults (so the CLI / bridge chokepoint
 * rejects a bad easing without a full `CompositionSchema.parse`).
 */
export function isValidKeyframeEasing(e: unknown): e is KeyframeEasing {
  // Reference the discrete list lazily (inside the call, not at module init) to
  // dodge the keyframes.ts ↔ composition.ts import cycle: at module-eval time
  // `DISCRETE_KEYFRAME_EASINGS` can still be in its TDZ. `.includes` on a
  // 4-element array is negligible.
  if (typeof e === "string") {
    return (DISCRETE_KEYFRAME_EASINGS as readonly string[]).includes(e);
  }
  if (e && typeof e === "object") {
    const o = e as { type?: unknown; p?: unknown };
    return o.type === "cubic-bezier" && isValidBezierPoints(o.p);
  }
  return false;
}

/**
 * Parse an easing SPEC (from the CLI `--easing` flag or the bridge wire) into a
 * canonical `KeyframeEasing`. Accepts:
 *   - a discrete preset name string (linear/easeIn/easeOut/easeInOut) → returned
 *     verbatim (the op validates the name against the enum),
 *   - a CSS-style string `cubic-bezier(x1,y1,x2,y2)` → `{type:"cubic-bezier",p}`,
 *   - an already-structured `{type:"cubic-bezier",p:[…]}` object → validated.
 * Throws `Error` on malformed cubic-bezier syntax or an out-of-range x control
 * point (the caller maps this to a 4xx / exit-4). A plain unknown discrete name
 * is returned as-is so the op owns the "not a real preset" rejection message.
 */
export function parseEasingSpec(raw: unknown): KeyframeEasing {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as { type?: unknown; p?: unknown };
    if (o.type === "cubic-bezier") {
      // Schema-validate the STRUCTURE — never type-coerce. `.map(Number)` would
      // turn null/""/booleans into 0/1 and slip a malformed curve past the gate
      // (S12 review F1). `CubicBezierEasingSchema` requires every `p` component
      // to be a real number and pins x1,x2 ∈ [0,1] (the shared source of truth).
      const parsed = CubicBezierEasingSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `invalid cubic-bezier easing object ${JSON.stringify(raw)} (need p:[x1,y1,x2,y2] numbers with x1,x2 in [0,1])`,
        );
      }
      return parsed.data;
    }
    throw new Error(`invalid easing object ${JSON.stringify(raw)}`);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    const m = /^cubic-bezier\(\s*([^)]*)\)$/i.exec(s);
    if (m) {
      // Reject an empty / whitespace-only component BEFORE `Number()` — otherwise
      // `Number("")` coerces the missing value to 0 and `cubic-bezier(0.4,,0.2,1)`
      // masquerades as the legal `[0.4,0,0.2,1]` (S12 review F1). A blank token
      // maps to NaN so `isValidBezierPoints`' finiteness check rejects it.
      const nums = m[1].split(",").map((x) => {
        const tok = x.trim();
        return tok === "" ? Number.NaN : Number(tok);
      });
      if (!isValidBezierPoints(nums)) {
        throw new Error(
          `invalid cubic-bezier easing "${s}" (need 4 numbers with x1,x2 in [0,1])`,
        );
      }
      return { type: "cubic-bezier", p: nums };
    }
    // A discrete preset name — return verbatim; the op validates it.
    return s as KeyframeEasing;
  }
  throw new Error(`invalid easing ${String(raw)}`);
}

function applyEasing(easing: KeyframeEasing, t: number): number {
  if (isCubicBezierEasing(easing)) {
    return cubicBezierFn(easing.p)(t);
  }
  switch (easing) {
    case "linear":
      return t;
    case "easeIn":
      return EASE_IN(t);
    case "easeOut":
      return EASE_OUT(t);
    case "easeInOut":
      return EASE_IN_OUT(t);
  }
}

/**
 * Returns the interpolated value for `property` at clip-local time `currentTime`,
 * or `null` if the array contains no keyframe for that property.
 *
 * Contract:
 * - Out-of-range times **clamp** to the nearest endpoint (D3). No extrapolation, no wrap.
 * - The easing of the *outgoing* keyframe (segment start) controls the segment.
 * - Input order is irrelevant — internally sorts a filtered copy by `time` ASC.
 * - Volume on a VideoClip / OverlayClip is structurally allowed but renderers ignore it (D5).
 *   This helper does NOT enforce (clip × property) compatibility — that is the renderer's job.
 */
export function interpolateProperty(
  keyframes: readonly Keyframe[] | undefined,
  property: KeyframeProperty,
  currentTime: number,
): number | null {
  if (!keyframes || keyframes.length === 0) return null;
  const filtered = keyframes
    .filter((k) => k.property === property)
    .slice()
    .sort((a, b) => a.time - b.time);
  if (filtered.length === 0) return null;

  if (currentTime <= filtered[0].time) return filtered[0].value;
  const last = filtered[filtered.length - 1];
  if (currentTime >= last.time) return last.value;

  // Find the segment [a, b] containing currentTime. Linear scan is fine — a clip
  // typically has < 20 keyframes per property; binary search is overkill.
  for (let i = 0; i < filtered.length - 1; i++) {
    const a = filtered[i];
    const b = filtered[i + 1];
    if (currentTime >= a.time && currentTime <= b.time) {
      const dt = b.time - a.time;
      // Defensive: two keyframes at the same time → step to b's value.
      if (dt <= 0) return b.value;
      const tNorm = (currentTime - a.time) / dt;
      const eased = applyEasing(a.easing, tNorm);
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value; // unreachable given the clamp branches above
}

/**
 * Idempotent insert: replaces an existing entry at `(property, time ± KEYFRAME_TIME_EPSILON)`,
 * otherwise inserts the new entry and re-sorts the array by `(property, time)`. D4 contract:
 * adding twice at the same (property, time) yields the second value, never duplicates.
 *
 * Returns a new array — never mutates the input.
 */
export function addOrReplaceKeyframe(
  keyframes: readonly Keyframe[] | undefined,
  next: Keyframe,
): Keyframe[] {
  const arr = keyframes ? keyframes.slice() : [];
  const idx = arr.findIndex(
    (k) =>
      k.property === next.property &&
      Math.abs(k.time - next.time) < KEYFRAME_TIME_EPSILON,
  );
  if (idx >= 0) {
    arr[idx] = next;
    return arr;
  }
  arr.push(next);
  arr.sort((a, b) =>
    a.property === b.property
      ? a.time - b.time
      : a.property.localeCompare(b.property),
  );
  return arr;
}

/**
 * Partition + rebase a clip's keyframes when the clip is split at clip-local
 * time `localSplit` (#46).
 *
 * Keyframe `time` is clip-local seconds measured from the clip's timeline start
 * (each renderer mounts the clip in a `<Sequence from={trackOffset}>` and reads
 * `useCurrentFrame()`, which resets to 0). So splitting at timeline `atSec`
 * means `localSplit = atSec - clip.trackOffset` for video / audio / overlay
 * alike. The previous `{ ...orig }` shallow copy carried the WHOLE array into
 * both halves unrebased, so child B fired child A's keyframes at the wrong
 * clip-local times and never reached the late ones — every split of an animated
 * clip corrupted both halves.
 *
 * For each property that has keyframes we:
 *   - keep the keyframes strictly before the split in `a` and those strictly
 *     after in `b` (rebased by `-localSplit` back to clip-local 0);
 *   - insert a BOUNDARY keyframe at the split (value = the original curve's
 *     interpolated value there) into both halves — `a` at `localSplit`, `b` at
 *     `0`. This preserves C0 continuity (no jump at the cut) and pins each
 *     half's held value instead of letting it fall back to the clip's static
 *     transform. For the default `linear` easing the reconstruction is exact:
 *     a line split into two sub-segments is still the same line. For a manually
 *     eased segment the boundary keeps endpoints exact and the interior is a
 *     close approximation (perfect easing subdivision would need De Casteljau).
 *
 * Boundary easing: child B's `time:0` keyframe inherits the easing of the
 * segment the split fell inside (the easing of the last keyframe at/under the
 * split), so the leading sub-segment keeps the original segment's character.
 * Child A's boundary is terminal, so its easing is irrelevant (kept linear).
 *
 * Returns fresh arrays; never mutates the input. Empty/undefined input → empty
 * halves (text clips carry no keyframes — D8 — so this is a harmless no-op).
 */
export function splitKeyframesAtLocal(
  keyframes: readonly Keyframe[] | undefined,
  localSplit: number,
): { a: Keyframe[]; b: Keyframe[] } {
  if (!keyframes || keyframes.length === 0) return { a: [], b: [] };
  const a: Keyframe[] = [];
  const b: Keyframe[] = [];
  const properties = [...new Set(keyframes.map((k) => k.property))];
  for (const property of properties) {
    const sorted = keyframes
      .filter((k) => k.property === property)
      .slice()
      .sort((x, y) => x.time - y.time);
    // Value of the original curve at the split (clamps outside the kf range).
    const vSplit = interpolateProperty(sorted, property, localSplit)!;
    // Easing governing the segment that contains the split = the easing of the
    // last keyframe at or before the split (the "outgoing" keyframe).
    let segEasing: KeyframeEasing = "linear";
    for (const k of sorted) {
      if (k.time <= localSplit + KEYFRAME_TIME_EPSILON) segEasing = k.easing;
    }
    // child A: keyframes strictly before the split, then the boundary at split.
    for (const k of sorted) {
      if (k.time < localSplit - KEYFRAME_TIME_EPSILON) a.push({ ...k });
    }
    a.push({ property, time: localSplit, value: vSplit, easing: "linear" });
    // child B: boundary at clip-local 0, then keyframes strictly after the
    // split rebased back to 0.
    b.push({ property, time: 0, value: vSplit, easing: segEasing });
    for (const k of sorted) {
      if (k.time > localSplit + KEYFRAME_TIME_EPSILON) {
        b.push({ ...k, time: k.time - localSplit });
      }
    }
  }
  return { a, b };
}
