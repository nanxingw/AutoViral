// AutoViral HTTP API — composition root.
//
// I11 (PRD-0002 / W7) split the former 3270-line api.ts god-module into
// per-domain sub-routers under src/server/routes/. This file is now the
// composition root: it constructs the top-level `apiRoutes` Hono app, mounts
// the bridge protocol router and every domain sub-router (preserving the exact
// registration order so overlapping route patterns — notably
// /api/works/:id/assets/* — keep matching identically), and re-exports the
// handful of symbols that server/index.ts, the research scheduler, and the
// test suite import from "./api.js".
//
// The split was a PURE structural move: no endpoint path, request/response
// shape, or behaviour changed. See docs/issues/011-api-ts-split-routers.md and
// bridge/routes.ts (the proven sub-router pattern this mirrors).

import { Hono } from "hono";
import { bridgeRouter } from "./bridge/routes.js";
import { systemRouter } from "./routes/system.js";
import { worksRouter } from "./routes/works.js";
import { renderRouter } from "./routes/render.js";
import { assetsRouter } from "./routes/assets.js";
import { analyticsRouter } from "./routes/analytics.js";
import { generateRouter } from "./routes/generate.js";
import { audioRouter } from "./routes/audio.js";
import { trendsRouter } from "./routes/trends.js";
import { coachRouter } from "./routes/coach.js";
import { setWsBridge, setRenderQueue } from "./routes/_shared.js";

export const apiRoutes = new Hono();

// AutoViral Bridge Protocol v1 — the agent-agnostic RPC surface that the
// `autoviral` CLI calls into. Mounted before any wildcard routes so its
// versioned prefix never gets shadowed. See docs/archive/specs/2026-
// 05-14-agentic-terminal-bridge-protocol.md for the contract.
apiRoutes.route("/api/bridge/v1", bridgeRouter);

// Domain sub-routers (I11). Mounted at "/" so each keeps its full original
// path. Order matches the pre-split file so Hono's registration-order matching
// across overlapping patterns (e.g. the /api/works/:id/assets/* wildcard vs the
// more specific /api/works/:id/assets/search) is preserved byte-for-byte.
apiRoutes.route("/", systemRouter);
apiRoutes.route("/", worksRouter);
apiRoutes.route("/", renderRouter);
apiRoutes.route("/", assetsRouter);
apiRoutes.route("/", analyticsRouter);
apiRoutes.route("/", generateRouter);
apiRoutes.route("/", audioRouter);
apiRoutes.route("/", trendsRouter);
apiRoutes.route("/", coachRouter);

// ── Re-exports — the stable surface other modules import from "./api.js". ────
// These used to live inline here; I11 moved their bodies into routes/_shared.ts
// (state singletons + helpers) but the import sites (server/index.ts, the
// research scheduler, the test suite) still reference "./api.js", so re-export
// keeps that contract intact.
export {
  setWsBridge,
  setRenderQueue,
  cancelInFlightRenders,
  findActiveRenderJob,
  synthesiseLegacyAssetsAndProvenance,
  researchTrends,
  SECRET_PATHS,
  SECRET_BEARING_KEYS,
  MAX_UPLOAD_BYTES,
} from "./routes/_shared.js";
