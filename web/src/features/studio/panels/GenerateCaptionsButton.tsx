// S14 (US 20/21) — "生成字幕" button. The last mile for ASR captions: the
// /api/audio/captions endpoint has transcribed audio for ages but nothing wired
// its output back into the composition. This button POSTs to the bridge
// `/captions/generate`, which runs the SAME stable-ts core the agent's
// `autoviral captions generate` CLI uses and writes each timecoded segment as a
// text clip into the text track. The bridge broadcasts `composition-changed`
// after the atomic write lands, so the Studio refetches the composition (and the
// new caption clips appear) WITHOUT a manual reload — see useBridgeEvents.
//
// Self-contained + testable: it owns its own request + busy/error state and a
// useRef reentrancy lock (a double-click fires two onClicks in the same tick;
// the ref flips synchronously, the useState flag is UI feedback only — see
// memory "useRef is the real race lock, useState is UI feedback only").

import { useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useT } from "@/i18n/useT";
import styles from "./GenerateCaptionsButton.module.css";

export interface GenerateCaptionsButtonProps {
  workId: string;
  /** Optional ISO-639 language hint forwarded to ASR (omit = auto-detect). */
  language?: string;
}

interface CaptionsGenerateResponse {
  ok: boolean;
  result?: { written: number; language: string | null };
  error?: string;
}

export function GenerateCaptionsButton({
  workId,
  language,
}: GenerateCaptionsButtonProps) {
  const t = useT();
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<
    { kind: "ok"; count: number } | { kind: "err"; msg: string } | null
  >(null);

  async function generate() {
    // Reentrancy lock — block a second click before the first request settles.
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setStatus(null);
    try {
      const res = await apiFetch<CaptionsGenerateResponse>(
        "/api/bridge/v1/captions/generate",
        {
          method: "POST",
          headers: { "X-AutoViral-Work-Id": workId },
          body: language ? { language } : {},
        },
      );
      setStatus({ kind: "ok", count: res.result?.written ?? 0 });
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
      setStatus({ kind: "err", msg });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.button}
        onClick={() => void generate()}
        disabled={running}
        aria-label={t("studio.captionsGenerate.aria")}
        data-testid="generate-captions"
      >
        {running
          ? t("studio.captionsGenerate.running")
          : t("studio.captionsGenerate.button")}
      </button>
      {status?.kind === "ok" ? (
        <span className={styles.ok} role="status">
          {t("studio.captionsGenerate.success", { count: status.count })}
        </span>
      ) : null}
      {status?.kind === "err" ? (
        <span className={styles.err} role="alert">
          {t("studio.captionsGenerate.failed", { msg: status.msg })}
        </span>
      ) : null}
    </div>
  );
}
