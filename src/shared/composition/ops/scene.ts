// ADR-009 — scene ops: the intent-level mutations for the v0.1.6 分镜 /
// storyboard planning layer (PRD-0007). These five verbs are the SINGLE source
// of truth that the Studio store (immer draft), the bridge read-modify-write
// path (`POST /scene`, …) and the `autoviral scene …` CLI all consume — an
// agent adding a shot via the CLI and a human editing a card in the panel
// converge on the same `comp.scenes` record.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp` or
// `comp.scenes` with a fresh object/array (that breaks the immer draft proxy
// on the store side). `comp.scenes` is OPTIONAL on the schema, so addScene
// lazily seeds it with `comp.scenes ??= []` (still in place — it assigns the
// missing slot once, then keeps that array's identity for every later op). We
// push/splice the EXISTING array so it keeps its identity. No fs / http here,
// and no CompositionSchema.parse (the bridge chokepoint validates on write —
// CompositionWriteSchema; the store validates at its existing moments).
// Illegal params throw CompositionOpError{code:4}.
//
// `order` is owned ENTIRELY by these ops: addScene auto-assigns it, reorder /
// remove recompact it contiguous 0..N-1. Callers (CLI / bridge / store) NEVER
// pass `order` — that is the keystone the S1 single test locks (a scene added
// without an order still parses under the strict write schema).

import { newSceneId, type Composition, type Scene } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

// Recompact scene order so the array sorted by order is contiguous 0..N-1.
// Mirrors track.ts's `recompactDisplayOrder` (the contiguous-order invariant
// lives in one shape across track + scene). Sort a shallow copy, then assign
// fresh indices in place onto the EXISTING scene objects (ties resolve by
// current array position via the stable sort).
function recompactSceneOrder(scenes: Scene[]): void {
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  sorted.forEach((s, i) => {
    s.order = i;
  });
}

// The subset of scene fields a caller may set at creation time. `order` is
// excluded on purpose — addScene owns it. `id` / `status` / `generatedAssetIds`
// are managed by the op too (minted / defaulted).
export interface AddScenePayload {
  title: string;
  intent?: Scene["intent"];
  prompt?: string;
  narration?: string;
  durationSec?: number;
  shotSize?: Scene["shotSize"];
  cameraMovement?: Scene["cameraMovement"];
  mdAnchor?: string;
  memberClipIds?: string[];
  memberAssetIds?: string[];
}

/**
 * Append a new scene (分镜 / storyboard shot) to `comp`. Mints a fresh `scn_`
 * id, auto-assigns `order = max(existing order) + 1` (0 when there are no
 * scenes yet), and seeds the generation-handoff state (`status: "planned"`,
 * `generatedAssetIds: []`). Callers MUST NOT pass `order` — it is owned here.
 *
 * `comp.scenes` is optional on the schema; if absent it is lazily seeded with
 * an empty array (in place) before the push, so the array identity is stable
 * from this point on.
 *
 * Returns the minted `sceneId` so callers (UI, CLI, tests) can immediately
 * reference the new shot.
 */
export function addScene(
  comp: Composition,
  p: AddScenePayload,
): { sceneId: string } {
  // Lazily seed the optional scenes array IN PLACE (never reassign once present
  // — this is the only assignment, and it only fires when the slot is missing).
  comp.scenes ??= [];

  const id = newSceneId();
  const order =
    comp.scenes.length === 0
      ? 0
      : Math.max(...comp.scenes.map((s) => s.order)) + 1;

  const scene: Scene = {
    id,
    order,
    title: p.title,
    memberClipIds: p.memberClipIds ?? [],
    memberAssetIds: p.memberAssetIds ?? [],
    generatedAssetIds: [],
    status: "planned",
    ...(p.intent !== undefined ? { intent: p.intent } : {}),
    ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
    ...(p.narration !== undefined ? { narration: p.narration } : {}),
    ...(p.durationSec !== undefined ? { durationSec: p.durationSec } : {}),
    ...(p.shotSize !== undefined ? { shotSize: p.shotSize } : {}),
    ...(p.cameraMovement !== undefined
      ? { cameraMovement: p.cameraMovement }
      : {}),
    ...(p.mdAnchor !== undefined ? { mdAnchor: p.mdAnchor } : {}),
  };

  // Push onto the EXISTING scenes array — keep its identity (decision #1).
  comp.scenes.push(scene);

  return { sceneId: id };
}

