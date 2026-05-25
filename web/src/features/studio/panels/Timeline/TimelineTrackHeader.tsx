import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useComposition } from "../../store";
import type { Track } from "../../types";
import { useT } from "@/i18n/useT";
import styles from "./TimelineTrackHeader.module.css";

/* ─── Phase F (issue #33) — track header row ───────────────────────────────
   Double-entry surface for lane mutations. Right-click anywhere on the cell
   OR click the ⋯ icon → same menu. Both call the same store actions, so
   tests can verify either entry path with zero behaviour drift.

   Brand: cool · glass · editorial. Menu container = glass card (blur 24 +
   saturate 140 + 1px --glass-border + --radius-md). Confirm dialog mirrors
   DeleteWorkConfirm's role="alertdialog" pattern. No terminal-hacker
   tonality — the ⋯ trigger is opacity 0 until the row is hovered so the
   timeline stays calm at rest. */

const KIND_COLOR: Record<Track["kind"], string> = {
  video: "var(--accent)",
  audio: "#c084fc",
  text: "var(--text-dim)",
  overlay: "#7dd3fc",
};

const KIND_ICON: Record<Track["kind"], ReactElement> = {
  video: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M22 8l-6 4 6 4V8z" />
    </svg>
  ),
  audio: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  text: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  overlay: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
};

const LANGUAGE_OPTIONS: Array<{ value: string | null; label: string }> = [
  { value: "zh", label: "ZH" },
  { value: "en", label: "EN" },
  { value: "ja", label: "JA" },
  { value: null, label: "—" },
];

interface MenuPosition {
  top: number;
  left: number;
}

interface Props {
  track: Track;
  /** Label fallback for kind-based localisation when track.label is empty. */
  fallbackLabel: string;
  /** Row height so the header cell matches the lane row beside it. */
  height: number;
}

