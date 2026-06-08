import { describe, it, expect } from "vitest";
import {
  CompositionWriteSchema,
  type Composition,
  type Scene,
  type Track,
} from "../../composition.js";
import {
  addScene,
  setSceneProps,
  reorderScenes,
  linkSceneAssets,
  removeScene,
} from "./scene.js";
import { CompositionOpError } from "./errors.js";

// Minimal composition. Scene ops are pure in-place mutators (ADR-009 #2) so we
// normally never run a zod parse here — BUT one keystone assertion DOES, to
// prove a scene minted without an explicit `order` survives the strict
// write-path validator. That means this fixture must be a FULLY VALID
// composition (all required keys: id/workId/fps/width/height/duration/aspect/
// tracks/updatedAt) and carry NO extra keys (CompositionWriteSchema is
// `.strict()`). We mirror track.test.ts's track helper + default lane layout.
function track(
  id: string,
  kind: Track["kind"],
  displayOrder: number,
  clips: unknown[] = [],
): unknown {
  return {
    id,
    kind,
    label: id,
    displayOrder,
    volume: 0,
    muted: false,
    hidden: false,
    clips,
    transitions: [],
  };
}

function compWith(scenes?: unknown[]): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 0,
    aspect: "9:16",
    updatedAt: "2026-06-08T00:00:00.000Z",
    tracks: [
      track("trk_v0", "video", 0),
      track("trk_a1", "audio", 1),
      track("trk_cc", "text", 2),
    ],
    assets: [],
    provenance: [],
    exportPresets: [],
    ...(scenes !== undefined ? { scenes } : {}),
  } as unknown as Composition;
}

// Reach into the (possibly undefined) scenes array as the test sees it.
function scenes(comp: Composition): Scene[] {
  return (comp.scenes ?? []) as Scene[];
}

function sceneOrders(comp: Composition): number[] {
  return scenes(comp)
    .map((s) => s.order)
    .sort((a, b) => a - b);
}

function assertContiguous(comp: Composition) {
  const orders = sceneOrders(comp);
  expect(orders).toEqual(orders.map((_, i) => i));
}

describe("ops.addScene", () => {
  it("assigns order 0 to the first scene when scenes is undefined, and inits status/generatedAssetIds", () => {
    const comp = compWith(); // no scenes key at all (0.1.5-shaped)
    const { sceneId } = addScene(comp, { title: "Hook" });
    expect(sceneId).toBeTruthy();
    expect(sceneId).toMatch(/^scn_/);
    expect(comp.scenes).toBeDefined();
    const s = scenes(comp).find((x) => x.id === sceneId)!;
    expect(s.order).toBe(0);
    expect(s.title).toBe("Hook");
    expect(s.status).toBe("planned");
    expect(s.generatedAssetIds).toEqual([]);
  });

  it("assigns order = max(existing order)+1 on a non-empty scenes array", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
      { id: "scn_b", order: 1, title: "B", status: "planned", generatedAssetIds: [] },
    ]);
    const { sceneId } = addScene(comp, { title: "C" });
    const s = scenes(comp).find((x) => x.id === sceneId)!;
    expect(s.order).toBe(2);
    assertContiguous(comp);
  });

  it("carries through the optional props it is given (intent/prompt/narration/durationSec/shotSize/cameraMovement/mdAnchor)", () => {
    const comp = compWith();
    const { sceneId } = addScene(comp, {
      title: "Payoff",
      intent: "payoff",
      prompt: "wide shot of the city",
      narration: "And then it all came together.",
      durationSec: 4,
      shotSize: "long",
      cameraMovement: "push",
      mdAnchor: "payoff-section",
      memberClipIds: ["clp_1"],
      memberAssetIds: ["ast_1"],
    });
    const s = scenes(comp).find((x) => x.id === sceneId)!;
    expect(s.intent).toBe("payoff");
    expect(s.prompt).toBe("wide shot of the city");
    expect(s.narration).toBe("And then it all came together.");
    expect(s.durationSec).toBe(4);
    expect(s.shotSize).toBe("long");
    expect(s.cameraMovement).toBe("push");
    expect(s.mdAnchor).toBe("payoff-section");
    expect(s.memberClipIds).toEqual(["clp_1"]);
    expect(s.memberAssetIds).toEqual(["ast_1"]);
  });

  // ── KEYSTONE: addScene without an explicit `order` still passes the strict
  // write-path validator. This is the regression that proves the bridge/CLI
  // never need to (and never do) pass `order` — schema acceptance on write.
  it("KEYSTONE — a comp with a scene added (no order passed) parses under CompositionWriteSchema", () => {
    const comp = compWith();
    addScene(comp, { title: "Hook", intent: "hook" });
    addScene(comp, { title: "Build" });
    // Must NOT throw.
    const parsed = CompositionWriteSchema.parse(comp);
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.scenes![0].order).toBe(0);
    expect(parsed.scenes![1].order).toBe(1);
    // Defaults materialised on parse.
    expect(parsed.scenes![0].status).toBe("planned");
    expect(parsed.scenes![0].generatedAssetIds).toEqual([]);
  });

  it("mutates comp.scenes in place — keeps the existing array identity (ADR-009 #1)", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
    ]);
    const ref = comp.scenes;
    addScene(comp, { title: "B" });
    expect(comp.scenes).toBe(ref);
  });

  // The riskiest immer transition: the FIRST addScene lazily seeds `comp.scenes`
  // (undefined → []) via `??=`. Prove that the seeded array — not a fresh one
  // each call — carries forward, so the store's immer draft proxy stays attached.
  it("the lazily-seeded scenes array keeps identity across subsequent adds (??= seed)", () => {
    const comp = compWith(); // no scenes key — first add must seed it
    addScene(comp, { title: "A" });
    const ref = comp.scenes;
    expect(ref).toBeDefined();
    addScene(comp, { title: "B" });
    expect(comp.scenes).toBe(ref);
    expect(scenes(comp)).toHaveLength(2);
  });
});

