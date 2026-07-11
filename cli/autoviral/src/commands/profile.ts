import { bridgeRequest, readContext } from "../client.js";

export async function profileCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  const result = await bridgeRequest<unknown>(ctx, "GET", "/profile", null);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
