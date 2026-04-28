import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { join } from "node:path";

export function buildSafeOutputFilename(
  title: string | undefined,
  now: Date = new Date(),
): string {
  const safe = (title ?? "")
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "autoviral-export";
  const stamp = now
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `${safe}-${stamp}.mp4`;
}

export async function renderCompositionToMp4(
  comp: { duration: number; fps: number; width: number; height: number; title?: string; [k: string]: unknown },
  outDir: string,
): Promise<string> {
  const bundleLocation = await bundle({
    entryPoint: join(
      process.cwd(),
      "web/src/features/studio/composition/RemotionRoot.tsx",
    ),
    webpackOverride: (c) => c,
  });
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "main",
    inputProps: { comp },
  });
  const outFile = join(outDir, buildSafeOutputFilename(comp.title));
  // Override every dimension prop from the composition data — Remotion's
  // <Composition> root only declares defaults (1080x1920 30fps); without the
  // override here, 1:1 / 16:9 / 4:5 / 60fps exports came out with wrong
  // dimensions/fps. (Codex review 2026-04-27)
  await renderMedia({
    composition: {
      ...composition,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      durationInFrames: Math.max(1, Math.round(comp.duration * comp.fps)),
    },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outFile,
    inputProps: { comp },
  });
  return outFile;
}
