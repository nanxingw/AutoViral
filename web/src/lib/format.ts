export function compactNumber(n: number): string {
  if (Math.abs(n) < 1_000) return String(n);
  if (Math.abs(n) < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function fmtDelta(ratio: number): string {
  if (ratio === 0) return "— 0%";
  const arrow = ratio > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(ratio * 100).toFixed(1)}%`;
}
