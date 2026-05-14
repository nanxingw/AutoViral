// `autoviral select <kind> <id>` — publishes a ui-select event so Studio
// highlights the clip/track. Pass `none` to clear selection.

import { bridgeRequest, readContext } from "../client.js";

export async function selectCommand(args: string[]): Promise<void> {
  const [kind, id] = args;
  if (!kind) {
    process.stderr.write(
      "usage: autoviral select <clip|track|none> <id?>\n",
    );
    process.exit(4);
  }
  const ctx = readContext();
  if (kind === "none") {
    await bridgeRequest(ctx, "POST", "/select", { target: { kind: "none" } });
    return;
  }
  if (kind !== "clip" && kind !== "track") {
    process.stderr.write(`autoviral select: unknown kind "${kind}"\n`);
    process.exit(4);
  }
  if (!id) {
    process.stderr.write("autoviral select: missing id\n");
    process.exit(4);
  }
  await bridgeRequest(ctx, "POST", "/select", { target: { kind, id } });
}
