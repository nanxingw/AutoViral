// Assets-library watcher — publishes asset-added whenever ANY file lands in a
// work's assets/ tree, regardless of who wrote it.
//
// Why this exists: the blessed generation endpoints (generate image/video/
// batch, TTS, ingest) publish asset-added themselves, but plenty of asset
// producers never go through them — the chat agent writing files via
// Bash/ffmpeg/python, the transition endpoints, captions/mix outputs, scene
// generate. Patching every endpoint one by one leaks forever (each new
// endpoint re-opens the gap); watching the directory closes ALL of them at
// the chokepoint, mirroring composition-watcher / plan-watcher.
//
// macOS gotcha (same as the sibling watchers): atomic tmpfile+rename writes
// surface as 'rename' on the parent dir, so we watch the assets/ DIR
// (recursively — assets/images, assets/clips, assets/audio…) rather than
// individual files.
//
// Burst handling: ffmpeg/PIL write progressively and fire many fs events per
// file; we debounce per workId and publish ONE asset-added per quiet window.
// The frontend handler only invalidates the ["assets", workId] query, so
// coalescing loses nothing.
//
// We dedupe per workId (one watcher per work) so reconnecting the WebSocket
// doesn't multiply listeners. A missing assets/ dir (typo'd workId — real
// works pre-create it at creation, work-store.ts:117) is skipped silently;
// bridge-ws calls this again on the next connect.

import { watch, statSync, type FSWatcher } from "node:fs";
import { join, basename } from "node:path";
import { uiEventBus } from "./ui-events.js";
import { getWorksRoot } from "../safe-paths.js";

const watchers = new Map<string, FSWatcher>();
const pending = new Map<string, NodeJS.Timeout>();

const DEBOUNCE_MS = 250;
// Skip editor/OS droppings and in-flight partial files.
const IGNORED = /^\.|\.(tmp|part|crdownload|swp)$/i;

function assetsDirFor(workId: string): string {
  return join(getWorksRoot(), workId, "assets");
}

export function watchAssetsFor(workId: string): void {
  if (watchers.has(workId)) return;
  const dir = assetsDirFor(workId);
  let w: FSWatcher;
  try {
    w = watch(dir, { recursive: true, persistent: true }, (_evt, filename) => {
      const rel = filename ? filename.toString() : "";
      if (rel && IGNORED.test(basename(rel))) return;
      // macOS emits a self-referencing event named after the watched dir
      // ("assets") alongside the per-file events — join(dir, "assets") points
      // at nothing, so it would otherwise slip the stat guard below.
      if (rel === basename(dir)) return;
      // A write inside a subdir also surfaces as an event on the subdir ENTRY
      // itself (macOS) — ignore directory events, only files are assets. A
      // failed stat = the entry was just deleted; fire anyway so the library
      // drops the removed file too.
      if (rel) {
        try {
          if (statSync(join(dir, rel)).isDirectory()) return;
        } catch {
          /* deleted — fall through and publish */
        }
      }
      const prev = pending.get(workId);
      if (prev) clearTimeout(prev);
      pending.set(
        workId,
        setTimeout(() => {
          pending.delete(workId);
          uiEventBus.publish(workId, {
            type: "asset-added",
            workId,
            ts: Date.now(),
            payload: {
              kind: "file",
              uri: rel ? join("assets", rel) : null,
              origin: "assets-watcher",
            },
          });
        }, DEBOUNCE_MS),
      );
    });
  } catch {
    // assets/ dir missing (typo'd workId or legacy work). Skip silently;
    // bridge-ws will call this again on the next connect.
    return;
  }
  watchers.set(workId, w);
}

export function unwatchAssetsFor(workId: string): void {
  const w = watchers.get(workId);
  if (w) {
    w.close();
    watchers.delete(workId);
  }
  const t = pending.get(workId);
  if (t) {
    clearTimeout(t);
    pending.delete(workId);
  }
}

/** Test helper — close all live assets watchers + cancel pending debounces. */
export function _closeAllAssetsWatchers(): void {
  for (const w of watchers.values()) w.close();
  watchers.clear();
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}
