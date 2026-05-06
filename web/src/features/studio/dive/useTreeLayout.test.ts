import { describe, it, expect } from "vitest";
import { useTreeLayout } from "./useTreeLayout";

describe("useTreeLayout", () => {
  it("returns an empty map for an empty graph", () => {
    const positions = useTreeLayout([], []);
    expect(positions.size).toBe(0);
  });

  it("places a single node at a stable position", () => {
    const positions = useTreeLayout(
      [{ id: "a", width: 180, height: 120 }],
      [],
    );
    expect(positions.has("a")).toBe(true);
    const p = positions.get("a")!;
    expect(typeof p.x).toBe("number");
    expect(typeof p.y).toBe("number");
  });

  it("places a chain A → B → C with monotonically increasing x (LR rankdir)", () => {
    const positions = useTreeLayout(
      [
        { id: "a", width: 180, height: 120 },
        { id: "b", width: 180, height: 120 },
        { id: "c", width: 180, height: 120 },
      ],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );
    const xa = positions.get("a")!.x;
    const xb = positions.get("b")!.x;
    const xc = positions.get("c")!.x;
    expect(xa).toBeLessThan(xb);
    expect(xb).toBeLessThan(xc);
  });

  it("siblings (A → B; A → C) sit at the same depth (same x), different y", () => {
    const positions = useTreeLayout(
      [
        { id: "a", width: 180, height: 120 },
        { id: "b", width: 180, height: 120 },
        { id: "c", width: 180, height: 120 },
      ],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ],
    );
    const xb = positions.get("b")!.x;
    const xc = positions.get("c")!.x;
    expect(xb).toBeCloseTo(xc, 0);
    const yb = positions.get("b")!.y;
    const yc = positions.get("c")!.y;
    expect(yb).not.toBeCloseTo(yc, 0);
  });

  it("returns a stable layout — same input → same output", () => {
    const inputNodes = [
      { id: "a", width: 180, height: 120 },
      { id: "b", width: 180, height: 120 },
    ];
    const inputEdges = [{ source: "a", target: "b" }];
    const a = useTreeLayout(inputNodes, inputEdges);
    const b = useTreeLayout(inputNodes, inputEdges);
    for (const id of ["a", "b"]) {
      expect(a.get(id)).toEqual(b.get(id));
    }
  });
});
