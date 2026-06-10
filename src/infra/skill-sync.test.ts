import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  lstat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncSkills } from "./skill-sync.js";

// skill-sync owns the "copy the bundled skills/ into ~/.claude/skills/" rule for
// BOTH the npm postinstall AND the daemon boot hook. These tests pin the copy
// rule (overwrite .md, never clobber .yaml / permitted_skills.md), the version
// gate (skip when the marker already records the current version), the
// missing-skill recovery, the symlink self-copy guard, and the marker placement
// (must live OUTSIDE the copied subtree so a copy never deletes it).

async function setup(): Promise<{
  root: string;
  source: string;
  target: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "av-skill-sync-"));
  const source = join(root, "source-skills");
  const target = join(root, "target-skills");
  await mkdir(join(source, "autoviral"), { recursive: true });
  return {
    root,
    source,
    target,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

const VERSION = "0.1.3";
const markerOf = (target: string) => join(target, ".autoviral-synced.json");

describe("syncSkills", () => {
  let root: string;
  let source: string;
  let target: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ root, source, target, cleanup } = await setup());
  });
  afterEach(async () => {
    await cleanup();
  });

  it("copies the bundled skill into a fresh target (missing-skill recovery)", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "# entry\n");

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    expect(existsSync(join(target, "autoviral", "SKILL.md"))).toBe(true);
    expect(await readFile(join(target, "autoviral", "SKILL.md"), "utf-8")).toBe("# entry\n");
  });

  it("overwrites .md but preserves an existing .yaml and permitted_skills.md", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "new md\n");
    await writeFile(join(source, "autoviral", "config.yaml"), "from: source\n");
    await writeFile(join(source, "autoviral", "permitted_skills.md"), "source list\n");

    // Pre-existing user files in the target (older marker → sync should run).
    await mkdir(join(target, "autoviral"), { recursive: true });
    await writeFile(join(target, "autoviral", "SKILL.md"), "old md\n");
    await writeFile(join(target, "autoviral", "config.yaml"), "user: edits\n");
    await writeFile(join(target, "autoviral", "permitted_skills.md"), "user runtime list\n");
    await writeFile(markerOf(target), JSON.stringify({ version: "0.0.1" }));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    // .md is freely overwritten…
    expect(await readFile(join(target, "autoviral", "SKILL.md"), "utf-8")).toBe("new md\n");
    // …but the user's .yaml + permitted_skills.md are untouched.
    expect(await readFile(join(target, "autoviral", "config.yaml"), "utf-8")).toBe("user: edits\n");
    expect(await readFile(join(target, "autoviral", "permitted_skills.md"), "utf-8")).toBe(
      "user runtime list\n",
    );
  });

  it("writes a .yaml / permitted_skills.md when the target does NOT yet have one", async () => {
    // First-install case: the protected files don't exist in target → they SHOULD
    // be seeded from source (the never-overwrite rule only protects EXISTING files).
    await writeFile(join(source, "autoviral", "config.yaml"), "from: source\n");
    await writeFile(join(source, "autoviral", "permitted_skills.md"), "source list\n");

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    expect(await readFile(join(target, "autoviral", "config.yaml"), "utf-8")).toBe("from: source\n");
    expect(await readFile(join(target, "autoviral", "permitted_skills.md"), "utf-8")).toBe(
      "source list\n",
    );
  });

  it("skips when the marker already records the current version", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "source v2\n");
    // Target already synced at the current version, with a stale user edit.
    await mkdir(join(target, "autoviral"), { recursive: true });
    await writeFile(join(target, "autoviral", "SKILL.md"), "user kept this\n");
    await writeFile(markerOf(target), JSON.stringify({ version: VERSION }));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(false);
    expect(res.reason).toMatch(/up.?to.?date|version/i);
    // Same-version → did NOT clobber the user's edit.
    expect(await readFile(join(target, "autoviral", "SKILL.md"), "utf-8")).toBe("user kept this\n");
  });

  it("re-syncs and updates the marker when the recorded version differs", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "v1.3 content\n");
    await mkdir(join(target, "autoviral"), { recursive: true });
    await writeFile(join(target, "autoviral", "SKILL.md"), "v1.2 content\n");
    await writeFile(markerOf(target), JSON.stringify({ version: "0.1.2" }));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    expect(await readFile(join(target, "autoviral", "SKILL.md"), "utf-8")).toBe("v1.3 content\n");
    // Marker advanced to the new version.
    const marker = JSON.parse(await readFile(markerOf(target), "utf-8")) as { version: string };
    expect(marker.version).toBe(VERSION);
  });

  it("syncs when the target autoviral skill is missing even if the marker matches", async () => {
    // Marker says current, but the skill dir was deleted → recover it.
    await writeFile(join(source, "autoviral", "SKILL.md"), "recovered\n");
    await mkdir(target, { recursive: true });
    await writeFile(markerOf(target), JSON.stringify({ version: VERSION }));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    expect(existsSync(join(target, "autoviral", "SKILL.md"))).toBe(true);
  });

  it("skips (symlink guard) when source realpath === target realpath", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "x\n");
    // target IS source (dev symlinked ~/.claude/skills straight at the repo).
    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: source,
      version: VERSION,
      markerPath: markerOf(source),
    });
    expect(res.synced).toBe(false);
    expect(res.reason).toMatch(/symlink|same|self/i);
  });

  it("skips (symlink guard) when target/autoviral is a symlink back into source", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "x\n");
    await mkdir(target, { recursive: true });
    // dev: ~/.claude/skills/autoviral → <repo>/skills/autoviral
    await symlink(join(source, "autoviral"), join(target, "autoviral"));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(false);
    expect(res.reason).toMatch(/symlink|same|self/i);
    // The symlinked source file is intact (we never copied over it).
    expect(await readFile(join(source, "autoviral", "SKILL.md"), "utf-8")).toBe("x\n");
  });

  it("never deletes the marker (it lives outside the copied subtree)", async () => {
    // The marker is a sibling of autoviral/, so a copy of autoviral/ can't touch it.
    await writeFile(join(source, "autoviral", "SKILL.md"), "v\n");
    await mkdir(target, { recursive: true });
    await writeFile(markerOf(target), JSON.stringify({ version: "0.0.1" }));

    await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    // Marker still present (and bumped), and it was NOT copied into autoviral/.
    expect(existsSync(markerOf(target))).toBe(true);
    const inside = await readdir(join(target, "autoviral"));
    expect(inside).not.toContain(".autoviral-synced.json");
  });

  // ── Finding #1/#3: a symlink-to-DIR sibling must not crash the sync ────────
  // The real repo skills/ dir has 14 symlink-to-dir siblings of autoviral/
  // (caveman → ../.agents/skills/caveman, etc.). readdir(withFileTypes) reports
  // them as Dirents whose isDirectory() is FALSE / isSymbolicLink() is TRUE, so
  // the old `else { readFile(srcPath) }` branch did readFile() on a directory →
  // EISDIR (or ENOENT for a dangling link). That threw BEFORE the marker write,
  // so the version gate never persisted: every boot re-ran the full copy, re-
  // clobbering the user's edits AND, depending on readdir order, could miss
  // copying autoviral/ entirely. The sync must tolerate symlink/dangling
  // siblings: still copy autoviral/, still write the marker.
  it("does not crash when a sibling skill is a symlink-to-DIR (copies autoviral + writes marker)", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "real skill\n");
    // A symlink-to-dir sibling pointing OUTSIDE source (mirrors the real repo:
    // skills/caveman → ../.agents/skills/caveman, i.e. another package's skill).
    const outOfTree = join(root, "agents-skills", "caveman");
    await mkdir(outOfTree, { recursive: true });
    await writeFile(join(outOfTree, "inner.md"), "inner\n");
    await symlink(outOfTree, join(source, "caveman"));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    // autoviral got copied despite the symlink sibling…
    expect(await readFile(join(target, "autoviral", "SKILL.md"), "utf-8")).toBe("real skill\n");
    // …and the marker landed (version gate now actually persists).
    expect(existsSync(markerOf(target))).toBe(true);
    const marker = JSON.parse(await readFile(markerOf(target), "utf-8")) as { version: string };
    expect(marker.version).toBe(VERSION);
  });

  it("does not crash on a DANGLING symlink sibling (target of the link is gone)", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "real skill\n");
    // A symlink whose target does not exist (e.g. .agents/ not shipped).
    await symlink(join(source, "_does-not-exist"), join(source, "handoff"));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    expect(await readFile(join(target, "autoviral", "SKILL.md"), "utf-8")).toBe("real skill\n");
    expect(existsSync(markerOf(target))).toBe(true);
  });

  // ── Finding #2: prune orphan files left by a managed-subtree layout change ─
  // The old boot path used `rsync -a --delete`, which removed files no longer in
  // source. copyDir only overwrites/adds → on a layout change (v0.1.3 moved
  // manual/00-quickstart.md → manual/video/…) the target keeps BOTH the new
  // sharded files AND the orphaned flat files, producing a self-contradictory
  // manual. The sync must prune target files inside a MANAGED skill subtree that
  // no longer exist in source.
  it("prunes orphan files inside the managed autoviral subtree on a layout change", async () => {
    // New (source) layout: manual/video/00-quickstart.md
    await writeFile(join(source, "autoviral", "SKILL.md"), "v1.3\n");
    await mkdir(join(source, "autoviral", "manual", "video"), { recursive: true });
    await writeFile(join(source, "autoviral", "manual", "video", "00-quickstart.md"), "new\n");

    // Old (target) layout: flat manual/00-quickstart.md (orphan after the move).
    await mkdir(join(target, "autoviral", "manual"), { recursive: true });
    await writeFile(join(target, "autoviral", "SKILL.md"), "v1.2\n");
    await writeFile(join(target, "autoviral", "manual", "00-quickstart.md"), "stale flat\n");
    await writeFile(markerOf(target), JSON.stringify({ version: "0.1.2" }));

    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    expect(res.synced).toBe(true);
    // New file present…
    expect(
      await readFile(join(target, "autoviral", "manual", "video", "00-quickstart.md"), "utf-8"),
    ).toBe("new\n");
    // …orphan flat file pruned (no self-contradictory duplicate left behind).
    expect(existsSync(join(target, "autoviral", "manual", "00-quickstart.md"))).toBe(false);
  });

  it("prune NEVER deletes the user's .yaml / permitted_skills.md even when absent from source", async () => {
    // Source no longer ships these (they're user/runtime data), but the user has
    // them in target. Prune must exempt them exactly like the copy rule does.
    await writeFile(join(source, "autoviral", "SKILL.md"), "v1.3\n");
    await mkdir(join(target, "autoviral"), { recursive: true });
    await writeFile(join(target, "autoviral", "SKILL.md"), "v1.2\n");
    await writeFile(join(target, "autoviral", "config.yaml"), "user: data\n");
    await writeFile(join(target, "autoviral", "permitted_skills.md"), "runtime allow\n");
    await writeFile(markerOf(target), JSON.stringify({ version: "0.1.2" }));

    await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    // Exempt files survive the prune.
    expect(await readFile(join(target, "autoviral", "config.yaml"), "utf-8")).toBe("user: data\n");
    expect(await readFile(join(target, "autoviral", "permitted_skills.md"), "utf-8")).toBe(
      "runtime allow\n",
    );
  });

  it("prune leaves UNMANAGED sibling skills + the marker untouched", async () => {
    // Source only owns autoviral/. The target also has another skill the user
    // installed independently (skill-creator) + the sibling marker. Prune must
    // NOT reach outside the managed autoviral/ subtree.
    await writeFile(join(source, "autoviral", "SKILL.md"), "v1.3\n");
    await mkdir(join(target, "autoviral"), { recursive: true });
    await writeFile(join(target, "autoviral", "SKILL.md"), "v1.2\n");
    await mkdir(join(target, "skill-creator"), { recursive: true });
    await writeFile(join(target, "skill-creator", "SKILL.md"), "other skill\n");
    await writeFile(markerOf(target), JSON.stringify({ version: "0.1.2" }));

    await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    // Unmanaged sibling skill untouched.
    expect(await readFile(join(target, "skill-creator", "SKILL.md"), "utf-8")).toBe("other skill\n");
    // Marker still present (and bumped, not pruned).
    expect(existsSync(markerOf(target))).toBe(true);
    const marker = JSON.parse(await readFile(markerOf(target), "utf-8")) as { version: string };
    expect(marker.version).toBe(VERSION);
  });

  it("does NOT materialise an OUT-OF-TREE symlink sibling into the target", async () => {
    // The real siblings (caveman → ../.agents/skills/caveman) point OUTSIDE the
    // package's source tree — other packages' skills, dropped from the npm
    // tarball. Materialising them would diverge desktop from npm and clobber the
    // user's independently-managed skills, so they must be skipped, not copied.
    await writeFile(join(source, "autoviral", "SKILL.md"), "real\n");
    const outOfTree = join(root, "agents-skills", "caveman");
    await mkdir(outOfTree, { recursive: true });
    await writeFile(join(outOfTree, "inner.md"), "inner\n");
    await symlink(outOfTree, join(source, "caveman"));

    await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    // The out-of-tree symlink sibling was NOT copied/materialised under target.
    expect(existsSync(join(target, "caveman"))).toBe(false);
    // sanity: autoviral is a real dir.
    const st = await lstat(join(target, "autoviral"));
    expect(st.isDirectory()).toBe(true);
  });

  // ── B4 (PRD-0009): content-hash gate for same-version manual edits ─────────
  // The version-only gate froze the manual INSIDE a version: editing a `.md`
  // without a version bump never reached ~/.claude/skills, so `autoviral docs`
  // served stale docs (B4 parity break). The gate now also keys on a content
  // hash of the source autoviral `.md` subtree recorded in the marker — same
  // version but changed `.md` content still syncs. Legacy markers (no
  // contentHash) keep the pure-version behaviour so we don't re-clobber edits
  // on the first boot after this ships.
  it("re-syncs when the SAME version ships changed manual `.md` content (content-hash gate)", async () => {
    // First sync at VERSION writes a marker WITH a contentHash.
    await writeFile(join(source, "autoviral", "SKILL.md"), "# entry\n");
    await mkdir(join(source, "autoviral", "manual", "_shared"), { recursive: true });
    await writeFile(
      join(source, "autoviral", "manual", "_shared", "03-cli-reference.md"),
      "v1 of the manual\n",
    );

    const first = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });
    expect(first.synced).toBe(true);
    const marker1 = JSON.parse(await readFile(markerOf(target), "utf-8")) as {
      version: string;
      contentHash?: string;
    };
    expect(typeof marker1.contentHash).toBe("string");

    // Edit the manual WITHOUT bumping the version.
    await writeFile(
      join(source, "autoviral", "manual", "_shared", "03-cli-reference.md"),
      "v2 of the manual — new endpoints documented\n",
    );

    const second = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION, // SAME version
      markerPath: markerOf(target),
    });

    // Content drifted → it synced despite the matching version.
    expect(second.synced).toBe(true);
    expect(second.reason).toMatch(/content/i);
    expect(
      await readFile(
        join(target, "autoviral", "manual", "_shared", "03-cli-reference.md"),
        "utf-8",
      ),
    ).toBe("v2 of the manual — new endpoints documented\n");
    // The marker's hash advanced to the new content.
    const marker2 = JSON.parse(await readFile(markerOf(target), "utf-8")) as {
      contentHash?: string;
    };
    expect(marker2.contentHash).not.toBe(marker1.contentHash);
  });

  it("does NOT re-sync when the same version ships IDENTICAL manual content (hash matches → up-to-date)", async () => {
    await writeFile(join(source, "autoviral", "SKILL.md"), "# entry\n");
    await mkdir(join(source, "autoviral", "manual"), { recursive: true });
    await writeFile(join(source, "autoviral", "manual", "page.md"), "stable\n");

    const first = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });
    expect(first.synced).toBe(true);

    // Nothing changed in source — second run must skip.
    const second = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });
    expect(second.synced).toBe(false);
    expect(second.reason).toMatch(/up.?to.?date|version/i);
  });

  it("content gate NEVER clobbers the user's .yaml even when manual content drifts", async () => {
    // First sync seeds a contentHash + the user's config.
    await writeFile(join(source, "autoviral", "SKILL.md"), "# entry\n");
    await mkdir(join(source, "autoviral", "manual"), { recursive: true });
    await writeFile(join(source, "autoviral", "manual", "page.md"), "v1\n");
    await writeFile(join(source, "autoviral", "config.yaml"), "from: source\n");
    await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });
    // User edits their installed .yaml.
    await writeFile(join(target, "autoviral", "config.yaml"), "user: edits\n");

    // Source ships changed manual content (same version) → content gate fires.
    await writeFile(join(source, "autoviral", "manual", "page.md"), "v2\n");
    const res = await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });
    expect(res.synced).toBe(true);
    // The manual updated…
    expect(await readFile(join(target, "autoviral", "manual", "page.md"), "utf-8")).toBe("v2\n");
    // …but the user's .yaml is untouched (never-overwrite still holds).
    expect(await readFile(join(target, "autoviral", "config.yaml"), "utf-8")).toBe("user: edits\n");
  });

  it("DOES follow a symlink that resolves INSIDE the source tree (legit internal link)", async () => {
    // Internal symlinks (a manual page aliased within autoviral/) are part of our
    // package — they should be followed and copied, not skipped.
    await writeFile(join(source, "autoviral", "SKILL.md"), "real\n");
    await mkdir(join(source, "autoviral", "manual"), { recursive: true });
    await writeFile(join(source, "autoviral", "manual", "real.md"), "page\n");
    await symlink(
      join(source, "autoviral", "manual", "real.md"),
      join(source, "autoviral", "alias.md"),
    );

    await syncSkills({
      sourceSkillsDir: source,
      targetSkillsDir: target,
      version: VERSION,
      markerPath: markerOf(target),
    });

    // The in-tree symlink's content was materialised into the target.
    expect(await readFile(join(target, "autoviral", "alias.md"), "utf-8")).toBe("page\n");
  });
});
