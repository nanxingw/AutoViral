import type { CSSProperties } from "react";

export function resolvePosition(
  pos: { anchor: "top" | "center" | "bottom"; xPct: number; yPct: number },
  _frame: { width: number; height: number },
): CSSProperties {
  const left = `${pos.xPct}%`;
  const top = `${pos.yPct}%`;
  let transform = "";
  switch (pos.anchor) {
    case "center":
      transform = "translate(-50%, -50%)";
      break;
    case "bottom":
      transform = "translateX(-50%)";
      break;
    case "top":
      transform = "translateX(-50%)";
      break;
  }
  return { position: "absolute", left, top, transform };
}
