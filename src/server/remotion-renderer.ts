import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { join } from "node:path";

export async function renderCompositionToMp4(
  comp: { duration: number; fps: number; [k: string]: unknown },
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
  const outFile = join(outDir, `final-${Date.now()}.mp4`);
  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: Math.max(
        1,
        Math.round(comp.duration * comp.fps),
      ),
    },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outFile,
    inputProps: { comp },
  });
  return outFile;
}
