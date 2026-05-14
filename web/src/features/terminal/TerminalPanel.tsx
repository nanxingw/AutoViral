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
    const term = new Terminal({
      fontFamily: "var(--font-mono), JetBrains Mono, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      theme: XTERM_THEME,
      allowProposedApi: true,
      scrollback: 5000,
      smoothScrollDuration: 80,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new ClipboardAddon());
    try { term.loadAddon(new WebglAddon()); } catch {
      // WebGL not available — fall back to canvas/DOM renderer (xterm default)
    }
    term.open(mountRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((d) => send(d));
    term.onResize(({ cols, rows }) => resize(cols, rows));

    const ro = new ResizeObserver(() => {
      fit.fit();
    });
    ro.observe(mountRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
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
