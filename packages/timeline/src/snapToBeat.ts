export function snapToBeat(
  t: number,
  beats: number[],
  toleranceSec = 0.05,
): number {
  if (!beats.length) return t;
  let best = beats[0];
  let bestDelta = Math.abs(t - beats[0]);
  for (const b of beats) {
    const d = Math.abs(t - b);
    if (d < bestDelta) {
      best = b;
      bestDelta = d;
    }
  }
  return bestDelta <= toleranceSec ? best : t;
}
