// `autoviral checkpoint create | list | restore <id>` — S21 (US 33/34) + D3.
//
// SNAPSHOT TRIGGER BOUNDARY (read this — the old教学 said "every agent turn",
// which is only true for the ws-bridge agent loop, NOT a pure CLI agent):
//   • ws-bridge agent turn — the Studio's chat agent auto-snapshots on each
//     turn_complete. A pure CLI agent (claude/codex/… driving `autoviral` on a
//     PATH) does NOT go through that loop, so it gets NO automatic snapshot.
//   • HTTP `POST /api/works/:id/checkpoints` — the manual trigger the UI uses.
//   • `autoviral checkpoint create` (this verb) — the SAME manual trigger,
//     reachable from a pure CLI agent. Take a snapshot BEFORE a risky edit so
//     `checkpoint restore` has something to roll back to.
//
// This command gives the agent (and a human typing in the Studio terminal):
//
//   checkpoint create [--label]  Snapshot the live deliverable(s) NOW. Idempotent:
//                                an unchanged yaml writes nothing. Prints the
//                                snapshot file(s) written (or a no-op note).
//   checkpoint list              List rollback history, newest first. JSON when
//                                piped (agent), YAML when interactive (human).
//   checkpoint restore <id>      Roll the live deliverable back to checkpoint <id>
//                                (its `file` name, e.g.
//                                2026-05-08T12-34-56Z__a1b2c3d4__carousel.yaml).
//
// SAFETY (#68): the server snapshots the CURRENT live state BEFORE overwriting
// it, so restore is reversible — a user's pending, never-checkpointed edits are
// preserved as a fresh checkpoint rather than silently destroyed. We surface
// that to the operator so they know the undo exists.
//
// `create` hits the WORKS route (POST /api/works/:id/checkpoints → bare
// `{ written }` JSON), not the bridge envelope — that's where the #90 label
// semantics + createCheckpoint live. `list`/`restore` go through the bridge.

import { apiJson, bridgeRequest, readContext } from "../client.js";
import { parseFormatFlag, writeOut } from "../output.js";

interface CheckpointRow {
  file: string;
  deliverable: string;
  ts: string;
  sha: string;
  bytes: number;
  label?: string;
}

export async function checkpointCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  // checkpoint create [--label <text>] — manual snapshot trigger (D3). Hits the
  // WORKS route (bare `{ written }` JSON, not the bridge envelope). Idempotent:
  // an unchanged deliverable yaml writes nothing → we report the no-op instead
  // of pretending we snapshotted (you can't name a no-op — #90).
  if (sub === "create") {
    const label = readLabelFlag(rest);
    const body = label === undefined ? undefined : { label };
    const out = await apiJson<{ written: CheckpointRow[] }>(
      ctx,
      "POST",
      "/checkpoints",
      body,
    );
    const written = out.written ?? [];
    if (written.length === 0) {
      process.stderr.write(
        "checkpoint create: no change since the last snapshot — nothing written (the existing checkpoint stands).\n",
      );
      return;
    }
    // One line per snapshot file written (so `$(autoviral checkpoint create)`
    // substitution yields the file id you'd hand to `checkpoint restore`).
    for (const w of written) process.stdout.write(`${w.file}\n`);
    if (label) {
      process.stderr.write(`↳ labelled "${label}"\n`);
    }
    return;
  }

  // checkpoint list — GET the rollback history.
  if (sub === "list") {
    const rows = await bridgeRequest<CheckpointRow[]>(ctx, "GET", "/checkpoints");
    // `--format json|yaml|table` overrides isTTY (manual §Output format override).
    writeOut(rows, parseFormatFlag(args));
    return;
  }

  // checkpoint restore <id> — POST { file } to roll back. <id> is the
  // checkpoint's `file` (as printed by `checkpoint list`).
  if (sub === "restore") {
    const file = rest[0];
    if (!file) {
      process.stderr.write(
        "usage: autoviral checkpoint restore <id>  (id = a `file` from `checkpoint list`)\n",
      );
      process.exit(4);
    }
    const result = await bridgeRequest<{
      deliverable: string;
      preRestoreSnapshot: { file: string; sha: string } | null;
    }>(ctx, "POST", "/restore", { file });
    process.stdout.write(`restored ${result.deliverable} from ${file}\n`);
    // #68 — tell the operator the restore is reversible (or was a no-op because
    // the live state matched the latest checkpoint already).
    if (result.preRestoreSnapshot) {
      process.stderr.write(
        `↩ current state was checkpointed first (${result.preRestoreSnapshot.sha}) — this restore is reversible.\n`,
      );
    }
    return;
  }

  process.stderr.write(
    `autoviral checkpoint: expected "create", "list" or "restore", got "${sub ?? ""}"\n`,
  );
  process.exit(127);
}

// Read an optional `--label <text>`. Absent → undefined (an unlabelled
// snapshot). A bare `--label` with no following value → exit 4 (a typo that
// would otherwise silently snapshot unlabelled). The server trims/caps the
// value, so we forward it verbatim.
function readLabelFlag(argv: string[]): string | undefined {
  const i = argv.indexOf("--label");
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    process.stderr.write(
      "usage: autoviral checkpoint create [--label <text>]\n",
    );
    process.exit(4);
  }
  return v;
}
