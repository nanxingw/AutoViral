// UiEventBus — process-global pub/sub keyed by workId.
//
// The bridge HTTP routes (`POST /select`, `/seek`, `/toast`, `/ask`, etc.)
// publish events here; the `/ws/bridge/:workId` WebSocket adapter
// (bridge-ws.ts) subscribes and forwards JSON-encoded frames to the Studio
// UI. Keeping the bus separate from the WebSocket means HTTP handlers don't
// need to know whether anyone is listening — they fire and forget.
//
// Per-workId isolation: a subscriber for workId "w1" must NEVER receive
// events published for "w2". This is the only invariant that matters for
// the multi-work scenario (one Studio user with multiple Work tabs open).

export interface UiEvent {
  type: string;
  workId: string;
  ts: number;
  payload: unknown;
}

export type UiEventListener = (event: UiEvent) => void;

export class UiEventBus {
  private subs = new Map<string, Set<UiEventListener>>();

  subscribe(workId: string, listener: UiEventListener): () => void {
    let set = this.subs.get(workId);
    if (!set) {
      set = new Set();
      this.subs.set(workId, set);
    }
    set.add(listener);
    return () => {
      this.subs.get(workId)?.delete(listener);
    };
  }

  publish(workId: string, event: UiEvent): void {
    const set = this.subs.get(workId);
    if (!set) return;
    for (const listener of set) listener(event);
  }
}

// Process-global singleton — every HTTP route + every WebSocket attach hook
// imports this exact instance so they share the same subscriber registry.
export const uiEventBus = new UiEventBus();
