import { readdir, readFile, writeFile, mkdir, stat, realpath, rm } from "node:fs/promises";
import { existsSync, type Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";

/**
 * One canonical "copy the bundled skills/ into ~/.claude/skills/" routine,
 * shared by BOTH the npm postinstall (src/postinstall.ts) AND the daemon boot
 * hook (src/server/index.ts). Before this existed the two paths diverged: npm
 * users got the postinstall copy (with its yaml / permitted_skills.md exemptions)
 * while DESKTOP users — who never run `npm postinstall` — only got an inline
 * `rsync -a --delete` at boot that blew away their accumulated skill edits every
 * launch AND skipped the exemptions. Now both routes call `syncSkills`, so the
 * external CLI agent's copy of the autoviral skill stays current on both the npm
 * update path and the Electron desktop update path.
 *
 * The copy rule mirrors the original postinstall: overwrite freely, but NEVER
 * clobber an EXISTING `.yaml` (user data) or `permitted_skills.md` (runtime-
 * modified allowlist).
 */

// Files that should NEVER be overwritten when they already exist in the target.
const NEVER_OVERWRITE_EXTENSIONS = [".yaml"];
const NEVER_OVERWRITE_FILES = ["permitted_skills.md"];

/** A file the copy rule must never clobber AND the prune must never delete. */
function isExemptFile(name: string): boolean {
  return (
    NEVER_OVERWRITE_EXTENSIONS.some((ext) => name.endsWith(ext)) ||
    NEVER_OVERWRITE_FILES.includes(name)
  );
}

export interface SyncSkillsOptions {
  /** Absolute path to the bundled skills/ dir (the source of truth). */
  sourceSkillsDir: string;
  /** Absolute path to ~/.claude/skills (where CLI agents read skills from). */
  targetSkillsDir: string;
  /** The current package version — gates the sync (skip when unchanged). */
  version: string;
  /**
   * Where the "last synced version" marker lives. MUST be OUTSIDE the copied
   * subtree (a sibling of the per-skill dirs, e.g. a `.json` directly under
   * targetSkillsDir) so a copy of `autoviral/` never deletes it.
   */
  markerPath: string;
  /** Optional logger; defaults to console. */
  logger?: { log?: (msg: string) => void; warn?: (msg: string) => void };
}

export interface SyncSkillsResult {
  synced: boolean;
  reason: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type Logger = { log?: (msg: string) => void; warn?: (msg: string) => void };

/** stat() (DEREFERENCED) → kind, tolerating a dangling symlink. */
async function resolvedKind(
  path: string,
): Promise<"dir" | "file" | "other" | "missing"> {
  try {
    const st = await stat(path); // follows symlinks
    if (st.isDirectory()) return "dir";
    if (st.isFile()) return "file";
    return "other";
  } catch {
    // Dangling symlink (target gone) or unreadable → treat as missing/skip.
    return "missing";
  }
}

/** True when `child`'s REAL path is inside `rootReal` (an already-realpath'd dir). */
async function resolvesInside(child: string, rootReal: string): Promise<boolean> {
  const real = await realpathSafe(child);
  if (real === rootReal) return true;
  const rel = relative(rootReal, real);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..";
}

/**
 * Recursive copy with the yaml / permitted_skills.md never-overwrite rule.
 *
 * Each entry's REAL kind is resolved via `stat` (which dereferences symlinks),
 * NOT via the `Dirent` flags from `readdir(withFileTypes)`. A `Dirent` for a
 * symlink-to-directory reports `isDirectory() === false` (it describes the link,
 * not its target), so the old code fell into the file branch and `readFile`'d a
 * directory → EISDIR — which threw before the marker write and broke the version
 * gate. The real repo `skills/` dir holds 14 such symlink-to-dir siblings of
 * `autoviral/` (caveman -> ../.agents/skills/caveman, ...). We now:
 *   (a) resolve each entry's dereferenced kind via `stat`, not the `Dirent` flag;
 *   (b) SKIP any symlink whose real target escapes the source tree — those
 *       siblings point at `../.agents/skills/*`, i.e. OTHER skills outside this
 *       package's `autoviral/` (matt-pocock's territory, git-ignored, dropped
 *       from the npm tarball). Materialising them would diverge desktop from npm
 *       and clobber the user's independently-managed skills. Symlinks that
 *       resolve INSIDE the source (legit internal links) are still followed;
 *   (c) tolerate a per-entry failure so one bad sibling (e.g. a dangling link)
 *       can never abort the sync — `autoviral/` + the marker still land.
 */
async function copyDir(
  src: string,
  dest: string,
  sourceRootReal: string,
  logger?: Logger,
): Promise<void> {
  const warn = logger?.warn ?? ((m: string) => console.warn(m));
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    try {
      // A symlink that escapes the package's source tree is NOT ours to copy.
      if (entry.isSymbolicLink() && !(await resolvesInside(srcPath, sourceRootReal))) {
        warn(`autoviral: skill sync skipped out-of-tree symlink: ${srcPath}`);
        continue;
      }
      const kind = await resolvedKind(srcPath);
      if (kind === "dir") {
        await copyDir(srcPath, destPath, sourceRootReal, logger);
      } else if (kind === "file") {
        if (isExemptFile(entry.name) && (await exists(destPath))) {
          // Never overwrite the user's YAML data or runtime-modified files.
          continue;
        }
        const content = await readFile(srcPath);
        await writeFile(destPath, content);
      } else {
        // Dangling symlink / socket / fifo / etc. — not ours to materialise.
        warn(`autoviral: skill sync skipped non-file entry: ${srcPath}`);
      }
    } catch (err) {
      // One bad entry must not abort the whole sync (e.g. a dangling sibling
      // symlink). Warn and keep going so autoviral/ + the marker still land.
      const message = err instanceof Error ? err.message : String(err);
      warn(`autoviral: skill sync skipped ${srcPath}: ${message}`);
    }
  }
}

/**
 * Prune target files inside a MANAGED skill subtree that no longer exist in
 * source — restoring the delete semantics the old boot path got from
 * `rsync -a --delete`. Without this, a layout change (v0.1.3 moved
 * `manual/00-quickstart.md` → `manual/video/…`) leaves the OLD flat files
 * orphaned alongside the new sharded ones, yielding a self-contradictory manual.
 *
 * Scoped to `managedDir` (the real `autoviral/` subtree we copied) so it NEVER
 * touches the user's independently-installed sibling skills or the sync marker
 * (both live outside this subtree). Exempt files (.yaml / permitted_skills.md)
 * are kept even when absent from source — they're user/runtime data, mirroring
 * the copy rule. Empty directories left behind by a prune are removed too.
 */
async function pruneOrphans(srcDir: string, managedDir: string, logger?: Logger): Promise<void> {
  const warn = logger?.warn ?? ((m: string) => console.warn(m));
  let entries: Dirent[];
  try {
    entries = await readdir(managedDir, { withFileTypes: true });
  } catch {
    return; // target subtree doesn't exist → nothing to prune.
  }

  for (const entry of entries) {
    const targetPath = join(managedDir, entry.name);
    const srcPath = join(srcDir, entry.name);
    try {
      // Resolve the TARGET's real kind (a stray symlink shouldn't fool us).
      const targetKind = await resolvedKind(targetPath);
      if (targetKind === "dir") {
        const srcKind = await resolvedKind(srcPath);
        if (srcKind === "dir") {
          // Recurse, then drop the dir if it became empty.
          await pruneOrphans(srcPath, targetPath, logger);
          const remaining = await readdir(targetPath);
          if (remaining.length === 0) await rm(targetPath, { recursive: true, force: true });
        } else {
          // Whole dir gone from source → remove it (still exempting any
          // protected files nested inside).
          await pruneDirRespectingExemptions(targetPath, logger);
        }
      } else {
        // A file (or stray non-dir) in target.
        if (isExemptFile(entry.name)) continue; // user/runtime data — never prune.
        if (!existsSync(srcPath)) {
          await rm(targetPath, { force: true });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warn(`autoviral: skill sync prune skipped ${targetPath}: ${message}`);
    }
  }
}

/** Remove a directory tree but keep any exempt files (and the dirs holding them). */
async function pruneDirRespectingExemptions(dir: string, logger?: Logger): Promise<void> {
  const warn = logger?.warn ?? ((m: string) => console.warn(m));
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    try {
      const kind = await resolvedKind(p);
      if (kind === "dir") {
        await pruneDirRespectingExemptions(p, logger);
        const remaining = await readdir(p);
        if (remaining.length === 0) await rm(p, { recursive: true, force: true });
      } else if (!isExemptFile(entry.name)) {
        await rm(p, { force: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warn(`autoviral: skill sync prune skipped ${p}: ${message}`);
    }
  }
  // Drop the dir itself if everything inside was pruned.
  try {
    if ((await readdir(dir)).length === 0) await rm(dir, { recursive: true, force: true });
  } catch {
    /* leave it */
  }
}

/** realpath that tolerates a not-yet-existing path (returns the input). */
async function realpathSafe(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

interface MarkerState {
  version: string | null;
  /** B4 (PRD-0009) — content hash of the source autoviral `.md` subtree at the
   *  last sync. Absent on legacy markers (pre-content-gate) ⇒ null. */
  contentHash: string | null;
}

/**
 * Write the sync marker — a sibling of the per-skill dirs (NEVER inside the
 * copied subtree, so a copy of `autoviral/` can't delete it). Records the
 * version, an ISO timestamp, and (when known) the `contentHash` of the managed
 * `.md` subtree. Shared by the post-copy write and the C2 legacy-marker backfill
 * (which writes the hash WITHOUT a copy) so the on-disk shape stays identical.
 */
async function writeMarker(
  markerPath: string,
  version: string,
  contentHash: string | null,
): Promise<void> {
  await writeFile(
    markerPath,
    `${JSON.stringify(
      {
        version,
        syncedAt: new Date().toISOString(),
        ...(contentHash ? { contentHash } : {}),
      },
      null,
      2,
    )}\n`,
  );
}

async function readMarkerState(markerPath: string): Promise<MarkerState> {
  try {
    const raw = JSON.parse(await readFile(markerPath, "utf-8")) as {
      version?: unknown;
      contentHash?: unknown;
    };
    return {
      version: typeof raw.version === "string" ? raw.version : null,
      contentHash: typeof raw.contentHash === "string" ? raw.contentHash : null,
    };
  } catch {
    return { version: null, contentHash: null };
  }
}

/**
 * B4 (PRD-0009) — content hash of every `.md` file under the SOURCE autoviral
 * skill subtree, so a manual edit that ships WITHOUT a version bump still
 * propagates to the installed copy (the old version-only gate froze the manual
 * inside one version — the parity-breaking bug B4 fixes). Hashes only `.md`
 * (the teaching surface); never `.yaml` / `permitted_skills.md` (user/runtime
 * data — never overwritten anyway, so they must not drive the gate). Path +
 * content are both folded in so a rename/move counts as a change. Symlinks are
 * dereferenced via `stat` and out-of-tree links are skipped (mirrors copyDir).
 * Returns null if the dir is unreadable (caller then can't content-gate).
 */
async function hashManagedMarkdown(autoviralDir: string): Promise<string | null> {
  if (!existsSync(autoviralDir)) return null;
  const sourceRootReal = await realpathSafe(autoviralDir);
  const files: { rel: string; content: Buffer }[] = [];

  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      try {
        if (entry.isSymbolicLink() && !(await resolvesInside(p, sourceRootReal))) {
          continue; // out-of-tree link — not part of this package's manual
        }
        const kind = await resolvedKind(p);
        if (kind === "dir") {
          await walk(p, `${prefix}${entry.name}/`);
        } else if (kind === "file" && entry.name.endsWith(".md")) {
          files.push({ rel: `${prefix}${entry.name}`, content: await readFile(p) });
        }
      } catch {
        // one unreadable entry must not abort the whole hash — skip it
      }
    }
  };
  await walk(autoviralDir, "");

  if (files.length === 0) return null;
  // Deterministic order so the hash is stable regardless of readdir ordering.
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f.rel);
    h.update("\0");
    h.update(f.content);
    h.update("\0");
  }
  return h.digest("hex");
}

/**
 * Sync the bundled skills into ~/.claude/skills when needed.
 *
 * Syncs when:
 *   - the target's `autoviral` skill is MISSING (recover it), OR
 *   - the marker's recorded version differs from `version` (update on bump).
 * Skips (no copy) when:
 *   - the marker already records `version` AND the skill is present
 *     (don't clobber user edits on every boot), OR
 *   - source and target resolve to the SAME real path, or the target's
 *     `autoviral` is a symlink back into the source (dev symlink — never
 *     self-overwrite).
 */
export async function syncSkills(opts: SyncSkillsOptions): Promise<SyncSkillsResult> {
  const { sourceSkillsDir, targetSkillsDir, version, markerPath } = opts;
  const log = opts.logger?.log ?? ((m: string) => console.log(m));
  const warn = opts.logger?.warn ?? ((m: string) => console.warn(m));

  if (!existsSync(sourceSkillsDir)) {
    return { synced: false, reason: `source skills dir not found: ${sourceSkillsDir}` };
  }

  // ── Symlink / self-copy guard ───────────────────────────────────────────
  // Dev sets up `~/.claude/skills/autoviral → <repo>/skills/autoviral` (or even
  // points the whole skills dir at the repo). Copying source over itself would
  // truncate the repo's own files mid-read. Bail if either the dirs are the same
  // real path, or the target's `autoviral` entry resolves back inside the source.
  const sourceReal = await realpathSafe(sourceSkillsDir);
  const targetReal = await realpathSafe(targetSkillsDir);
  if (sourceReal === targetReal) {
    return { synced: false, reason: "symlink guard: source and target are the same path" };
  }
  const targetAutoviral = join(targetSkillsDir, "autoviral");
  if (existsSync(targetAutoviral)) {
    const targetAutoviralReal = await realpathSafe(targetAutoviral);
    const sourceAutoviralReal = await realpathSafe(join(sourceSkillsDir, "autoviral"));
    const within = relative(sourceReal, targetAutoviralReal);
    const insideSource =
      targetAutoviralReal === sourceAutoviralReal ||
      (within !== "" && !within.startsWith("..") && !within.startsWith(sep) && within !== "..");
    if (insideSource) {
      return {
        synced: false,
        reason: "symlink guard: target skill resolves into the source tree (self-copy)",
      };
    }
  }

  // ── Version + content gate ────────────────────────────────────────────────
  // The version gate alone froze the manual INSIDE a version: editing a `.md`
  // without a version bump never propagated to ~/.claude/skills, so `autoviral
  // docs` served a stale manual (B4 parity break, PRD-0009). We now also gate on
  // a content hash of the source autoviral `.md` subtree — same version but
  // changed content still syncs.
  //
  // C2 (PRD-0009) — the LEGACY-marker blind spot. The original B4 code only
  // engaged the gate when `recorded.contentHash !== null`, so a marker shipped
  // BEFORE the content field existed (the real 0.1.7 marker: `{ version,
  // syncedAt }`, no hash) could NEVER detect drift at the matching version. The
  // installed manual then froze forever — the 03-cli-reference.md 513-vs-669
  // bug — because a version bump that would have written the first hash never
  // came. The recorded-hash comparison can't help (there's nothing to compare),
  // so for a legacy marker we instead hash the INSTALLED (target) `.md` subtree
  // and compare it to source: if they differ, sync NOW; either way we backfill
  // the hash so the gate engages from this boot on. The never-overwrite rule
  // (.yaml / permitted_skills.md) is unaffected — even a forced sync routes
  // through copyDir, which still exempts those files.
  const skillPresent = existsSync(targetAutoviral);
  const recorded = await readMarkerState(markerPath);
  const sourceAutoviral = join(sourceSkillsDir, "autoviral");
  const sourceContentHash = await hashManagedMarkdown(sourceAutoviral);
  const legacyMarker = recorded.contentHash === null;
  if (skillPresent && recorded.version === version) {
    if (legacyMarker) {
      // Legacy marker → no recorded hash. Compare source vs the INSTALLED copy.
      const targetContentHash = await hashManagedMarkdown(targetAutoviral);
      const legacyDrifted =
        sourceContentHash !== null &&
        targetContentHash !== null &&
        sourceContentHash !== targetContentHash;
      if (!legacyDrifted) {
        // Identical content — don't re-clobber, but BACKFILL the hash so the
        // gate engages next boot. Use the installed copy's hash (≡ source's when
        // identical) so the marker reflects what's actually on disk.
        const backfill = targetContentHash ?? sourceContentHash;
        if (backfill) {
          await writeMarker(markerPath, version, backfill);
        }
        return { synced: false, reason: `up-to-date (version ${version})` };
      }
      // Drifted → fall through to the copy (forced sync for the legacy marker).
    } else {
      const contentDrifted =
        sourceContentHash !== null && recorded.contentHash !== sourceContentHash;
      if (!contentDrifted) {
        return { synced: false, reason: `up-to-date (version ${version})` };
      }
    }
  }

  // ── Copy ────────────────────────────────────────────────────────────────
  try {
    await copyDir(sourceSkillsDir, targetSkillsDir, sourceReal, opts.logger);

    // ── Prune orphans inside each MANAGED skill subtree ────────────────────
    // copyDir only overwrites/adds; restore the `rsync --delete` delete-side so
    // a layout change (e.g. manual/00-quickstart.md → manual/video/…) doesn't
    // leave stale orphan files behind. Scope = each top-level SOURCE entry that
    // resolves to a real directory (the dirs we actually copied — e.g.
    // autoviral/). Symlink-to-dir siblings (caveman → ../.agents/skills/…) are
    // NOT pruned: they were never copied into target, so there's no managed
    // subtree to clean, and the user's other skills + the marker live outside
    // any managed subtree and stay untouched.
    const sourceEntries = await readdir(sourceSkillsDir, { withFileTypes: true });
    for (const entry of sourceEntries) {
      const srcChild = join(sourceSkillsDir, entry.name);
      // Only manage entries whose SOURCE side is a *real* (non-symlink) dir.
      if (!entry.isDirectory()) continue;
      const targetChild = join(targetSkillsDir, entry.name);
      if (existsSync(targetChild)) {
        await pruneOrphans(srcChild, targetChild, opts.logger);
      }
    }

    await mkdir(targetSkillsDir, { recursive: true });
    // Re-hash AFTER the copy so the marker records the hash of what now lives in
    // the target (== source content). Falls back to the pre-copy source hash if
    // a re-hash fails, and omits the field entirely if neither is available.
    const writtenHash =
      (await hashManagedMarkdown(join(targetSkillsDir, "autoviral"))) ?? sourceContentHash;
    await writeMarker(markerPath, version, writtenHash);
    const sameVersion = skillPresent && recorded.version === version;
    // C2 — a legacy marker (no recorded hash) that reached this copy did so
    // because the INSTALLED `.md` content drifted from source; a B4 marker
    // (recorded hash) drifted vs its recorded hash. Either is "content changed".
    const contentDriftedSameVersion =
      sameVersion &&
      sourceContentHash !== null &&
      (legacyMarker || recorded.contentHash !== sourceContentHash);
    const why = !skillPresent
      ? "skill missing"
      : recorded.version === null
        ? "no version marker"
        : contentDriftedSameVersion
          ? `manual content changed (version ${version})`
          : `version ${recorded.version ?? "?"} → ${version}`;
    log(`autoviral: synced skills to ${targetSkillsDir} (${why})`);
    return { synced: true, reason: why };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`autoviral: skill sync failed: ${message}`);
    throw err;
  }
}
