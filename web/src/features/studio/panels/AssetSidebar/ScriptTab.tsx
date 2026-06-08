import { useMemo } from "react";
import { useComposition } from "../../store";
import type { Scene } from "@shared/composition";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n/useT";

// ─────────────────────────────────────────────────────────────────────────────
// ScriptTab (S3 · PRD-0007) — READ-ONLY view of the work's storyboard skeleton.
//
// This is the planning layer made visible: comp.scenes (the 分镜 / shots an
// agent drafted via `autoviral scene add`, or a human will edit in S4) rendered
// as a card list so the creator sees the whole film's bones at a glance.
//
// SCOPE: this slice is read-only. No create / edit / reorder here — that is S4,
// which will add per-card editing actions, and S5, which will mount a `plan/
// script.md` editor ABOVE this card list (this tab will then be 剧本 md editor
// + 分镜 card list stacked). For now the tab contains only the card region.
// ─────────────────────────────────────────────────────────────────────────────

// Code-facing enum key → i18n message key. Kept in lockstep with SceneSchema's
// enum literals (the cross-slice contract). The UI localises; the data stays in
// stable code-facing keys.
const INTENT_KEY: Record<NonNullable<Scene["intent"]>, MessageKey> = {
  hook: "studio.scriptPanel.intentHook",
  build: "studio.scriptPanel.intentBuild",
  payoff: "studio.scriptPanel.intentPayoff",
  cta: "studio.scriptPanel.intentCta",
};

const STATUS_KEY: Record<Scene["status"], MessageKey> = {
  planned: "studio.scriptPanel.statusPlanned",
  generated: "studio.scriptPanel.statusGenerated",
  stale: "studio.scriptPanel.statusStale",
};

const SHOT_KEY: Record<NonNullable<Scene["shotSize"]>, MessageKey> = {
  long: "studio.scriptPanel.shotLong",
  full: "studio.scriptPanel.shotFull",
  medium: "studio.scriptPanel.shotMedium",
  close: "studio.scriptPanel.shotClose",
  closeup: "studio.scriptPanel.shotCloseup",
};

const CAMERA_KEY: Record<NonNullable<Scene["cameraMovement"]>, MessageKey> = {
  push: "studio.scriptPanel.cameraPush",
  pull: "studio.scriptPanel.cameraPull",
  pan: "studio.scriptPanel.cameraPan",
  track: "studio.scriptPanel.cameraTrack",
  follow: "studio.scriptPanel.cameraFollow",
  static: "studio.scriptPanel.cameraStatic",
};

export function ScriptTab() {
  const scenes = useComposition((s) => s.comp?.scenes);
  // Read-path only: sort a copy by `order` (the intended shot sequence). The
  // store array is never mutated here.
  const ordered = useMemo(
    () => (scenes ? [...scenes].sort((a, b) => a.order - b.order) : []),
    [scenes],
  );
  const hasScenes = ordered.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header — mirrors LibraryTab's editorial heading. */}
      <div
        style={{
          padding: "14px 14px 10px",
          borderBottom: "1px solid var(--divider)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 18,
            fontStyle: "italic",
            letterSpacing: "-0.015em",
            color: "var(--text)",
          }}
        >
          <ScriptHeading />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {hasScenes ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ordered.map((scene) => (
              <SceneCard key={scene.id} scene={scene} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function ScriptHeading() {
  const t = useT();
  return <>{t("studio.scriptPanel.heading")}</>;
}

function EmptyState() {
  const t = useT();
  return (
    <div
      style={{
        padding: "28px 18px",
        textAlign: "center",
        color: "var(--text-dimmer)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-editorial)",
          fontStyle: "italic",
          fontSize: 16,
          color: "var(--text-dim)",
          marginBottom: 8,
        }}
      >
        {t("studio.scriptPanel.emptyTitle")}
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          letterSpacing: "0.01em",
        }}
      >
        {t("studio.scriptPanel.emptyHint")}
      </div>
    </div>
  );
}

const STATUS_FILLED: Record<Scene["status"], boolean> = {
  planned: false, // hollow — not yet generated
  generated: true, // filled — generated
  stale: true, // filled but tinted — needs regen
};

function SceneCard({ scene }: { scene: Scene }) {
  const t = useT();
  const statusLabel = t(STATUS_KEY[scene.status]);
  const statusColor =
    scene.status === "stale" ? "var(--status-error, #d4756c)" : "var(--accent)";

  return (
    <div
      data-testid="scene-card"
      data-scene-id={scene.id}
      style={{
        border: "1px solid var(--glass-border)",
        borderRadius: 10,
        background: "var(--surface-0)",
        padding: "10px 12px",
      }}
    >
      {/* Top row: 镜号 + status dot + intent badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--text-dimmer)",
            whiteSpace: "nowrap",
          }}
        >
          {t("studio.scriptPanel.shotNumber", { n: scene.order + 1 })}
        </span>
        <span
          data-status={scene.status}
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            background: STATUS_FILLED[scene.status] ? statusColor : "transparent",
            border: `1.5px solid ${statusColor}`,
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {scene.title}
        </span>
        {scene.intent && (
          <span
            data-intent={scene.intent}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: 999,
              border: "1px solid var(--accent)",
              color: "var(--accent-hi)",
              background: "var(--accent-glow)",
              whiteSpace: "nowrap",
            }}
          >
            {t(INTENT_KEY[scene.intent])}
          </span>
        )}
      </div>

      {/* Prompt — visual description summary. */}
      {scene.prompt && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text-dim)",
            marginBottom: 6,
          }}
        >
          {scene.prompt}
        </div>
      )}

      {/* Narration. */}
      {scene.narration && (
        <FieldRow label={t("studio.scriptPanel.narration")} value={scene.narration} />
      )}

      {/* Meta chips: duration / shot size / camera — each only if present. */}
      {(scene.durationSec != null || scene.shotSize || scene.cameraMovement) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 4,
          }}
        >
          {scene.durationSec != null && (
            <MetaChip
              label={t("studio.scriptPanel.duration")}
              value={t("studio.scriptPanel.durationValue", { sec: scene.durationSec })}
            />
          )}
          {scene.shotSize && (
            <MetaChip
              label={t("studio.scriptPanel.shotSize")}
              value={t(SHOT_KEY[scene.shotSize])}
            />
          )}
          {scene.cameraMovement && (
            <MetaChip
              label={t("studio.scriptPanel.camera")}
              value={t(CAMERA_KEY[scene.cameraMovement])}
            />
          )}
        </div>
      )}

      {/* mdAnchor back-link or the "no linked section" note. */}
      {!scene.mdAnchor && (
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.04em",
            color: "var(--text-dimmer)",
            fontStyle: "italic",
          }}
        >
          {t("studio.scriptPanel.noMdAnchor")}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
          marginRight: 6,
        }}
      >
        {label}
      </span>
      <span style={{ color: "var(--text-dim)" }}>{value}</span>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.04em",
        padding: "2px 8px",
        borderRadius: 6,
        border: "1px solid var(--glass-border)",
        color: "var(--text-dim)",
        background: "var(--surface-1, transparent)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "var(--text-dimmer)", textTransform: "uppercase" }}>
        {label}
      </span>
      <span>{value}</span>
    </span>
  );
}