describe("ops.setSceneProps", () => {
  it("updates editable fields (title / narration / shotSize) in place", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
    ]);
    setSceneProps(comp, {
      sceneId: "scn_a",
      props: { title: "Renamed", narration: "voiceover", shotSize: "closeup" },
    });
    const s = scenes(comp).find((x) => x.id === "scn_a")!;
    expect(s.title).toBe("Renamed");
    expect(s.narration).toBe("voiceover");
    expect(s.shotSize).toBe("closeup");
    // untouched fields stay
    expect(s.order).toBe(0);
  });

  it("throws CompositionOpError{code:4} for an unknown sceneId", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
    ]);
    try {
      setSceneProps(comp, { sceneId: "scn_nope", props: { title: "x" } });
      expect.unreachable("setSceneProps should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  // The bridge does an UNTYPED read-modify-write of agent JSON, so the compile-
  // time SetScenePropsPatch type is not a runtime guard. The op's runtime
  // allowlist must reject order/id/status/asset-state so an out-of-band payload
  // cannot break the invariants those keys' owning ops protect.
  it("ignores non-settable keys (order/id/status/generatedAssetIds) from an untyped payload — allowlist guard", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: ["ast_keep"] },
      { id: "scn_b", order: 1, title: "B", status: "planned", generatedAssetIds: [] },
    ]);
    setSceneProps(comp, {
      sceneId: "scn_a",
      // Cast through unknown to simulate the bridge's untyped JSON body.
      props: {
        title: "Renamed",
        order: 99,
        id: "scn_hacked",
        status: "generated",
        generatedAssetIds: [],
        selectedAssetId: "ast_evil",
      } as unknown as Parameters<typeof setSceneProps>[1]["props"],
    });
    const s = scenes(comp).find((x) => x.title === "Renamed")!;
    // The settable key landed…
    expect(s.title).toBe("Renamed");
    // …but every owned-by-another-op key was rejected.
    expect(s.id).toBe("scn_a");
    expect(s.order).toBe(0);
    expect(s.status).toBe("planned");
    expect(s.generatedAssetIds).toEqual(["ast_keep"]);
    expect(s.selectedAssetId).toBeUndefined();
    // The contiguous invariant is intact (order 99 never landed).
    assertContiguous(comp);
  });
});

describe("ops.reorderScenes", () => {
  it("rewrites order to contiguous 0..N-1 in the requested sequence", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
      { id: "scn_b", order: 1, title: "B", status: "planned", generatedAssetIds: [] },
      { id: "scn_c", order: 2, title: "C", status: "planned", generatedAssetIds: [] },
    ]);
    reorderScenes(comp, { orderedSceneIds: ["scn_c", "scn_a", "scn_b"] });
    const byId = (id: string) => scenes(comp).find((s) => s.id === id)!;
    expect(byId("scn_c").order).toBe(0);
    expect(byId("scn_a").order).toBe(1);
    expect(byId("scn_b").order).toBe(2);
    assertContiguous(comp);
  });

  // Seed NON-contiguous orders (0/5/10) so the recompactSceneOrder safety net in
  // the reorder path is actually exercised — a broken recompact here would leave
  // a gap and fail assertContiguous. (The happy-path test above seeds already-
  // contiguous orders, where recompact is a provable no-op.)
  it("recompacts a gapped order set to contiguous 0..N-1 (reorder-path recompact guard)", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
      { id: "scn_b", order: 5, title: "B", status: "planned", generatedAssetIds: [] },
      { id: "scn_c", order: 10, title: "C", status: "planned", generatedAssetIds: [] },
    ]);
    reorderScenes(comp, { orderedSceneIds: ["scn_b", "scn_c", "scn_a"] });
    const byId = (id: string) => scenes(comp).find((s) => s.id === id)!;
    expect(byId("scn_b").order).toBe(0);
    expect(byId("scn_c").order).toBe(1);
    expect(byId("scn_a").order).toBe(2);
    assertContiguous(comp);
  });

  it("throws CompositionOpError{code:4} when the id set does not match existing scenes", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
      { id: "scn_b", order: 1, title: "B", status: "planned", generatedAssetIds: [] },
    ]);
    try {
      reorderScenes(comp, { orderedSceneIds: ["scn_a", "scn_nope"] });
      expect.unreachable("reorderScenes should have thrown on id mismatch");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });
});

