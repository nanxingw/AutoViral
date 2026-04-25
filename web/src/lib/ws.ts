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
  private backoff: number;
  private readonly maxBackoff: number;

  constructor(
    private readonly url: string,
    opts: ReconnectingWSOptions = {},
  ) {
    this.backoff = opts.backoffMs ?? 500;
    this.maxBackoff = opts.maxBackoffMs ?? 8000;
    this.connect();
  }

  private connect() {
    if (this.disposed) return;
    const sock = new WebSocket(this.url);
    this.socket = sock;
    sock.addEventListener("open", () => {
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
    sock.addEventListener("error", () => sock.close());
  }

  send(data: string) {
    if (this.socket && this.socket.readyState === 1) this.socket.send(data);
    else this.buffer.push(data);
  }

  on(fn: Listener<T>) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    this.disposed = true;
    this.socket?.close();
    this.listeners.clear();
  }
}
