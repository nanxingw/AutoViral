// ContentTypeRegistry — the central manifest for AutoViral content types.
//
// ADR-006 (the keystone of PRD-0002 v0.1.1). Before this, the distinction
// between the two content types radiated as 34 hard-coded type-literal string
// branches across server + web: `workType !== "..."` comparisons, a
// hand-maintained `DELIVERABLES` list, route ternaries, and per-type create
// buttons. Adding a third type was shotgun surgery across 5+ files.
//
// This registry collapses that to a single central Record of manifests. Each
// manifest fully describes a content type: its i18n label keys, its single
// deliverable yaml (= its single checkpoint target), its viewer route, its
// shared zod schema, and a pure blank-doc seed factory. Consumers query the
// registry (`getContentType` / `listContentTypes`) instead of branching on
// the literal.
//
// PURE DATA + PURE FUNCTIONS ONLY (ADR-006 Decision #4): no `fs`, no
// `node:path`, no server-only imports. This is what makes the registry safe
// to import from the web bundle (via the @shared alias) AND unit-testable in
// isolation. NO runtime auto-discovery (Decision #5) — a hard-coded central
// Record of two entries; full plugin discovery is deferred to 0.2.0.

import type { z } from "zod";
import { CompositionSchema, makeEmptyComposition } from "../composition.js";
import { CarouselSchema, makeEmptyCarousel } from "../carousel.js";

/**
 * The closed set of content type ids AutoViral ships. The registry OWNS this
 * — `WorkType` derives from it, and `src/domain/work-store.ts` re-exports the
 * union for back-compat. `src/shared` must NOT import from `src/domain`; the
 * dependency points the other way.
 *
 * This is a standalone tuple (not `keyof typeof CONTENT_TYPES`) to break the
 * type cycle: `ContentTypeManifest.id` needs `WorkType`, and `CONTENT_TYPES`
 * is checked against `ContentTypeManifest` — deriving the union from the
 * record keys would reference the record in its own type annotation. The
 * `satisfies` on CONTENT_TYPES still guarantees its keys exactly match.
 */
export const WORK_TYPE_IDS = ["short-video", "image-text"] as const;

/** The work content-type union — the registry is the single source of truth. */
export type WorkType = (typeof WORK_TYPE_IDS)[number];

export interface ContentTypeManifest {
  /** Stable id, also the `work.type` discriminant. */
  id: WorkType;
  /** i18n message key for the type label (was works.type.video/image). The
   *  manifest carries the KEY, not a resolved string, so it stays safe to
   *  import from the web bundle with no runtime locale dependency (Decision
   *  #3). Typed `string` because MessageKey is a web-only type the shared
   *  layer must not depend on; web consumers cast to MessageKey at use. */
  labelKey: string;
  /** i18n message key for cover alt text (was works.coverAltVideo/Image). */
  coverAltKey: string;
  /** The single deliverable yaml for this type — also its single checkpoint
   *  target (ADR-006 Decision #2 collapsed `checkpointTargets` into this). */
  deliverableFile: "composition.yaml" | "carousel.yaml";
  /** The viewer route for a work of this type. */
  routePath: (workId: string) => string;
  /** The shared zod schema validating this type's deliverable (now both in
   *  src/shared/, symmetric — ADR-006 Decision #1). */
  schema: z.ZodType;
  /** Pure blank-doc factory (Decision #6). Returns a fresh empty doc that the
   *  manifest's own `schema` accepts. Does NOT seed at create time — works
   *  stay yaml-less until first edit; consumers (web Editor on load, future
   *  CLI) call the right factory by type. */
  seedFactory: (workId: string) => unknown;
}

/**
 * The central Record. Two entries (the video + carousel types). The insertion
 * order here is the canonical order `listContentTypes()` returns, and the
 * order `DELIVERABLES` derives in. Add a third type by adding one entry here.
 */
export const CONTENT_TYPES = {
  "short-video": {
    id: "short-video",
    labelKey: "works.type.video",
    coverAltKey: "works.coverAltVideo",
    deliverableFile: "composition.yaml",
    routePath: (workId: string) => `/studio/${workId}`,
    schema: CompositionSchema,
    seedFactory: (workId: string) => makeEmptyComposition({ workId }),
  },
  "image-text": {
    id: "image-text",
    labelKey: "works.type.image",
    coverAltKey: "works.coverAltImage",
    deliverableFile: "carousel.yaml",
    routePath: (workId: string) => `/editor/${workId}`,
    schema: CarouselSchema,
    seedFactory: (workId: string) => makeEmptyCarousel(workId),
  },
} as const satisfies Record<WorkType, ContentTypeManifest>;

/** Look up a content type's manifest by id. */
export function getContentType(id: WorkType): ContentTypeManifest {
  return CONTENT_TYPES[id];
}

/** All registered manifests, in canonical insertion order. */
export function listContentTypes(): ContentTypeManifest[] {
  return Object.values(CONTENT_TYPES);
}

/** True iff `id` is a known content type. Narrows `string` → `WorkType` at
 *  trust boundaries (HTTP body, yaml read) where the value isn't yet typed. */
export function isWorkType(id: string): id is WorkType {
  return id in CONTENT_TYPES;
}
