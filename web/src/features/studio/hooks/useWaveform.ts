import { useEffect } from "react";
import WaveSurfer from "wavesurfer.js";

export function useWaveform(opts: {
  container: HTMLElement | null;
  src: string;
  height?: number;
}) {
  useEffect(() => {
    if (!opts.container) return;
    const ws = WaveSurfer.create({
      container: opts.container,
      height: opts.height ?? 40,
      waveColor: "rgba(168,197,214,0.45)",
      progressColor: "rgba(168,197,214,0.95)",
      cursorWidth: 0,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
    });
    ws.load(opts.src);
    return () => {
      ws.destroy();
    };
  }, [opts.container, opts.src, opts.height]);
}
