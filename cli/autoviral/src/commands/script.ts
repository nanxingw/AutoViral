// `autoviral script [show|edit]` — read + write the planning-layer 剧本
// (plan/script.md), the narrative outline that twins the storyboard.
//
// S5 (PRD-0007 §4.5). The 剧本 is a first-class, read/write, watch-refreshable
// markdown artifact: the "PRD" of a video plan. Unlike the composition verbs
// (which round-trip through the bridge's JSON envelope), this surface targets
// the works route `/api/works/:id/plan/script.md` directly because the body is
// raw markdown, not a structured composition — GET returns the markdown text,
// PUT takes markdown text and broadcasts plan-changed so the Studio script
// editor refetches live.
//
//  - `script show`   → GET the markdown, print to stdout (empty body → prints
//    nothing; the file may not exist yet — that is a clean empty plan, NOT an
//    error).
//  - `script edit [--file <path>]` → read markdown from `--file` (or stdin) and
//    PUT it. Reading a missing file / unreadable stdin is an input error (exit
//    4) BEFORE the request — we never round-trip a half-read body.

import { readFile } from "node:fs/promises";
import { apiText, readContext } from "../client.js";

const SCRIPT_PATH = "/plan/script.md";

// Read a markdown source: `--file <path>` reads the file; absent → stdin.
async function readScriptSource(file: string | undefined): Promise<string> {
  if (file) return readFile(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseFileFlag(args: string[]): string | undefined {
  const i = args.indexOf("--file");
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v) {
    process.stderr.write("autoviral script edit: --file requires a path\n");
    process.exit(4);
  }
  return v;
}

export async function scriptCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "show" || sub === undefined) {
    const ctx = readContext();
    const md = await apiText(ctx, "GET", SCRIPT_PATH);
    // Write the markdown verbatim — no envelope, no isTTY YAML re-encode (the
    // body IS the human-readable artifact). An empty body prints nothing.
    process.stdout.write(md);
    return;
  }

  if (sub === "edit") {
    const file = parseFileFlag(args.slice(1));
    let md: string;
    try {
      md = await readScriptSource(file);
    } catch (err) {
      // Missing file / unreadable stdin is an input error → exit 4, no request.
      process.stderr.write(
        `autoviral script edit: cannot read ${file ?? "stdin"}: ${
          (err as Error).message
        }\n`,
      );
      process.exit(4);
    }
    const ctx = readContext();
    await apiText(ctx, "PUT", SCRIPT_PATH, md);
    process.stdout.write(
      `wrote script from ${file ?? "stdin"}\n`,
    );
    return;
  }

  process.stderr.write(`autoviral script: unknown subcommand "${sub}"\n`);
  process.exit(127);
}
