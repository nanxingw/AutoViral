// Carousel schema re-export shim (ADR-006 / I06).
//
// The canonical carousel domain schema + factories now live in
// src/shared/carousel.ts so the server and the `autoviral` CLI can reach them
// (symmetric with src/shared/composition.ts). This file is kept ONLY as a
// re-export so every existing `@/features/editor/types` / `../types` import in
// the web Editor keeps working without a call-site rewrite.
//
// Add new carousel schema in src/shared/carousel.ts, not here.

export * from "@shared/carousel";
