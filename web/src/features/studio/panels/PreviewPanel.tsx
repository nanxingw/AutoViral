import { Player, type PlayerRef } from "@remotion/player";
import { useCallback, useEffect, useRef, useState } from "react";
import { useComposition } from "../store";
import { Scene } from "../composition/Scene";

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m.toString().padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

export function PreviewPanel() {
  const comp = useComposition((s) => s.comp);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const playerRef = useRef<PlayerRef | null>(null);

  // Subscribe to player frame updates so the scrubber + timecode track playback.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame as any);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame as any);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [comp]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else p.play();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const p = playerRef.current;
    const fps = comp?.fps ?? 30;
    if (!p) return;
    const f = Math.max(0, Math.min(Math.round(seconds * fps), (comp?.duration ?? 0) * fps));
    p.seekTo(f);
    setFrame(f);
  }, [comp]);

  if (!comp) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-dimmer)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.06em",
        }}
      >
        LOADING…
      </div>
    );
  }

  const fps = comp.fps;
  const durationInFrames = Math.max(1, Math.round(comp.duration * fps));
  const currentSec = frame / fps;
  const progress = comp.duration > 0 ? Math.min(1, currentSec / comp.duration) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--divider)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dimmer)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          {comp.width} × {comp.height} · {fps}FPS · H.264
        </div>
        <div style={{ flex: 1 }} />
      </div>

      {/* Viewport */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          position: "relative",
          minHeight: 0,
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.3), transparent 70%)",
        }}
      >
        {/* Ambient grid pattern (matches design) */}
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            opacity: 0.15,
          }}
        >
          <defs>
            <pattern id="preview-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--accent)" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#preview-grid)" />
        </svg>

        {/* Side meta */}
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 24,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 10,
            color: "var(--text-dimmer)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <div>
            FRAME {formatTime(currentSec)} / {formatTime(comp.duration)}
          </div>
          <div>
            {comp.tracks.flatMap((t) => t.clips).length} CLIPS · {comp.aspect}
          </div>
          <div style={{ color: "var(--accent)" }}>▲ EST. {comp.duration.toFixed(2)}s</div>
        </div>

        {/* Phone canvas */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            aspectRatio: `${comp.width} / ${comp.height}`,
            maxWidth: "100%",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow:
              "0 30px 60px rgba(0,0,0,0.35), 0 0 0 1px var(--glass-hi), 0 0 40px var(--accent-glow)",
            background: "#000",
          }}
        >
          <Player
            ref={playerRef}
            component={Scene as any}
            inputProps={{ comp }}
            durationInFrames={durationInFrames}
            fps={fps}
            compositionWidth={comp.width}
            compositionHeight={comp.height}
            style={{ width: "100%", height: "100%" }}
            // No `controls` — we render our own transport bar below.
            clickToPlay
          />
          {/* Safe-zone overlay */}
          <div
            style={{
              position: "absolute",
              inset: "5%",
              border: "1px dashed rgba(255,255,255,0.08)",
              borderRadius: 14,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>

      {/* Custom Transport Bar */}
      <div
        style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--divider)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          data-bare
          onClick={() => seekTo(0)}
          style={transportIconBtn()}
          aria-label="Prev"
          title="Prev"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="19 20 9 12 19 4 19 20" />
            <rect x="5" y="4" width="2" height="16" />
          </svg>
        </button>
        <button
          type="button"
          data-bare
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "var(--accent)",
            border: "none",
            color: "var(--accent-fg)",
            cursor: "pointer",
            boxShadow: "0 0 20px var(--accent-glow)",
            flexShrink: 0,
          }}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          )}
        </button>
        <button
          type="button"
          data-bare
          onClick={() => seekTo(comp.duration)}
          style={transportIconBtn()}
          aria-label="Next"
          title="Next"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 4 15 12 5 20 5 4" />
            <rect x="17" y="4" width="2" height="16" />
          </svg>
        </button>

        {/* Timecode + scrubber */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--accent)",
              fontWeight: 500,
              minWidth: 64,
            }}
          >
            {formatTime(currentSec)}
          </span>
          <Scrubber
            progress={progress}
            duration={comp.duration}
            onSeek={(p) => seekTo(p * comp.duration)}
          />
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-dim)",
              minWidth: 56,
              textAlign: "right",
            }}
          >
            {formatTime(comp.duration)}
          </span>
        </div>

        <button
          type="button"
          data-bare
          aria-label="Volume"
          title="Volume"
          style={transportIconBtn()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
        <button
          type="button"
          data-bare
          aria-label="Speed"
          title="Speed"
          style={{
            ...transportIconBtn(),
            width: 38,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
          }}
        >
          1×
        </button>
      </div>
    </div>
  );
}

function Scrubber({
  progress,
  duration,
  onSeek,
}: {
  progress: number;
  duration: number;
  onSeek: (p: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!duration) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const seek = (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(p);
    };
    seek(e.clientX);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      style={{
        flex: 1,
        height: 4,
        background: "var(--glass-border)",
        borderRadius: 2,
        position: "relative",
        cursor: duration ? "pointer" : "default",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${progress * 100}%`,
          background: "linear-gradient(90deg, var(--accent-lo), var(--accent))",
          borderRadius: 2,
          boxShadow: "0 0 8px var(--accent-glow)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${progress * 100}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "var(--accent)",
          boxShadow: "0 0 12px var(--accent-glow), 0 0 0 3px rgba(255,255,255,0.08)",
        }}
      />
    </div>
  );
}

function transportIconBtn(): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid var(--glass-border)",
    background: "var(--surface-0)",
    color: "var(--text-dim)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
    fontWeight: 600,
  };
}