describe("ops.linkSceneAssets", () => {
  it("appends (deduped) generatedAssetIds, sets selectedAssetId default to last, flips status to generated", () => {
    const comp = compWith([
      {
        id: "scn_a",
        order: 0,
        title: "A",
        status: "planned",
        generatedAssetIds: ["ast_old"],
      },
    ]);
    linkSceneAssets(comp, {
      sceneId: "scn_a",
      assetIds: ["ast_old", "ast_1", "ast_2"],
    });
    const s = scenes(comp).find((x) => x.id === "scn_a")!;
    // dedup: ast_old already present, only ast_1/ast_2 appended
    expect(s.generatedAssetIds).toEqual(["ast_old", "ast_1", "ast_2"]);
    expect(s.selectedAssetId).toBe("ast_2");
    expect(s.status).toBe("generated");
  });

  it("honours an explicit selectedAssetId and status override", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
    ]);
    linkSceneAssets(comp, {
      sceneId: "scn_a",
      assetIds: ["ast_1", "ast_2"],
      selectedAssetId: "ast_1",
      status: "stale",
    });
    const s = scenes(comp).find((x) => x.id === "scn_a")!;
    expect(s.selectedAssetId).toBe("ast_1");
    expect(s.status).toBe("stale");
  });

  it("throws CompositionOpError{code:4} when the scene does not exist", () => {
    const comp = compWith([]);
    try {
      linkSceneAssets(comp, { sceneId: "scn_nope", assetIds: ["ast_1"] });
      expect.unreachable("linkSceneAssets should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });
});

describe("ops.removeScene", () => {
  it("removes the scene and recompacts order to contiguous 0..N-1", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
      { id: "scn_b", order: 1, title: "B", status: "planned", generatedAssetIds: [] },
      { id: "scn_c", order: 2, title: "C", status: "planned", generatedAssetIds: [] },
    ]);
    removeScene(comp, { sceneId: "scn_b" });
    expect(scenes(comp).some((s) => s.id === "scn_b")).toBe(false);
    expect(scenes(comp)).toHaveLength(2);
    assertContiguous(comp);
  });

  it("throws CompositionOpError{code:4} for an unknown sceneId", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
    ]);
    try {
      removeScene(comp, { sceneId: "scn_nope" });
      expect.unreachable("removeScene should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("mutates comp.scenes in place — keeps the existing array identity (ADR-009 #1)", () => {
    const comp = compWith([
      { id: "scn_a", order: 0, title: "A", status: "planned", generatedAssetIds: [] },
      { id: "scn_b", order: 1, title: "B", status: "planned", generatedAssetIds: [] },
    ]);
    const ref = comp.scenes;
    removeScene(comp, { sceneId: "scn_a" });
    expect(comp.scenes).toBe(ref);
  });
});

// ── Backward compatibility regressions (0.1.5 → v0.1.6) ──────────────────────
describe("scene backward compatibility under CompositionWriteSchema", () => {
  it("(a) a 0.1.5 work with NO scenes key parses unchanged", () => {
    const comp = compWith(); // no scenes key
    const parsed = CompositionWriteSchema.parse(comp);
    expect(parsed.scenes).toBeUndefined();
  });

  it("(b) a scene with only the old fields (id/order/title) parses and the new fields take their defaults", () => {
    const comp = compWith([{ id: "scn_old", order: 0, title: "Legacy" }]);
    const parsed = CompositionWriteSchema.parse(comp);
    const s = parsed.scenes![0];
    expect(s.id).toBe("scn_old");
    expect(s.title).toBe("Legacy");
    // new-in-v0.1.6 defaults materialise
    expect(s.generatedAssetIds).toEqual([]);
    expect(s.status).toBe("planned");
    // strictly-optional new fields stay undefined
    expect(s.narration).toBeUndefined();
    expect(s.durationSec).toBeUndefined();
    expect(s.shotSize).toBeUndefined();
    expect(s.cameraMovement).toBeUndefined();
    expect(s.selectedAssetId).toBeUndefined();
    expect(s.mdAnchor).toBeUndefined();
    // old defaulted fields still fill
    expect(s.memberClipIds).toEqual([]);
    expect(s.memberAssetIds).toEqual([]);
  });
});
