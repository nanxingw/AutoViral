const MAJOR_INTERVALS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300,
] as const;

const MIN_MAJOR_SPACING_PX = 72;
const MIN_MINOR_SPACING_PX = 8;
const SUBDIVISIONS = 5;
const ROUNDING_PRECISION = 1_000_000;

export interface RulerScaleOptions {
  pxPerSecond: number;
  duration: number;
  viewportStart?: number;
  viewportEnd?: number;
}

export interface RulerTick {
  kind: "major" | "minor";
  time: number;
  label?: string;
}

export interface RulerScale {
  majorInterval: number;
  minorInterval: number;
  showMinor: boolean;
  ticks: RulerTick[];
}

function roundTime(time: number) {
  return Math.round(time * ROUNDING_PRECISION) / ROUNDING_PRECISION;
}

function formatRulerLabel(time: number, duration: number, majorInterval: number) {
  if (duration >= 3_600) {
    const totalSeconds = Math.round(time);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  if (majorInterval < 1) {
    const totalTenths = Math.round(time * 10);
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  const totalSeconds = Math.round(time);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function computeRulerScale({
  pxPerSecond,
  duration,
  viewportStart = 0,
  viewportEnd = duration,
}: RulerScaleOptions): RulerScale {
  const safePxPerSecond = Number.isFinite(pxPerSecond) && pxPerSecond > 0
    ? pxPerSecond
    : 0;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const majorInterval = MAJOR_INTERVALS.find(
    (interval) => interval * safePxPerSecond >= MIN_MAJOR_SPACING_PX,
  ) ?? MAJOR_INTERVALS[MAJOR_INTERVALS.length - 1];
  const minorInterval = majorInterval / SUBDIVISIONS;
  const showMinor = minorInterval * safePxPerSecond >= MIN_MINOR_SPACING_PX;

  if (safeDuration === 0) {
    return {
      majorInterval,
      minorInterval,
      showMinor,
      ticks: [{ kind: "major", time: 0, label: "0:00" }],
    };
  }

  const safeViewportStart = Math.min(
    safeDuration,
    Math.max(0, Number.isFinite(viewportStart) ? viewportStart : 0),
  );
  const safeViewportEnd = Math.min(
    safeDuration,
    Math.max(
      safeViewportStart,
      Number.isFinite(viewportEnd) ? viewportEnd : safeDuration,
    ),
  );
  const rangeStart = Math.max(0, safeViewportStart - majorInterval);
  const rangeEnd = Math.min(safeDuration, safeViewportEnd + majorInterval);
  const tickInterval = showMinor ? minorInterval : majorInterval;
  const firstTickIndex = Math.ceil((rangeStart - 1e-9) / tickInterval);
  const lastTickIndex = Math.floor((rangeEnd + 1e-9) / tickInterval);
  const ticks: RulerTick[] = [];

  for (let index = firstTickIndex; index <= lastTickIndex; index += 1) {
    const time = roundTime(index * tickInterval);
    const majorRatio = time / majorInterval;
    const isMajor = Math.abs(majorRatio - Math.round(majorRatio)) < 1e-6;
    if (isMajor) {
      ticks.push({
        kind: "major",
        time,
        label: formatRulerLabel(time, safeDuration, majorInterval),
      });
    } else if (showMinor) {
      ticks.push({ kind: "minor", time });
    }
  }

  return { majorInterval, minorInterval, showMinor, ticks };
}
