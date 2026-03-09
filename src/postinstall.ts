import { readdir, readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
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
    console.log("skill-evolver: skill-creator already installed, skipping");
    return;
  }

  console.log("skill-evolver: installing skill-creator from official Anthropic repo...");

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
      console.log("skill-evolver: skill-creator installed successfully");
    } else {
      console.warn("skill-evolver: skill-creator not found in official repo");
    }
  } catch (err) {
    console.warn(
      "skill-evolver: could not install skill-creator (git may not be available):",
      err instanceof Error ? err.message : err
    );
  } finally {
    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  try {
    if (!await exists(SOURCE_SKILLS)) {
      console.log("skill-evolver: skills/ directory not found, skipping postinstall");
      return;
    }

    console.log("skill-evolver: installing skills to ~/.claude/skills/");
    await copyDir(SOURCE_SKILLS, TARGET_SKILLS);
    console.log("skill-evolver: skills installed successfully");

    // Install skill-creator from official repo if not present
    await installSkillCreator();
  } catch (err) {
    console.warn("skill-evolver: postinstall warning:", err instanceof Error ? err.message : err);
    // Don't crash the install
  }
}

main();
