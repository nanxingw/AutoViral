export function secToTimecode(sec: number): string {
  const cs = Math.round(sec * 100);
  const m = Math.floor(cs / 6000);
  const s = (cs % 6000) / 100;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
