import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PlatformTabs } from "@/features/explore/PlatformTabs";
import { AnglesCard } from "@/features/explore/AnglesCard";
import { TrendingPanel } from "@/features/explore/TrendingPanel";
import { usePlatformTrends, type Platform, type TrendItem, SUPPORTED_REFRESH_PLATFORMS } from "@/queries/trends";
import { useAngleBriefs, type AngleBrief } from "@/queries/angleBriefs";
import { useCreateWork } from "@/queries/works";
import { localizeApiError } from "@/i18n/serverError";
import { apiFetch } from "@/lib/api";
import { useT } from "@/i18n/useT";
import { ChatPanel } from "@/features/studio/panels/Chat";
import { CoachModelSwitcher } from "@/features/explore/CoachModelSwitcher";
import {
  COACH_SESSION_KEY,
  COACH_PROMPT_LIBRARY,
  sendCoachMessage,
  COACH_DEFAULT_PLATFORM,
  buildCoachIdeaTopicHint,
  type CoachIdea,
} from "@/features/explore/coachSession";
import { useChatStore } from "@/features/chat/store";

// #65 — compose a creative brief (topicHint) from a trend so the agent's
// research/output is seeded by the trend's title + AI-computed hook, not just
// a bare title. Trims empty analysis fields so the brief stays clean.
export function buildTrendTopicHint(item: TrendItem): string {
  const parts = [
    item.title,
    item.analysis?.category,
    item.analysis?.exampleHook,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.join("\n");
}

export default function Explore() {
  // e2e-report F134: default to 小红书 (a SUPPORTED_REFRESH_PLATFORMS member)
  // so first-load shows real collected trend data instead of empty state.
  // YouTube/TikTok don't have a server-side collector yet (see F132); landing
  // on either of them gives users a "no data — click 立即采集" misdirection
  // because the refresh endpoint hardcodes ["xiaohongshu","douyin"] anyway.
  // Pick xiaohongshu over douyin: its YAML schema has views/likes/comments
  // (douyin is heat-based topics, less visually grounded for first paint).
  const [platform, setPlatform] = useState<Platform>("xiaohongshu");
  const trends = usePlatformTrends(platform);
  const qc = useQueryClient();
  const t = useT();
  const navigate = useNavigate();
  // #65 — turn a trend into a new work seeded with topicHint, then open it.
  // Trends are video hooks → always seed a video work. Guard re-entry on the
  // pending flag. (The chosen type literal below is a deliberate domain
  // default, not type dispatch — a trend never produces a carousel work.)
  const createWork = useCreateWork();
  async function useTrend(item: TrendItem) {
    if (createWork.isPending) return;
    try {
      const w = await createWork.mutateAsync({
        title: item.title,
        type: "short-video",
        topicHint: buildTrendTopicHint(item),
      });
      navigate(`/studio/${w.id}`);
    } catch {
      // surfaced inline via createWork.isError below
    }
  }
  // S8 — the chat-output sibling of useTrend: turn a coach-suggested idea into a
  // new work seeded with topicHint (reuse the #65 plumbing), then open it. The
  // originating surface is the coach's chat output, not a trend row. Same domain
  // default ("short-video") — coach ideas are video angles, not carousels.
  async function useCoachIdea(idea: CoachIdea) {
    if (createWork.isPending) return;
    try {
      const w = await createWork.mutateAsync({
        title: idea.title,
        type: "short-video",
        topicHint: buildCoachIdeaTopicHint(idea),
      });
      navigate(`/studio/${w.id}`);
    } catch {
      // surfaced inline via createWork.isError below
    }
  }
  // PRD-0006 S9 — the honest replacement for the old hard-coded 3-sample 起手切角
  // card. Real grounded briefs (works + selected-platform trends + interests)
  // shaped server-side by the pure deterministic shaper (instant, no LLM, no
  // fabrication). Keyed on the same `platform` the trending panel reads.
  const angleBriefs = useAngleBriefs(platform);
  // S9 — turn a brief into a new work, reusing the S8 coach-idea plumbing
  // (#65 topicHint). A brief carries the same {title, hook, why} shape a coach
  // idea does, so the topicHint is built the same way.
  function createFromBrief(brief: AngleBrief) {
    void useCoachIdea({ title: brief.title, hook: brief.hook, why: brief.why });
  }
  const [collecting, setCollecting] = useState(false);
  // e2e-report F87: collectStatus splits the old single `collectMsg` into a
  // tagged union so the queued case can render as two-channel UI (done badge
  // + scheduled hint) instead of cramming three semantics ("done + pending +
  // 30s schedule") into one sentence.
  const [collectStatus, setCollectStatus] = useState<"idle" | "queued" | "failed">("idle");
  const [collectError, setCollectError] = useState<string | null>(null);

  const collectTrends = async () => {
    setCollecting(true);
    setCollectStatus("idle");
    setCollectError(null);
    try {
      // The /api/trends/refresh endpoint runs sync research on the supported
      // platforms and returns when the new yaml lands; we then nudge react-query.
      // #82 — only request the platforms that actually have a collector
      // (the server ignored youtube/tiktok anyway). Single source of truth.
      const result = await apiFetch<{ collected: string[]; errors: string[] }>(`/api/trends/refresh`, {
        method: "POST",
        body: { platforms: [...SUPPORTED_REFRESH_PLATFORMS] },
      });
      if (result.collected.length > 0 && result.errors.length === 0) {
        setCollectStatus("queued"); // full success
        setCollectError(null);
      } else if (result.collected.length > 0) {
        setCollectStatus("queued"); // partial — show error detail alongside ✓
        setCollectError(`${result.collected.length} ok, ${result.errors.length} failed: ${result.errors.join("; ")}`);
      } else {
        setCollectStatus("failed");
        setCollectError(result.errors.join("; ") || "all platforms failed");
      }
      qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (e) {
      setCollectStatus("failed");
      setCollectError(e instanceof Error ? e.message : String(e));
    } finally {
      setCollecting(false);
    }
  };

  // PRD-0006 S7 — mount the WORKLESS grounded coach on this page. The coach is
  // not a work: ChatPanel runs in coach mode (CoachConfig), keyed on the stable
  // COACH_SESSION_KEY so its WS path is /ws/browser/coach_main (streaming +
  // persisted-history reseed survives reload), but SEND is decoupled to POST
  // /api/coach/message — that first turn spins up the grounded research session
  // (reads the user's works + selected-platform trends + interests). The empty
  // box is seeded with the prompt library (grounded starter questions) so the
  // user never faces a blank prompt.
  const coachStreaming = useChatStore((s) => s.streaming);
  const coachConfig = {
    send: (wireText: string) => {
      void sendCoachMessage(wireText, COACH_DEFAULT_PLATFORM);
    },
    modelSwitcher: <CoachModelSwitcher streaming={coachStreaming} />,
    title: t("explore.coach.title"),
    subtitle: t("explore.coach.subtitle"),
    onboarding: {
      title: t("explore.coach.onboardingTitle"),
      sub: t("explore.coach.onboardingSub"),
      placeholder: t("explore.coach.placeholder"),
      prompts: COACH_PROMPT_LIBRARY.map((p) => ({
        label: t(p.labelKey),
        prompt: t(p.promptKey),
      })),
    },
    // S8 — a coach-suggested idea (a `<coach-idea/>` tag) renders a "用此创作"
    // action; clicking it lands here to create + open the new work.
    onCreateFromIdea: (idea: CoachIdea) => {
      void useCoachIdea(idea);
    },
  };

  return (
    <main className="page">
      <section style={{ padding: "48px 0 32px" }}>
        <span className="eyebrow">{t("explore.heroEyebrow")}</span>
        <h1 className="h-display" style={{ fontSize: 52, lineHeight: 1.05, margin: "12px 0 14px", maxWidth: 880, fontWeight: 500 }}>
          {t("explore.heroLine1")}
          <br />
          {t("explore.heroLine2")}
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span>
            {t("explore.aggregatedFrom")} <strong style={{ color: "var(--text)" }}>YouTube</strong>, <strong style={{ color: "var(--text)" }}>TikTok</strong>, 小红书, 抖音.
          </span>
          <button
            type="button"
            onClick={collectTrends}
            disabled={collecting}
            aria-busy={collecting}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              borderRadius: 7,
              border: "1px solid var(--accent)",
              background: collecting ? "var(--surface-2)" : "var(--accent)",
              color: collecting ? "var(--text-dim)" : "var(--accent-fg)",
              cursor: collecting ? "wait" : "pointer",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
            }}
          >
            {collecting ? t("explore.collectInProgress") : `↻ ${t("explore.collectTrends")}`}
          </button>
          {collectStatus === "queued" && (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, flexWrap: "wrap" }}>
              <strong style={{ color: "var(--status-done)", fontWeight: 600 }}>
                ✓ {t("explore.collectQueuedDone")}
              </strong>
              <span style={{ color: "var(--text-dimmer)" }}>
                {t("explore.collectQueuedHint")}
              </span>
              {collectError && (
                <span style={{ color: "var(--status-warn, var(--text-dim))", fontWeight: 400 }}>
                  · {collectError}
                </span>
              )}
            </span>
          )}
          {collectStatus === "failed" && collectError && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--status-error)" }}>
              {t("explore.collectFailed", { reason: collectError })}
            </span>
          )}
        </div>
      </section>

      {/* PRD-0006 S7 — the grounded inspiration coach, mounted as the page's
          hero conversation surface. ChatPanel runs in workless coach mode
          (coachConfig); the glass shell gives the height:100% panel a frame. */}
      <section
        aria-label={t("explore.coach.title")}
        style={{
          height: 560,
          marginBottom: 28,
          borderRadius: "var(--radius-lg, 16px)",
          border: "1px solid var(--glass-border)",
          background: "var(--surface-1)",
          backdropFilter: "blur(24px) saturate(140%)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
          overflow: "hidden",
        }}
      >
        <ChatPanel workId={COACH_SESSION_KEY} coach={coachConfig} />
      </section>

      <AnglesCard
        briefs={angleBriefs.data ?? []}
        loading={angleBriefs.isLoading}
        busy={createWork.isPending}
        onCreate={createFromBrief}
      />

      <PlatformTabs value={platform} onChange={setPlatform} />

      {trends.isLoading ? (
        <div style={{ color: "var(--text-dim)" }}>{t("explore.loadingTrends")}</div>
      ) : trends.data ? (
        <>
          {createWork.isError && (
            <div role="alert" style={{ color: "var(--status-error, #d4756c)", fontSize: 12, marginBottom: 8, fontFamily: "var(--font-mono)" }}>
              {localizeApiError(createWork.error, t)}
            </div>
          )}
          <TrendingPanel
            platform={platform}
            items={trends.data.items}
            onUse={useTrend}
            busy={createWork.isPending}
            stale={trends.data.stale}
            ageDays={trends.data.ageDays}
            collectedAt={trends.data.collectedAt}
          />
        </>
      ) : (
        <div style={{ color: "var(--text-dim)" }}>{t("explore.noTrendsData")}</div>
      )}
    </main>
  );
}
