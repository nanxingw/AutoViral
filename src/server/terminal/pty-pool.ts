import * as pty from "node-pty";

/** Cap of recent pty output kept per session for reconnect scrollback replay
 *  (ADR-008 §6). A freshly-attached ws (page reload) otherwise sees an EMPTY
 *  terminal until the next keystroke; replaying this buffer restores prior
 *  scrollback. Bounded so a chatty shell can't grow it without limit — oldest
 *  bytes are evicted once the total exceeds the cap. */
const REPLAY_BUFFER_MAX_BYTES = 256 * 1024;

export interface SpawnOptions {
  workId: string;
  /** Stable session id within the work (ADR-008) — e.g. "s_1". The pty is
   *  keyed by (workId, sessionId) so it survives ws reconnect and a reload
   *  re-attaches to the SAME shell instead of spawning a fresh one. */
  sessionId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface PtySession {
  id: string;
  workId: string;
  sessionId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): () => void;
  onExit(cb: (code: number) => void): () => void;
}

interface PtyEntry extends PtySession {
  proc: pty.IPty;
  dataListeners: Set<(data: string) => void>;
  exitListeners: Set<(code: number) => void>;
  /** Recent output chunks (oldest first) + their running byte total, for
   *  reconnect scrollback replay. Bounded by REPLAY_BUFFER_MAX_BYTES. */
  replayChunks: string[];
  replayBytes: number;
}

/**
 * Pool of ptys keyed by `(workId, sessionId)` (ADR-008 §6). A pty PERSISTS
 * across ws reconnect — `getOrSpawn` returns the existing shell for a key
 * instead of spawning a new one, so a reload / second tab on the same session
 * multiplexes onto one pty (output is fanned to every attached listener; resize
 * is last-writer-wins). The pty is disposed only on explicit `dispose()`
 * (session delete) or when the shell process exits.
 *
 * Each pty keeps a bounded RING BUFFER of its recent output so a freshly
 * attached ws (page reload) can replay prior scrollback before live output
 * resumes — see `replayBuffer` (ADR-008 §6).
 */
export class PtyPool {
  private readonly sessions = new Map<string, PtyEntry>();

  /** Compose the pool key. Distinct (workId, sessionId) → distinct pty.
   *  JSON-encode the pair so the key is unambiguous for ANY id contents — a
   *  bare delimiter (even "::") collides when an id itself contains it, e.g.
   *  ("a","b::c") vs ("a::b","c"). The encoded form can never collide. */
  private key(workId: string, sessionId: string): string {
    return JSON.stringify([workId, sessionId]);
  }

  /**
   * Return the live pty for (workId, sessionId), or spawn one if none exists
   * (or the previous one exited). This is the resume primitive: a reconnecting
   * ws gets the SAME shell, scrollback intact in the running process.
   */
  getOrSpawn(opts: SpawnOptions): PtySession {
    const k = this.key(opts.workId, opts.sessionId);
    const existing = this.sessions.get(k);
    if (existing) return existing;
    return this.spawn(opts);
  }

  spawn(opts: SpawnOptions): PtySession {
    const id = this.key(opts.workId, opts.sessionId);
    const proc = pty.spawn(opts.shell, [], {
      name: "xterm-256color",
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: { ...process.env, ...opts.env },
    });
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(code: number) => void>();
    const entry: PtyEntry = {
      id,
      workId: opts.workId,
      sessionId: opts.sessionId,
      proc,
      dataListeners,
      exitListeners,
      replayChunks: [],
      replayBytes: 0,
      write: (d) => proc.write(d),
      resize: (cols, rows) => proc.resize(cols, rows),
      onData: (cb) => {
        dataListeners.add(cb);
        return () => dataListeners.delete(cb);
      },
      onExit: (cb) => {
        exitListeners.add(cb);
        return () => exitListeners.delete(cb);
      },
    };
    proc.onData((d) => {
      // Record into the bounded replay buffer (oldest evicted) BEFORE fanning,
      // so the scrollback a reconnect replays includes this chunk.
      entry.replayChunks.push(d);
      entry.replayBytes += d.length;
      while (entry.replayBytes > REPLAY_BUFFER_MAX_BYTES && entry.replayChunks.length > 1) {
        const dropped = entry.replayChunks.shift()!;
        entry.replayBytes -= dropped.length;
      }
      dataListeners.forEach((l) => l(d));
    });
    proc.onExit(({ exitCode }) => {
      exitListeners.forEach((l) => l(exitCode));
      this.sessions.delete(id);
    });
    this.sessions.set(id, entry);
    return entry;
  }

  /** Look up the live pty for a key (or undefined). */
  get(workId: string, sessionId: string): PtySession | undefined {
    return this.sessions.get(this.key(workId, sessionId));
  }

  /**
   * Recent output buffered for (workId, sessionId), concatenated oldest-first —
   * empty string if there is no live pty or it has produced nothing yet. A
   * freshly attached ws replays this to restore scrollback before wiring its
   * live onData listener (ADR-008 §6).
   */
  replayBuffer(workId: string, sessionId: string): string {
    return this.sessions.get(this.key(workId, sessionId))?.replayChunks.join("") ?? "";
  }

  /** Number of browser tabs currently attached to a session's pty. */
  attachCount(workId: string, sessionId: string): number {
    return this.sessions.get(this.key(workId, sessionId))?.dataListeners.size ?? 0;
  }

  /**
   * Kill + drop the pty for (workId, sessionId). Called on explicit session
   * delete — NOT on ws.close (the pty must survive reconnect, ADR-008 §6).
   */
  dispose(workId: string, sessionId: string): void {
    const k = this.key(workId, sessionId);
    const entry = this.sessions.get(k);
    if (!entry) return;
    try {
      entry.proc.kill();
    } catch {
      /* already dead */
    }
    this.sessions.delete(k);
  }

  disposeAll(): void {
    for (const entry of [...this.sessions.values()]) {
      try {
        entry.proc.kill();
      } catch {
        /* already dead */
      }
    }
    this.sessions.clear();
  }
}
