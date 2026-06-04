/**
 * Studio right pane — agent surface container.
 *
 * Hosts two sibling surfaces per ADR-005:
 *   • Chat       — `claude -p` subprocess, markdown UI, pneuma-style envelope
 *   • Terminal   — xterm.js + arbitrary CLI agent
 *
 * Both stay mounted across switches (display:none on the inactive one) so
 * long chat conversations and terminal pty buffers survive without remount.
 *
 * Hotkey: ⌘\ (Ctrl+\ on non-mac) toggles. First use of the hotkey announces
 * a toast so the binding is discoverable.
 *
 * Persistence: per-work localStorage with global fallback — see
 * `useActiveSurface.ts`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChatPanel } from "@/features/studio/panels/Chat";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { useToastStore } from "@/stores/toast";
import {
  useFocusStore,
  buildViewerContext,
  buildTerminalPrefix,
} from "@/stores/focus";
import type { LocatorData } from "@/features/chat/types";
import { useActiveSurface, type Surface } from "./useActiveSurface";
import { SessionStrip } from "./SessionStrip";
import { TerminalSessionStrip } from "./TerminalSessionStrip";
import {
  useTerminalSessionIds,
  useActiveTerminalSessionId,
} from "@/features/terminal/terminalSessions";
import { useT } from "@/i18n/useT";
import styles from "./index.module.css";

export interface RightPaneProps {
  workId: string;
  /** Viewer-context envelope builder prepended to each outgoing chat
   *  message. Defaults to Studio's clip-based buildViewerContext; the
   *  carousel editor passes buildEditorViewerContext so the agent sees the
   *  current slide / layer instead of a (nonexistent) video clip. */
  getViewerContext?: () => string | null;
  /** Agent-locator jump handler for `<viewer-locator/>` clicks. When
   *  omitted, ChatPanel falls back to the Studio playhead/selection jump,
   *  which mutates the VIDEO composition store — so any non-video editor
   *  MUST pass its own handler or a locator click corrupts the wrong store. */
  onJumpToLocator?: (data: LocatorData) => void;
  /** Opt-in chat shortcut buttons (rendered between messages + composer).
   *  Fill-then-review only — the instant-send Studio chips were removed. */
  quickActions?: ReactNode;
  /** Render the Studio clip-focus terminal prefix line (`[ctx: clip=…]`).
   *  The carousel surface has no clip focus, so it passes false. */
  showTerminalPrefix?: boolean;
}

const HOTKEY_TOAST_SEEN_KEY = "autoviral.rightPane.hotkeyToastSeen";

