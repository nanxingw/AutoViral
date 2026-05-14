// `autoviral toast <message> [--kind info|success|warn|error] [--duration ms]`
// Surfaces a toast in Studio via the ui-toast event.

import { bridgeRequest, readContext } from "../client.js";

export async function toastCommand(args: string[]): Promise<void> {
  const message = args[0];
  if (!message) {
    process.stderr.write(
      "usage: autoviral toast <message> [--kind info|success|warn|error] [--duration 3000]\n",
    );
    process.exit(4);
  }
  const kindIdx = args.indexOf("--kind");
  const durIdx = args.indexOf("--duration");
  const kind = kindIdx >= 0 ? args[kindIdx + 1] : "info";
  const durationMs = durIdx >= 0 ? Number(args[durIdx + 1]) : 3000;
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/toast", { message, kind, durationMs });
}
