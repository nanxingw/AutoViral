import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import { useTerminalSocket } from "./useTerminalSocket";
import { DEFAULT_TERMINAL_SESSION_ID } from "./terminalSessions";
import { useTheme, type Theme } from "../../stores/theme";
import { useT } from "@/i18n/useT";
import styles from "./TerminalPanel.module.css";

interface Props {
  workId: string;
  /** ADR-008 §6 / I25 — which terminal session this panel drives. Carried into
   *  the WS path (`/ws/terminal/{workId}/{sessionId}`); distinct sessions get
   *  distinct ptys. Defaults to the first/legacy session so existing callers
   *  (single-terminal surfaces) keep working unchanged. */
  sessionId?: string;
}

// Two themes tuned for the editorial cool-steel palette. xterm.js does not
// react to CSS variable changes — we swap the whole theme object at runtime
// when `useTheme` toggles. Background stays transparent in both so the
// wrapper's `--surface-0` shows through (no double-paint of the page color).
const XTERM_THEME_DARK = {
  background: "rgba(0,0,0,0)",
  foreground: "#e6ebf0",
  cursor: "#a8c5d6",
  cursorAccent: "#0a0b0f",
  selectionBackground: "rgba(168,197,214,0.25)",
  black: "#0a0b0f",
  red: "#d4756c",
  green: "#6ec18f",
  yellow: "#d8c2a1",
  blue: "#a8c5d6",
  magenta: "#c6a8d6",
  cyan: "#a8d6c5",
  white: "#e6ebf0",
  brightBlack: "#3a3d44",
  brightRed: "#e89a91",
  brightGreen: "#9adfb4",
  brightYellow: "#ecdcc0",
  brightBlue: "#c7dde9",
  brightMagenta: "#d6c0e1",
  brightCyan: "#c0e1d6",
  brightWhite: "#fafaf7",
} as const;

// Light theme: deep-ink foreground + saturated ANSI palette tuned so every
// hue clears WCAG AA contrast against paper-white (#fafaf7). The dark theme's
// pastel ANSI palette (designed for a dark canvas) washed out unreadably here
// — bright blue/cyan especially. Verified luminance ratios ≥ 4.5:1 on bg.
const XTERM_THEME_LIGHT = {
  background: "rgba(0,0,0,0)",
  foreground: "#1a1d24",
  cursor: "#2a3a4a",
  cursorAccent: "#fafaf7",
  selectionBackground: "rgba(42,58,74,0.22)",
  black: "#1a1d24",
  red: "#a8453c",
  green: "#2f7048",
  yellow: "#7a5a1c",
  blue: "#2e5d7a",
  magenta: "#6a4180",
  cyan: "#256b62",
  white: "#5a5f68",
  brightBlack: "#7a7e87",
  brightRed: "#c46258",
  brightGreen: "#3f8a5a",
  brightYellow: "#9a7634",
  brightBlue: "#4683a6",
  brightMagenta: "#8e6aa6",
  brightCyan: "#388578",
  brightWhite: "#3a3d44",
} as const;

const pickXtermTheme = (mode: Theme) =>
  mode === "light" ? XTERM_THEME_LIGHT : XTERM_THEME_DARK;

