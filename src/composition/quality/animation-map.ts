/**
 * `autoviral animation-map` — produce a tween Gantt + dead-zone report
 * from the composition's declared animation fields.
 *
 * H1.4 static analysis: reads composition.yaml's caption entrance/exit
 * durations, track-clip transforms, etc. Doesn't need a render pass.
 * Future puppeteer version can add render-time tween extraction.
 */
import { CompositionSchema } from "../../shared/composition.js";

export interface TweenSummary {
  elementId: string;
  start: number;
  end: number;
  property: "opacity" | "transform" | "color" | "scale" | "other";
  description: string;
}

export interface AnimationMapReport {
  durationSec: number;
  tweens: TweenSummary[];
  deadZones: Array<{ start: number; end: number; durationSec: number }>;
  staggers: Array<{ ids: string[]; intervalMs: number }>;
  flags: Array<{ tweenIndex: number; flag: string; message: string }>;
}

const DEAD_ZONE_MIN_SEC = 1;

export function animationMap(input: unknown): AnimationMapReport {
  const parsed = CompositionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      durationSec: 0,
      tweens: [],
      deadZones: [],
      staggers: [],
      flags: [],
    };
  }
  const comp = parsed.data;
  const tweens: TweenSummary[] = [];

  // Caption group entrance / exit tweens
  if (comp.captions) {
    for (const g of comp.captions.groups) {
      const anim = g.animation;
      if (anim?.entrance) {
        tweens.push({
          elementId: g.groupId,
          start: g.start,
          end: g.start + anim.entrance.duration,
          property: anim.entrance.type === "fade" ? "opacity" : "transform",
          description: `${anim.entrance.type} entrance ${anim.entrance.duration}s`,
        });
      }
      if (anim?.exit) {
        tweens.push({
          elementId: g.groupId,
          start: g.end - anim.exit.duration,
          end: g.end,
          property: anim.exit.type === "fade" ? "opacity" : "transform",
          description: `${anim.exit.type} exit ${anim.exit.duration}s`,
        });
      }
    }
  }

  // Sort by start time for downstream analyses
  tweens.sort((a, b) => a.start - b.start);

  // Dead zones — windows >1s within composition with no tween activity
  const deadZones: AnimationMapReport["deadZones"] = [];
  let cursor = 0;
  for (const t of tweens) {
    if (t.start - cursor >= DEAD_ZONE_MIN_SEC) {
      deadZones.push({
        start: cursor,
        end: t.start,
        durationSec: t.start - cursor,
      });
    }
    cursor = Math.max(cursor, t.end);
  }
  if (comp.duration - cursor >= DEAD_ZONE_MIN_SEC) {
    deadZones.push({
      start: cursor,
      end: comp.duration,
      durationSec: comp.duration - cursor,
    });
  }

  // Staggers — three or more entrance tweens within 50ms intervals
  const entrances = tweens
    .filter((t) => /entrance/.test(t.description))
    .sort((a, b) => a.start - b.start);
  const staggers: AnimationMapReport["staggers"] = [];
  for (let i = 0; i + 2 < entrances.length; i++) {
    const a = entrances[i]!;
    const b = entrances[i + 1]!;
    const c = entrances[i + 2]!;
    const d1 = b.start - a.start;
    const d2 = c.start - b.start;
    if (
      d1 > 0 &&
      Math.abs(d1 - d2) / d1 < 0.2 &&
      d1 < 0.5 // within 500ms
    ) {
      staggers.push({
        ids: [a.elementId, b.elementId, c.elementId],
        intervalMs: Math.round(d1 * 1000),
      });
    }
  }

  // Flags — paced-fast / paced-slow / out-of-window
  const flags: AnimationMapReport["flags"] = [];
  tweens.forEach((t, i) => {
    const dur = t.end - t.start;
    if (dur < 0.2) {
      flags.push({
        tweenIndex: i,
        flag: "paced-fast",
        message: `${t.elementId} ${t.property} runs in ${(dur * 1000).toFixed(0)}ms — may be missed by viewer`,
      });
    } else if (dur > 2) {
      flags.push({
        tweenIndex: i,
        flag: "paced-slow",
        message: `${t.elementId} ${t.property} runs ${dur.toFixed(1)}s — may feel sluggish`,
      });
    }
    if (t.end > comp.duration + 0.01) {
      flags.push({
        tweenIndex: i,
        flag: "out-of-window",
        message: `${t.elementId} ${t.property} extends past composition duration (${t.end.toFixed(2)} > ${comp.duration})`,
      });
    }
  });

  return {
    durationSec: comp.duration,
    tweens,
    deadZones,
    staggers,
    flags,
  };
}

/** ASCII Gantt for TTY output. One row per tween, ~80 cols wide. */
export function asciiGantt(report: AnimationMapReport): string {
  if (report.tweens.length === 0) return "(no tweens)";
  const cols = 78;
  const dur = Math.max(report.durationSec, 0.001);
  const lines: string[] = [];
  for (const t of report.tweens) {
    const s = Math.max(0, Math.round((t.start / dur) * cols));
    const e = Math.min(cols, Math.round((t.end / dur) * cols));
    const bar =
      " ".repeat(s) + "█".repeat(Math.max(1, e - s)) + " ".repeat(cols - e);
    lines.push(`${t.elementId.padEnd(12)} ${bar}`);
  }
  return lines.join("\n");
}
