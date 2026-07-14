// PRD-0014 S14 — the ORDERED effect-stack op family, lifted into the shared
// composition-ops core so the Studio Inspector's effects list (store actions) and
// the bridge/CLI (`autoviral clip effects add|remove|reorder|toggle|set`) consume
// THESE five implementations — an agent editing an effect chain and a human
// dragging one in the Inspector converge byte-for-byte. Mirrors the OpenCut
// command族 (docs/竞品/OpenCut-pre-rewrite/.../commands/timeline/element/effects/).
//
// Decision (ADR-009): mutate `comp` IN PLACE — seed the `effects` array on the
// EXISTING clip object if missing (identity survives the immer draft proxy on the
// store side), then push/splice the EXISTING array so it keeps its identity. No
// fs / http and no CompositionSchema.parse. ALL validation happens BEFORE the
// single mutation so a rejected call leaves `comp` byte-identical (atomic).
// Illegal params throw CompositionOpError{code:4}.
//
// Effects live on VIDEO and ADJUSTMENT clips (the two kinds that carry a stack);
// audio/text/overlay have no effect stack and are a code:4 rejection.

import type { Composition, Clip, Effect, EffectType } from "../../composition.js";
import { EFFECT_TYPES, newEffectId } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

// The clip kinds that carry an `effects` stack.
type EffectClip = Extract<Clip, { kind: "video" | "adjustment" }>;

function locateEffectClip(comp: Composition, clipId: string): EffectClip {
  for (const track of comp.tracks) {
    const c = (track.clips as Clip[]).find((c) => c.id === clipId);
    if (!c) continue;
    if (c.kind !== "video" && c.kind !== "adjustment") {
      throw new CompositionOpError(
        `effects: clip ${clipId} is a ${c.kind} clip — only video/adjustment clips carry an effect stack`,
        4,
      );
    }
    return c as EffectClip;
  }
  throw new CompositionOpError(`effects: no clip with id ${clipId}`, 4);
}

// Seed + return the EXISTING clip's effects array (keeps identity).
function effectsArrayOf(clip: EffectClip): Effect[] {
  if (!clip.effects) {
    (clip as { effects: Effect[] }).effects = [];
  }
  return clip.effects!;
}

function findEffectIndex(arr: Effect[], effectId: string, verb: string): number {
  const idx = arr.findIndex((e) => e.id === effectId);
  if (idx < 0) {
    throw new CompositionOpError(`${verb}: no effect with id ${effectId} on this clip`, 4);
  }
  return idx;
}

/**
 * Append (or insert at `index`) a new effect of `type` onto `clipId`'s stack.
 * Mints + returns the effect id. `params` defaults to `{}`, `enabled` to true.
 *
 * Throws `CompositionOpError{code:4}` when the clip is missing / not an
 * effect-bearing kind, or `type` is not a built-in effect type.
 */
export function addEffect(
  comp: Composition,
  p: { clipId: string; type: EffectType; params?: Record<string, unknown>; enabled?: boolean; index?: number },
): { effectId: string } {
  if (!EFFECT_TYPES.includes(p.type)) {
    throw new CompositionOpError(`addEffect: unknown effect type ${String(p.type)}`, 4);
  }
  const clip = locateEffectClip(comp, p.clipId);
  const arr = effectsArrayOf(clip);
  const effect: Effect = {
    id: newEffectId(),
    type: p.type,
    params: p.params ? { ...p.params } : {},
    enabled: p.enabled ?? true,
  };
  if (p.index !== undefined) {
    const at = Math.min(Math.max(0, Math.floor(p.index)), arr.length);
    arr.splice(at, 0, effect);
  } else {
    arr.push(effect);
  }
  return { effectId: effect.id };
}

/**
 * Remove the effect `effectId` from `clipId`'s stack (in place — array identity
 * survives). Throws code:4 when the clip / effect is missing.
 */
export function removeEffect(comp: Composition, p: { clipId: string; effectId: string }): void {
  const clip = locateEffectClip(comp, p.clipId);
  const arr = effectsArrayOf(clip);
  const idx = findEffectIndex(arr, p.effectId, "removeEffect");
  arr.splice(idx, 1);
}

/**
 * Move the effect `effectId` to `toIndex` in `clipId`'s stack. `toIndex` is
 * clamped into range so a stale UI index never tears the array. In place.
 */
export function reorderEffect(
  comp: Composition,
  p: { clipId: string; effectId: string; toIndex: number },
): void {
  const clip = locateEffectClip(comp, p.clipId);
  const arr = effectsArrayOf(clip);
  const from = findEffectIndex(arr, p.effectId, "reorderEffect");
  const to = Math.min(Math.max(0, Math.floor(p.toIndex)), arr.length - 1);
  if (to === from) return;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
}

/**
 * Toggle (or set) the `enabled` flag of effect `effectId`. Omit `enabled` to
 * flip the current value. In place — mutates the EXISTING effect object.
 */
export function toggleEffect(
  comp: Composition,
  p: { clipId: string; effectId: string; enabled?: boolean },
): void {
  const clip = locateEffectClip(comp, p.clipId);
  const arr = effectsArrayOf(clip);
  const idx = findEffectIndex(arr, p.effectId, "toggleEffect");
  arr[idx].enabled = p.enabled ?? !arr[idx].enabled;
}

/**
 * Merge `params` into effect `effectId`'s params (SPREAD-GUARD — sibling keys
 * survive, #81 教训). In place — mutates the EXISTING effect object.
 */
export function updateEffectParams(
  comp: Composition,
  p: { clipId: string; effectId: string; params: Record<string, unknown> },
): void {
  const clip = locateEffectClip(comp, p.clipId);
  const arr = effectsArrayOf(clip);
  const idx = findEffectIndex(arr, p.effectId, "updateEffectParams");
  arr[idx].params = { ...arr[idx].params, ...p.params };
}
