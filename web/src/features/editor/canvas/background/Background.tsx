import { Rect, Image as KImage } from "react-konva";
import useImage from "use-image";
import type { SlideBg } from "../../types";

interface BackgroundProps {
  bg: SlideBg;
  width: number;
  height: number;
}

/**
 * Parse a CSS-ish "linear-gradient(... ,#aaa 0%, #bbb 100%)" string into two
 * hex stops. Falls back to a neutral pair if parsing fails. Konva does not
 * understand CSS gradients, so we feed it explicit color stops.
 */
export function parseGradientStops(value: string): [string, string] {
  const matches = value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g) ?? [];
  const first = matches[0];
  const last = matches[matches.length - 1];
  if (first && last && matches.length >= 2) return [first, last];
  if (first) return [first, first];
  return ["#fafaf7", "#e8e6df"];
}

export function Background({ bg, width, height }: BackgroundProps) {
  if (bg.type === "solid") {
    return <Rect x={0} y={0} width={width} height={height} fill={bg.value} />;
  }
  if (bg.type === "gradient") {
    const [a, b] = parseGradientStops(bg.value);
    return (
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: width, y: height }}
        fillLinearGradientColorStops={[0, a, 1, b]}
      />
    );
  }
  return <BgImage src={bg.value} width={width} height={height} />;
}

function BgImage({
  src,
  width,
  height,
}: {
  src: string;
  width: number;
  height: number;
}) {
  // crossOrigin="anonymous" forces a CORS request — backend's /api/works/.../
  // assets/* doesn't return Access-Control-Allow-Origin, so the image load
  // fails silently and the canvas stays blank. Same-origin (via vite proxy)
  // doesn't need CORS; drop the flag and let the browser use the simpler
  // request mode. Costs are: canvas filters that read pixels (toDataURL,
  // getImageData) will taint, but rendering itself is unaffected.
  // R33: consume status. Failed background = render the same red dashed
  // marker as image/sticker layers so the user sees "background failed"
  // rather than thinking the slide is intentionally blank.
  const [img, status] = useImage(src);
  if (status === "failed") {
    return (
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        stroke="#d4756c"
        strokeWidth={2}
        dash={[12, 8]}
        fill="rgba(212, 117, 108, 0.04)"
      />
    );
  }
  return <KImage image={img} x={0} y={0} width={width} height={height} />;
}
