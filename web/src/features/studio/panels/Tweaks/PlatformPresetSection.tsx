import { useMemo, useState, useEffect, useRef } from "react";
import { useComposition } from "../../store";
import { ReframeConfirmDialog, type ReframeClipSummary } from "./ReframeConfirmDialog";
import type { ExportPreset } from "../../types";

// Phase 6.D — frozen mirror of skills/autoviral/modules/assembly/references/
// platform-specs.md. Update both files in the same commit if a spec changes.
const PRESETS: ExportPreset[] = [
  {
    id: "douyin-9-16",
    label: "抖音 9:16",
    platform: "douyin",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.18,
    maxDurationSec: 60,
  },
  {
    id: "xhs-9-16",
    label: "小红书视频 9:16",
    platform: "xiaohongshu",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 6000,
    audioBitrate: 192,
    loudnessTargetLufs: -16,
    safeZonePct: 0.12,
    maxDurationSec: 60,
  },
  {
    id: "wechat-9-16",
    label: "视频号 9:16",
    platform: "weixin-channels",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.15,
    maxDurationSec: 60,
  },
  {
    id: "bilibili-16-9",
    label: "Bilibili 16:9",
    platform: "bilibili",
    width: 1920,
    height: 1080,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 6000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.0,
  },
  {
    id: "tiktok-9-16",
    label: "TikTok 9:16",
    platform: "tiktok",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.18,
    maxDurationSec: 60,
  },
  {
    id: "reels-9-16",
    label: "Reels 9:16",
    platform: "reels",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 10000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.15,
    maxDurationSec: 90,
  },
  {
    id: "shorts-9-16",
    label: "Shorts 9:16",
    platform: "shorts",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 10000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.15,
    maxDurationSec: 60,
  },
  {
    id: "yt-long-16-9",
    label: "YouTube long 16:9",
    platform: "youtube-long",
    width: 1920,
    height: 1080,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.05,
  },
];

interface Props {
  workId: string;
}

/**
 * Phase 6.D — platform preset dropdown + reframe confirmation flow.
 *
 *   user picks preset
 *     → opens ReframeConfirmDialog listing every video clip
 *     → on confirm: applyPlatformPreset (D5 atomic) + parallel reframe per clip
 *     → on cancel: nothing changes (D6)
 *
 * Concurrency: at most 2 in-flight /api/video/reframe requests (Phase 6
 * follow-up notes the server's CPU cap; cap them client-side too so the box
 * doesn't OOM). Phase 7 will move this orchestration into the render queue.
 */
export function PlatformPresetSection({ workId }: Props) {
  const comp = useComposition((s) => s.comp);
  const applyPlatformPreset = useComposition((s) => s.applyPlatformPreset);
  const rebindClip = useComposition((s) => s.rebindClip);
  const addAsset = useComposition((s) => s.addAsset);
  const addProvenance = useComposition((s) => s.addProvenance);

  const [candidate, setCandidate] = useState<ExportPreset | null>(null);
  const [busy, setBusy] = useState(false);
  // R37: alive flag for unmount-safe state updates after the long
  // parallel reframe loop. User can close Tweaks panel mid-reframe;
  // setBusy/setCandidate after that throws React warnings. Store
  // mutations (addAsset/addProvenance/rebindClip) are id-keyed so
  // they're naturally safe across work switches, but local component
  // state is not.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const videoClips: ReframeClipSummary[] = useMemo(() => {
    if (!comp) return [];
    const out: ReframeClipSummary[] = [];
    for (const t of comp.tracks) {
      if (t.kind !== "video") continue;
      for (const c of t.clips as Array<{
        id: string;
        kind: string;
        src?: string;
        label?: string;
      }>) {
        if (c.kind === "video" && typeof c.src === "string") {
          out.push({ id: c.id, src: c.src, label: c.label });
        }
      }
    }
    return out;
  }, [comp]);

  const onPick = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p) setCandidate(p);
  };

  const onConfirm = async () => {
    if (!candidate || !comp) return;
    setBusy(true);
    const fromAspect = comp.aspect;
    const toAspect = inferAspect(candidate);
    // D5 atomic: applyPlatformPreset flips exportPresets+aspect+w+h+fps in
    // one transaction before any reframe call goes out.
    applyPlatformPreset(candidate);
    await runWithConcurrency(2, videoClips, async (clip) => {
      try {
        const res = await fetch("/api/video/reframe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workId,
            videoId: findAssetIdByUri(comp, clip.src),
            fromAspect,
            toAspect,
            strategy: "auto",
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          asset: Parameters<typeof addAsset>[0];
          edge: Parameters<typeof addProvenance>[0];
        };
        addAsset(json.asset);
        addProvenance(json.edge);
        rebindClip(clip.id, json.asset.id);
      } catch {
        // Phase 6 keeps errors silent in the panel; Phase 7's render queue
        // will own progress + error surfacing for these jobs.
      }
    });
    if (!aliveRef.current) return;
    setBusy(false);
    setCandidate(null);
  };

  const onCancel = () => {
    setCandidate(null);
  };

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
        Platform
      </h4>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
        Platform preset
        <select
          aria-label="Platform preset"
          value=""
          onChange={(e) => onPick(e.target.value)}
          disabled={busy}
          style={{ display: "block", width: "100%", marginTop: 6 }}
        >
          <option value="" disabled>
            Choose a platform…
          </option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {comp?.exportPresets[0] && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dimmer)",
          }}
        >
          Current · {comp.exportPresets[0].label}
        </div>
      )}
      {busy && videoClips.length > 0 ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
          }}
        >
          Reframing {videoClips.length} clip{videoClips.length === 1 ? "" : "s"}…
        </div>
      ) : null}
      <ReframeConfirmDialog
        open={!!candidate}
        presetLabel={candidate?.label ?? ""}
        fromAspect={comp?.aspect ?? "9:16"}
        toAspect={candidate ? inferAspect(candidate) : "9:16"}
        clips={videoClips}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </section>
  );
}

function inferAspect(p: ExportPreset): "9:16" | "1:1" | "16:9" | "4:5" {
  const r = p.width / p.height;
  if (Math.abs(r - 9 / 16) < 0.01) return "9:16";
  if (Math.abs(r - 1) < 0.01) return "1:1";
  if (Math.abs(r - 16 / 9) < 0.01) return "16:9";
  return "4:5";
}

function findAssetIdByUri(
  comp: { assets: Array<{ id: string; uri: string }> },
  uri: string,
): string | null {
  return comp.assets.find((a) => a.uri === uri)?.id ?? null;
}

async function runWithConcurrency<T>(
  limit: number,
  items: T[],
  fn: (it: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next) await fn(next);
    }
  });
  await Promise.all(workers);
}
