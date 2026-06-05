import { readdir, readFile, writeFile, mkdir, stat, rm, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { syncSkills } from "./infra/skill-sync.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// skills/ is sibling to dist/ in the package
const SOURCE_SKILLS = join(__dirname, "..", "skills");
const TARGET_SKILLS = join(homedir(), ".claude", "skills");
// Marker lives OUTSIDE the copied subtree (sibling of the per-skill dirs) so a
// copy of autoviral/ never deletes it. Shared with the daemon boot hook.
const SKILL_SYNC_MARKER = join(TARGET_SKILLS, ".autoviral-synced.json");

// Files that should NEVER be overwritten (user's accumulated data). Used by the
// local copyDir below, which now only serves installSkillCreator (the autoviral
// skill copy moved to the shared syncSkills core).
const NEVER_OVERWRITE_EXTENSIONS = [".yaml"];
// Files that should not be overwritten if they already exist (runtime-modified files)
const NEVER_OVERWRITE_FILES = ["permitted_skills.md"];

/** Read this package's version (dist/package.json sits next to the compiled
 *  postinstall.js → `..`). Falls back to "0.0.0" if unreadable so the sync still
 *  runs on a missing-skill target. */
function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, "..", "package.json"), "utf-8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // unreadable — fall through to the safe default.
  }
  return "0.0.0";
}

const SKILL_CREATOR_REPO = "https://github.com/anthropics/claude-plugins-official.git";
const SKILL_CREATOR_PATH = "plugins/skill-creator/skills/skill-creator";

// hyperframes auto-install was removed 2026-05-17 per ADR-001 — AutoViral
// owns the editing layer itself and absorbs hyperframes' high-ROI techniques
// (quality gate, variables, caption animations, TTS) as native features.
// Users who want hyperframes can install it explicitly via
//   npx skills add heygen-com/hyperframes
// alongside the autoviral skill.

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      const isYaml = NEVER_OVERWRITE_EXTENSIONS.some((ext) => entry.name.endsWith(ext));
      const isProtected = NEVER_OVERWRITE_FILES.includes(entry.name);

      if ((isYaml || isProtected) && await exists(destPath)) {
        // Never overwrite user's YAML data or runtime-modified files
        continue;
      }
      const content = await readFile(srcPath);
      await writeFile(destPath, content);
    }
  }
}

/**
 * Install skill-creator from the official Anthropic plugin repository.
 * Uses git sparse-checkout to fetch only the skill-creator directory.
 */
async function installSkillCreator(): Promise<void> {
  const targetDir = join(TARGET_SKILLS, "skill-creator");

  if (await exists(join(targetDir, "SKILL.md"))) {
    console.log("autoviral: skill-creator already installed, skipping");
    return;
  }

  console.log("autoviral: installing skill-creator from official Anthropic repo...");

  const tmpDir = join(tmpdir(), `skill-creator-${Date.now()}`);
  try {
    // Clone with sparse-checkout to fetch only the skill-creator skill
    await execFileAsync("git", [
      "clone", "--depth", "1", "--filter=blob:none", "--sparse",
      SKILL_CREATOR_REPO, tmpDir,
    ], { timeout: 30000 });

    await execFileAsync("git", [
      "-C", tmpDir,
      "sparse-checkout", "set", SKILL_CREATOR_PATH,
    ], { timeout: 15000 });

    const srcDir = join(tmpDir, SKILL_CREATOR_PATH);
    if (await exists(srcDir)) {
      await copyDir(srcDir, targetDir);
      console.log("autoviral: skill-creator installed successfully");
    } else {
      console.warn("autoviral: skill-creator not found in official repo");
    }
  } catch (err) {
    console.warn(
      "autoviral: could not install skill-creator (git may not be available):",
      err instanceof Error ? err.message : err
    );
  } finally {
    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * node-pty 1.1.x ships prebuilt `spawn-helper` binaries via tarballs that
 * sometimes lose their executable bit when npm extracts them on macOS arm64.
 * Symptom: `pty.spawn()` fails with `posix_spawnp failed` (ENOEXEC). Re-
 * chmod +x on every postinstall so the fix is idempotent and survives
 * dependency upgrades / `npm install` cycles.
 */
async function repairNodePtyPermissions(): Promise<void> {
  const root = join(__dirname, "..", "node_modules", "node-pty", "prebuilds");
  if (!(await exists(root))) return;
  const platforms = await readdir(root);
  for (const platform of platforms) {
    const helper = join(root, platform, "spawn-helper");
    if (await exists(helper)) {
      try {
        await chmod(helper, 0o755);
      } catch (err) {
        console.warn(`autoviral: chmod ${helper}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    if (!await exists(SOURCE_SKILLS)) {
      console.log("autoviral: skills/ directory not found, skipping postinstall");
      return;
    }

    console.log("autoviral: installing skills to ~/.claude/skills/");
    // Shared core (also called at daemon boot). On install/update the version
    // gate forces a copy (recorded marker version differs from this one, or the
    // skill is freshly missing), preserving the old unconditional-install
    // behaviour while NEVER clobbering the user's .yaml / permitted_skills.md.
    await syncSkills({
      sourceSkillsDir: SOURCE_SKILLS,
      targetSkillsDir: TARGET_SKILLS,
      version: readPackageVersion(),
      markerPath: SKILL_SYNC_MARKER,
    });
    console.log("autoviral: skills installed successfully");

    // Install skill-creator from official repo if not present
    await installSkillCreator();

    // Repair node-pty spawn-helper permissions (see fn docstring)
    await repairNodePtyPermissions();
  } catch (err) {
    console.warn("autoviral: postinstall warning:", err instanceof Error ? err.message : err);
    // Don't crash the install
  }
}

main();
