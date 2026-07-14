// `autoviral select <kind> <id>` — publishes a ui-select event so Studio
// highlights the clip/track. Pass `none` to clear selection.

import { bridgeRequest, readContext } from "../client.js";

export async function selectCommand(args: string[]): Promise<void> {
  const [kind, ...rest] = args;
  if (!kind) {
    process.stderr.write(
      "usage: autoviral select <clip|clips|track|none> <id...?>\n",
    );
    process.exit(4);
  }
  const ctx = readContext();
  if (kind === "none") {
    await bridgeRequest(ctx, "POST", "/select", { target: { kind: "none" } });
    return;
  }
  // PRD-0014 S8 — `autoviral select clips <id...>` highlights MANY clips at once
  // (the multi-select protocol). The bridge broadcasts the id array; Studio
  // reuses the PRD-0013 timeline multi-selection store state. Single-id `select
  // clip <id>` is unchanged (back-compat).
  if (kind === "clips") {
    const ids = rest.filter((a) => a && !a.startsWith("--"));
    if (ids.length === 0) {
      process.stderr.write("autoviral select clips: at least one <id> required\n");
      process.exit(4);
    }
    await bridgeRequest(ctx, "POST", "/select", { target: { kind: "clips", ids } });
    return;
  }
  if (kind !== "clip" && kind !== "track") {
    process.stderr.write(`autoviral select: unknown kind "${kind}"\n`);
    process.exit(4);
  }
  const id = rest[0];
  if (!id) {
    process.stderr.write("autoviral select: missing id\n");
    process.exit(4);
  }
  await bridgeRequest(ctx, "POST", "/select", { target: { kind, id } });
}
