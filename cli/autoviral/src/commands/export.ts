// `autoviral export [--preset name] [--proxy]
//                   [--variables '{...}'] [--variables-file <path>]
//                   [--strict-variables] [--continue-on-error]` — render.
//
// H2.2 added variable-override flags:
//   --variables '{"title":"Pro"}'   inline JSON object
//   --variables-file ./overrides.json   load JSON from a file
//   --variables-file ./batch/           OR a directory (H2.4 batch mode)
//   --strict-variables  fail when overrides reference undeclared keys
//
// `autoviral render` is an alias that forces `--proxy`.

import { readFile, stat, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { bridgeRequest, readContext, type BridgeContext } from "../client.js";

type Overrides = Record<string, string | number | boolean>;

interface ExportFlags {
  preset?: string;
  proxy: boolean;
  variables?: Overrides;
  variablesFile?: string;
  strictVariables: boolean;
  continueOnError: boolean;
}

function parseFlags(args: string[]): ExportFlags {
  const out: ExportFlags = {
    proxy: false,
    strictVariables: false,
    continueOnError: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--proxy") out.proxy = true;
    else if (a === "--preset") out.preset = args[++i];
    else if (a === "--variables") {
      const json = args[++i];
      try {
        out.variables = JSON.parse(json) as Overrides;
      } catch (err) {
        process.stderr.write(
          `autoviral: --variables must be a JSON object — ${(err as Error).message}\n`,
        );
        process.exit(4);
      }
    } else if (a === "--variables-file") {
      out.variablesFile = args[++i];
    } else if (a === "--strict-variables") {
      out.strictVariables = true;
    } else if (a === "--continue-on-error") {
      out.continueOnError = true;
    } else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    }
  }
  return out;
}

async function callExport(
  ctx: BridgeContext,
  body: Record<string, unknown>,
): Promise<{ path: string }> {
  return bridgeRequest<{ path: string }>(ctx, "POST", "/export", body);
}

async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readVariablesFile(path: string): Promise<Overrides> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("variables file must contain a JSON object");
  }
  return parsed as Overrides;
}

export async function exportCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const ctx = readContext();

  // Batch mode: --variables-file points at a directory of *.json files.
  if (flags.variablesFile && (await isDir(flags.variablesFile))) {
    const files = (await readdir(flags.variablesFile))
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort();
    if (files.length === 0) {
      process.stderr.write(
        `autoviral: no *.json files in ${flags.variablesFile}\n`,
      );
      process.exit(4);
    }
    let succeeded = 0;
    let failed = 0;
    for (const file of files) {
      const fullPath = join(flags.variablesFile, file);
      const stem = basename(file, extname(file));
      try {
        const variables = await readVariablesFile(fullPath);
        const result = await callExport(ctx, {
          preset: flags.preset,
          proxy: flags.proxy,
          variables,
          strictVariables: flags.strictVariables,
          variantStem: stem,
        });
        process.stdout.write(`${file}\t${result.path}\tok\n`);
        succeeded += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`${file}\tERROR\t${msg}\n`);
        failed += 1;
        if (!flags.continueOnError) {
          process.exitCode = 5;
          return;
        }
      }
    }
    process.stdout.write(
      `\nautoviral batch: ${succeeded}/${files.length} succeeded\n`,
    );
    if (failed > 0) process.exitCode = 5;
    return;
  }

  // Single-render mode: inline JSON OR single file
  let variables = flags.variables;
  if (flags.variablesFile) {
    if (!(await isFile(flags.variablesFile))) {
      process.stderr.write(
        `autoviral: --variables-file path not found: ${flags.variablesFile}\n`,
      );
      process.exit(4);
    }
    variables = await readVariablesFile(flags.variablesFile);
  }
  const result = await callExport(ctx, {
    preset: flags.preset,
    proxy: flags.proxy,
    variables,
    strictVariables: flags.strictVariables,
  });
  process.stdout.write(`${result.path}\n`);
}

export async function renderCommand(args: string[]): Promise<void> {
  return exportCommand([...args, "--proxy"]);
}
