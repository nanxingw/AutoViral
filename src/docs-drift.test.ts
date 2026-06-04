import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "./ws-bridge.js";

// docs-drift guard (PRD-0002 I05, extended by I09). The system prompt +
// SKILL.md hard-code references to manual chapters — `autoviral docs
// video/02-composition-schema`, `manual/_shared/00-quickstart.md`, etc.
// When the manual is restructured, any rename silently dangles these refs:
// the agent runs `autoviral docs <topic>` and gets a 404 nobody notices.
// This is an fs contract — every manual/docs reference must resolve to a real
// file under skills/autoviral/manual/. Enumerated as a SWEEP over the whole
// reference family (not the handful listed today), so a new reference form
// is caught automatically and there is NO or-fallback that lets a miss pass.
//
// I09 co-located the manual by content type: chapters now live under
// manual/_shared/, manual/video/, manual/carousel/ (not flat). The reference
// forms in the prompt + SKILL.md changed to match (`autoviral docs
// <subdir>/<chapter>`, `manual/<subdir>/NN-slug.md`). This guard tracks BOTH
// the subdir docs-slug form and the subdir file-path form, recursing into the
// subtree so a rename anywhere in the manual tree turns it red.

// Anchor to THIS file, not process.cwd(), so the guard is cwd-independent.
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..");
const MANUAL_DIR = join(REPO_ROOT, "skills", "autoviral", "manual");
const SKILL_MD = join(REPO_ROOT, "skills", "autoviral", "SKILL.md");

// Every chapter file actually on disk, RECURSING into the content-type subdirs
// (manual/_shared/, manual/video/, manual/carousel/, ...). Returns the relative
// paths from MANUAL_DIR (e.g. "video/02-composition-schema.md"). Used to
// (a) sanity-floor the chapter count and (b) verify a bare chapter prefix like
// "02" resolves somewhere in the tree.
function manualChapterFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && /\.md$/.test(e.name)) out.push(prefix + e.name);
      else if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
    }
  };
  walk(MANUAL_DIR, "");
  return out;
}

// Placeholders the prompt/SKILL use for "any topic" — NOT real references.
// They must be excluded from the sweep, but nothing else may be.
const PLACEHOLDER_TOPICS = new Set(["topic"]);

type Ref = { source: string; raw: string; kind: "docs" | "file"; assert: () => void };

// Pull every manual/docs reference out of one text blob. Two reference forms
// survive the I09 co-location, each mapped to a concrete fs assertion:
//
//   Form A — `autoviral docs <subdir>/<chapter>` (the topic the CLI resolves)
//   Form B — `manual/<subdir>/<chapter>.md` (an exact in-tree file path)
//
// Both resolve the path against MANUAL_DIR exactly as the server's /docs
// endpoint does, so a dangling subdir ref (e.g. a rename of
// video/02-composition-schema.md) makes this guard red. No regex is "best
// effort": an unrecognised but reference-looking token would simply not be
// collected, so the sweep is exhaustive over the forms that actually appear
// (asserted by the coverage test below).
function extractRefs(source: string, text: string): Ref[] {
  const refs: Ref[] = [];

  // Form A: `autoviral docs <slug>` — a topic is a slug, now allowing one or
  // more `/`-separated path segments (e.g. `video/02-composition-schema`,
  // `_shared/03-cli-reference`). `<topic>` / `[topic]` placeholders never match
  // this shape. A leading `_` is allowed for the `_shared` subdir.
  const docsRx =
    /autoviral docs ([a-z0-9_][a-z0-9-]*(?:\/[a-z0-9_][a-z0-9-]*)*)/g;
  for (const m of text.matchAll(docsRx)) {
    const topic = m[1];
    if (PLACEHOLDER_TOPICS.has(topic)) continue;
    refs.push({
      source,
      raw: m[0],
      kind: "docs",
      assert: () =>
        expect(
          existsSync(join(MANUAL_DIR, `${topic}.md`)),
          `${source}: \`${m[0]}\` -> ${topic}.md must exist under skills/autoviral/manual/`,
        ).toBe(true),
    });
  }

  // Form B: `manual/<path>/NN-slug.md` — an exact file path into the manual
  // tree (one or more subdir segments, then an NN-slug chapter file). This is
  // the SKILL.md "read these" list. The leading subdir segment may start with
  // `_` (the _shared subtree).
  const fileRx = /manual\/((?:[a-z0-9_][a-z0-9-]*\/)+\d{2}-[a-z0-9-]+\.md)/g;
  for (const m of text.matchAll(fileRx)) {
    refs.push({
      source,
      raw: m[0],
      kind: "file",
      assert: () =>
        expect(
          existsSync(join(MANUAL_DIR, m[1])),
          `${source}: \`${m[0]}\` -> ${m[1]} must exist under skills/autoviral/manual/`,
        ).toBe(true),
    });
  }

  return refs;
}

