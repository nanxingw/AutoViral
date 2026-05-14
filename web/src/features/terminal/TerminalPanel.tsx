import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import { useTerminalSocket } from "./useTerminalSocket";
import styles from "./TerminalPanel.module.css";

interface Props {
  workId: string;
}

// Theme tuned for cool-steel editorial glass — NOT terminal-hacker green.
// Color tokens fall back to readable defaults if CSS vars not loaded yet.
const XTERM_THEME = {
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
};

// Literal font stack — NOT `var(--font-mono)`. Canvas2D resolves CSS variables
// inconsistently when xterm.js builds its WebGL glyph atlas before Google
// Fonts (display=swap) has delivered JetBrains Mono. The atlas caches the
// fallback glyph metrics and never refreshes when the real font arrives —
// the terminal renders with mismatched-metric / wrong-style glyphs even
// though CSS-level inspection shows the right family. Hard-code the stack
// here and await document.fonts.ready before constructing Terminal so the
// atlas is built with the final font on the first frame.
const TERMINAL_FONT_FAMILY = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export function TerminalPanel({ workId }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  const { send, resize } = useTerminalSocket(workId, handleData);

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ro: ResizeObserver | null = null;

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
      if (cancelled || !mountRef.current) return;
      term = new Terminal({
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        theme: XTERM_THEME,
        allowProposedApi: true,
        scrollback: 5000,
        smoothScrollDuration: 80,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new ClipboardAddon());
      try { term.loadAddon(new WebglAddon()); } catch {
        // WebGL not available — xterm.js falls back to the canvas/DOM renderer
      }
      term.open(mountRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      term.onData((d) => send(d));
      term.onResize(({ cols, rows }) => resize(cols, rows));

      ro = new ResizeObserver(() => {
        fit?.fit();
      });
      ro.observe(mountRef.current);
    });

    return () => {
      cancelled = true;
      ro?.disconnect();
      term?.dispose();
    };
  }, [send, resize]);

  const quickLaunch = (cmd: string) => () => {
    send(cmd + "\r");
  };

  return (
    <div className={styles.shell} data-area="terminal">
      <div className={styles.header}>
        <span className={styles.dotIndicator} aria-hidden />
        <span>TERMINAL · {workId}</span>
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
