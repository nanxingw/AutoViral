// `autoviral comp [show|diff|put|validate]` — composition.yaml read +
// full-write + preflight surface.
//
// `validate <file|->` (S13 / US 11/12) PREFLIGHTS a candidate composition
// WITHOUT writing it: reads the same way `put` does, POSTs to /comp/validate,
// and renders the {ok,errors,warnings} verdict (exit 4 on blocking errors,
// 0 on warnings-only). The cheap "check before you commit" path that replaces
// the agent's "PUT → 400 → read zod dump → guess" loop.
//
// `show` returns the full composition.yaml as structured data; pipe to jq
// in agent contexts, scan as YAML in interactive ones.
//
// `diff` (Phase 5 Task 5.4) prints the unified diff between
// composition.yaml.previous (snapshot taken just before the most recent
// write) and the current composition.yaml. Exits 0 with `(no changes
// since last write)` if the two are identical; 0 with a friendly note
// if no baseline snapshot exists yet (first write of this workspace).
//
// `put <file|->` (S4 / US 10) is the full-composition write escape hatch: read
// a COMPLETE composition from a file (or stdin via `-`), parse it (YAML, which
// is a superset of JSON, so either input format works), and PUT it through the
// bridge chokepoint (zod validate → atomic rename + composition-changed
// broadcast). Before the intent-level verbs exist — or for a rich edit no
// single verb covers — this is the universal write path the agent reaches for.

import { readFile } from "node:fs/promises";
import { parse as yamlParse } from "yaml";
import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

interface CompDiffResult {
  diff: string;
  hasBaseline: boolean;
}

// Read a composition source: `-` means stdin, anything else is a file path.
// Returns the raw text; the caller parses it. A missing file / unreadable
// stdin is an input error (exit 4) — we never round-trip a half-read body.
async function readCompSource(source: string): Promise<string> {
  if (source === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(source, "utf8");
}

export async function compCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "show" || sub === undefined) {
    const ctx = readContext();
    const result = await bridgeRequest<unknown>(ctx, "GET", "/comp");
    writeOut(result);
    return;
  }
  if (sub === "diff") {
    const ctx = readContext();
    const result = await bridgeRequest<CompDiffResult>(ctx, "GET", "/comp/diff");
    if (!result.hasBaseline) {
      process.stdout.write(
        "(no prior write to diff against — composition.yaml.previous has not been written yet)\n",
      );
      return;
    }
    if (result.diff === "") {
      process.stdout.write("(no changes since last write)\n");
      return;
    }
    process.stdout.write(result.diff);
    return;
  }
  if (sub === "put") {
    const source = args[1];
    const comp = await readCompCandidate("put", source);
    const ctx = readContext();
    // The bridge re-validates against CompositionSchema; an invalid composition
    // 400s with code:4 → bridgeRequest exits 4 (and disk is left untouched).
    await bridgeRequest(ctx, "PUT", "/comp", comp);
    // Confirm the write on stdout, in step with the sibling write verbs
    // (`clip add` / `carousel set-layer` / `checkpoint restore` all print). A
    // silent success on a full-composition overwrite is the riskiest write to
    // leave unacknowledged.
    process.stdout.write(
      `wrote composition from ${source === "-" ? "stdin" : source}\n`,
    );
    return;
  }
  if (sub === "validate") {
    // S13 (US 11/12) — PREFLIGHT a candidate composition WITHOUT writing it.
    // Reads the same way `put` does (file or stdin, YAML/JSON), then POSTs to
    // /comp/validate which returns a {ok,errors,warnings} verdict — never
    // touching disk. This is the cheap "check before you commit" path that
    // replaces the agent's costly "PUT → 400 → read zod dump → guess" loop.
    const source = args[1];
    const comp = await readCompCandidate("validate", source);
    const ctx = readContext();
    const verdict = await bridgeRequest<PreflightVerdict>(
      ctx,
      "POST",
      "/comp/validate",
      comp,
    );
    if (args.includes("--json")) {
      writeOut(verdict);
    } else {
      renderVerdict(verdict);
    }
    // Exit code is the agent's control signal: blocking errors → 4 (same class
    // as a rejected write); warnings alone do NOT fail (the write path would
    // still accept the candidate).
    if (!verdict.ok) process.exitCode = 4;
    return;
  }
  process.stderr.write(`autoviral comp: unknown subcommand "${sub}"\n`);
  process.exit(127);
}

interface PreflightVerdict {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// Shared read+parse for the full-composition input verbs (`put`, `validate`).
// `verb` only shapes the diagnostics. Any failure exits 4 BEFORE the bridge.
async function readCompCandidate(verb: string, source: string | undefined): Promise<unknown> {
  if (!source) {
    // `-` is the stdin token (matches the actual arg the reader accepts +
    // the `--help` line in cli.ts); keep this usage string aligned with it.
    process.stderr.write(`usage: autoviral comp ${verb} <file|->\n`);
    process.exit(4);
  }
  let raw: string;
  try {
    raw = await readCompSource(source);
  } catch (err) {
    // Missing file / unreadable stdin is an input error → exit 4, no bridge.
    process.stderr.write(
      `autoviral comp ${verb}: cannot read ${source === "-" ? "stdin" : source}: ${
        (err as Error).message
      }\n`,
    );
    process.exit(4);
  }
  let comp: unknown;
  try {
    // yaml.parse handles both YAML and JSON (JSON is a YAML subset), so the
    // agent can pipe either format. A parse failure is an input error.
    comp = yamlParse(raw);
  } catch (err) {
    process.stderr.write(
      `autoviral comp ${verb}: ${source === "-" ? "stdin" : source} is not valid YAML/JSON: ${
        (err as Error).message
      }\n`,
    );
    process.exit(4);
  }
  // `typeof [] === "object"` and `typeof null === "object"`, so guard both:
  // a top-level YAML/JSON ARRAY (or null/scalar) is not a composition object
  // and must fail fast as an input error before it reaches the bridge.
  if (comp === null || typeof comp !== "object" || Array.isArray(comp)) {
    process.stderr.write(
      `autoviral comp ${verb}: ${source === "-" ? "stdin" : source} did not parse to a composition object\n`,
    );
    process.exit(4);
  }
  return comp;
}

// Human-readable rendering of a preflight verdict. Errors go to stderr (they're
// the actionable failures), warnings to stdout, and a clean candidate prints a
// single confirmation line.
function renderVerdict(verdict: PreflightVerdict): void {
  for (const e of verdict.errors) process.stderr.write(`✗ ${e}\n`);
  for (const w of verdict.warnings) process.stdout.write(`⚠ ${w}\n`);
  if (verdict.ok && verdict.warnings.length === 0) {
    process.stdout.write("ok — composition is valid (no errors, no warnings)\n");
  } else if (verdict.ok) {
    process.stdout.write(
      `ok — composition is valid (${verdict.warnings.length} warning(s))\n`,
    );
  } else {
    process.stderr.write(
      `invalid — ${verdict.errors.length} error(s), ${verdict.warnings.length} warning(s)\n`,
    );
  }
}
