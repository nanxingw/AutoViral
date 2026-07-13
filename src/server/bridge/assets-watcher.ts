// Assets-library watcher — publishes asset-added whenever ANY file lands in a
// work's assets/ OR output/ tree, regardless of who wrote it.
//
// Why this exists: the blessed generation endpoints (generate image/video/
// batch, TTS, ingest) publish asset-added themselves, but plenty of asset
// producers never go through them — the chat agent writing files via
// Bash/ffmpeg/python, the transition endpoints, captions/mix outputs, scene
// generate, and (E2E gap 1, 2026-07-09) the render pipeline's own
// output/final-<ms>.mp4 deliverable. Patching every endpoint one by one
// leaks forever (each new endpoint re-opens the gap); watching the
// directories closes ALL of them at the chokepoint, mirroring
// composition-watcher / plan-watcher.
//
// output/ was added alongside assets/ (not merged into one watch) because a
// finished export is exactly as "a new asset appeared" as anything under
// assets/ — the render-queue worker has no event bus wiring of its own
// (job completion only reaches the UI via the separate /ws/render/jobs/:id
// socket, which the asset library doesn't subscribe to), so without this the
// library only ever learned about a fresh export on a full page reload.
//
// macOS gotcha (same as the sibling watchers): atomic tmpfile+rename writes
// surface as 'rename' on the parent dir, so we watch each DIR (recursively —
// assets/images, assets/clips, assets/audio… / output/) rather than
// individual files.
//
// Burst handling: ffmpeg/PIL write progressively and fire many fs events per
// file; we debounce per (workId, root) and publish ONE asset-added per quiet
// window. The frontend handler only invalidates the ["assets", workId]
// query, so coalescing loses nothing. assets/ and output/ debounce
// independently — a concurrent write burst in one must not swallow a quiet
// window's publish in the other.
//
// We dedupe per (workId, root) (one watcher per work per root) so
// reconnecting the WebSocket doesn't multiply listeners. A missing dir
// (typo'd workId, or a legacy work pre-dating output/'s pre-creation) is
// skipped silently; bridge-ws calls this again on the next connect.

import { statSync } from "node:fs";
import { join, basename } from "node:path";
import { uiEventBus } from "./ui-events.js";
import { getWorksRoot } from "../safe-paths.js";
import { watchDirectory, type DirectoryWatcher } from "./resilient-watch.js";

type WatchRoot = "assets" | "output";
const WATCH_ROOTS: readonly WatchRoot[] = ["assets", "output"];

const watchers = new Map<string, DirectoryWatcher>();
const pending = new Map<string, NodeJS.Timeout>();

const DEBOUNCE_MS = 250;
// Skip editor/OS droppings and in-flight partial files.
const IGNORED = /^\.|\.(tmp|part|crdownload|swp)$/i;

function dirFor(workId: string, root: WatchRoot): string {
  return join(getWorksRoot(), workId, root);
}

function watchKey(workId: string, root: WatchRoot): string {
  return `${workId}::${root}`;
}

function startWatch(workId: string, root: WatchRoot): void {
  const key = watchKey(workId, root);
  if (watchers.has(key)) return;
  const dir = dirFor(workId, root);
  let w: DirectoryWatcher;
  try {
    w = watchDirectory(dir, { recursive: true, persistent: true }, (_evt, filename) => {
      const rel = filename ? filename.toString() : "";
      if (rel && IGNORED.test(basename(rel))) return;
      // macOS emits a self-referencing event named after the watched dir
      // (e.g. "assets"/"output") alongside the per-file events —
      // join(dir, "assets") points at nothing, so it would otherwise slip
      // the stat guard below.
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
      const prev = pending.get(key);
      if (prev) clearTimeout(prev);
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          uiEventBus.publish(workId, {
            type: "asset-added",
            workId,
            ts: Date.now(),
            payload: {
              kind: "file",
              uri: rel ? join(root, rel) : null,
              origin: root === "output" ? "output-watcher" : "assets-watcher",
            },
          });
        }, DEBOUNCE_MS),
      );
    });
  } catch {
    // dir missing (typo'd workId or legacy work). Skip silently; bridge-ws
    // will call this again on the next connect.
    return;
  }
  watchers.set(key, w);
}

export function watchAssetsFor(workId: string): void {
  for (const root of WATCH_ROOTS) startWatch(workId, root);
}

export function unwatchAssetsFor(workId: string): void {
  for (const root of WATCH_ROOTS) {
    const key = watchKey(workId, root);
    const w = watchers.get(key);
    if (w) {
      w.close();
      watchers.delete(key);
    }
    const t = pending.get(key);
    if (t) {
      clearTimeout(t);
      pending.delete(key);
    }
  }
}

/** Test helper — close all live assets watchers + cancel pending debounces. */
export function _closeAllAssetsWatchers(): void {
  for (const w of watchers.values()) w.close();
  watchers.clear();
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}
