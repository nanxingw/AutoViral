import { describe, it, expect } from "vitest";
import { moveInOrder } from "./sceneEdit";

// S4 (PRD-0007) — the PURE reorder computation. Both the move-up/down buttons
// and the drag handler reduce a gesture to (fromIndex, toIndex) and call this;
// the result is sent verbatim to the bridge `/scene/reorder` as the complete
// expected order. Locking it here keeps the order math out of the React layer.

describe("moveInOrder (S4 reorder math)", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an item UP one slot (down-index)", () => {
    // move 'c' (idx 2) up to idx 1 → a, c, b, d
    expect(moveInOrder(ids, 2, 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves an item DOWN one slot (up-index)", () => {
    // move 'b' (idx 1) down to idx 2 → a, c, b, d
    expect(moveInOrder(ids, 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves to the very front", () => {
    expect(moveInOrder(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("moves to the very end", () => {
    expect(moveInOrder(ids, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("returns the SAME reference (no-op) when from === to", () => {
    expect(moveInOrder(ids, 1, 1)).toBe(ids);
  });

  it("returns the SAME reference when from is out of bounds", () => {
    expect(moveInOrder(ids, -1, 0)).toBe(ids);
    expect(moveInOrder(ids, 4, 0)).toBe(ids);
  });

  it("returns the SAME reference when to is out of bounds", () => {
    expect(moveInOrder(ids, 0, -1)).toBe(ids);
    expect(moveInOrder(ids, 0, 4)).toBe(ids);
  });

  it("always returns a complete permutation (same set, same length)", () => {
    const out = moveInOrder(ids, 2, 0);
    expect(out).toHaveLength(ids.length);
    expect([...out].sort()).toEqual([...ids].sort());
  });

  it("does not mutate the input array", () => {
    const input = ["x", "y", "z"];
    const copy = [...input];
    moveInOrder(input, 0, 2);
    expect(input).toEqual(copy);
  });
});