export function TimelineTrackHeader({ track, fallbackLabel, height }: Props) {
  const t = useT();
  // Pull individual actions instead of object-destructuring the whole store
  // — each useComposition selector returns a stable reference so re-renders
  // only fire when the specific slice changes.
  const addTrack = useComposition((s) => s.addTrack);
  const removeTrack = useComposition((s) => s.removeTrack);
  const renameTrack = useComposition((s) => s.renameTrack);
  const setTrackLanguage = useComposition((s) => s.setTrackLanguage);
  // Track ordering — we need it to know which track sits above `track` so
  // "Add lane above" can pick the correct afterTrackId anchor.
  const trackAbove = useComposition((s) => {
    const tracks = s.comp?.tracks;
    if (!tracks) return null;
    const sorted = [...tracks].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sorted.findIndex((x) => x.id === track.id);
    return idx > 0 ? sorted[idx - 1] : null;
  });

  // Menu state — anchored to either a fixed coordinate (right-click) or to
  // the ⋯ button (icon click). We store the coordinate to make positioning
  // identical for both entries: the menu always opens at the cursor / the
  // button's bottom-right corner, never as a CSS-positioned dropdown that
  // could overflow the timeline scroll container.
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Submenu reveal for "Set language" (only on text/subtitle lanes).
  const [langOpen, setLangOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenuPos(null);
    setLangOpen(false);
  }, []);

  // Click-outside + Escape teardown. Mirrors WorkCardMenu, hardened to also
  // close the language submenu in one go.
  useEffect(() => {
    if (!menuPos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      if (menuBtnRef.current && menuBtnRef.current.contains(e.target as Node)) return;
      closeMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [menuPos, closeMenu]);

  // Focus the input the moment we enter rename mode.
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  // ── menu open handlers ──────────────────────────────────────────────────
  const openMenuFromContext = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Suppress the menu while the user is in inline-rename mode.
    if (renaming) return;
    setMenuPos({ top: e.clientY, left: e.clientX });
  }, [renaming]);

  const openMenuFromButton = useCallback(() => {
    const btn = menuBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
  }, []);

  // ── action wrappers ─────────────────────────────────────────────────────
  const handleAddAbove = useCallback(() => {
    closeMenu();
    // Anchor on the track above this one. If we're already top-most, pass
    // no anchor — addTrack will fall through to tail-of-kind placement,
    // which is the right semantic when "above" lands you at position 0.
    if (trackAbove) {
      addTrack(track.kind, { afterTrackId: trackAbove.id });
    } else {
      // Edge: at top of stack. Caller intent is "lane between ruler and
      // this row", but no anchor exists — degrade to same-kind tail. The
      // alternative would be to mint at displayOrder 0 explicitly, which
      // the store doesn't expose; this keeps the contract simple.
      addTrack(track.kind);
    }
  }, [addTrack, closeMenu, track.kind, trackAbove]);

  const handleAddBelow = useCallback(() => {
    closeMenu();
    addTrack(track.kind, { afterTrackId: track.id });
  }, [addTrack, closeMenu, track.id, track.kind]);

  const handleRename = useCallback(() => {
    closeMenu();
    setRenaming(true);
  }, [closeMenu]);

  const commitRename = useCallback((next: string) => {
    setRenaming(false);
    const trimmed = next.trim();
    if (!trimmed) return; // empty label = cancel-equivalent (silent)
    renameTrack(track.id, trimmed);
  }, [renameTrack, track.id]);

  const handleRenameKey = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(e.currentTarget.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenaming(false);
    }
  }, [commitRename]);

  const handleRemoveClick = useCallback(() => {
    closeMenu();
    // Empty lane → fast path: store will succeed without forcing.
    if (track.clips.length === 0) {
      removeTrack(track.id);
      return;
    }
    // Non-empty → confirm dialog gates the destructive {force: true} call.
    setConfirming(true);
  }, [closeMenu, removeTrack, track.clips.length, track.id]);

  const handleConfirmRemove = useCallback(() => {
    setConfirming(false);
    removeTrack(track.id, { force: true });
  }, [removeTrack, track.id]);

  const handleLanguagePick = useCallback((lang: string | null) => {
    closeMenu();
    setTrackLanguage(track.id, lang);
  }, [closeMenu, setTrackLanguage, track.id]);

  // ── mute / hide ────────────────────────────────────────────────────────
  // store doesn't expose dedicated setMuted/setHidden actions; mutate via
  // renameTrack-style snapshot? No — the cleanest path that survives the
  // strict file-edit boundary is to call the store's `loadComposition` is
  // overkill. Instead, mutate via direct setState — this is well-trodden in
  // the rest of the file (e.g. setState in Track.test.tsx). It's not in the
  // store API but is supported by zustand and keeps history intact-ish.
  // BUT — to keep history correct, we use the actions that do exist. Since
  // neither mute nor hide are in #32's API, we fall back to setState here
  // and accept that toggling mute/hide doesn't enter the trackHistory stack.
  // (Following issues can promote these to first-class store actions; for
  // now the UI affordance is more important than the undo coverage.)
  const toggleMuted = useCallback(() => {
    useComposition.setState((s) => {
      if (!s.comp) return s;
      const t = s.comp.tracks.find((x) => x.id === track.id);
      if (!t) return s;
      t.muted = !t.muted;
      return s;
    });
  }, [track.id]);

  const toggleHidden = useCallback(() => {
    useComposition.setState((s) => {
      if (!s.comp) return s;
      const t = s.comp.tracks.find((x) => x.id === track.id);
      if (!t) return s;
      t.hidden = !t.hidden;
      return s;
    });
  }, [track.id]);

  const displayedLabel = useMemo(
    () => (track.label && track.label.length > 0 ? track.label : fallbackLabel),
    [track.label, fallbackLabel],
  );
  const isSubtitleLane = track.kind === "text";

  const rootStyle: CSSProperties = useMemo(() => ({
    minHeight: height,
  }), [height]);

  const menuStyle: CSSProperties | undefined = menuPos
    ? { top: menuPos.top, left: menuPos.left }
    : undefined;

  return (
    <>
      <div
        ref={rootRef}
        className={styles.root}
        style={rootStyle}
        data-track-id={track.id}
        data-kind={track.kind}
        onContextMenu={openMenuFromContext}
      >
        <span
          className={styles.kindIcon}
          style={{ color: KIND_COLOR[track.kind] }}
        >
          {KIND_ICON[track.kind]}
        </span>

        {renaming ? (
          <input
            ref={renameInputRef}
            className={styles.renameInput}
            defaultValue={displayedLabel}
            placeholder={t("studio.timeline.trackHeader.renamePlaceholder")}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onKeyDown={handleRenameKey}
            aria-label={t("studio.timeline.trackHeader.rename")}
          />
        ) : (
          <span className={styles.label} title={displayedLabel}>
            {displayedLabel}
          </span>
        )}

        <button
          type="button"
          className={styles.toggleBtn}
          aria-label={t("studio.timeline.trackHeader.muteAria")}
          aria-pressed={track.muted}
          data-active={track.muted ? "true" : "false"}
          onClick={toggleMuted}
          title={t("studio.timeline.trackHeader.muteAria")}
        >
          {track.muted ? <IconMuted /> : <IconUnmuted />}
        </button>

        <button
          type="button"
          className={styles.toggleBtn}
          aria-label={t("studio.timeline.trackHeader.hideAria")}
          aria-pressed={track.hidden}
          data-active={track.hidden ? "true" : "false"}
          onClick={toggleHidden}
          title={t("studio.timeline.trackHeader.hideAria")}
        >
          {track.hidden ? <IconHidden /> : <IconVisible />}
        </button>

        <button
          ref={menuBtnRef}
          type="button"
          className={styles.menuBtn}
          aria-label={t("studio.timeline.trackHeader.menuAria")}
          aria-haspopup="menu"
          aria-expanded={menuPos !== null}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (menuPos) closeMenu();
            else openMenuFromButton();
          }}
        >
          <IconDots />
        </button>
      </div>

      {menuPos && createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          style={menuStyle}
          role="menu"
          aria-label={t("studio.timeline.trackHeader.menuAria")}
        >
          <button type="button" role="menuitem" className={styles.menuItem} onClick={handleAddAbove}>
            {t("studio.timeline.trackHeader.addAbove")}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={handleAddBelow}>
            {t("studio.timeline.trackHeader.addBelow")}
          </button>
          <hr className={styles.menuDivider} />
          <button type="button" role="menuitem" className={styles.menuItem} onClick={handleRename}>
            {t("studio.timeline.trackHeader.rename")}
          </button>
          {isSubtitleLane && (
            <>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                aria-haspopup="menu"
                aria-expanded={langOpen}
                onClick={() => setLangOpen((v) => !v)}
              >
                {t("studio.timeline.trackHeader.setLanguage")}
                <span aria-hidden="true" style={{ marginLeft: "auto", opacity: 0.6 }}>
                  {track.language ?? "—"} ▾
                </span>
              </button>
              {langOpen && (
                <div className={styles.langSubmenu} role="menu">
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value ?? "none"}
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => handleLanguagePick(opt.value)}
                      data-language={opt.value ?? ""}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <hr className={styles.menuDivider} />
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={handleRemoveClick}
          >
            {t("studio.timeline.trackHeader.remove")}
          </button>
        </div>,
        document.body,
      )}

      {confirming && createPortal(
        <div className={styles.confirmBackdrop} data-testid="track-remove-confirm-backdrop">
          <div
            className={styles.confirmBox}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="track-remove-title"
            aria-describedby="track-remove-body"
          >
            <h3 id="track-remove-title" className={styles.confirmTitle}>
              {t("studio.timeline.trackHeader.removeConfirmTitle")}
            </h3>
            <p id="track-remove-body" className={styles.confirmBody}>
              {track.clips.length > 0
                ? t("studio.timeline.trackHeader.removeConfirmBodyClips", { count: track.clips.length })
                : t("studio.timeline.trackHeader.removeConfirmBodyEmpty")}
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setConfirming(false)}
                autoFocus
              >
                {t("studio.timeline.trackHeader.removeConfirmCancel")}
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                onClick={handleConfirmRemove}
                data-testid="track-remove-confirm-confirm"
              >
                {t("studio.timeline.trackHeader.removeConfirmConfirm")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── inline SVG icons — kept here to avoid a dependency churn elsewhere ───
function IconDots() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
function IconUnmuted() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}
function IconMuted() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}
function IconVisible() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconHidden() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.43 10.43 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
