/**
 * Fetch an audio file, decode it with Web Audio API, extract RMS amplitudes,
 * and render a bar-style waveform on a canvas.
 */
export interface WaveformOptions {
  audioUrl: string;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  barWidth?: number;
  barGap?: number;
  color?: string;
}

export async function renderWaveform(opts: WaveformOptions): Promise<boolean> {
  const {
    audioUrl, canvas, width, height,
    barWidth = 2, barGap = 1,
    color = "rgba(168, 85, 247, 0.6)",
  } = opts;

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const dpr = window.devicePixelRatio;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) return false;
    const arrayBuffer = await response.arrayBuffer();

    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();

    const channelData = audioBuffer.getChannelData(0);
    const numBars = Math.floor(width / (barWidth + barGap));
    const samplesPerBar = Math.floor(channelData.length / numBars);

    const rmsValues: number[] = [];
    let maxRms = 0;
    for (let i = 0; i < numBars; i++) {
      let sum = 0;
      const start = i * samplesPerBar;
      for (let j = start; j < start + samplesPerBar && j < channelData.length; j++) {
        sum += channelData[j] * channelData[j];
      }
      const rms = Math.sqrt(sum / samplesPerBar);
      rmsValues.push(rms);
      if (rms > maxRms) maxRms = rms;
    }

    ctx.fillStyle = color;
    const padding = 4;
    const drawHeight = height - padding * 2;

    for (let i = 0; i < numBars; i++) {
      const normalized = maxRms > 0 ? rmsValues[i] / maxRms : 0;
      const logNorm = Math.log1p(normalized * 10) / Math.log1p(10);
      const barH = Math.max(2, logNorm * drawHeight);
      const x = i * (barWidth + barGap);
      const y = padding + (drawHeight - barH) / 2;
      ctx.fillRect(x, y, barWidth, barH);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Draw a fake waveform (used as fallback when audio decoding fails).
 */
export function renderFakeWaveform(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  color: string = "rgba(168, 85, 247, 0.4)",
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = color;
  const barWidth = 2;
  const barGap = 1;
  const numBars = Math.floor(width / (barWidth + barGap));
  const padding = 4;
  const drawHeight = height - padding * 2;

  for (let i = 0; i < numBars; i++) {
    const t = i / numBars;
    const amplitude = 0.3 + 0.4 * Math.sin(t * Math.PI * 6) + 0.2 * Math.sin(t * Math.PI * 14 + 1) + 0.1 * Math.random();
    const barH = Math.max(2, amplitude * drawHeight);
    const x = i * (barWidth + barGap);
    const y = padding + (drawHeight - barH) / 2;
    ctx.fillRect(x, y, barWidth, barH);
  }
}
