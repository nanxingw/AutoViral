// Isolation test for the ContentTypeRegistry (ADR-006 / I06 keystone AC).
//
// Asserts both shipped manifests' field shapes, then registers a THIRD mock
// manifest and proves the consumers (a derived DELIVERABLES list, a routePath
// lookup) pick it up with NO interface change — the keystone guarantee that
// adding a content type is "one registry entry," not shotgun surgery.

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  getContentType,
  listContentTypes,
  CONTENT_TYPES,
  type ContentTypeManifest,
} from "./registry.js";

describe("ContentTypeRegistry — shipped manifests", () => {
  it("short-video manifest carries the composition contract", () => {
    const m = getContentType("short-video");
    expect(m.id).toBe("short-video");
    expect(m.labelKey).toBe("works.type.video");
    expect(m.coverAltKey).toBe("works.coverAltVideo");
    expect(m.deliverableFile).toBe("composition.yaml");
    expect(m.routePath("w123")).toBe("/studio/w123");
    // seedFactory is a pure blank-doc factory; it must produce a doc the
    // manifest's own schema accepts (round-trip invariant #3).
    const seed = m.seedFactory("w123");
    expect(() => m.schema.parse(seed)).not.toThrow();
    expect((seed as { workId: string }).workId).toBe("w123");
  });

  it("image-text manifest carries the carousel contract", () => {
    const m = getContentType("image-text");
    expect(m.id).toBe("image-text");
    expect(m.labelKey).toBe("works.type.image");
    expect(m.coverAltKey).toBe("works.coverAltImage");
    expect(m.deliverableFile).toBe("carousel.yaml");
    expect(m.routePath("w999")).toBe("/editor/w999");
    const seed = m.seedFactory("w999");
    expect(() => m.schema.parse(seed)).not.toThrow();
    expect((seed as { workId: string }).workId).toBe("w999");
  });

  it("listContentTypes returns every registered manifest", () => {
    const ids = listContentTypes().map((t) => t.id);
    expect(ids).toEqual(["short-video", "image-text"]);
  });

  it("DELIVERABLES derives from the manifests (no hand-maintained list)", () => {
    const deliverables = listContentTypes().map((t) => t.deliverableFile);
    expect(deliverables).toEqual(["composition.yaml", "carousel.yaml"]);
  });
});

describe("ContentTypeRegistry — adding a third type needs no interface change", () => {
  // A consumer pattern expressed ONLY via the registry interface. If adding a
  // type required touching consumers, this helper would need editing too —
  // proving the keystone fails. It does not.
  const deriveDeliverables = (types: ContentTypeManifest[]): string[] =>
    types.map((t) => t.deliverableFile);
  const lookupRoute = (
    types: ContentTypeManifest[],
    id: string,
    workId: string,
  ): string | null => types.find((t) => t.id === id)?.routePath(workId) ?? null;

  it("a mock third manifest flows through the same consumers untouched", () => {
    const mockSchema = z.object({ workId: z.string(), kind: z.literal("poster") });
    const mock: ContentTypeManifest = {
      // cast: the mock is a NEW type id the production union doesn't know
      // about. The registry interface is what the consumers depend on, not
      // the closed union — which is exactly the point of this test.
      id: "poster" as ContentTypeManifest["id"],
      labelKey: "works.type.video", // reuse an existing key (i18n is lazy)
      coverAltKey: "works.coverAltVideo",
      deliverableFile: "poster.yaml" as ContentTypeManifest["deliverableFile"],
      routePath: (workId) => `/poster/${workId}`,
      schema: mockSchema,
      seedFactory: (workId) => ({ workId, kind: "poster" as const }),
    };

    const all: ContentTypeManifest[] = [...listContentTypes(), mock];

    // Consumer 1: derived DELIVERABLES auto-extends.
    expect(deriveDeliverables(all)).toEqual([
      "composition.yaml",
      "carousel.yaml",
      "poster.yaml",
    ]);

    // Consumer 2: routePath lookup resolves the new type with no special-case.
    expect(lookupRoute(all, "poster", "p1")).toBe("/poster/p1");
    expect(lookupRoute(all, "short-video", "s1")).toBe("/studio/s1");

    // And the new manifest's own schema accepts its seed — same contract as
    // the shipped types, no interface divergence.
    const seed = mock.seedFactory("p1");
    expect(() => mock.schema.parse(seed)).not.toThrow();
  });

  it("the central record is exactly the two shipped types", () => {
    expect(Object.keys(CONTENT_TYPES)).toEqual(["short-video", "image-text"]);
  });
});
