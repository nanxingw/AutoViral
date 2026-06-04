// `autoviral snapshot [--at <time>] [--slide <id>]` — I21.
//
// Capture the CURRENT frame (video) or slide (carousel) as a PNG and print its
// absolute path, so the agent can `Read` it and visually self-check its output
// before declaring done (invariant #6 — verify what's actually visible, don't
// assume the backend artifact is right).
//
//   video work     → Remotion renderStill at the current playhead, or at
//                    --at <seconds|'12.5s'|'1m30s'> if given.
//   carousel work  → the current slide's PNG, or --slide <id> if given.
//
// Output is a single line: the absolute PNG path. The agent Reads that path.
// When the bridge reports `textLayersComposited:false` (carousel background-only
// fallback — no headless Konva renderer), we ALSO print a caveat line to stderr
// so the agent knows the PNG is base-only and must NOT infer text layout /
// overflow from it. stdout stays a clean path for `$(autoviral snapshot)`.

import { bridgeRequest, readContext } from "../client.js";
import { parseTime } from "./seek.js";

interface SnapshotFlags {
  at?: number;
  slide?: string;
}

function parseFlags(args: string[]): SnapshotFlags {
  const out: SnapshotFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--at") {
      const raw = args[++i];
      if (raw === undefined) {
        process.stderr.write("autoviral snapshot: --at needs a time value\n");
        process.exit(4);
      }
      const seconds = parseTime(raw);
      if (seconds === null) {
        process.stderr.write(
          `autoviral snapshot: bad --at time format ${raw} (use seconds|'12.5s'|'1m30s')\n`,
        );
        process.exit(4);
      }
      out.at = seconds;
    } else if (a === "--slide") {
      out.slide = args[++i];
      if (out.slide === undefined) {
        process.stderr.write("autoviral snapshot: --slide needs a slide id\n");
        process.exit(4);
      }
    } else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    }
  }
  return out;
}

export async function snapshotCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const ctx = readContext();
  const body: Record<string, unknown> = {};
  if (flags.at !== undefined) body.at = flags.at;
  if (flags.slide !== undefined) body.slide = flags.slide;
  const result = await bridgeRequest<{
    path: string;
    kind: string;
    textLayersComposited?: boolean;
  }>(ctx, "POST", "/snapshot", body);
  // Print the absolute path on its own line — the whole point is for the agent
  // to `Read` it next. Keep it parse-clean (no decoration) so `$(autoviral
  // snapshot)` substitution works in a shell too.
  process.stdout.write(`${result.path}\n`);
  // Honesty caveat for the carousel background-only fallback: the PNG is the
  // slide BASE only (Konva text/shape/sticker layers aren't composited
  // server-side). Goes to stderr so it never pollutes the path on stdout.
  if (result.textLayersComposited === false) {
    process.stderr.write(
      "⚠ carousel snapshot shows the slide background only; text/sticker layers are NOT composited (no headless carousel renderer yet) — do not infer text layout/overflow from this image.\n",
    );
  }
}
