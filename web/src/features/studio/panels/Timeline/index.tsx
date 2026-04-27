import { useComposition } from "../../store";
import { Ruler } from "./Ruler";
import { Track } from "./Track";
import { Playhead } from "./Playhead";

export function Timeline() {
  const comp = useComposition((s) => s.comp);
  const pxPerSecond = 50;
  if (!comp) return null;
  return (
    <div
      className="timeline-root"
      style={{
        overflow: "auto",
        padding: "0 24px 16px 140px",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "relative",
          width: Math.max(800, comp.duration * pxPerSecond),
        }}
      >
        <Ruler duration={comp.duration} pxPerSecond={pxPerSecond} />
        {comp.tracks.map((t) => (
          <Track key={t.id} track={t} pxPerSecond={pxPerSecond} />
        ))}
        <Playhead pxPerSecond={pxPerSecond} />
      </div>
    </div>
  );
}
