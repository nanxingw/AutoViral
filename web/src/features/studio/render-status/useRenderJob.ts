import { useEffect, useRef, useState, useCallback } from "react";

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
    await fetch(`/api/render/jobs/${jobId}`, { method: "DELETE" });
  }, [jobId]);

  return { job, connected, cancel };
}
