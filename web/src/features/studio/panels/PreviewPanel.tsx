import { Player } from "@remotion/player";
import { useComposition } from "../store";
import { Scene } from "../composition/Scene";

export function PreviewPanel() {
  const comp = useComposition((s) => s.comp);
  if (!comp) return <div className="preview-empty">载入中…</div>;
  const durationInFrames = Math.max(1, Math.round(comp.duration * comp.fps));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Player
        component={Scene as any}
        inputProps={{ comp }}
        durationInFrames={durationInFrames}
        fps={comp.fps}
        compositionWidth={comp.width}
        compositionHeight={comp.height}
        controls
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          aspectRatio: `${comp.width} / ${comp.height}`,
        }}
      />
    </div>
  );
}
