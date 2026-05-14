// `autoviral list [clips|assets] [--track <kind>] [--kind <kind>]`
//
// Thin pass-through to the bridge's /clips and /assets projection routes.
// The flag conventions are deliberately distinct: --track filters clip
// rows by their parent track kind, --kind filters asset rows by their
// asset kind. They never apply to both lists.

import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

export async function listCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const ctx = readContext();
  if (sub === "clips") {
    const trackIdx = args.indexOf("--track");
    const track = trackIdx >= 0 ? args[trackIdx + 1] : undefined;
    const qs = track ? `?track=${encodeURIComponent(track)}` : "";
    const r = await bridgeRequest<unknown[]>(ctx, "GET", `/clips${qs}`);
    writeOut(r);
    return;
  }
  if (sub === "assets") {
    const kindIdx = args.indexOf("--kind");
    const kind = kindIdx >= 0 ? args[kindIdx + 1] : undefined;
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    const r = await bridgeRequest<unknown[]>(ctx, "GET", `/assets${qs}`);
    writeOut(r);
    return;
  }
  process.stderr.write(
    `autoviral list: expected "clips" or "assets", got "${sub ?? ""}"\n`,
  );
  process.exit(127);
}
