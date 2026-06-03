// Collected migration MEMBERS (I10 / W7.5 — PRD-0002 deep module ③).
//
// This is where the three pre-I10 ad-hoc migrations are "收编" (collected) into
// the unified registry as named, addressable members. Two distinct member
// SHAPES exist and we model both honestly rather than forcing them into one
// mould:
//
//   A. Doc normalizers — pure `doc → doc` transforms run at READ time on a
//      single parsed yaml object (composition.yaml / carousel.yaml). They are
//      idempotent and version-INDEPENDENT (they run on every read regardless
//      of schemaVersion). `migrateLegacyTrackIds` is the only current member.
//
//   B. Batch scripts — disk-scanning one-shot upgrades that walk every work
//      directory and rewrite files in place (with a .bak first). They are NOT
//      doc→doc and NOT chained by `migrate()`; they're collected here only so
//      there is a single catalogue of "every migration this project owns".
//      `strip-pipeline` is the only current member.
//
// Range discipline (PRD-0002 N6): collecting ≠ behaviour change. Each member
// re-exports / delegates to its ORIGINAL implementation verbatim — same input
// → same output. In particular `migrateLegacyTrackIds` (which absorbs #57's
// black-list rewrite) is referenced, not re-implemented, so #57's behaviour is
// byte-for-byte unchanged. v0.1.1 registers ZERO version-bumping chain
// migrations: the skeleton + catalogue exist, but the on-disk schemaVersion
// floor stays 1.

import { migrateLegacyTrackIds } from "../composition.js";
import type { MigratableKind } from "./registry.js";

// The strip-pipeline batch script lives at the REPO ROOT (`migrations/`), not
// under `src/` — it is its own tsx-run tool with its own CLI entry + tests and
// must stay there (moving it would change its CLI path + test imports). Because
// tsc's `rootDir` is `./src`, we cannot statically import it (TS6059). Instead
// we (a) re-declare its small public types locally and (b) load `run` lazily
// via a runtime dynamic import. The script's behaviour is referenced verbatim
// — we never re-implement it here.

/** Mirror of `migrations/strip-pipeline.ts` `RunOpts`. Kept in lock-step. */
export interface RunOpts {
  dataDir: string;
  dryRun?: boolean;
}
/** Mirror of `migrations/strip-pipeline.ts` `RunReport`. Kept in lock-step. */
export interface RunReport {
  scanned: number;
  wouldStrip: number;
  stripped: number;
  backups: string[];
}

// Resolution note: the repo-root `migrations/strip-pipeline.ts` is a tsx-run
// tool — it is NOT part of the `src/` → `dist/` publish build, so this lazy
// import resolves against SOURCE (vitest / tsx run the `.ts` directly via the
// nodenext `.js`→`.ts` mapping). That is sufficient for v0.1.1: the catalogue
// member is the single registry entry point but is invoked ONLY by tooling /
// tests, never at product boot (PRD-0002 N6 defers the boot-time runner). When
// the runner lands, wiring the script into the publish build (or relocating it
// under `src/`) is the follow-up; until then we keep its CLI path + tests
// untouched. The specifier is held in a `const` so tsc's rootDir analysis
// (which only folds direct string-literal `import()`) leaves it out of the
// `src/` program — that's what keeps `tsc -p tsconfig.build.json` green.
async function loadStripPipelineRun(): Promise<
  (opts: RunOpts) => Promise<RunReport>
> {
  const spec = "../../../migrations/strip-pipeline.js";
  const mod = (await import(/* @vite-ignore */ spec)) as {
    run: (opts: RunOpts) => Promise<RunReport>;
  };
  return mod.run;
}

/**
 * A read-time doc normalizer collected into the registry. Distinct from a
 * chained {@link Migration} (which bumps `schemaVersion`): normalizers run on
 * every read, are idempotent, and do NOT advance the version. They are the
 * "give #57 a hook, don't fix it" path — addressable by id, behaviour frozen.
 */
export interface DocNormalizer {
  kind: MigratableKind;
  id: string;
  /** Pure doc→doc transform; must be idempotent and side-effect-free. */
  apply: (doc: unknown) => unknown;
}

/**
 * A batch (disk-scanning) migration collected into the registry catalogue.
 * Unlike doc normalizers it operates on a whole data directory and mutates
 * files in place (backing them up first). It is intentionally NOT part of the
 * `migrate()` chain — it is run by an operator/CLI, not at read time.
 */
export interface BatchMigration {
  id: string;
  /** Delegates verbatim to the original standalone script's `run`. */
  run: (opts: RunOpts) => Promise<RunReport>;
}

// ─── Member A — composition read-time normalizers ────────────────────────────
// `migrateLegacyTrackIds` rewrites any non-`trk_`-prefixed track id to a fresh
// `trk_<uuid>` and back-fills `displayOrder` (issue #31 + the #57 widening).
// Collected verbatim: the registry references the SAME function the read paths
// (api.ts GET /composition, composition-ops.readCompositionFor) already use, so
// there is exactly one implementation and zero behaviour drift.
export const COMPOSITION_NORMALIZERS: readonly DocNormalizer[] = [
  {
    kind: "composition",
    id: "legacy-track-ids",
    apply: migrateLegacyTrackIds,
  },
];

// ─── Member B — batch (disk) migrations ──────────────────────────────────────
// `strip-pipeline` removes the dead `pipeline` / `evaluationMode` / `eval*`
// keys from every work.yaml, backing each up to `work.<ts>.bak.yaml` first.
// Collected as a catalogue member only — its behaviour (and its standalone
// `tsx migrations/strip-pipeline.ts` CLI entry) are untouched.
export const BATCH_MIGRATIONS: readonly BatchMigration[] = [
  {
    id: "strip-pipeline",
    // Lazily resolves the repo-root script and delegates verbatim — same
    // input → same output as `tsx migrations/strip-pipeline.ts`.
    run: async (opts: RunOpts): Promise<RunReport> => {
      const run = await loadStripPipelineRun();
      return run(opts);
    },
  },
];

/**
 * Apply every collected read-time normalizer for `kind` to `doc`, in
 * registration order. This is the single funnel the read paths can call so a
 * future second normalizer is picked up everywhere at once (today there is one:
 * `legacy-track-ids`). Pure: returns a new doc, never mutates, never IO.
 *
 * NOTE: this is deliberately separate from `migrate()` (the version chain).
 * Normalizers are version-independent read-time fixups; `migrate()` is the
 * version-stamped forward chain. v0.1.1 wires the catalogue; threading this
 * funnel into the actual read paths (replacing the bare `migrateLegacyTrackIds`
 * call) is a follow-up so #57's call sites stay byte-identical for now.
 */
export function applyNormalizers(kind: MigratableKind, doc: unknown): unknown {
  let out = doc;
  for (const n of COMPOSITION_NORMALIZERS) {
    if (n.kind === kind) out = n.apply(out);
  }
  return out;
}
