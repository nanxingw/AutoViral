// S5 (PRD-0007 §4.5) — file watcher that publishes plan-changed events
// whenever a work's plan/script.md (剧本 narrative outline) is modified on
// disk by an EXTERNAL writer (agent via `autoviral script edit`, a text
// editor, another process). The in-app PUT route already broadcasts
// plan-changed directly; this watcher covers the out-of-band edits the route
// never sees.
//
// macOS gotcha (same as composition-watcher): our writes land via
// writeFile / tmpfile+rename, which `fs.watch` typically surfaces as a
// `rename` event on the PARENT directory rather than `change` on the file
// itself. We therefore watch the plan/ DIR and filter for the script.md
// entry — that catches both write-in-place and atomic-rename writes.
//
// We dedupe per workId (one watcher per work) so reconnecting the WebSocket
// doesn't multiply listeners.

import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { uiEventBus } from "./ui-events.js";
import { getWorksRoot } from "../safe-paths.js";

const watchers = new Map<string, FSWatcher>();

/** The directory that holds plan/script.md for a work. Resolves the works root
 *  via the shared helper so the watcher never diverges from the REST routes on a
 *  non-default config (was AUTOVIRAL_WORKS_ROOT-only; routes use DATA_DIR). */
function planDirFor(workId: string): string {
  return join(getWorksRoot(), workId, "plan");
}

export function watchPlanFor(workId: string): void {
  if (watchers.has(workId)) return;
  const dir = planDirFor(workId);
  let w: FSWatcher;
  try {
    w = watch(dir, { persistent: true }, (_evt, filename) => {
      // Atomic rename on macOS surfaces as a 'rename' event with the filename
      // (or null on some platforms). Coalesce by re-checking the filename and
      // firing a single plan-changed.
      if (filename && !filename.toString().endsWith("script.md")) return;
      uiEventBus.publish(workId, {
        type: "plan-changed",
        workId,
        ts: Date.now(),
        payload: null,
      });
    });
  } catch {
    // plan/ dir may not exist yet (no script.md saved). Skip silently;
    // bridge-ws will call this again on the next connect.
    return;
  }
  watchers.set(workId, w);
}

export function unwatchPlanFor(workId: string): void {
  const w = watchers.get(workId);
  if (!w) return;
  w.close();
  watchers.delete(workId);
}

/** Test helper — close all live plan watchers. */
export function _closeAllPlanWatchers(): void {
  for (const w of watchers.values()) w.close();
  watchers.clear();
}
