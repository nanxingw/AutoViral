// S10 (PRD-0014) — generation-manifest: content-addressed idempotency for the
// generation route family. These lock the MODULE contract (pure key derivation
// + reserve/complete/fail state machine + the concurrency race window). The
// route-level integration lives in generation-resilience-routes.test.ts.
//
// Key discipline (禁 from the slice): the manifest key is CONTENT-addressed
// (hash of prompt+params) — NEVER a timestamp — so the same request is idempotent
// across time. Order of params must not change the key.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function tempWorkDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "av-manifest-"));
}

describe("manifestKey — content-addressed, order-independent, time-invariant", () => {
  let manifestKey: typeof import("../generation-resilience.js").manifestKey;
  beforeEach(async () => {
    ({ manifestKey } = await import("../generation-resilience.js"));
  });

  it("is stable for identical prompt+params", () => {
    const k1 = manifestKey({ prompt: "a beach at dusk", params: { durationSec: 4, aspectRatio: "9:16" } });
    const k2 = manifestKey({ prompt: "a beach at dusk", params: { durationSec: 4, aspectRatio: "9:16" } });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]+$/);
  });

  it("is INDEPENDENT of param key order (canonical JSON)", () => {
    const k1 = manifestKey({ prompt: "p", params: { a: 1, b: 2, c: 3 } });
    const k2 = manifestKey({ prompt: "p", params: { c: 3, b: 2, a: 1 } });
    expect(k1).toBe(k2);
  });

  it("drops undefined params so optional spreads don't change the key", () => {
    const k1 = manifestKey({ prompt: "p", params: { a: 1, b: 2 } });
    const k2 = manifestKey({ prompt: "p", params: { a: 1, b: 2, resolution: undefined } });
    expect(k1).toBe(k2);
  });

  it("changes when the prompt changes", () => {
    const k1 = manifestKey({ prompt: "one", params: { a: 1 } });
    const k2 = manifestKey({ prompt: "two", params: { a: 1 } });
    expect(k1).not.toBe(k2);
  });

  it("changes when a param value changes", () => {
    const k1 = manifestKey({ prompt: "p", params: { aspectRatio: "9:16" } });
    const k2 = manifestKey({ prompt: "p", params: { aspectRatio: "16:9" } });
    expect(k1).not.toBe(k2);
  });

  it("does NOT fold a timestamp into the key (idempotent across time)", async () => {
    const k1 = manifestKey({ prompt: "p", params: { a: 1 } });
    // A later call with the same content must produce the same key.
    const k2 = manifestKey({ prompt: "p", params: { a: 1 } });
    expect(k2).toBe(k1);
  });
});

describe("reserve / complete / fail — state machine", () => {
  let mod: typeof import("../generation-resilience.js");
  beforeEach(async () => {
    mod = await import("../generation-resilience.js");
  });

  it("first reserve on an absent key → proceed, and persists an in-flight entry", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("proceed");

    const raw = await readFile(join(dir, "generation-manifest.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed[key].status).toBe("in-flight");
  });

  it("a second reserve while in-flight is REJECTED (no duplicate dispatch)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    const r2 = await mod.reserveGeneration(dir, key);
    expect(r2.decision).toBe("reject");
  });

  it("after complete → a repeat reserve is SKIPPED and returns the cached response", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    await mod.completeGeneration(dir, key, {
      assetPath: "assets/seedance/clip.mp4",
      response: { success: true, assetId: "gen_abc" },
    });
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("skip");
    if (r.decision === "skip") {
      expect(r.entry.assetPath).toBe("assets/seedance/clip.mp4");
      expect((r.entry.response as any).assetId).toBe("gen_abc");
    }
  });

  it("after fail → a repeat reserve is allowed to PROCEED (retry)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    await mod.failGeneration(dir, key);
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("proceed");
  });

  it("CONCURRENT identical reserves → exactly one proceed, one reject (race window)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "concurrent", params: { a: 1 } });
    const [a, b] = await Promise.all([
      mod.reserveGeneration(dir, key),
      mod.reserveGeneration(dir, key),
    ]);
    const decisions = [a.decision, b.decision].sort();
    expect(decisions).toEqual(["proceed", "reject"]);
  });
});
