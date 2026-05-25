import { useMemo, useState, useEffect, useRef } from "react";
import { useComposition } from "../../store";
import { ReframeConfirmDialog, type ReframeClipSummary } from "./ReframeConfirmDialog";
import type { ExportPreset } from "../../types";
import { useT } from "@/i18n/useT";

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
  const t = useT();
  const comp = useComposition((s) => s.comp);
  const applyPlatformPreset = useComposition((s) => s.applyPlatformPreset);
  const rebindClip = useComposition((s) => s.rebindClip);
  const addAsset = useComposition((s) => s.addAsset);
  const addProvenance = useComposition((s) => s.addProvenance);

  const [candidate, setCandidate] = useState<ExportPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    const fromAspect = comp.aspect;
    const toAspect = inferAspect(candidate);

    // #45 — transactional reframe. Previously applyPlatformPreset flipped
    // aspect/w/h/fps up front, then each reframe failure was silently
    // swallowed (`if (!res.ok) return` + empty catch). When the backend 500'd
    // (deleted smart-crop scripts), the canvas was left flipped + autosaved
    // while the clips kept the old aspect — a silently corrupted mixed-aspect
    // work. Now: reframe ALL clips first; only commit the preset + rebinds if
    // every clip succeeds. Any failure aborts with NOTHING changed.
    type ReframeOk = {
      clipId: string;
      asset: Parameters<typeof addAsset>[0];
      edge: Parameters<typeof addProvenance>[0];
    };
    const results: ReframeOk[] = [];
    let failure = false;

    await runWithConcurrency(2, videoClips, async (clip) => {
      if (failure) return; // short-circuit once any clip has failed
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
        if (!res.ok) {
          failure = true;
          return;
        }
        const json = (await res.json()) as {
          asset: Parameters<typeof addAsset>[0];
          edge: Parameters<typeof addProvenance>[0];
        };
        results.push({ clipId: clip.id, asset: json.asset, edge: json.edge });
      } catch {
        failure = true;
      }
    });

    if (!aliveRef.current) return;

    if (failure) {
      // Do NOT flip the aspect — leaving the canvas reframed while clips keep
      // the old aspect is the silent-corruption bug this fix exists to kill.
      setError(t("studio.platformPreset.reframeFailed"));
      setBusy(false);
      setCandidate(null);
      return;
    }

    // Every clip reframed — commit atomically: flip the canvas, then register
    // the new assets and rebind each clip to its reframed source.
    applyPlatformPreset(candidate);
    for (const r of results) {
      addAsset(r.asset);
      addProvenance(r.edge);
      rebindClip(r.clipId, r.asset.id);
    }
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
        {t("studio.platformPreset.heading")}
      </h4>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
        {t("studio.platformPreset.label")}
        <select
          aria-label={t("studio.platformPreset.ariaLabel")}
          value=""
          onChange={(e) => onPick(e.target.value)}
          disabled={busy}
          style={{ display: "block", width: "100%", marginTop: 6 }}
        >
          <option value="" disabled>
            {t("studio.platformPreset.chooseOption")}
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
          {t("studio.platformPreset.currentPrefix")} {comp.exportPresets[0].label}
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
          {videoClips.length === 1
            ? t("studio.platformPreset.reframingSingular")
            : t("studio.platformPreset.reframingPlural", { n: videoClips.length })}
        </div>
      ) : null}
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            lineHeight: 1.5,
            color: "var(--text-warn, #c44a4a)",
          }}
        >
          {error}
        </div>
      )}
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
