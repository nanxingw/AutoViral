// `autoviral preprocess <subcommand> [opts]`
//
// H4.1 ships `preprocess tts <text>` for narration synthesis. Future
// subcommands (bg-remove, etc.) live under the same namespace.

import { bridgeRequest, readContext } from "../client.js";

interface TtsFlags {
  text?: string;
  voice?: string;
  format?: string;
  model?: string;
  stem?: string;
}

function parseTtsFlags(args: string[]): TtsFlags {
  const flags: TtsFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--voice") flags.voice = args[++i];
    else if (a === "--format") flags.format = args[++i];
    else if (a === "--model") flags.model = args[++i];
    else if (a === "--stem" || a === "--filename-stem")
      flags.stem = args[++i];
    else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    } else if (!flags.text) {
      flags.text = a;
    }
  }
  return flags;
}

export async function preprocessCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === "tts") return ttsCommand(rest);
  process.stderr.write(
    `autoviral: unknown preprocess subcommand ${sub ?? "<none>"}\n`,
  );
  process.exit(127);
}

async function ttsCommand(args: string[]): Promise<void> {
  const flags = parseTtsFlags(args);
  if (!flags.text) {
    process.stderr.write(
      `autoviral: preprocess tts <text> [--voice alloy|echo|fable|onyx|nova|shimmer] [--format mp3|wav|opus|aac|flac] [--stem <name>]\n`,
    );
    process.exit(4);
  }
  const ctx = readContext();
  const result = await bridgeRequest<{
    assetPath: string;
    relativeUri: string;
    voice: string;
    format: string;
    bytes: number;
  }>(ctx, "POST", "/preprocess/tts", {
    text: flags.text,
    voice: flags.voice,
    format: flags.format,
    model: flags.model,
    filenameStem: flags.stem,
  });
  process.stdout.write(
    `${result.relativeUri}\nvoice ${result.voice} · ${result.format} · ${result.bytes} bytes\n`,
  );
}