function hasSeenHotkeyToast(): boolean {
  try {
    return localStorage.getItem(HOTKEY_TOAST_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markHotkeyToastSeen(): void {
  try {
    localStorage.setItem(HOTKEY_TOAST_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

const HOTKEY_HINT =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform ?? "")
    ? "⌘\\"
    : "Ctrl+\\";

export function RightPane({
  workId,
  getViewerContext = buildViewerContext,
  onJumpToLocator,
  quickActions,
  showTerminalPrefix = true,
}: RightPaneProps) {
  const t = useT();
  const { active, setActive, toggle } = useActiveSurface(workId);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  // Global keyboard shortcut: ⌘\ / Ctrl+\
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // We want bracketLeft/Right? No — backslash. KeyCode "Backslash" or
      // "IntlBackslash" depending on layout. Use e.key for the actual char.
      if (e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleRef.current();

        // First-time discoverability toast — announces the binding so users
        // know it exists. Only on the FIRST manual toggle.
        if (!hasSeenHotkeyToast()) {
          markHotkeyToastSeen();
          useToastStore.getState().push({
            variant: "info",
            message: `Switched panes — press ${HOTKEY_HINT} to toggle Chat / Terminal anytime.`,
            ttlMs: 4500,
          });
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={styles.root} data-area="agent-surface" data-active={active}>
      <div className={styles.tabs} role="tablist" aria-label="Agent surface">
        <TabButton
          surface="chat"
          active={active}
          onSelect={setActive}
          label={t("studio.rightPane.tabChat")}
          icon="✦"
        />
        <TabButton
          surface="terminal"
          active={active}
          onSelect={setActive}
          label={t("studio.rightPane.tabTerminal")}
          icon="⌨"
        />
        <span className={styles.tabHint} aria-hidden>
          {HOTKEY_HINT}
        </span>
      </div>

      <div className={styles.surface}>
        {/* Both surfaces mount once and stay mounted; we hide the inactive
            one via display:none so state (scroll position, pty buffer,
            xterm canvas, chat stream) survives the switch. */}
        <div
          data-surface="chat"
          className={`${styles.surfaceContent} ${active === "chat" ? "" : styles.hidden}`}
          role="tabpanel"
          aria-hidden={active !== "chat"}
        >
          {/* Multi-session sub-strip (ADR-008 §5 / I24) — new/switch/jump-back
              between chat sessions. ChatPanel itself stays single-component;
              the active session lives in the activeSession store that
              useChatSocket reads, so a switch reconnects the WS + reseeds
              history without remounting ChatPanel. */}
          <SessionStrip workId={workId} />
          {/* ChatPanel's root is height:100%; the SessionStrip above it is a
              fixed-height sibling, so we give ChatPanel a flex-fill wrapper
              (flex:1 / min-height:0) to claim the remaining space without
              overflowing the surface. */}
          <div style={{ flex: 1, minHeight: 0 }}>
            {/* The viewer-context envelope (pneuma-style) is automatically
                prepended to every outgoing user message. ChatPanel calls
                getViewerContext() right before sending. */}
            <ChatPanel
              workId={workId}
              getViewerContext={getViewerContext}
              onJumpToLocator={onJumpToLocator}
              quickActions={quickActions}
            />
          </div>
        </div>
        <div
          data-surface="terminal"
          className={`${styles.surfaceContent} ${active === "terminal" ? "" : styles.hidden}`}
          role="tabpanel"
          aria-hidden={active !== "terminal"}
        >
          {showTerminalPrefix && <TerminalFocusPrefix />}
          {/* Multi-terminal sub-strip (ADR-008 §6 / I25) — new/switch/jump-back
              between terminal sessions. Each session keeps its own mounted
              TerminalPanel; switching just display:none's the others, so the
              hidden ptys + xterm canvases survive (the server keeps every
              session's pty alive across ws teardown). */}
          <TerminalSessionStrip workId={workId} />
          <div className={styles.terminalInner}>
            <TerminalSurface workId={workId} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the dim `[ctx: clip=X]` prefix line above the terminal canvas
 * when focus is set. The actual content updates reactively as the user
 * changes selection. Hidden entirely when focus is empty so the prefix
 * row doesn't steal pixels from xterm when there's nothing to show.
 */
const TERMINAL_INJECT_KEY = "autoviral.terminal.injectEnabled";
function readInjectEnabled(): boolean {
  try {
    return localStorage.getItem(TERMINAL_INJECT_KEY) !== "off";
  } catch {
    return true;
  }
}

function TerminalFocusPrefix() {
  // Subscribe to focus changes — every selection write re-renders this.
  // The value itself is unused here; the subscription is the point (void to
  // keep `noUnusedLocals` happy without dropping the re-render trigger).
  void useFocusStore((s) => s.focus);
  // H0.3 — inject toggle. CLI `autoviral context --inject off` flips this
  // via the ui-context-inject WS event (subscriber lives elsewhere); the
  // local read is from localStorage for cross-reload persistence.
  const [enabled, setEnabled] = useState<boolean>(() => readInjectEnabled());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TERMINAL_INJECT_KEY) setEnabled(readInjectEnabled());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  if (!enabled) return null;
  const prefix = buildTerminalPrefix();
  if (!prefix) return null;
  return (
    <div
      className={styles.terminalCtxPrefix}
      data-testid="terminal-ctx-prefix"
      aria-label="Agent context (current focus)"
    >
      {prefix}
    </div>
  );
}

/**
 * Renders one mounted TerminalPanel per terminal session (ADR-008 §6 / I25).
 *
 * Every session's panel stays mounted; only the active one is visible (the
 * rest are display:none'd via the surface `hidden` class). Keeping the inactive
 * panels mounted preserves their xterm canvas + the live socket, and the server
 * keeps the pty alive across the ws teardown a switch causes — so jumping back
 * to a terminal restores its scrollback (the backend replays its ring-buffer on
 * re-attach). "New terminal" appends a session id to the store, which mounts a
 * NEW panel here (new socket → new pty under the new sessionId) without
 * touching the existing ones.
 */
function TerminalSurface({ workId }: { workId: string }) {
  const ids = useTerminalSessionIds(workId);
  const activeId = useActiveTerminalSessionId(workId);
  return (
    <>
      {ids.map((id) => (
        <div
          key={id}
          className={`${styles.terminalPane} ${id === activeId ? "" : styles.hidden}`}
          data-terminal-session={id}
          data-active={id === activeId}
          aria-hidden={id !== activeId}
        >
          <TerminalPanel workId={workId} sessionId={id} />
        </div>
      ))}
    </>
  );
}

interface TabButtonProps {
  surface: Surface;
  active: Surface;
  onSelect: (s: Surface) => void;
  label: string;
  icon: string;
}

function TabButton({ surface, active, onSelect, label, icon }: TabButtonProps) {
  const isActive = active === surface;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-surface={surface}
      className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
      onClick={() => onSelect(surface)}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
