# ADR-006: ContentTypeRegistry — central manifest for work content types

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** nanxingw + AI design partner (grill-with-docs session)
- **Related:** [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md), [ADR-007](ADR-007-single-media-provider-registry.md)
- **Resolves:** PRD-0002 workstream W4 (深模块 ①) — the keystone HITL gate of v0.1.1

## Context

AutoViral has two content types — `short-video` (renders `composition.yaml` in Studio at `/studio/<id>`) and `image-text` (renders `carousel.yaml` in Editor at `/editor/<id>`). Today the distinction is a bare union `type WorkType = "short-video" | "image-text"` (`src/work-store.ts:12`) that radiates as **34 hard-coded string branches** across server and web: `workType !== "short-video"` comparisons, a hard-coded `DELIVERABLES = ["carousel.yaml", "composition.yaml"]` list (`src/server/checkpoints.ts:21`), `WorksGrid`'s `?'/studio/':'/editor/'` route ternary plus two more type ternaries (label key, cover-alt key), and `NewWorkCard`'s two hard-wired create buttons.

Adding a third content type today is a shotgun surgery across 5+ files. PRD-0002 frames closing this as the keystone that the rest of v0.1.1 builds on.

A grill-with-docs session on 2026-06-03 pressure-tested the PRD's recommended `ContentTypeManifest` shape against the **actual code** and surfaced three facts the PRD missed:

1. **The schemas are asymmetric.** `composition.ts`'s schema lives in `src/shared/` (reachable by server + web + CLI). But `CarouselSchema` + `makeEmptyCarousel` live in `web/src/features/editor/types.ts` — **web-only**. The server, the `autoviral` CLI, and any migration code cannot import them.
2. **There is no existing seed logic to "collect".** `createWork` (`src/work-store.ts:144`) writes **no** deliverable yaml — it only creates directories + `work.yaml`. A fresh work starts yaml-less; the deliverable is written later by the agent / ingest / first composition POST. `makeEmptyCarousel` exists but is web-side (called by the Editor on load); there is no `makeEmptyComposition` server-side.
3. **`checkpointTargets` is redundant with `deliverableFile`.** Each content type has exactly one deliverable, which is exactly its one checkpoint target. The two PRD-proposed fields are always identical.

Fact (1) is the real keystone: I08 (carousel CLI with zod validation via the bridge) and I10 (carousel migrations) are **impossible as specified** unless the carousel schema is reachable from the server. The CLI is a thin client — `autoviral clip add` round-trips through `POST /api/bridge/v1/clip` and the **server** validates against the shared `CompositionSchema` before atomic-writing. A symmetric `autoviral carousel add-slide` needs the **server** to validate against `CarouselSchema`, which today it cannot reach.

## Decision

**Introduce a central content-type registry at `src/shared/content-types/registry.ts`, and promote the carousel schema to `src/shared/` so both content types are symmetric.**

### The `ContentTypeManifest` contract

```ts
interface ContentTypeManifest {
  id: WorkType                         // "short-video" | "image-text"
  labelKey: MessageKey                 // i18n key for the type label (was works.type.video/image)
  coverAltKey: MessageKey              // i18n key for cover alt text (was works.coverAltVideo/Image)
  deliverableFile: "composition.yaml" | "carousel.yaml"  // also the single checkpoint target
  routePath: (workId: string) => string                  // /studio/<id> | /editor/<id>
  schema: z.ZodType                    // CompositionSchema | CarouselSchema (both now in src/shared/)
  seedFactory: (workId: string) => unknown               // pure blank-doc factory
}

getContentType(id: WorkType): ContentTypeManifest
listContentTypes(): ContentTypeManifest[]
```

Two entries registered in a central `Record` — `short-video` and `image-text`.

### Decisions crystallized in this ADR

1. **Promote `CarouselSchema` + layer/slide sub-schemas + `makeEmptyCarousel` to `src/shared/carousel.ts`** (pure zod + pure functions, zero web deps). `web/src/features/editor/types.ts` becomes a thin re-export shim so existing web imports keep working. This unblocks the server bridge `/carousel/*` validation (I08), migrations (I10), and a symmetric `schema` field on the manifest.

2. **Collapse `checkpointTargets` → `deliverableFile`.** A type's one deliverable *is* its one checkpoint target. `DELIVERABLES` becomes `listContentTypes().map(t => t.deliverableFile)`. If a future type ever needs multiple snapshot files, reintroduce a `checkpointTargets` field then (YAGNI now).

3. **The manifest carries i18n *keys*, not resolved strings.** Keeps i18n lazy and the manifest safe to import from the web bundle (no runtime locale dependency).