// The fields setSceneProps may patch. `id` and `order` are excluded on
// purpose: `id` is immutable; `order` is owned by reorderScenes. Asset / status
// state is owned by linkSceneAssets, so it is excluded here too.
//
// CLEAR PROTOCOL (PATCH semantics): a key ABSENT (or `undefined`) means "leave
// this field unchanged"; a key set to `null` means "clear this optional field"
// (delete it so it round-trips as absent). The optional fields therefore accept
// `| null`. `title` is required by the schema, so it is NOT clearable.
export interface SetScenePropsPatch {
  title?: string;
  intent?: Scene["intent"] | null;
  prompt?: string | null;
  narration?: string | null;
  durationSec?: number | null;
  shotSize?: Scene["shotSize"] | null;
  cameraMovement?: Scene["cameraMovement"] | null;
  mdAnchor?: string | null;
  memberClipIds?: string[];
  memberAssetIds?: string[];
}

// RUNTIME allowlist of settable keys — the single source of truth the patch
// loop enforces. `SetScenePropsPatch` only excludes `id`/`order`/`status`/
// asset-state at COMPILE time, but the bridge does an UNTYPED read-modify-write
// of agent-supplied JSON (`POST /scene/:id { props }`). Without this allowlist a
// payload like `{ props: { order: 99, id: "x", status: "generated" } }` would
// clobber `order` (breaking the contiguous-0..N-1 invariant reorderScenes owns),
// reassign the immutable `id`, or hijack the generation-handoff status that
// linkSceneAssets owns. Each invariant has exactly one op entry point; this set
// keeps setSceneProps from being a back door into the others.
const SETTABLE_SCENE_KEYS: ReadonlySet<string> = new Set([
  "title",
  "intent",
  "prompt",
  "narration",
  "durationSec",
  "shotSize",
  "cameraMovement",
  "mdAnchor",
  "memberClipIds",
  "memberAssetIds",
]);

// S7 (PRD-0007) — the subset of editable fields that DRIVE the generated pixels.
// Editing any of these on a scene whose status is "generated" invalidates the
// rendered asset, so setSceneProps flips status → "stale" (the card then offers
// a reshoot). `title` / `durationSec` / `mdAnchor` / member* are deliberately
// excluded: they change metadata/layout, not the prompt the next reshoot feeds
// the provider. Kept inside the op (not the route) so the bridge PATCH, the CLI
// `scene set`, and the store all get identical stale semantics (ADR-009).
const GENERATION_AFFECTING_KEYS = [
  "prompt",
  "narration",
  "shotSize",
  "cameraMovement",
] as const;

/**
 * Patch editable fields on the scene `sceneId` in place. `id` / `order` cannot
 * be changed through here (order is reorderScenes' job). Only keys actually
 * present in `props` are written, so a partial patch leaves siblings untouched.
 *
 * Throws `CompositionOpError{code:4}` when no scene matches `sceneId`.
 */
export function setSceneProps(
  comp: Composition,
  p: { sceneId: string; props: SetScenePropsPatch },
): void {
  const scene = comp.scenes?.find((s) => s.id === p.sceneId);
  if (!scene) {
    throw new CompositionOpError(
      `setSceneProps: no scene with id ${p.sceneId}`,
      4,
    );
  }
  // Assign each provided key in place onto the EXISTING scene object, enforcing
  // the runtime allowlist (so an untyped bridge payload can't write
  // `order`/`id`/`status`/asset-state through this door). Clear protocol:
  //  - key absent / `undefined` → leave the field unchanged (sparse patch)
  //  - key === `null`           → CLEAR the optional field (delete it so it
  //                               round-trips as absent — what the card's "—" /
  //                               emptied-input does; JSON keeps null, unlike
  //                               undefined which serializes away entirely)
  //  - any other value          → set it
  // `title` is never deleted even on null (it is schema-required); a null title
  // is ignored rather than producing an invalid scene.
  //
  // S7 stale-on-edit: snapshot the generation-affecting fields BEFORE the patch
  // loop so we can detect a real value change AFTER (a no-op patch — same value
  // — must NOT flip).
  const before: Record<string, unknown> = {};
  for (const key of GENERATION_AFFECTING_KEYS) {
    before[key] = (scene as Record<string, unknown>)[key];
  }

  for (const [key, value] of Object.entries(p.props)) {
    if (!SETTABLE_SCENE_KEYS.has(key)) continue;
    if (value === undefined) continue;
    if (value === null) {
      if (key !== "title") delete (scene as Record<string, unknown>)[key];
      continue;
    }
    (scene as Record<string, unknown>)[key] = value;
  }

  // S7 stale-on-edit: a "generated" scene whose rendered pixels are now stale
  // (one of the generation-affecting fields actually CHANGED value) flips to
  // "stale". Only generated→stale — "planned" and "stale" are left untouched,
  // and a no-op patch (same value) is a no-flip. linkSceneAssets owns the
  // reverse transition (back to "generated") when the reshoot lands.
  if (scene.status === "generated") {
    const changed = GENERATION_AFFECTING_KEYS.some(
      (key) => (scene as Record<string, unknown>)[key] !== before[key],
    );
    if (changed) scene.status = "stale";
  }
}