function allRefs(): Ref[] {
  const promptVariants = [
    buildSystemPrompt(
      { id: "w_test", type: "short-video", platforms: ["douyin"] } as any,
      { port: 3271, workspacePath: "/tmp/a/works/w" },
    ),
    buildSystemPrompt(
      { id: "w_test", type: "image-text", platforms: ["xiaohongshu"] } as any,
      { port: 3271, workspacePath: "/tmp/a/works/w" },
    ),
  ];
  const skillMd = readFileSync(SKILL_MD, "utf8");

  const refs: Ref[] = [];
  promptVariants.forEach((p, i) => refs.push(...extractRefs(`buildSystemPrompt[${i}]`, p)));
  refs.push(...extractRefs("SKILL.md", skillMd));
  return refs;
}

describe("docs-drift guard — manual/docs references must resolve to real files", () => {
  it("finds the manual dir and at least the 6 base chapters (recursing subdirs)", () => {
    expect(existsSync(MANUAL_DIR)).toBe(true);
    const files = manualChapterFiles();
    // Sanity floor: the manual still ships at least its 6 base chapters, now
    // spread across the _shared / video / carousel subtrees. The per-ref sweep
    // below is what actually guards drift.
    expect(files.length).toBeGreaterThanOrEqual(6);
    // Co-location invariant: chapters live in subdirs, not flat at the top.
    expect(files.every((f) => f.includes("/"))).toBe(true);
    // The three content-type subtrees each carry at least one chapter.
    expect(files.some((f) => f.startsWith("_shared/"))).toBe(true);
    expect(files.some((f) => f.startsWith("video/"))).toBe(true);
    expect(files.some((f) => f.startsWith("carousel/"))).toBe(true);
  });

  it("sweeps EVERY manual/docs reference in prompt + SKILL.md and asserts the file exists", () => {
    const refs = allRefs();
    // The sweep must actually be finding references — a regex that silently
    // matched nothing would be a vacuously-green guard.
    expect(refs.length, "the reference sweep matched zero refs — regex is broken").toBeGreaterThan(0);
    for (const ref of refs) {
      ref.assert();
    }
  });

  // S1 (US 35/36/37) —止谎. The crossfade recipe used to print a literal
  // `autoviral clip set <id> --keyframes '<json-array>'` command. That path is
  // guaranteed to 400: the CLI flag parser sends `keyframes` as a SCALAR
  // (string), but the bridge's clip-patch schema expects a Keyframe[] array, so
  // the on-disk comp is never touched. An agent that trusts the manual and runs
  // it verbatim burns its whole session budget on a command that can't succeed
  // until the keyframe verb / `transition add` (S9/S12) ships. The recipe must
  // not advertise the broken command.
  it("the crossfade recipe never prints a `clip set --keyframes` command (it necessarily 400s pre-S9/S12)", () => {
    const recipe = readFileSync(
      join(
        REPO_ROOT,
        "skills",
        "autoviral",
        "recipes",
        "video",
        "crossfade-between-clips.md",
      ),
      "utf8",
    );
    // An agent copy-pastes runnable commands out of ```fenced``` code blocks.
    // Inline prose / blockquotes documenting the anti-pattern ("do NOT run
    // `clip set --keyframes`") are fine — those educate. What must NOT survive
    // is the broken invocation living inside an executable code fence. So we
    // strip fenced blocks out and assert no fence carries the 400-guaranteed
    // `clip set ... --keyframes` command.
    const fences = [...recipe.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(
      (m) => m[1],
    );
    const brokenCmd = /clip set\b[^\n]*--keyframes/;
    const offendingFence = fences.find((f) => brokenCmd.test(f));
    expect(
      offendingFence,
      "a runnable code fence still contains `clip set --keyframes`, which 400s — remove it or gate it behind the S9/S12 verb",
    ).toBeUndefined();
  });

  it("covers both reference families (docs-slug + file-path) so a new form can't slip the net unnoticed", () => {
    const refs = allRefs();
    const haveDocsSlug = refs.some((r) => r.kind === "docs");
    const haveFile = refs.some((r) => r.kind === "file");
    // These are the two forms present in the I09 prompt + SKILL.md. If a future
    // edit drops a whole family the coverage erodes silently; assert each is
    // still represented so the guard keeps biting. Both forms now carry subdir
    // segments — assert at least one ref of each is a true subdir reference.
    expect(haveDocsSlug, "no `autoviral docs <subdir>/<chapter>` ref found").toBe(true);
    expect(haveFile, "no `manual/<subdir>/NN-slug.md` ref found").toBe(true);
    expect(
      refs.some((r) => r.kind === "docs" && /autoviral docs [a-z0-9_]+\//.test(r.raw)),
      "no SUBDIR `autoviral docs` ref — co-location regressed to flat topics",
    ).toBe(true);
    expect(
      refs.some((r) => r.kind === "file" && /manual\/[a-z0-9_]+\//.test(r.raw)),
      "no SUBDIR `manual/...` file ref — co-location regressed to flat paths",
    ).toBe(true);
  });
});
