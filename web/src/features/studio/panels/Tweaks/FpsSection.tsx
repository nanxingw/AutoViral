import { useState } from "react";
import { useComposition } from "../../store";
import { useT } from "@/i18n/useT";
import { apiFetch, ApiError } from "@/lib/api";
import { FPS_VALUES } from "@shared/composition";
import type { Fps } from "@shared/composition/ops";

interface Props {
  workId: string;
}

/**
 * PRD-0011 F3 — canvas-fps segmented control, docked in the TweaksPanel next
 * to PlatformPresetSection (same section/heading shape). Four canonical
 * values only (24/25/30/60 — FPS_VALUES, the single source shared with the
 * `setFps` op / bridge / CLI). No Reframe-style confirmation dialog: fps is
 * data-lossless and instantly reversible (PRD Implementation Decisions).
 *
 * codex review (F3 finding, high) — clicking a value submits through
 * `POST /api/bridge/v1/comp/fps`, the SAME per-intent route
 * `autoviral comp fps <n>` hits (bridge/routes.ts), converging the human-UI
 * and agent-CLI paths on one write (F2/F3's documented contract). This
 * mirrors the established bridge-write precedent this same PRD batch already
 * ships — GenerateCaptionsButton.tsx and sceneEdit.ts's patchScene/
 * generateScene: the component does NOT mutate `comp.fps` in the store
 * locally; the bridge's atomic write broadcasts `composition-changed`, which
 * useBridgeEvents refetches into the store (see sceneEdit.ts's "we NEVER
 * mutate scenes in the store locally" note for the identical rationale — a
 * local optimistic write here would race the SAME field against a
 * concurrent agent `comp fps` call or the whole-doc autosave PUT).
 *
 * The store's own `setFps` action (a pure local immer write over the shared
 * `ops.setFps`) still exists and is still tested (store.test.ts) — it is the
 * op's in-process unit-test surface, not this component's submit path.
 *
 * Segmented-control markup/styling mirrors PreviewPanel's existing aspect-
 * ratio control (role="group" + aria-pressed + --accent-lo/-hi tokens) —
 * the closest in-repo precedent for "four-way toggle over a canvas param".
 */
export function FpsSection({ workId }: Props) {
  const t = useT();
  const fps = useComposition((s) => s.comp?.fps);
  const [pending, setPending] = useState<Fps | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(next: Fps) {
    if (next === fps) return; // idempotent no-op, same as the shared op
    setPending(next);
    setError(null);
    try {
      await apiFetch(`/api/bridge/v1/comp/fps`, {
        method: "POST",
        headers: { "X-AutoViral-Work-Id": workId },
        body: { fps: next },
      });
      // No local setState on success — composition-changed → useBridgeEvents
      // refetch is the single source of truth for the new comp.fps.
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (() => {
              const b = err.body as { error?: string } | undefined;
              return b?.error ?? err.message;
            })()
          : err instanceof Error
            ? err.message
            : String(err);
      setError(`${t("studio.fpsSection.submitFailed")} (${msg})`);
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--glass-border)",
      }}
    >
      <h4
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
          color: "var(--text-dim)",
          margin: "0 0 8px",
        }}
      >
        {t("studio.fpsSection.heading")}
      </h4>
      <div
        role="group"
        aria-label={t("studio.fpsSection.ariaLabel")}
        style={{ display: "flex", gap: 4 }}
      >
        {FPS_VALUES.map((v) => {
          const active = fps === v;
          return (
            <button
              key={v}
              type="button"
              data-testid={`fps-option-${v}`}
              aria-pressed={active}
              disabled={pending !== null}
              onClick={() => void submit(v)}
              style={{
                flex: 1,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
                padding: "5px 4px",
                borderRadius: "var(--radius-sm)",
                cursor: pending !== null ? "default" : "pointer",
                border: "1px solid var(--glass-border)",
                color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
                background: active ? "var(--accent-lo)" : "transparent",
                opacity: pending !== null && pending !== v ? 0.6 : 1,
              }}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--text-dimmer)",
        }}
      >
        24 {t("studio.fpsSection.recommendedSuffix")}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-dim)",
        }}
      >
        {t("studio.fpsSection.hint")}
      </div>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            lineHeight: 1.5,
            color: "var(--text-warn, #c44a4a)",
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
