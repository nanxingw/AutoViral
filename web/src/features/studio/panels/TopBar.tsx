import { useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useComposition } from "../store";
import { useNavigate } from "react-router-dom";
import { useT } from "@/i18n/useT";
import {
  enqueueRender,
  resolveRenderOpts,
  type EnqueueRenderOptions,
} from "../services/render";
import { ExportProgress } from "../render-status/ExportProgress";
import { CheckpointsMenu } from "@/features/checkpoints/CheckpointsMenu";
import { ExportCaptionsDialog } from "./Export/ExportCaptionsDialog";
import type { CaptionTrackOption } from "./Export/CaptionTracksSection";
import { ShortcutsCheatsheet } from "./ShortcutsCheatsheet";

export interface TopBarProps {
  workId: string;
  savedAt: string | null;
  /** R20: when truthy, replaces the SAVED indicator with a red SAVE FAILED
   *  badge — autosave round-trip rejected. */
  saveError?: string | null;
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
}

export function TopBar({
  workId,
  savedAt,
  saveError,
  onToggleSettings,
  settingsOpen,
}: TopBarProps) {
  const navigate = useNavigate();
  const comp = useComposition((s) => s.comp);
  const t = useT();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [lastOpts, setLastOpts] = useState<EnqueueRenderOptions>({
    type: "full",
  });
  const [captionsDialogOpen, setCaptionsDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // #62 — reentrancy guard for the multi-minute export. enqueueingRef is the
  // REAL lock: a double-click fires two onClicks in the same tick, before any
  // setState has flushed, so a useState flag would still be false on the second
  // call (stale render). The ref flips synchronously and gates the second call.
  // `enqueueing` is UI feedback only (disables the button). See memory:
  // "useRef is the real race lock, useState is UI feedback only".
  const enqueueingRef = useRef(false);
  const [enqueueing, setEnqueueing] = useState(false);

  // Phase H (#35) — derive the text-track list for the captions dialog.
  // Reading from the composition store keeps the dialog in sync with the
  // current lane stack (rename / add / remove a caption lane and the
  // dialog reflects it on next open).
  const captionTrackOptions: CaptionTrackOption[] = useMemo(() => {
    const tracks = comp?.tracks ?? [];
    return tracks
      .filter((t) => t.kind === "text")
      .map((t) => ({
        id: t.id,
        label: t.label,
        language: (t as { language?: string }).language,
      }));
  }, [comp]);

  async function startExport(opts: EnqueueRenderOptions) {
    // #62 — block re-entry while an enqueue is in flight (double-click guard).
    if (enqueueingRef.current) return;
    enqueueingRef.current = true;
    setEnqueueing(true);
    try {
      // #80 — bridge the active platform preset's loudness target (and preset
      // id) from the stored composition into the render request. Without this
      // the server's loudnorm always falls back to -14 and a non-default
      // preset (e.g. WeChat Channels -16) is silently dropped. Store the
      // merged opts so a retry re-sends the same target.
      const merged = resolveRenderOpts(opts, comp?.exportPresets?.[0]);
      setLastOpts(merged);
      const { jobId } = await enqueueRender(workId, merged);
      setActiveJobId(jobId);
    } finally {
      enqueueingRef.current = false;
      setEnqueueing(false);
    }
  }

  // Escape closes the modal — keeps WebSocket subscription cleanup tied to
  // unmount of <ExportProgress /> via useRenderJob's useEffect cleanup.
  useEffect(() => {
    if (!activeJobId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveJobId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeJobId]);

  // #89 — `?` opens the shortcuts cheatsheet (the canonical discoverability
  // gesture). Mirror useShortcuts' input-element guard so typing a literal
  // "?" into a field / textarea doesn't pop the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      setShortcutsOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 18px",
        height: "100%",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        data-bare
        onClick={() => navigate("/")}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        {t("studio.topBar.back")}
      </button>

      <div style={{ width: 1, height: 20, background: "var(--divider)", flexShrink: 0 }} />

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flex: 1, minWidth: 0, overflow: "hidden" }}>
        <span
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 22,
            fontStyle: "italic",
            color: "var(--accent)",
            letterSpacing: "-0.02em",
            flexShrink: 0,
          }}
        >
          Autoviral
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-dimmer)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {t("studio.topBar.versionTag")}
        </span>
        <div style={{ width: 1, height: 14, background: "var(--divider)", margin: "0 8px", flexShrink: 0 }} />
        <span
          // R38: ellipsis was already declared but missing whiteSpace
          // nowrap + maxWidth — text just wrapped to 2+ lines instead of
          // truncating. Add both so long ids stay on one line.
          title={comp?.id ?? workId}
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--text)",
            letterSpacing: "-0.015em",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {comp?.id ?? workId}
        </span>
      </div>

      {saveError ? (
        <span
          role="alert"
          title={t("common.saveFailedTitle", { msg: saveError })}
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid var(--status-error, #d4756c)",
            background: "rgba(212, 117, 108, 0.1)",
            color: "var(--status-error, #d4756c)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            flexShrink: 0,
          }}
        >
          ⚠ {t("common.saveFailed")}
        </span>
      ) : (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: savedAt ? "var(--status-done)" : "var(--text-dimmer)",
            flexShrink: 0,
          }}
        >
          {savedAt ? `${t("studio.topBar.saved")} · ${savedAt}` : t("studio.topBar.unsaved")}
        </span>
      )}

      <div style={{ width: 1, height: 20, background: "var(--divider)", flexShrink: 0 }} />

      <CheckpointsMenu workId={workId} />

      <div style={{ width: 1, height: 20, background: "var(--divider)", flexShrink: 0 }} />

      <button
        type="button"
        data-bare
        onClick={() => setShortcutsOpen(true)}
        aria-label={t("studio.topBar.shortcuts")}
        title={t("studio.topBar.shortcuts")}
        data-testid="shortcuts-toggle"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          border: "1px solid var(--glass-border)",
          background: "var(--surface-0)",
          color: "var(--text-dim)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        ?
      </button>

      {onToggleSettings ? (
        <button
          type="button"
          data-bare
          onClick={onToggleSettings}
          aria-label={t("studio.topBar.toggleSettings")}
          aria-pressed={settingsOpen ? true : false}
          data-testid="settings-toggle"
          title={t("studio.topBar.toggleSettings")}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--glass-border)",
            background: settingsOpen ? "var(--surface-1)" : "var(--surface-0)",
            color: settingsOpen ? "var(--accent)" : "var(--text-dim)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ) : null}

      <div style={{ display: "inline-flex", flexShrink: 0 }}>
        <button
          type="button"
          data-bare
          onClick={() => void startExport({ type: "full" })}
          aria-label="Export full render"
          disabled={enqueueing}
          aria-busy={enqueueing}
          style={{
            padding: "7px 14px",
            borderRadius: "9px 0 0 9px",
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid var(--accent-hi)",
            borderRight: "1px solid var(--accent)",
            background: "linear-gradient(180deg, var(--accent-hi), var(--accent))",
            color: "var(--accent-fg)",
            cursor: enqueueing ? "wait" : "pointer",
            opacity: enqueueing ? 0.6 : 1,
            letterSpacing: "-0.005em",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 4px 16px var(--accent-glow)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          {t("studio.topBar.exportFull")}
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              data-bare
              aria-label={t("studio.topBar.moreExportOptions")}
              style={{
                padding: "7px 8px",
                borderRadius: "0 9px 9px 0",
                fontSize: 12,
                fontWeight: 600,
                border: "1px solid var(--accent-hi)",
                borderLeft: "none",
                background: "linear-gradient(180deg, var(--accent-hi), var(--accent))",
                color: "var(--accent-fg)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                boxShadow: "0 4px 16px var(--accent-glow)",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              style={{
                minWidth: 200,
                background: "var(--surface-1)",
                border: "1px solid var(--glass-border)",
                borderRadius: 8,
                padding: 4,
                boxShadow: "0 12px 32px rgba(0,0,0,0.32)",
                zIndex: 200,
              }}
            >
              <DropdownMenu.Item
                disabled={enqueueing}
                onSelect={() => void startExport({ type: "proxy" })}
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                  color: "var(--text)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {t("studio.topBar.quickProxyExport")}
              </DropdownMenu.Item>
              {/* Phase H (#35) — Resolve-model caption track picker. We
                  always show the item (even with 0 text tracks) so users
                  discover the feature; the dialog itself surfaces an
                  empty state when there's nothing to configure. */}
              <DropdownMenu.Item
                data-testid="export-captions-trigger"
                onSelect={() => setCaptionsDialogOpen(true)}
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                  color: "var(--text)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {t("studio.captionExport.trigger")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {activeJobId ? (
        <ExportProgress
          jobId={activeJobId}
          workId={workId}
          onClose={() => setActiveJobId(null)}
          onRetry={() => void startExport(lastOpts)}
        />
      ) : null}

      {captionsDialogOpen ? (
        <ExportCaptionsDialog
          tracks={captionTrackOptions}
          onCancel={() => setCaptionsDialogOpen(false)}
          onExport={(selection) => {
            setCaptionsDialogOpen(false);
            void startExport({
              type: "full",
              captionTracks: {
                burnTrackId: selection.burnTrackId,
                sidecarTrackIds: selection.sidecarTrackIds,
              },
            });
          }}
        />
      ) : null}

      {shortcutsOpen ? (
        <ShortcutsCheatsheet onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </div>
  );
}
