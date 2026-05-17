// `autoviral trends [--platform p1,p2] [--topic q] [--limit N]`
import { bridgeRequest, readContext } from "../client.js";

export async function trendsCommand(args: string[]): Promise<void> {
  let platform: string | undefined;
  let topic: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform") platform = args[++i];
    else if (a === "--topic") topic = args[++i];
    else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    }
  }
  const ctx = readContext();
  const qs: string[] = [];
  if (platform) qs.push(`platform=${encodeURIComponent(platform)}`);
  if (topic) qs.push(`topic=${encodeURIComponent(topic)}`);
  const result = await bridgeRequest<unknown>(
    ctx,
    "GET",
    `/trends${qs.length > 0 ? `?${qs.join("&")}` : ""}`,
    null,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function profileCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  const result = await bridgeRequest<unknown>(ctx, "GET", "/profile", null);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
