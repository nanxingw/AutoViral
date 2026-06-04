// `autoviral comp [show|diff|put]` — composition.yaml read + full-write surface.
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
    if (!source) {
      // `-` is the stdin token (matches the actual arg the reader accepts +
      // the `--help` line in cli.ts); keep this usage string aligned with it.
      process.stderr.write("usage: autoviral comp put <file|->\n");
      process.exit(4);
    }
    let raw: string;
    try {
      raw = await readCompSource(source);
    } catch (err) {
      // Missing file / unreadable stdin is an input error → exit 4, no bridge.
      process.stderr.write(
        `autoviral comp put: cannot read ${source === "-" ? "stdin" : source}: ${
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
        `autoviral comp put: ${source === "-" ? "stdin" : source} is not valid YAML/JSON: ${
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
        `autoviral comp put: ${source === "-" ? "stdin" : source} did not parse to a composition object\n`,
      );
      process.exit(4);
    }
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
  process.stderr.write(`autoviral comp: unknown subcommand "${sub}"\n`);
  process.exit(127);
}
