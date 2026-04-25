export interface ReconnectingWSOptions {
  backoffMs?: number;
  maxBackoffMs?: number;
}

type Listener<T> = (msg: T) => void;

export class ReconnectingWS<T = string> {
  private socket: WebSocket | null = null;
  private buffer: string[] = [];
  private listeners = new Set<Listener<T>>();
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

  private connect(): void {
    if (this.disposed) return;
    const sock = new WebSocket(this.url);
    this.socket = sock;
    sock.addEventListener("open", () => {
      // Successful connection — reset backoff so the next failure starts fresh
      this.backoff = this.initialBackoff;
      while (this.buffer.length) sock.send(this.buffer.shift()!);
    });
    sock.addEventListener("message", (e: MessageEvent) => {
      this.listeners.forEach((fn) => fn(e.data as T));
    });
    sock.addEventListener("close", () => {
      this.socket = null;
      if (this.disposed) return;
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

  dispose(): void {
    this.disposed = true;
    this.socket?.close();
    this.listeners.clear();
  }
}
