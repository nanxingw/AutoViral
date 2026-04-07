/**
 * Extract evenly-spaced frames from a video and draw them as a filmstrip on a canvas.
 * Falls back gracefully if video cannot be decoded.
 */
export interface FilmstripOptions {
  videoUrl: string;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  numFrames?: number;
}

export async function renderFilmstrip(opts: FilmstripOptions): Promise<boolean> {
  const { videoUrl, canvas, width, height, numFrames = 8 } = opts;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  video.src = videoUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Video load failed"));
      setTimeout(() => reject(new Error("Timeout")), 8000);
    });

    const duration = video.duration;
    if (!duration || !isFinite(duration)) return false;

    const frameWidth = width / numFrames;
    const aspect = video.videoWidth / video.videoHeight;
    const drawHeight = height;
    const drawWidth = drawHeight * aspect;

    for (let i = 0; i < numFrames; i++) {
      const seekTime = (i / numFrames) * duration;
      video.currentTime = seekTime;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(() => resolve(), 2000);
      });

      const x = i * frameWidth;
      const srcX = Math.max(0, (drawWidth - frameWidth) / 2);
      ctx.drawImage(video, x - srcX, 0, drawWidth, drawHeight);
    }

    return true;
  } catch {
    return false;
  } finally {
    video.src = "";
    video.load();
  }
}
