export interface ReconnectingWSOptions {
  backoffMs?: number;
  maxBackoffMs?: number;
}

type Listener<T> = (msg: T) => void;

/**
 * Public connection state — exposed so UI can render "Reconnecting…" badges
 * instead of leaving the user wondering why their messages disappear into
 * the void. Round 19: previously the close→reconnect cycle was completely
 * silent, even when offline.
 */
export type WSState = "connecting" | "open" | "reconnecting";
type StateListener = (s: WSState) => void;

export class ReconnectingWS<T = string> {
  private socket: WebSocket | null = null;
  private buffer: string[] = [];
  private listeners = new Set<Listener<T>>();
  private stateListeners = new Set<StateListener>();
  private state: WSState = "connecting";
  private disposed = false;
  private readonly initialBackoff: number;
  private backoff: number;
  private readonly maxBackoff: number;

  constructor(
    private readonly url: string,
    opts: ReconnectingWSOptions = {},
  ) {
    this.initialBackoff = opts.backoffMs ?? 500;
    this.backoff = this.initialBackoff;
    this.maxBackoff = opts.maxBackoffMs ?? 8000;
    this.connect();
  }

  private setState(s: WSState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateListeners.forEach((fn) => fn(s));
  }

  private connect(): void {
    if (this.disposed) return;
    const sock = new WebSocket(this.url);
    this.socket = sock;
    sock.addEventListener("open", () => {
      // Successful connection — reset backoff so the next failure starts fresh
      this.backoff = this.initialBackoff;
      while (this.buffer.length) sock.send(this.buffer.shift()!);
      this.setState("open");
    });
    sock.addEventListener("message", (e: MessageEvent) => {
      this.listeners.forEach((fn) => fn(e.data as T));
    });
    sock.addEventListener("close", () => {
      this.socket = null;
      if (this.disposed) return;
      this.setState("reconnecting");
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    });
    // error → close cascade is intentional: a connect-error storm should back off,
    // and the close handler is the single place backoff grows.
    sock.addEventListener("error", () => sock.close());
  }

  send(data: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(data);
    else this.buffer.push(data);
  }

  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Subscribe to connection-state transitions. Returns an unsubscribe fn. */
  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  }

  /** Synchronous read of the current connection state. */
  getState(): WSState {
    return this.state;
  }

  dispose(): void {
    this.disposed = true;
    this.socket?.close();
    this.listeners.clear();
    this.stateListeners.clear();
  }
}
