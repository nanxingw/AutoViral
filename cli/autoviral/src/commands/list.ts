// `autoviral list [clips|assets] [--track <kind>] [--kind <kind>]`
//
// Thin pass-through to the bridge's /clips and /assets projection routes.
// The flag conventions are deliberately distinct: --track filters clip
// rows by their parent track kind, --kind filters asset rows by their
// asset kind. They never apply to both lists.

import { bridgeRequest, readContext } from "../client.js";
import { parseFormatFlag, writeOut } from "../output.js";

export async function listCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const ctx = readContext();
  // `--format json|yaml|table` overrides the isTTY auto-detect (manual §Output
  // format override) — explicit wins even when stdout is piped.
  const format = parseFormatFlag(args);
  if (sub === "clips") {
    const trackIdx = args.indexOf("--track");
    const track = trackIdx >= 0 ? args[trackIdx + 1] : undefined;
    const qs = track ? `?track=${encodeURIComponent(track)}` : "";
    const r = await bridgeRequest<unknown[]>(ctx, "GET", `/clips${qs}`);
    writeOut(r, format);
    return;
  }
  if (sub === "assets") {
    const kindIdx = args.indexOf("--kind");
    const kind = kindIdx >= 0 ? args[kindIdx + 1] : undefined;
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    const r = await bridgeRequest<unknown[]>(ctx, "GET", `/assets${qs}`);
    writeOut(r, format);
    return;
  }
  process.stderr.write(
    `autoviral list: expected "clips" or "assets", got "${sub ?? ""}"\n`,
  );
  process.exit(127);
}
