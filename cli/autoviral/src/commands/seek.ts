// `autoviral seek <time>` — accepts "12s", "1m30s", or bare seconds.

import { bridgeRequest, readContext } from "../client.js";

export function parseTime(raw: string): number | null {
  if (/^[\d.]+$/.test(raw)) return parseFloat(raw);
  const m = raw.match(/^(?:(\d+)m)?(\d+(?:\.\d+)?)s$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

export async function seekCommand(args: string[]): Promise<void> {
  const raw = args[0];
  if (!raw) {
    process.stderr.write("usage: autoviral seek <seconds|'12.5s'|'1m30s'>\n");
    process.exit(4);
  }
  const seconds = parseTime(raw);
  if (seconds === null) {
    process.stderr.write(`autoviral seek: bad time format ${raw}\n`);
    process.exit(4);
  }
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/seek", { seconds });
}
