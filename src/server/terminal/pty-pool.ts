import * as pty from "node-pty";
import { randomBytes } from "node:crypto";

export interface SpawnOptions {
  workId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface PtySession {
  id: string;
  workId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): () => void;
  onExit(cb: (code: number) => void): () => void;
}

interface PtyEntry extends PtySession {
  proc: pty.IPty;
  dataListeners: Set<(data: string) => void>;
  exitListeners: Set<(code: number) => void>;
}

export class PtyPool {
  private readonly sessions = new Map<string, PtyEntry>();

  spawn(opts: SpawnOptions): PtySession {
    const id = `pty_${randomBytes(6).toString("hex")}`;
    const proc = pty.spawn(opts.shell, [], {
      name: "xterm-256color",
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: { ...process.env, ...opts.env },
    });
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(code: number) => void>();
    proc.onData((d) => dataListeners.forEach((l) => l(d)));
    proc.onExit(({ exitCode }) => {
      exitListeners.forEach((l) => l(exitCode));
      this.sessions.delete(id);
    });
    const entry: PtyEntry = {
      id,
      workId: opts.workId,
      proc,
      dataListeners,
      exitListeners,
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
    this.sessions.set(id, entry);
    return entry;
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  dispose(id: string): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    try {
      entry.proc.kill();
    } catch {
      /* already dead */
    }
    this.sessions.delete(id);
  }

  disposeAll(): void {
    for (const id of this.sessions.keys()) this.dispose(id);
  }
}
