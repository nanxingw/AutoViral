// Composition schemas live in src/shared/ so both the Hono backend (under
// src/) and the React frontend (under web/) can import the same types
// without crossing tsconfig rootDir boundaries. Phase 1.2.5 introduces this
// split; see docs/superpowers/plans/2026-04-28-autoviral-video-supremacy.md.
export * from "@shared/composition";
