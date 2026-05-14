import { readdir, readFile, writeFile, mkdir, stat, rm, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// skills/ is sibling to dist/ in the package
const SOURCE_SKILLS = join(__dirname, "..", "skills");
const TARGET_SKILLS = join(homedir(), ".claude", "skills");

// Files that should NEVER be overwritten (user's accumulated data)
const NEVER_OVERWRITE_EXTENSIONS = [".yaml"];
// Files that should not be overwritten if they already exist (runtime-modified files)
const NEVER_OVERWRITE_FILES = ["permitted_skills.md"];

const SKILL_CREATOR_REPO = "https://github.com/anthropics/claude-plugins-official.git";
const SKILL_CREATOR_PATH = "plugins/skill-creator/skills/skill-creator";

// HeyGen's "Write HTML. Render video." skill bundle — 15 sibling skills
// (hyperframes + gsap + lottie + three + …) that complement AutoViral's
// "operate the workstation" skill. autoviral handles interactive display;
// hyperframes handles HTML→video composition. Sentinel for idempotent
// install: ~/.claude/skills/hyperframes/SKILL.md.
const HYPERFRAMES_REPO = "https://github.com/heygen-com/hyperframes.git";
const HYPERFRAMES_SKILLS_PATH = "skills";
const HYPERFRAMES_SENTINEL = "hyperframes";

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
    console.log("autocode: skill-creator already installed, skipping");
    return;
  }

  console.log("autocode: installing skill-creator from official Anthropic repo...");

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
      console.log("autocode: skill-creator installed successfully");
    } else {
      console.warn("autocode: skill-creator not found in official repo");
    }
  } catch (err) {
    console.warn(
      "autocode: could not install skill-creator (git may not be available):",
      err instanceof Error ? err.message : err
    );
  } finally {
    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Install hyperframes + sibling skills from HeyGen's public bundle.
 *
 * AutoViral's `autoviral` skill teaches an agent how to operate the
 * Studio workstation; hyperframes teaches it how to actually author
 * dynamic HTML video compositions. The two are complementary and ship
 * together so a fresh `npm i @autoviral/cli` gives the user the full
 * "operate + author" surface without manual skill plumbing.
 *
 * Pulls the upstream repo's `skills/` directory via sparse-checkout
 * and copies each sub-skill into `~/.claude/skills/`. Idempotent.
 */
async function installHyperframes(): Promise<void> {
  const sentinel = join(TARGET_SKILLS, HYPERFRAMES_SENTINEL, "SKILL.md");
  if (await exists(sentinel)) {
    console.log("autocode: hyperframes already installed, skipping");
    return;
  }

  console.log("autocode: installing hyperframes skill bundle from heygen-com/hyperframes...");

  const tmpDir = join(tmpdir(), `hyperframes-${Date.now()}`);
  try {
    await execFileAsync("git", [
      "clone", "--depth", "1", "--filter=blob:none", "--sparse",
      HYPERFRAMES_REPO, tmpDir,
    ], { timeout: 60000 });

    await execFileAsync("git", [
      "-C", tmpDir,
      "sparse-checkout", "set", HYPERFRAMES_SKILLS_PATH,
    ], { timeout: 30000 });

    const srcSkillsDir = join(tmpDir, HYPERFRAMES_SKILLS_PATH);
    if (!(await exists(srcSkillsDir))) {
      console.warn("autocode: hyperframes skills/ directory missing in clone — upstream layout changed?");
      return;
    }

    const subSkills = await readdir(srcSkillsDir, { withFileTypes: true });
    let installed = 0;
    for (const entry of subSkills) {
      if (!entry.isDirectory()) continue;
      const src = join(srcSkillsDir, entry.name);
      const dest = join(TARGET_SKILLS, entry.name);
      // Don't trample autoviral's own skill if names ever collide
      if (entry.name === "autoviral") continue;
      await copyDir(src, dest);
      installed += 1;
    }
    console.log(`autocode: hyperframes installed ${installed} sub-skill(s)`);
  } catch (err) {
    console.warn(
      "autocode: could not install hyperframes (git may not be available, or upstream temporarily unreachable):",
      err instanceof Error ? err.message : err
    );
  } finally {
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
        console.warn(`autocode: chmod ${helper}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    if (!await exists(SOURCE_SKILLS)) {
      console.log("autocode: skills/ directory not found, skipping postinstall");
      return;
    }

    console.log("autocode: installing skills to ~/.claude/skills/");
    await copyDir(SOURCE_SKILLS, TARGET_SKILLS);
    console.log("autocode: skills installed successfully");

    // Install skill-creator from official repo if not present
    await installSkillCreator();

    // Install HeyGen's hyperframes skill bundle (complements autoviral —
    // autoviral = operate workstation, hyperframes = author HTML→video).
    await installHyperframes();

    // Repair node-pty spawn-helper permissions (see fn docstring)
    await repairNodePtyPermissions();
  } catch (err) {
    console.warn("autocode: postinstall warning:", err instanceof Error ? err.message : err);
    // Don't crash the install
  }
}

main();
