import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// skills/ is sibling to dist/ in the package
const SOURCE_SKILLS = join(__dirname, "..", "skills");
const TARGET_SKILLS = join(homedir(), ".claude", "skills");

// Files that should NEVER be overwritten (user's accumulated data)
const NEVER_OVERWRITE_EXTENSIONS = [".yaml"];

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

      if (isYaml && await exists(destPath)) {
        // Never overwrite user's YAML data files
        continue;
      }

      // SKILL.md, permitted_skills.md, and other instruction files: always overwrite
      const content = await readFile(srcPath);
      await writeFile(destPath, content);
    }
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
  } catch (err) {
    console.warn("skill-evolver: postinstall warning:", err instanceof Error ? err.message : err);
    // Don't crash the install
  }
}

main();
