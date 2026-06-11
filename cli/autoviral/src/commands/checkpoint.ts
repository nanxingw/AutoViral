// `autoviral checkpoint list | restore <id>` — S21 (US 33/34).
//
// Checkpoints are taken automatically every agent turn, but until now the agent
// had no verb to roll one BACK after a bad hand-edit. This command gives the
// agent (and a human typing in the Studio terminal) a safe rollback:
//
//   checkpoint list            List rollback history, newest first. JSON when
//                              piped (agent), YAML when interactive (human).
//   checkpoint restore <id>    Roll the live deliverable back to checkpoint <id>
//                              (its `file` name, e.g.
//                              2026-05-08T12-34-56Z__a1b2c3d4__carousel.yaml).
//
// SAFETY (#68): the server snapshots the CURRENT live state BEFORE overwriting
// it, so restore is reversible — a user's pending, never-checkpointed edits are
// preserved as a fresh checkpoint rather than silently destroyed. We surface
// that to the operator so they know the undo exists.

import { bridgeRequest, readContext } from "../client.js";
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
    `autoviral checkpoint: expected "list" or "restore", got "${sub ?? ""}"\n`,
  );
  process.exit(127);
}
