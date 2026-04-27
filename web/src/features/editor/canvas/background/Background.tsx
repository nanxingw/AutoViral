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
  const [img] = useImage(src, "anonymous");
  return <KImage image={img} x={0} y={0} width={width} height={height} />;
}
