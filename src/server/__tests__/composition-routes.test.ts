import { describe, it, expect } from "vitest";
import { CompositionSchema } from "../../shared/composition.js";

// Schema-level guards covering the 400 paths added in Task 1.9 to
// PUT /api/works/:id/composition (I-1) and POST /api/works/:id/render (I-2).
// These tests pin the contract that the route handlers depend on:
// `safeParse` returns `success:false` with non-empty `issues[]` for malformed
// input, and applies defaults (assets/provenance) on success.
describe("CompositionSchema validation guards", () => {
  it("PUT composition rejects bodies missing required fields (would cause 400)", () => {
    const malformed = { id: "c", workId: "w" }; // missing fps/width/height/duration/aspect/tracks/updatedAt
    const r = CompositionSchema.safeParse(malformed);
    expect(r.success).toBe(false);
    if (!r.success) {
      // Verify Zod surfaces useful info (used as the 400 issues array)
      expect(r.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("PUT composition accepts a complete shape (would NOT 400)", () => {
    const r = CompositionSchema.safeParse({
      id: "c",
      workId: "w",
      fps: 30,
      width: 1080,
      height: 1920,
      duration: 0,
      aspect: "9:16",
      tracks: [],
      updatedAt: "2026-04-28T10:00:00Z",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Defaults applied:
      expect(r.data.assets).toEqual([]);
      expect(r.data.provenance).toEqual([]);
    }
  });
});
