import { describe, it, expect } from "vitest";
import { walkProvenance, findAssetByUri } from "./walkProvenance";
import { makeAssetGraph } from "../../../test/composition-fixtures";

describe("walkProvenance", () => {
  it("returns empty arrays when comp has no assets", () => {
    const comp = makeAssetGraph({ ids: [] });
    const result = walkProvenance(comp, "missing");
    expect(result.ancestors).toEqual([]);
    expect(result.descendants).toEqual([]);
    expect(result.siblings).toEqual([]);
  });

  it("returns empty arrays for a single root asset (no relations)", () => {
    const comp = makeAssetGraph({ ids: ["root"] });
    const result = walkProvenance(comp, "root");
    expect(result.ancestors).toEqual([]);
    expect(result.descendants).toEqual([]);
    expect(result.siblings).toEqual([]);
  });

  it("walks a linear chain A → B → C from the middle node", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c"],
      edges: [["a", "b"], ["b", "c"]],
    });
    const result = walkProvenance(comp, "b");
    expect(result.ancestors.map((a) => a.id)).toEqual(["a"]);
    expect(result.descendants.map((a) => a.id)).toEqual(["c"]);
    expect(result.siblings.map((a) => a.id)).toEqual([]);
  });

  it("finds siblings — assets sharing the same fromAssetId", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c", "d"],
      edges: [["a", "b"], ["a", "c"], ["a", "d"]],
    });
    const result = walkProvenance(comp, "b");
    expect(result.siblings.map((a) => a.id).sort()).toEqual(["c", "d"]);
  });

  it("returns empty siblings for a root asset (D5 — root assets have no siblings)", () => {
    const comp = makeAssetGraph({
      ids: ["root1", "root2", "child"],
      edges: [["root1", "child"]],
    });
    const result = walkProvenance(comp, "root1");
    // root1 and root2 both have fromAssetId === null, but per D5 we do NOT
    // treat unrelated roots as siblings.
    expect(result.siblings).toEqual([]);
  });

  it("walks descendants breadth-first across multiple levels", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c", "d"],
      edges: [["a", "b"], ["b", "c"], ["b", "d"]],
    });
    const result = walkProvenance(comp, "a");
    // BFS order: depth-1 first (b), then depth-2 (c, d). Order within a depth
    // follows the order edges appear in comp.provenance.
    expect(result.descendants.map((x) => x.id)).toEqual(["b", "c", "d"]);
  });

  it("returns empty arrays when rootAssetId is not in the comp", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    const result = walkProvenance(comp, "missing");
    expect(result).toEqual({ ancestors: [], descendants: [], siblings: [] });
  });
});

describe("findAssetByUri", () => {
  it("returns the matching AssetEntry for a known URI", () => {
    const comp = makeAssetGraph({ ids: ["alpha"] });
    // makeAssetEntry uses "/assets/<id>.png" as the default uri.
    const found = findAssetByUri(comp, "/assets/alpha.png");
    expect(found?.id).toBe("alpha");
  });

  it("returns null when no asset has that URI", () => {
    const comp = makeAssetGraph({ ids: ["alpha"] });
    expect(findAssetByUri(comp, "/nope.png")).toBeNull();
  });
});
