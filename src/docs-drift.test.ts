import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "./ws-bridge.js";

// docs-drift guard (PRD-0002 I05). The system prompt + SKILL.md hard-code
// references to manual chapters — `autoviral docs 02-composition-schema`,
// `manual/02`, `manual/00-quickstart.md`, the `manual/00-05` range, etc.
// When I09 restructures the manual, any rename silently dangles these refs:
// the agent runs `autoviral docs <topic>` and gets a 404 nobody notices.
// This is an fs contract — every manual/docs reference must resolve to a real
// file under skills/autoviral/manual/. Enumerated as a SWEEP over the whole
// reference family (not the handful listed today), so a new reference form
// is caught automatically and there is NO or-fallback that lets a miss pass.

// Anchor to THIS file, not process.cwd(), so the guard is cwd-independent.
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..");
const MANUAL_DIR = join(REPO_ROOT, "skills", "autoviral", "manual");
const SKILL_MD = join(REPO_ROOT, "skills", "autoviral", "SKILL.md");

// All chapter files actually on disk, indexed by their two-digit chapter prefix
// (e.g. "02" -> "02-composition-schema.md"). The bare-number + range reference
// forms resolve against this map.
function manualChapterIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  for (const f of readdirSync(MANUAL_DIR)) {
    const m = /^(\d{2})-[a-z0-9-]+\.md$/.exec(f);
    if (m) idx.set(m[1], f);
  }
  return idx;
}

// Placeholders the prompt/SKILL use for "any topic" — NOT real references.
// They must be excluded from the sweep, but nothing else may be.
const PLACEHOLDER_TOPICS = new Set(["topic"]);

type Ref = { source: string; raw: string; assert: (idx: Map<string, string>) => void };

// Pull every manual/docs reference out of one text blob. Three reference forms,
// each mapped to a concrete fs assertion. No regex is "best effort": an
// unrecognised but reference-looking token would simply not be collected, so the
// sweep is exhaustive over the forms that actually appear (asserted below).
function extractRefs(source: string, text: string): Ref[] {
  const refs: Ref[] = [];

  // Form 1: `autoviral docs <slug>` — a real topic is two digits + "-" + slug
  // (e.g. 02-composition-schema). `<topic>` / `[topic]` placeholders never
  // match this shape, so they're excluded by construction.
  //
  // I08 — a topic may now be a SUBDIR chapter like `carousel/02-schema` (the
  // server resolves the `/` into a real subdir under manual/). The slug class
  // therefore allows `/` segments. The fs assertion resolves the topic against
  // MANUAL_DIR exactly as the server's /docs endpoint does, so a dangling
  // subdir ref (e.g. a rename of carousel/02-schema.md) makes this guard red.
  const docsRx = /autoviral docs ([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)/g;
  for (const m of text.matchAll(docsRx)) {
    const topic = m[1];
    if (PLACEHOLDER_TOPICS.has(topic)) continue;
    refs.push({
      source,
      raw: m[0],
      assert: () =>
        expect(
          existsSync(join(MANUAL_DIR, `${topic}.md`)),
          `${source}: \`${m[0]}\` -> ${topic}.md must exist under skills/autoviral/manual/`,
        ).toBe(true),
    });
  }

  // Form 2: `manual/NN-NN` RANGE (both sides numeric, e.g. manual/00-05) —
  // every chapter in [lo, hi] inclusive must exist.
  const rangeRx = /manual\/(\d{2})-(\d{2})\b(?!-)/g;
  const rangeSpans: Array<[number, number]> = [];
  for (const m of text.matchAll(rangeRx)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    rangeSpans.push([m.index!, m.index! + m[0].length]);
    refs.push({
      source,
      raw: m[0],
      assert: (idx) => {
        for (let n = lo; n <= hi; n++) {
          const key = String(n).padStart(2, "0");
          expect(
            idx.has(key),
            `${source}: \`${m[0]}\` range chapter ${key} must have a ${key}-*.md under skills/autoviral/manual/`,
          ).toBe(true);
        }
      },
    });
  }

  // Form 3a: `manual/NN-slug.md` — exact filename reference.
  const fileRx = /manual\/(\d{2}-[a-z0-9-]+\.md)/g;
  for (const m of text.matchAll(fileRx)) {
    refs.push({
      source,
      raw: m[0],
      assert: () =>
        expect(
          existsSync(join(MANUAL_DIR, m[1])),
          `${source}: \`${m[0]}\` -> ${m[1]} must exist under skills/autoviral/manual/`,
        ).toBe(true),
    });
  }

  // Form 3b: `manual/NN` bare chapter number (not `.md`, not a range) —
  // must resolve to exactly one NN-*.md.
  const bareRx = /manual\/(\d{2})\b(?!-)/g;
  for (const m of text.matchAll(bareRx)) {
    // Skip if this NN was the leading side of a range we already counted.
    const inRange = rangeSpans.some(([s, e]) => m.index! >= s && m.index! < e);
    if (inRange) continue;
    const key = m[1];
    refs.push({
      source,
      raw: m[0],
      assert: (idx) =>
        expect(
          idx.has(key),
          `${source}: \`${m[0]}\` must resolve to a ${key}-*.md under skills/autoviral/manual/`,
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
  it("finds the manual dir and at least the 6 base chapters", () => {
    expect(existsSync(MANUAL_DIR)).toBe(true);
    const idx = manualChapterIndex();
    // Sanity floor: the current manual ships 00..05. If I09 renumbers, this
    // floor may legitimately change — but the per-ref sweep below is what
    // actually guards drift.
    expect(idx.size).toBeGreaterThanOrEqual(6);
  });

  it("sweeps EVERY manual/docs reference in prompt + SKILL.md and asserts the file exists", () => {
    const idx = manualChapterIndex();
    const refs = allRefs();
    // The sweep must actually be finding references — a regex that silently
    // matched nothing would be a vacuously-green guard.
    expect(refs.length, "the reference sweep matched zero refs — regex is broken").toBeGreaterThan(0);
    for (const ref of refs) {
      ref.assert(idx);
    }
  });

  it("covers all three reference families (docs-slug, file, bare/range) so a new form can't slip the net unnoticed", () => {
    const refs = allRefs();
    const haveDocsSlug = refs.some((r) => /autoviral docs \d{2}-/.test(r.raw));
    const haveBareOrRange = refs.some((r) => /^manual\/\d{2}(-\d{2})?$/.test(r.raw));
    const haveFile = refs.some((r) => /^manual\/\d{2}-[a-z0-9-]+\.md$/.test(r.raw));
    // These three are the forms present in the current prompt + SKILL.md.
    // If a future edit drops a whole family the coverage erodes silently;
    // assert each is still represented so the guard keeps biting.
    expect(haveDocsSlug, "no `autoviral docs NN-slug` ref found").toBe(true);
    expect(haveBareOrRange, "no `manual/NN` bare/range ref found").toBe(true);
    expect(haveFile, "no `manual/NN-slug.md` filename ref found").toBe(true);
  });
});
