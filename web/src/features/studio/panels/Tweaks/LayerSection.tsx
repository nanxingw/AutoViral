import { useComposition } from "../../store";
import type { AudioClip, Clip, TextClip, VideoClip } from "../../types";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  testId?: string;
}) {
  return (
    <label
      style={{
        display: "block",
        fontSize: 11,
        marginBottom: 8,
        color: "var(--text-soft)",
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </label>
  );
}

function VideoControls({ clip }: { clip: VideoClip }) {
  const update = useComposition((s) => s.updateClip);
  return (
    <>
      <Slider
        label="Brightness"
        value={clip.filters.brightness}
        min={-1}
        max={1}
        step={0.01}
        testId="layer-brightness"
        onChange={(v) =>
          update(clip.id, {
            filters: { ...clip.filters, brightness: v },
          } as Partial<Clip>)
        }
      />
      <Slider
        label="Contrast"
        value={clip.filters.contrast}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) =>
          update(clip.id, {
            filters: { ...clip.filters, contrast: v },
          } as Partial<Clip>)
        }
      />
      <Slider
        label="Saturation"
        value={clip.filters.saturation}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) =>
          update(clip.id, {
            filters: { ...clip.filters, saturation: v },
          } as Partial<Clip>)
        }
      />
      <Slider
        label="Scale"
        value={clip.transforms.scale}
        min={0.1}
        max={3}
        step={0.05}
        onChange={(v) =>
          update(clip.id, {
            transforms: { ...clip.transforms, scale: v },
          } as Partial<Clip>)
        }
      />
    </>
  );
}

function AudioControls({ clip }: { clip: AudioClip }) {
  const update = useComposition((s) => s.updateClip);
  return (
    <>
      <Slider
        label="Volume"
        value={clip.volume}
        min={0}
        max={1.5}
        step={0.01}
        onChange={(v) =>
          update(clip.id, { volume: v } as Partial<Clip>)
        }
      />
      <Slider
        label="Fade in"
        value={clip.fadeIn}
        min={0}
        max={5}
        step={0.05}
        onChange={(v) =>
          update(clip.id, { fadeIn: v } as Partial<Clip>)
        }
      />
      <Slider
        label="Fade out"
        value={clip.fadeOut}
        min={0}
        max={5}
        step={0.05}
        onChange={(v) =>
          update(clip.id, { fadeOut: v } as Partial<Clip>)
        }
      />
    </>
  );
}

function TextControls({ clip }: { clip: TextClip }) {
  const update = useComposition((s) => s.updateClip);
  return (
    <>
      <Slider
        label="Size"
        value={clip.style.size}
        min={12}
        max={200}
        step={1}
        onChange={(v) =>
          update(clip.id, {
            style: { ...clip.style, size: v },
          } as Partial<Clip>)
        }
      />
      <Slider
        label="Weight"
        value={clip.style.weight}
        min={100}
        max={900}
        step={100}
        onChange={(v) =>
          update(clip.id, {
            style: { ...clip.style, weight: v },
          } as Partial<Clip>)
        }
      />
      <Slider
        label="Tracking"
        value={clip.style.tracking}
        min={-2}
        max={20}
        step={0.5}
        onChange={(v) =>
          update(clip.id, {
            style: { ...clip.style, tracking: v },
          } as Partial<Clip>)
        }
      />
    </>
  );
}

export function LayerSection() {
  const sel = useComposition((s) => s.selection);
  const clip = useComposition((s) =>
    s.comp?.tracks.flatMap((t) => t.clips).find((c) => c.id === sel),
  );
  return (
    <section
      style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <h4
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--text-soft)",
          margin: "0 0 8px",
        }}
      >
        Layer
      </h4>
      {!clip && (
        <p style={{ fontSize: 12, color: "var(--text-soft)" }}>
          选中时间轴上的片段以查看属性
        </p>
      )}
      {clip?.kind === "video" && <VideoControls clip={clip} />}
      {clip?.kind === "audio" && <AudioControls clip={clip} />}
      {clip?.kind === "text" && <TextControls clip={clip} />}
    </section>
  );
}
