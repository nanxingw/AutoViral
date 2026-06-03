// Sequential migrations registry (I10 / W7.5 — PRD-0002 deep module ③).
//
// Why this exists
// ───────────────
// Before I10 the project had THREE unrelated ad-hoc migration mechanisms:
//   1. runtime-inline `migrateLegacyTrackIds` (composition.ts) — only knew one
//      legacy track-id shape until #57 widened it;
//   2. a standalone tsx script `migrations/strip-pipeline.ts` that nobody
//      called from product code;
//   3. one-off reconciliation scripts.
// None of them shared a notion of "which migrations has THIS doc already been
// through", because composition.yaml / carousel.yaml had no `schemaVersion`.
//
// This module is the SKELETON that unifies them. A migration is a pure
// `from → to` function on a plain doc object. `migrate(kind, doc)` reads
// `doc.schemaVersion` (default 1), then applies every registered migration
// whose `from` matches the doc's current version, in ascending order, until
// the doc reaches the latest version — stamping `schemaVersion` forward as it
// goes.
//
// Range discipline (PRD-0002 N6): v0.1.1 ships the STRUCTURE + collects the
// existing migrations as members ONLY. There is NO boot-time runner here, and
// #57's behaviour is unchanged — `migrateLegacyTrackIds` is collected verbatim
// (same input → same output). Persisting a migrated doc still goes through the
// SAME zod + atomic-write path (invariant #3); this registry never writes to
// disk itself — callers run `migrate(...)` then hand the result to the
// existing `CompositionSchema.parse` + atomic write in composition-ops.ts.

/**
 * A single forward migration. `up` must be a PURE function: it takes a plain
 * doc object (already at version `from`) and returns a NEW doc at version
 * `to` — it never mutates its input and never touches disk. `to` should be
 * exactly `from + 1`; chaining handles multi-step upgrades.
 */
export interface Migration {
  /** Schema version this migration upgrades FROM. */
  from: number;
  /** Schema version this migration upgrades TO (conventionally `from + 1`). */
  to: number;
  /** Human-readable id for logs / tests, e.g. `"legacy-track-ids"`. */
  id: string;
  /** Pure doc→doc transform. Must not mutate input or perform IO. */
  up: (doc: unknown) => unknown;
}

/** The doc kinds that carry a `schemaVersion` and can be chained by `migrate`. */
export type MigratableKind = "composition" | "carousel";

/**
 * Read a doc's declared `schemaVersion`. Absent / non-numeric ⇒ 1 (the
 * implicit version of every pre-I10 on-disk file). Mirrors the zod
 * `.default(1)` on both schemas so `migrate` and `parse` agree on the floor.
 */
export function readSchemaVersion(doc: unknown): number {
  if (doc && typeof doc === "object") {
    const v = (doc as Record<string, unknown>).schemaVersion;
    if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  }
  return 1;
}

/**
 * Stamp `schemaVersion` onto a NEW doc object (never mutates `doc`). Used by
 * the chain runner after each step so the result records how far it migrated.
 */
function withSchemaVersion(doc: unknown, version: number): unknown {
  if (!doc || typeof doc !== "object") return doc;
  return { ...(doc as Record<string, unknown>), schemaVersion: version };
}

/**
 * Run the registered migration chain for `kind` against `doc`, upgrading it to
 * the latest version. Pure: returns a NEW doc, never mutates the input, never
 * touches disk. If `doc` is already at (or somehow beyond) the latest version,
 * it is returned with its `schemaVersion` normalised but otherwise untouched.
 *
 * Determinism: migrations are applied in ascending `from` order. We look up
 * the migration whose `from === currentVersion` at each step; a missing step
 * is a registry bug (gap in the chain) and throws loudly rather than silently
 * skipping a transform.
 */
export function migrate(kind: MigratableKind, doc: unknown): unknown {
  const migrations = REGISTRY[kind];
  const latest = latestVersion(kind);
  let current = readSchemaVersion(doc);
  let out = doc;

  // Already current (or ahead — forward-compat read of a newer file): just
  // normalise the stamp so callers never see an absent schemaVersion.
  if (current >= latest) {
    return withSchemaVersion(out, current);
  }

  while (current < latest) {
    const step = migrations.find((m) => m.from === current);
    if (!step) {
      throw new Error(
        `[migrations] no ${kind} migration registered from schemaVersion ${current} ` +
          `(chain target ${latest}); registry has a gap`,
      );
    }
    out = withSchemaVersion(step.up(out), step.to);
    current = step.to;
  }
  return out;
}

/**
 * The latest schemaVersion reachable for `kind` = 1 (base) + number of
 * registered forward migrations, since each migration bumps the version by
 * one. With zero migrations registered this is 1 (the floor), which is the
 * v0.1.1 state for both kinds — the skeleton is in place but no behaviour-
 * changing version bump has shipped yet.
 */
export function latestVersion(kind: MigratableKind): number {
  return 1 + REGISTRY[kind].length;
}

// ─── The registries ──────────────────────────────────────────────────────────
// Populated by ./index.ts at import time via `registerMigration` so the
// registry definitions (here) and the collected member implementations
// (sibling files) stay separable + independently testable. Ordering inside
// each array is normalised on insert (ascending `from`).

const REGISTRY: Record<MigratableKind, Migration[]> = {
  composition: [],
  carousel: [],
};

/**
 * Register a forward migration for a kind. Idempotency is NOT assumed —
 * registering the same id twice throws so a double-import can't silently
 * duplicate a version bump (which would corrupt `latestVersion`).
 */
export function registerMigration(
  kind: MigratableKind,
  migration: Migration,
): void {
  const list = REGISTRY[kind];
  if (list.some((m) => m.id === migration.id)) {
    throw new Error(
      `[migrations] duplicate ${kind} migration id "${migration.id}"`,
    );
  }
  if (migration.to !== migration.from + 1) {
    throw new Error(
      `[migrations] migration "${migration.id}" must bump by exactly 1 ` +
        `(from ${migration.from} → to ${migration.to})`,
    );
  }
  list.push(migration);
  list.sort((a, b) => a.from - b.from);
}

/** Read-only view of the registered chain for a kind (tests / introspection). */
export function listMigrations(kind: MigratableKind): readonly Migration[] {
  return REGISTRY[kind];
}
