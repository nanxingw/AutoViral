import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  moveInOrder,
  generateScene,
  addSceneRemote,
  removeSceneRemote,
} from "./sceneEdit";

// S7 — generateScene rides the per-intent bridge (apiFetch), so mock the
// transport and assert path/method/headers/body. The pure moveInOrder tests
// below don't touch it.
const apiFetch = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

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

describe("generateScene (S7 — per-intent bridge generate/reshoot)", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true });
  });

  it("POSTs /scene/:id/generate with the work-id header and an EMPTY body", async () => {
    await generateScene("w1", "s1");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetch.mock.calls[0] as [
      string,
      { method?: string; headers?: Record<string, string>; body?: unknown },
    ];
    // Same route the agent's `autoviral scene generate <id>` CLI hits.
    expect(path).toBe("/api/bridge/v1/scene/s1/generate");
    expect(opts.method).toBe("POST");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    // The server builds the prompt from the scene's own fields — we NEVER send
    // a prompt; the body is empty.
    expect(opts.body).toEqual({});
  });

  it("propagates (does not swallow) a bridge failure so the card can surface it", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    await expect(generateScene("w1", "s1")).rejects.toThrow("boom");
  });
});

describe("addSceneRemote (T1 — per-intent bridge scene-add)", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, result: { sceneId: "scn_new" } });
  });

  it("POSTs /scene with the work-id header and the title in the body", async () => {
    await addSceneRemote("w1", { title: "Hook" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetch.mock.calls[0] as [
      string,
      { method?: string; headers?: Record<string, string>; body?: unknown },
    ];
    // Same route the agent's `autoviral scene add --title …` CLI hits.
    expect(path).toBe("/api/bridge/v1/scene");
    expect(opts.method).toBe("POST");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    expect(opts.body).toEqual({ title: "Hook" });
  });

  it("returns the minted sceneId the bridge echoes (so the card can auto-expand it)", async () => {
    const id = await addSceneRemote("w1", { title: "Hook" });
    expect(id).toBe("scn_new");
  });

  it("propagates (does not swallow) a bridge failure so the caller can surface it", async () => {
    apiFetch.mockRejectedValue(new Error("missing title"));
    await expect(addSceneRemote("w1", { title: "" })).rejects.toThrow(
      "missing title",
    );
  });
});

describe("removeSceneRemote (T1 — per-intent bridge scene-remove)", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true });
  });

  it("DELETEs /scene/:id with the work-id header and no body", async () => {
    await removeSceneRemote("w1", "s1");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetch.mock.calls[0] as [
      string,
      { method?: string; headers?: Record<string, string>; body?: unknown },
    ];
    // Same route the agent's `autoviral scene remove <id>` CLI hits.
    expect(path).toBe("/api/bridge/v1/scene/s1");
    expect(opts.method).toBe("DELETE");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    // DELETE carries no body — the id is in the path.
    expect(opts.body).toBeUndefined();
  });

  it("propagates (does not swallow) a bridge failure so the caller can surface it", async () => {
    apiFetch.mockRejectedValue(new Error("no scene with id s1"));
    await expect(removeSceneRemote("w1", "s1")).rejects.toThrow(
      "no scene with id s1",
    );
  });
});
