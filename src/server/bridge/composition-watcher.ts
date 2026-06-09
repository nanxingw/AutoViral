// Phase 3 Task 3.10 — file watcher that publishes composition-changed
// events whenever a work's composition.yaml is modified on disk.
//
// macOS gotcha: our atomic-write helper does tmpfile + rename(), which
// `fs.watch` typically surfaces as an `rename` event on the parent
// directory rather than `change` on the file itself. We therefore watch
// the PARENT dir and filter for the composition.yaml entry — that
// catches both write-in-place and atomic-rename writes.
//
// We dedupe per workId (one watcher per work) so reconnecting the
// WebSocket doesn't multiply listeners.

import { watch, type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import { uiEventBus } from "./ui-events.js";
import { compositionPathFor } from "./composition-ops.js";
import { getWorksRoot } from "../safe-paths.js";

const watchers = new Map<string, FSWatcher>();

export function watchCompositionFor(workId: string): void {
  if (watchers.has(workId)) return;
  // Shared works-root resolver — keeps this watcher, the plan-watcher, and the
  // REST routes in lockstep on a non-default config (single source of truth).
  const fullPath = compositionPathFor({ workId, worksRoot: getWorksRoot() });
  const dir = dirname(fullPath);
  let w: FSWatcher;
  try {
    w = watch(dir, { persistent: true }, (_evt, filename) => {
      // Atomic rename on macOS surfaces as a 'rename' event with the
      // filename (or null on some platforms). Coalesce by re-checking
      // the filename and firing a single composition-changed.
      if (filename && !filename.toString().endsWith("composition.yaml")) return;
      uiEventBus.publish(workId, {
        type: "composition-changed",
        workId,
        ts: Date.now(),
        payload: null,
      });
    });
  } catch {
    // Directory may not exist yet (no composition saved). Skip silently;
    // bridge-ws will call this again on the next connect.
    return;
  }
  watchers.set(workId, w);
}

export function unwatchCompositionFor(workId: string): void {
  const w = watchers.get(workId);
  if (!w) return;
  w.close();
  watchers.delete(workId);
}

/** Test helper — close all live watchers. */
export function _closeAllWatchers(): void {
  for (const w of watchers.values()) w.close();
  watchers.clear();
}
