import { readdirSync, statSync, watch } from "node:fs";
import { join, relative } from "node:path";

export interface DirectoryWatcher {
  close(): void;
}

type WatchCallback = (event: "change" | "rename", filename: string | null) => void;

function snapshot(root: string, recursive: boolean): Map<string, number> {
  const entries = new Map<string, number>();
  const scan = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const rel = relative(root, fullPath);
      if (entry.isDirectory()) {
        if (recursive) scan(fullPath);
        continue;
      }
      try {
        const stat = statSync(fullPath);
        entries.set(rel, stat.mtimeMs + stat.size);
      } catch {
        // The entry disappeared between readdir and stat; the next scan will
        // report the deletion against the previous snapshot.
      }
    }
  };
  scan(root);
  return entries;
}

/**
 * Prefer the OS watcher, but fall back to a small directory snapshot poll when
 * the host cannot allocate native watches (for example EMFILE in a sandbox).
 * The fallback preserves the same filename-oriented contract used by the
 * composition, plan, and asset watchers.
 */
export function watchDirectory(
  dir: string,
  options: { recursive?: boolean; persistent?: boolean },
  callback: WatchCallback,
): DirectoryWatcher {
  const recursive = options.recursive === true;
  let closed = false;
  let poll: NodeJS.Timeout | undefined;
  let previous = snapshot(dir, recursive);

  const startPolling = (): void => {
    if (closed || poll) return;
    poll = setInterval(() => {
      let current: Map<string, number>;
      try {
        current = snapshot(dir, recursive);
      } catch {
        return;
      }
      const names = new Set([...previous.keys(), ...current.keys()]);
      for (const name of names) {
        if (previous.get(name) !== current.get(name)) callback("change", name);
      }
      previous = current;
    }, 25);
  };

  let native: ReturnType<typeof watch> | undefined;
  try {
    native = watch(dir, options, callback);
    native.on("error", () => {
      native?.close();
      native = undefined;
      startPolling();
    });
  } catch {
    startPolling();
  }

  return {
    close(): void {
      closed = true;
      native?.close();
      if (poll) clearInterval(poll);
    },
  };
}
