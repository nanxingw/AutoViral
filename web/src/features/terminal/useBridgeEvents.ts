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
    const ws = new WebSocket(url);

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

    ws.onmessage = (e) => {
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

    return () => {
      ws.close();
    };
  }, [workId, queryClient]);
}
