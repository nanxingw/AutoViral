// Public surface of the migrations registry (I10 / W7.5).
//
// The registry SKELETON: a `schemaVersion`-driven forward chain (`migrate`)
// plus a catalogue of the existing migrations collected as members. v0.1.1
// ships structure + collection only — no boot-time runner, no version bump.
// See ./registry.ts and ./members.ts for the design rationale.

export {
  migrate,
  registerMigration,
  listMigrations,
  latestVersion,
  readSchemaVersion,
  type Migration,
  type MigratableKind,
} from "./registry.js";

export {
  applyNormalizers,
  COMPOSITION_NORMALIZERS,
  BATCH_MIGRATIONS,
  type DocNormalizer,
  type BatchMigration,
  type RunOpts,
  type RunReport,
} from "./members.js";