/**
 * Reorder scenes to the exact sequence `orderedSceneIds`, then recompact so the
 * resulting `order` is contiguous 0..N-1. `orderedSceneIds` must be a complete
 * permutation of the existing scene ids (same set, same size) — otherwise we
 * throw rather than silently drop / duplicate a scene.
 *
 * The scene objects themselves stay in their original array slots (we only
 * rewrite their `order` field); the array identity is preserved (decision #1).
 *
 * Throws `CompositionOpError{code:4}` on an id-set mismatch.
 */
export function reorderScenes(
  comp: Composition,
  p: { orderedSceneIds: string[] },
): void {
  const scenes = comp.scenes ?? [];
  const existing = new Set(scenes.map((s) => s.id));
  const requested = new Set(p.orderedSceneIds);

  const sameSize =
    p.orderedSceneIds.length === scenes.length &&
    requested.size === p.orderedSceneIds.length; // no dup ids in request
  const sameSet =
    sameSize &&
    [...existing].every((id) => requested.has(id)) &&
    [...requested].every((id) => existing.has(id));

  if (!sameSet) {
    throw new CompositionOpError(
      `reorderScenes: orderedSceneIds must be a complete permutation of existing scene ids`,
      4,
    );
  }

  // Write the requested index as each scene's order, then recompact (a no-op
  // here since the indices are already 0..N-1, but it guarantees the invariant
  // survives any future change to the assignment above — mirrors track.ts).
  p.orderedSceneIds.forEach((id, i) => {
    const scene = scenes.find((s) => s.id === id)!;
    scene.order = i;
  });
  recompactSceneOrder(scenes);
}

/**
 * Link generated assets onto the scene `sceneId` (the generation-handoff
 * write-back). Appends `assetIds` to `generatedAssetIds` (deduped, preserving
 * existing order), sets `selectedAssetId` to `p.selectedAssetId` (or the last
 * of `assetIds` by default), and flips `status` to `p.status` (default
 * `"generated"`).
 *
 * Throws `CompositionOpError{code:4}` when no scene matches `sceneId`.
 */
export function linkSceneAssets(
  comp: Composition,
  p: {
    sceneId: string;
    assetIds: string[];
    selectedAssetId?: string;
    status?: "planned" | "generated" | "stale";
  },
): void {
  const scene = comp.scenes?.find((s) => s.id === p.sceneId);
  if (!scene) {
    throw new CompositionOpError(
      `linkSceneAssets: no scene with id ${p.sceneId}`,
      4,
    );
  }
  // generatedAssetIds has a schema default of [], but a hand-built scene object
  // (or an older record) might not carry it — guard so we never push onto
  // undefined.
  if (!scene.generatedAssetIds) scene.generatedAssetIds = [];
  const present = new Set(scene.generatedAssetIds);
  for (const id of p.assetIds) {
    if (!present.has(id)) {
      scene.generatedAssetIds.push(id);
      present.add(id);
    }
  }
  scene.selectedAssetId =
    p.selectedAssetId ?? p.assetIds[p.assetIds.length - 1];
  scene.status = p.status ?? "generated";
}

/**
 * Remove the scene `sceneId` from `comp` and recompact order to contiguous
 * 0..N-1. We `splice` the EXISTING `comp.scenes` array so it keeps its identity
 * (decision #1).
 *
 * Throws `CompositionOpError{code:4}` when no scene matches `sceneId`.
 */
export function removeScene(
  comp: Composition,
  p: { sceneId: string },
): void {
  const scenes = comp.scenes ?? [];
  const idx = scenes.findIndex((s) => s.id === p.sceneId);
  if (idx < 0) {
    throw new CompositionOpError(
      `removeScene: no scene with id ${p.sceneId}`,
      4,
    );
  }
  scenes.splice(idx, 1);
  recompactSceneOrder(scenes);
}