// Literal font stack — NOT `var(--font-mono)`. Canvas2D resolves CSS variables
// inconsistently when xterm.js builds its WebGL glyph atlas before Google
// Fonts (display=swap) has delivered JetBrains Mono. The atlas caches the
// fallback glyph metrics and never refreshes when the real font arrives —
// the terminal renders with mismatched-metric / wrong-style glyphs even
// though CSS-level inspection shows the right family. Hard-code the stack
// here and await document.fonts.ready before constructing Terminal so the
// atlas is built with the final font on the first frame.
const TERMINAL_FONT_FAMILY = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export function TerminalPanel({ workId, sessionId = DEFAULT_TERMINAL_SESSION_ID }: Props) {
  const t = useT();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const theme = useTheme((s) => s.theme);
  // Ref mirror so the construction effect (which doesn't re-run on theme
  // change — we don't want to rebuild Terminal and kill the pty) reads the
  // latest value if the user toggled while the font-load promise was in flight.
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  const { send, resize, status, reconnect, respawn } = useTerminalSocket(
    workId,
    handleData,
    sessionId,
  );

  // Hot-swap palette when theme changes. xterm.js v5 supports runtime
  // `options.theme = ...` reassignment — it re-paints existing rows.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = pickXtermTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!mountRef.current || termRef.current) return;
    let cancelled = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ro: ResizeObserver | null = null;
    let fitFrame: number | null = null;
    let lastFitWidth = 0;
    let lastFitHeight = 0;
    let zeroSizeFitRetries = 0;

    const scheduleFit = () => {
      if (fitFrame !== null) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        const mount = mountRef.current;
        if (cancelled || !mount || !fit) return;

        const rect = mount.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const physicalWidth = Math.round(rect.width * dpr);
        const physicalHeight = Math.round(rect.height * dpr);

        if (physicalWidth <= 0 || physicalHeight <= 0) {
          if (zeroSizeFitRetries < 4) {
            zeroSizeFitRetries += 1;
            scheduleFit();
          }
          return;
        }

        zeroSizeFitRetries = 0;
        if (physicalWidth === lastFitWidth && physicalHeight === lastFitHeight) return;

        lastFitWidth = physicalWidth;
        lastFitHeight = physicalHeight;
        fit.fit();
      });
    };

    // Hint the browser to prioritize loading JetBrains Mono at the size we'll
    // render. Then wait for ALL fonts to settle before creating the Terminal
    // so the WebGL glyph atlas is built with the right typeface.
    const ensureFont = async () => {
      try {
        if (document.fonts && "load" in document.fonts) {
          await document.fonts.load('500 13px "JetBrains Mono"');
        }
        if (document.fonts && "ready" in document.fonts) {
          await document.fonts.ready;
        }
      } catch {
        // Non-fatal — proceed with the OS fallback rather than block forever
      }
    };

    ensureFont().then(() => {
      if (cancelled || !mountRef.current || termRef.current) return;
      term = new Terminal({
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        theme: pickXtermTheme(themeRef.current),
        allowProposedApi: true,
        scrollback: 5000,
        smoothScrollDuration: 80,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new ClipboardAddon());
      // NOTE: WebglAddon removed. On macOS retina (DPR=2) the WebGL glyph
      // atlas is built at logical resolution and upsampled with bilinear
      // filtering when displayed, producing visible ghost halos around
      // each character — the "重影" the user reported after the font fix
      // landed. xterm.js's default canvas renderer is DPR-aware out of
      // the box, and at our usage (chat-like terminal, low refresh rate)
      // its perf is more than enough. If we ever need WebGL again,
      // re-enable behind a feature flag with `preserveDrawingBuffer:
      // false` and an explicit dpr override.
      term.open(mountRef.current);
      termRef.current = term;
      fitRef.current = fit;

      term.onData((d) => send(d));
      term.onResize(({ cols, rows }) => resize(cols, rows));

      ro = new ResizeObserver(scheduleFit);
      ro.observe(mountRef.current);
      scheduleFit();
    });

    return () => {
      cancelled = true;
      if (fitFrame !== null) {
        cancelAnimationFrame(fitFrame);
        fitFrame = null;
      }
      ro?.disconnect();
      term?.dispose();
      if (termRef.current === term) termRef.current = null;
      if (fitRef.current === fit) fitRef.current = null;
    };
  }, [send, resize]);

  const quickLaunch = (cmd: string) => () => {
    send(cmd + "\r");
  };

  const dotClass =
    status === "open"
      ? styles.dotIndicator
      : `${styles.dotIndicator} ${styles.dotIndicatorDisconnected}`;

  return (
    <div className={styles.shell} data-area="terminal" data-status={status}>
      <div className={styles.header}>
        <span className={dotClass} aria-hidden />
        <span>
          {`TERMINAL · ${workId}${
            sessionId !== DEFAULT_TERMINAL_SESSION_ID ? ` · ${sessionId}` : ""
          }`}
        </span>
        {status === "reconnecting" && (
          <span
            className={styles.statusBadge}
            data-status="reconnecting"
            aria-live="polite"
          >
            reconnecting…
          </span>
        )}
        {status === "gave-up" && (
          <button
            type="button"
            className={styles.reconnectBtn}
            onClick={() => reconnect()}
            data-testid="terminal-reconnect"
          >
            reconnect
          </button>
        )}
        {status === "exited" && (
          <button
            type="button"
            className={styles.reconnectBtn}
            onClick={() => respawn()}
            data-testid="terminal-respawn"
            aria-label={t("studio.rightPane.terminalSessions.respawnAria")}
          >
            {t("studio.rightPane.terminalSessions.respawn")}
          </button>
        )}
        <div className={styles.quickLaunch}>
          <button type="button" className={styles.quickLaunchBtn} onClick={quickLaunch("claude")}>
            claude
          </button>
          <button type="button" className={styles.quickLaunchBtn} onClick={quickLaunch("codex")}>
            codex
          </button>
          <button type="button" className={styles.quickLaunchBtn} onClick={quickLaunch("kimi")}>
            kimi
          </button>
        </div>
      </div>
      <div ref={mountRef} className={styles.terminalMount} />
    </div>
  );
}