4. **The manifest is pure data + pure functions only** — no `fs`, no `node:path`, no server-only imports. This is what makes it safe to import from the web bundle *and* unit-testable in isolation (the AC requires adding a third mock entry and asserting consumers need no interface change).

5. **No runtime auto-discovery.** A hard-coded central `Record` of two entries — not a filesystem scan or remote `mode add`. pneuma itself uses a hard-coded `builtinModes` central map; only *external* modes are dynamic. Full plugin discovery is deferred to 0.2.0 (PRD Out-of-Scope N1).

6. **`seedFactory` is a pure blank-doc factory, NOT create-time seeding.** It returns a blank doc object (`makeEmptyCarousel` moved to shared + a new `makeEmptyComposition` factored from the existing default). It does **not** change `createWork` to write yaml at creation — works stay yaml-less until first edit, preserving current behavior. The manifest carries `seedFactory` so consumers (web Editor on load, future CLI) call the right factory by type.

7. **Do NOT unify the video and carousel domain schemas.** `composition.yaml` (timeline / tracks / clips / frames / transitions) and `carousel.yaml` (static slides / layers / boxes) are genuinely heterogeneous domains. v0.1.1 unifies the *outer wiring* (registry + manifest), not the two domain schemas themselves (PRD Out-of-Scope N2).

## Consequences

### Positive

- Adding a third content type collapses from "edit 5+ files + copy a view tree" to "add one registry entry + implement the viewer". The `≤4` residual `short-video|image-text` literals (from 34) are inside the registry entries themselves.
- `DELIVERABLES` (and checkpoint coverage) auto-extends when a type is added — no constant to hand-edit.
- Carousel becomes a first-class, server-reachable schema: the CLI can validate it, migrations can run on it, the bridge enforces invariant #3 (SSoT via zod) for carousel just like for composition.
- The registry is a deep module: a few-method interface (`getContentType` / `listContentTypes`) hiding all per-type variance; pure → cheaply isolation-tested.

### Negative

- Promoting the carousel schema touches every web file that imports from `editor/types`. Mitigation: the re-export shim keeps the old import path valid, so the blast radius is "re-point the canonical definition," not "rewrite call sites."
- `src/shared/` grows a second large schema module. Acceptable — that's exactly where shared, server-and-web-reachable schemas belong (composition already lives there).

### Neutral

- `WorkType` stays a union `z.infer` for back-compat; the registry derives from it rather than replacing it. Rollback is a single `git revert` per workstream — the union still compiles.

## Alternatives considered

### A. Central registry + promote carousel schema to shared (chosen)
See Decision.

### B. Keep `CarouselSchema` web-only; downgrade I08 to structural-only CLI writes
**Rejected.** The CLI would write carousel.yaml without server zod validation, violating invariant #3 (composition/carousel are the SSoT; all mutations go through zod). The whole point of I08 is to stop the agent blind-writing invalid carousel yaml — a structural-only path perpetuates exactly that failure.

### C. Duplicate the carousel schema in `src/shared/` (leave the web copy too)
**Rejected.** Two definitions drift. The re-export shim gives one canonical definition with zero duplication.

### D. Full runtime mode-plugin discovery (pneuma external-mode style)
**Rejected for v0.1.1.** XL scope; pneuma's own built-ins are a hard-coded map. Deferred to 0.2.0.

## Implementation notes

Maps onto PRD-0002 issue slice I06. Suggested order:
1. Move carousel schema → `src/shared/carousel.ts`; add re-export shim in `web/src/features/editor/types.ts`.
2. Add `makeEmptyComposition(workId)` factored from the current composition default.
3. Build `src/shared/content-types/registry.ts` with the two manifests.
4. Re-point consumers: `DELIVERABLES`, the `workType !== "..."` server branches, `WorksGrid`'s three ternaries, `NewWorkCard`'s create buttons.
5. Isolation test: assert both manifests' fields; add a third mock manifest and assert consumers need no interface change.
6. E2E (invariant #6): after `build:backend` + daemon restart, create a video work + a carousel work in the browser; screenshot both routing/loading.

## References

- PRD-0002 (`docs/prd/0002-v0.1.1-extensibility-foundation-and-cleanup.md`) — workstream W4, Implementation Decision 深模块 ①.
- `src/work-store.ts:12` (`WorkType`), `src/work-store.ts:144` (`createWork`), `src/server/checkpoints.ts:21` (`DELIVERABLES`).
- `web/src/features/editor/types.ts` — current web-only `CarouselSchema` + `makeEmptyCarousel`.
- `web/src/features/works/WorksGrid.tsx`, `web/src/features/works/NewWorkCard.tsx` — the type-ternary consumers.
