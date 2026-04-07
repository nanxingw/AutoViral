/**
 * Extract evenly-spaced frames from a video and draw them as a filmstrip on a canvas.
 * Each frame is center-cropped to fill its tile completely with no gaps.
 */
export interface FilmstripOptions {
  videoUrl: string;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  numFrames?: number;
}

export async function renderFilmstrip(opts: FilmstripOptions): Promise<boolean> {
  const { videoUrl, canvas, width, height, numFrames = 10 } = opts;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const dpr = window.devicePixelRatio;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

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

    const tileWidth = width / numFrames;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    for (let i = 0; i < numFrames; i++) {
      const seekTime = ((i + 0.5) / numFrames) * duration;
      video.currentTime = seekTime;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(() => resolve(), 2000);
      });

      // Center-crop: compute source rect from video to fill tile exactly
      const tileAspect = tileWidth / height;
      const videoAspect = vw / vh;

      let sx: number, sy: number, sw: number, sh: number;
      if (videoAspect > tileAspect) {
        // Video is wider — crop sides
        sh = vh;
        sw = vh * tileAspect;
        sx = (vw - sw) / 2;
        sy = 0;
      } else {
        // Video is taller — crop top/bottom
        sw = vw;
        sh = vw / tileAspect;
        sx = 0;
        sy = (vh - sh) / 2;
      }

      const dx = i * tileWidth;
      ctx.drawImage(video, sx, sy, sw, sh, dx, 0, tileWidth, height);
    }

    return true;
  } catch {
    return false;
  } finally {
    video.src = "";
    video.load();
  }
}
