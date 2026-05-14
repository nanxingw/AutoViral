// `autoviral ingest youtube <url> [--lang zh-CN] [--model <openrouter-id>]`
//
// Drives the server-side ingest pipeline (yt-dlp → Whisper → OpenRouter
// translation → composition bootstrap). Long-running — agents should not
// timeout client-side under ~15 min for typical 5–10 minute YouTube clips.
// Progress is broadcast over the bridge UI bus so the Studio terminal +
// progress strip render live updates; this CLI just blocks on the final
// HTTP result and prints a one-line summary.

import { bridgeRequest, readContext } from "../client.js";

type IngestSubcommand = "youtube";

export async function ingestCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub !== "youtube") {
    process.stderr.write(
      `autoviral: ingest subcommand must be 'youtube' (got ${sub ?? "nothing"})\n`,
    );
    process.exit(127);
  }
  await ingestYouTubeCommand(rest);
}

async function ingestYouTubeCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  if (!flags.url) {
    process.stderr.write("autoviral: ingest youtube <url> [--lang zh-CN] [--model <openrouter-id>] [--start <s>] [--end <s>]\n");
    process.exit(4);
  }
  const ctx = readContext();
  const result = await bridgeRequest<{
    workId: string;
    sourceClipPath: string;
    durationSec: number;
    segmentCount: number;
    language: string;
    targetLanguage: string;
  }>(ctx, "POST", "/ingest/youtube", {
    url: flags.url,
    language: flags.lang ?? "zh-CN",
    model: flags.model,
    start: flags.start,
    end: flags.end,
  });
  process.stdout.write(
    `${result.sourceClipPath}\nduration ${result.durationSec.toFixed(2)}s · ${result.segmentCount} segments · ${result.language} → ${result.targetLanguage}\n`,
  );
}

interface IngestFlags {
  url?: string;
  lang?: string;
  model?: string;
  start?: number;
  end?: number;
}

function parseFlags(args: string[]): IngestFlags {
  const flags: IngestFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--lang") {
      flags.lang = args[++i];
    } else if (a === "--model") {
      flags.model = args[++i];
    } else if (a === "--start") {
      flags.start = Number(args[++i]);
    } else if (a === "--end") {
      flags.end = Number(args[++i]);
    } else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    } else if (!flags.url) {
      flags.url = a;
    }
  }
  return flags;
}

// Suppress unused-export lint
export const _internalKindGuard: IngestSubcommand = "youtube";
