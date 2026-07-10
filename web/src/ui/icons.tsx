import type { SVGProps } from "react";

/**
 * Minimal shared icon set for the IconButton collection (PRD-0013 S2). Each is a
 * 24×24 viewBox stroke icon that inherits `currentColor`, so callers control colour
 * via the button. Default size 14px matches the existing inline glyphs being
 * replaced (reader close "×", TopBar "?", Tweaks close). Add icons here as more
 * call sites are collected — do NOT set a global `button svg` rule.
 */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function HelpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ strokeWidth: 1.8, ...props })}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
