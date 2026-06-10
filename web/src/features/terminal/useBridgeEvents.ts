// Phase 3 Task 3.5 — subscribe Studio to /ws/bridge/:workId.
//
// The hook owns a single WebSocket per workId and routes incoming
// UiEvent frames into the appropriate store. It intentionally re-uses
// the existing zustand stores (useComposition for select/seek,
// useToastStore for toasts) rather than introducing a new "bridge
// state" store — every bridge event is a *command*, not a piece of
// shared state.
//
// play / pause are dispatched as window CustomEvents so PreviewPanel
// (Task 3.6) can imperatively poke its <Player> ref without us
// reaching into its internals.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useComposition } from "@/features/studio/store";
import { useToastStore } from "@/stores/toast";

type UiEvent = { type: string; workId: string; ts: number; payload: any };

// kind → toast variant mapping. Phase 5 Task 5.1 — the toast store now
// supports success/warn/error/info directly so the kind-indicator dot
// reflects the bridge `ui-toast` kind verbatim.
function variantFromKind(kind: string): "info" | "error" | "success" | "warn" {
  if (kind === "error") return "error";
  if (kind === "success") return "success";
  if (kind === "warn" || kind === "warning") return "warn";
  return "info";
}

export function useBridgeEvents(workId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!workId) return;
    // jsdom test envs don't ship WebSocket; bail cleanly so render tests
    // that mount Studio don't crash. The real browser always has it.
    if (typeof WebSocket === "undefined") return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/bridge/${workId}`;

    // Re-fetch the composition from disk into the store. Kept as a dynamic
    // import so this hook stays free of a hard dep on the composition service
    // (which has its own test surface). Shared by composition-changed and
    // asset-added (I17) so both refresh the dive canvas / asset registry.
    const refetchComposition = () => {
      import("@/features/studio/services/composition")
        .then(({ loadComposition }) =>
          loadComposition(workId).then(
            (found) => found && useComposition.getState().loadComposition(found),
          ),
        )
        .catch(() => {
          /* swallow — refetch failure is non-fatal */
        });
    };

    // S2 (US 17) — carousel twin of refetchComposition. A carousel write
    // endpoint (add-slide / set-layer) now broadcasts "carousel-changed" right
    // after the atomic write lands, so the Editor refetches carousel.yaml into
    // its store and the preview reflects the agent's change WITHOUT a reload —
    // replacing the fragile fs.watch path. Dynamic import keeps this terminal
    // hook free of a hard dep on the editor feature.
    const refetchCarousel = () => {
      Promise.all([
        import("@/features/editor/services/carousel"),
        import("@/features/editor/store"),
      ])
        .then(([{ loadCarousel }, { useEditor }]) =>
          loadCarousel(workId).then(
            (found) => found && useEditor.getState().loadCarousel(found),
          ),
        )
        .catch(() => {
          /* swallow — refetch failure is non-fatal */
        });
    };

    // S5 (PRD-0007) — 剧本 twin of refetchComposition. The 剧本
    // (plan/script.md) write endpoint broadcasts "plan-changed" right after the
    // markdown lands (and the plan-watcher fires it for external edits), so the
    // Studio script editor refetches plan/script.md into its store and reflects
    // the change WITHOUT a reload — agent (`autoviral script edit`) and human
    // converge on the same on-disk markdown (ADR-009 agent-人一致). Dynamic
    // import keeps this terminal hook free of a hard dep on the studio feature.
    const refetchScript = () => {
      Promise.all([
        import("@/features/studio/services/script"),
        import("@/features/studio/scriptStore"),
      ])
        .then(([{ loadScript }, { useScript }]) =>
          // Stamp the owning workId so the script store stays tenant-aware: the
          // WS is per-work, so this `workId` is the script's rightful owner.
          loadScript(workId).then((md) => useScript.getState().setScript(workId, md)),
        )
        .catch(() => {
          /* swallow — refetch failure is non-fatal */
        });
    };

    const onMessage = (e: MessageEvent) => {
      let ev: UiEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      const store = useComposition.getState();
      switch (ev.type) {
        case "ui-select": {
          const target = ev.payload as { kind: string; id?: string };
          if (target?.kind === "clip" && target.id) store.setSelection(target.id);
          else if (target?.kind === "none") store.setSelection(null);
          // track selection (highlight only, no store field for it yet) ignored
          break;
        }
        case "ui-seek": {
          const fps = store.comp?.fps ?? 30;
          const seconds = (ev.payload as { seconds: number }).seconds ?? 0;
          store.setFrame(Math.round(seconds * fps));
          break;
        }
        case "ui-play":
        case "ui-pause":
          window.dispatchEvent(new CustomEvent(`autoviral:${ev.type}`));
          break;
        case "ui-toast": {
          const p = ev.payload as { message: string; kind?: string; durationMs?: number };
          useToastStore.getState().push({
            variant: variantFromKind(p.kind ?? "info"),
            message: p.message,
            ttlMs: p.durationMs ?? 3000,
          });
          break;
        }
        case "ui-progress": {
          const p = ev.payload as { phase: string; label?: string };
          useToastStore.getState().push({
            variant: "info",
            message:
              p.phase === "start"
                ? `${p.label ?? "working"}…`
                : p.phase === "done"
                  ? "done"
                  : `${p.label ?? "step"} ${(p as any).n ?? ""}`,
            ttlMs: 2000,
          });
          break;
        }
        case "composition-changed":
          // Phase 3 Task 3.10 — re-fetch from disk into the store.
          refetchComposition();
          break;
        case "carousel-changed":
          // S2 (US 17) — re-fetch carousel.yaml into the editor store so the
          // carousel preview reflects an agent write without a page reload.
          refetchCarousel();
          break;
        case "plan-changed":
          // S5 (PRD-0007) — re-fetch plan/script.md into the script store so the
          // Studio script editor reflects an agent write (or an external editor
          // edit caught by the plan-watcher) without a page reload.
          refetchScript();
          break;
        case "asset-added":
          // I17 — a freshly generated image/video (or TTS audio) landed in the
          // work. The server publishes this from generate.ts / audio.ts. Reuse
          // the composition-changed refetch (keeps the dive canvas / asset
          // registry current) AND invalidate the filesystem-driven library
          // query (["assets", workId]) that LibraryTab renders, so the new
          // thumbnail appears live without a page reload.
          refetchComposition();
          void queryClient.invalidateQueries({ queryKey: ["assets", workId] });
          break;
        default:
          // ui-ask is handled by ApprovalPrompt (Task 3.9) on its own WS.
          // ui-render-progress — Phase 5 Task 5.2 routes through a window
          // CustomEvent so RenderProgressBar can subscribe without us
          // owning render-state in the toast store. Render is a stream,
          // not a model surface.
          if (ev.type === "ui-render-progress") {
            const p = ev.payload as { stage: string; pct?: number };
            window.dispatchEvent(
              new CustomEvent("autoviral:ui-render-progress", { detail: p }),
            );
          }
          break;
      }
    };

    // ── Connection lifecycle with auto-reconnect ─────────────────────────
    // A dropped socket (daemon restart, laptop sleep, network blip) used to
    // leave the page permanently deaf: no composition/plan/asset events ever
    // arrived again until a manual reload — which read as "generated assets
    // don't show up until I refresh". Reconnect with capped exponential
    // backoff, and on every RE-connect run a full catch-up refetch, because
    // any events published while we were down are gone for good (the bus has
    // no replay).
    let ws: WebSocket | null = null;
    let disposed = false;
    let retryMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hadConnection = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(url);
      ws.onmessage = onMessage;
      ws.onopen = () => {
        retryMs = 1000;
        if (hadConnection) {
          // Catch up on everything we may have missed while disconnected.
          refetchComposition();
          refetchCarousel();
          refetchScript();
          void queryClient.invalidateQueries({ queryKey: ["assets", workId] });
        }
        hadConnection = true;
      };
      ws.onclose = () => {
        if (disposed) return;
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 10_000);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [workId, queryClient]);
}
