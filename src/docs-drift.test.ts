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

  // S1 (US 35/36/37) —止谎 / S12 — the runnable path now exists. The crossfade
  // recipe used to print a literal `autoviral clip set <id> --keyframes
  // '<json-array>'` command, which is guaranteed to 400: the CLI flag parser
  // sends `keyframes` as a SCALAR (string), but the bridge's clip-patch schema
  // expects a Keyframe[] array, so the on-disk comp is never touched. S1 deleted
  // that command and gated the recipe behind a "not yet runnable" notice. S12
  // ships the real verbs (`transition add` for the easy dissolve, `clip keyframe
  // add/set` for hand-authored fades), so the recipe is rewritten to show those.
  // This guard now does BOTH: (a) the broken `clip set --keyframes` command must
  // still never reappear in a runnable fence, and (b) the recipe MUST advertise
  // at least one of the runnable S9/S12 verbs in a fence (the "not yet runnable"
  // era is over — leaving the recipe verb-less would re-strand the agent).
  it("the crossfade recipe never prints a `clip set --keyframes` command but DOES show a runnable verb (S9/S12)", () => {
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
    // S1 fix-up — the original `clip set\b[^\n]*--keyframes` only caught the
    // broken command when it lived on ONE line. The removed batch snippet used
    // backslash line-continuation (`clip set "$id" --out "$out" \` then
    // `--keyframes "$kfs"` on the next line); `[^\n]*` stops at the newline, so
    // a multi-line reintroduction of the exact deleted pattern slipped the
    // guard. Collapse backslash-newline continuations within each fence first
    // so a `clip set ... \<newline>... --keyframes` spread across lines is
    // treated as the single command it is, then match.
    const collapseContinuations = (f: string) => f.replace(/\\\n\s*/g, " ");
    const brokenCmd = /clip set\b[^\n]*--keyframes/;
    const offendingFence = fences.find((f) =>
      brokenCmd.test(collapseContinuations(f)),
    );
    expect(
      offendingFence,
      "a runnable code fence still contains `clip set --keyframes`, which 400s — use `clip keyframe` / `transition add` instead",
    ).toBeUndefined();

    // S12 — the recipe must now point at a verb that actually works. At least
    // one fence must carry `transition add` (the easy dissolve) or `clip
    // keyframe` (hand-authored fades). A recipe with no runnable verb is the
    // same dead-end the "not yet runnable" notice was — it must not regress to
    // that state.
    const runnableVerb = /autoviral (?:transition add|clip keyframe)\b/;
    const runnableFence = fences.find((f) => runnableVerb.test(f));
    expect(
      runnableFence,
      "the crossfade recipe shows no runnable verb — it must demonstrate `transition add` or `clip keyframe` (S9/S12 shipped them)",
    ).toBeDefined();
  });

  // S1 (US 35/36/37) fix-up —止谎 parity with the cli.test.ts `--help` guard.
  // S1 removed the overlay false-promise from `cli.ts --help` but left it in
  // the CLI-REFERENCE MANUAL (the declared single source of truth for
  // `autoviral docs`) and a sibling recipe. The live bridge writes
  // video/audio/text and throws ONLY on overlay (routes.ts:595, HTTP 400), so
  // any manual that advertises `--track overlay` as a usable clip-add value —
  // or claims audio/text DON'T write — re-introduces the exact lie S1 killed.
  // Guard the manual chapter's clip-add row + the recipe the same way the CLI
  // help is guarded, so the two surfaces can't diverge again.
  it("the CLI-REFERENCE manual's `clip add --track` row does NOT advertise the overlay track (it 400s)", () => {
    const ref = readFileSync(
      join(MANUAL_DIR, "_shared", "03-cli-reference.md"),
      "utf8",
    );
    // Find the `--track <kind>` row in the clip-add flag table and assert it
    // lists no `overlay` value (overlay clip-add throws at the bridge).
    const trackRow = ref
      .split("\n")
      .find((l) => /`--track\b/.test(l) && /\bvideo\b/.test(l));
    expect(
      trackRow,
      "could not find the `--track` flag row in 03-cli-reference.md",
    ).toBeDefined();
    expect(
      trackRow,
      "the `--track` row still advertises `overlay`, but `clip add --track overlay` 400s — drop it",
    ).not.toMatch(/overlay/);
  });

  it("the i2v batch recipe never claims audio/text clip-add is unsupported (they write today)", () => {
    const recipe = readFileSync(
      join(
        REPO_ROOT,
        "skills",
        "autoviral",
        "recipes",
        "video",
        "generate-i2v-batch.md",
      ),
      "utf8",
    );
    // The pre-fix lie: "clip add currently only writes video clips" /
    // "Audio/text/overlay clip-add ... widened in Phase 5". Audio + text DO
    // write today (routes.ts handles both); only overlay throws. Assert the
    // recipe doesn't claim audio/text clip-add is unavailable.
    expect(recipe).not.toMatch(/only writes `video` clips/i);
    expect(recipe).not.toMatch(/[Aa]udio\/text\/overlay clip-add/);
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
