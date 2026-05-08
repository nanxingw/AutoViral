import { useEffect, useRef, useState, useCallback } from "react";
import { cancelRender } from "../services/render";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

export interface RenderLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface RenderJobView {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  stage?: "render" | "duck" | "loudnorm" | "burn" | "encode";
  log: RenderLogEntry[];
  outputPath?: string;
  error?: string;
}

interface RenderEvent {
  at?: string;
  status: RenderJobView["status"];
  progress: number;
  stage?: RenderJobView["stage"];
  log?: RenderLogEntry;
  outputPath?: string;
  error?: string;
}

/**
 * Phase 7.D — single-shot WebSocket subscription to /ws/render/jobs/:id.
 *
 * Per D5, the client closes the socket when status reaches a terminal value
 * (done | failed | cancelled). Per D10, this hook does NOT auto-reconnect —
 * a single render job has a finite lifetime; if the socket dies we surface
 * `connected = false` and let the caller decide.
 */
export function useRenderJob(jobId: string | null) {
  const [job, setJob] = useState<RenderJobView | null>(null);
  const [connected, setConnected] = useState(false);
  // R23: cancel was previously raw `fetch()` with no status check, no try/catch
  // — a 4xx/5xx silently returned, leaving the user thinking they cancelled
  // a runaway 5-min render. Now cancel uses cancelRender (apiFetch, throws
  // on non-2xx) and exposes a cancelError state so ExportProgress can show
  // the failure inline.
  const [cancelError, setCancelError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    setJob({ id: jobId, status: "queued", progress: 0, log: [] });

    const proto =
      typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
    const host = typeof location !== "undefined" && location.host ? location.host : "localhost";
    const ws = new WebSocket(`${proto}://${host}/ws/render/jobs/${jobId}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onmessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(typeof e.data === "string" ? e.data : String(e.data)) as RenderEvent;
        setJob((prev) => {
          const base: RenderJobView =
            prev ?? { id: jobId, status: "queued", progress: 0, log: [] };
          return {
            ...base,
            status: ev.status,
            progress: ev.progress,
            stage: ev.stage ?? base.stage,
            log: ev.log ? [...base.log, ev.log] : base.log,
            outputPath: ev.outputPath ?? base.outputPath,
            error: ev.error ?? base.error,
          };
        });
        if (TERMINAL.has(ev.status)) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    setCancelError(null);
    try {
      await cancelRender(jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCancelError(msg);
    }
  }, [jobId]);

  // Reset cancelError when jobId switches — old job's failure shouldn't bleed.
  useEffect(() => {
    setCancelError(null);
  }, [jobId]);

  return { job, connected, cancel, cancelError };
}
