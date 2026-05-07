#!/usr/bin/env bun
/**
 * Live smoke test for the Seedance 2.0 provider.
 *
 * WARNING: This script calls the real OpenRouter API. A 3-second clip
 * costs ~$0.76 and takes ~70s end-to-end. Do NOT wire this into CI.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... bun scripts/smoke-seedance.ts \
 *     "a cinematic shot of a panda eating bamboo, slow dolly-in"
 *
 * Optional flags via env:
 *   SMOKE_DURATION=3            (seconds, default 3)
 *   SMOKE_ASPECT=9:16           (default 9:16; see KNOWN ISSUE in seedance.ts)
 *   SMOKE_OUT_DIR=/tmp/seedance (default ./tmp/seedance)
 */
import { createSeedanceProvider } from "../src/server/providers/seedance.js";

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("ERROR: OPENROUTER_API_KEY is not set. Aborting.");
    process.exit(1);
  }
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    console.error("ERROR: pass a prompt as the first arg.");
    console.error('Example: bun scripts/smoke-seedance.ts "a panda eating bamboo"');
    process.exit(1);
  }
  const durationSec = Number(process.env.SMOKE_DURATION ?? 3);
  const aspectRatio = process.env.SMOKE_ASPECT ?? "9:16";
  const outputDir = process.env.SMOKE_OUT_DIR ?? "tmp/seedance";

  console.log("[smoke-seedance] dispatching real OpenRouter job");
  console.log(`  prompt:       ${prompt}`);
  console.log(`  durationSec:  ${durationSec}`);
  console.log(`  aspectRatio:  ${aspectRatio}`);
  console.log(`  outputDir:    ${outputDir}`);
  console.log("  (this will cost ~$0.25/sec and take ~70s for a 3s clip)");

  const provider = createSeedanceProvider({ outputDir });
  const t0 = Date.now();
  const result = await provider.generateVideo({ prompt, durationSec, aspectRatio });
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("[smoke-seedance] done");
  console.log(`  elapsed:        ${elapsedSec}s`);
  console.log(`  assetUri:       ${result.assetUri}`);
  console.log(`  providerJobId:  ${result.providerJobId ?? "(none)"}`);
  console.log(`  costUsd:        ${result.costUsd}`);
  console.log(`  stub:           ${result.stub}`);
}

main().catch((err) => {
  console.error("[smoke-seedance] FAILED");
  console.error(err);
  process.exit(1);
});
