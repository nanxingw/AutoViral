import { useMemo } from "react";
import { Rect } from "react-konva";
import useImage from "use-image";

interface Props {
  width: number;
  height: number;
  /** 0..1 — opacity of the noise overlay. 0 = no grain. */
  grain: number;
  /** 0..1 — strength of the bottom-vignette gradient overlay. */
  gradient: number;
}

/** Generate a tiny noise tile as a base64-encoded PNG once per grain bucket
 *  (rounded to two decimals) so all slides share the same image cache. */
function noiseDataUri(opacity: number): string {
  // happy-dom (vitest env) returns a partial 2d context that lacks
  // createImageData/putImageData/toDataURL — wrap the whole synth in
  // try/catch so unit tests don't blow up the render.
  try {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.createImageData !== "function") return "";
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(Math.random() * 256);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.round(opacity * 255);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** Renders grain + bottom-up gradient overlay on top of the slide content.
 *  Lives above the background and below text/image layers? — actually we
 *  mount it ABOVE everything so the editorial film-grain look applies to
 *  the whole composition, mirroring how impeccable editorial designs add
 *  grain at the export stage. */
export function EffectsOverlay({ width, height, grain, gradient }: Props) {
  // Memoise a noise PNG per (rounded) grain value so we don't recompute
  // on every render. Round to 0.05 buckets — visually indistinguishable.
  const grainSrc = useMemo(() => {
    if (grain <= 0) return "";
    const bucket = Math.round(grain * 20) / 20;
    return noiseDataUri(bucket);
  }, [grain]);
  const [grainImg] = useImage(grainSrc);

  return (
    <>
      {gradient > 0 && (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: 0, y: height }}
          fillLinearGradientColorStops={[
            0, "rgba(0,0,0,0)",
            1, `rgba(0,0,0,${(gradient * 0.6).toFixed(3)})`,
          ]}
          listening={false}
        />
      )}
      {grain > 0 && grainImg && (
        // Tile the 96×96 noise PNG via fillPatternImage so the grain stays
        // crisp at any output resolution instead of stretching to fit.
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fillPatternImage={grainImg}
          fillPatternRepeat="repeat"
          listening={false}
        />
      )}
    </>
  );
}
