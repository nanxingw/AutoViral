import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useComposition } from "../../store";
import { useScript } from "../../scriptStore";
import { loadScript, saveScript } from "../../services/script";
import type { Scene } from "@shared/composition";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n/useT";
import { ApiError } from "@/lib/api";
import {
  patchScene,
  reorderScenesRemote,
  moveInOrder,
  type ScenePropsPatch,
} from "./sceneEdit";

// ─────────────────────────────────────────────────────────────────────────────
// ScriptTab (S3→S4 · PRD-0007) — the work's storyboard skeleton, now EDITABLE.
//
// comp.scenes (the 分镜 / shots an agent drafted via `autoviral scene add`, or a
// human edits here) render as a card list — the whole film's bones at a glance.
//
// S4 makes each card inline-editable AND reorderable. THE INVARIANT (ADR-009
// agent-人一致): every edit goes through the SAME per-intent bridge route the
// agent's CLI uses (PATCH /scene/:id, POST /scene/reorder via sceneEdit.ts), NOT
// the Studio store's 800ms whole-composition autosave. `comp.scenes` in the
// store is a READ-ONLY mirror — only the `composition-changed` → refetch path
// (useBridgeEvents) ever rewrites it. We NEVER mutate scenes in the store here,
// so the unrelated autosave's whole-`PUT /comp` always carries server-fresh
// scenes and can't clobber a concurrent agent (or another tab) with stale data.
//
// S5 mounts the `plan/script.md` 剧本 (narrative) editor ABOVE this card list
// (ScriptEditor below). The 剧本 (free-text narrative outline) and the 分镜
// (structured storyboard cards) are TWO independent surfaces, weakly linked by
// `scene.mdAnchor` — we render an honest drift notice and let each surface show
// its own state (`hasScript` / `hasScenes` never imply each other). Edits commit
// straight to disk via `saveScript` (raw text/markdown PUT) — the SAME write
// path the agent's `autoviral script edit` CLI uses (ADR-009 agent-人一致) — and
// the `plan-changed` broadcast → refetchScript keeps every surface convergent.
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

// Enum-literal option order (the dropdown order). Drives the <select>s; the
// label is localised, the value is the schema literal sent to the bridge.
const INTENT_OPTIONS: NonNullable<Scene["intent"]>[] = [
  "hook",
  "build",
  "payoff",
  "cta",
];
const SHOT_OPTIONS: NonNullable<Scene["shotSize"]>[] = [
  "long",
  "full",
  "medium",
  "close",
  "closeup",
];
const CAMERA_OPTIONS: NonNullable<Scene["cameraMovement"]>[] = [
  "push",
  "pull",
  "pan",
  "track",
  "follow",
  "static",
];

export function ScriptTab() {
  const scenes = useComposition((s) => s.comp?.scenes);
  const workId = useComposition((s) => s.comp?.workId ?? "");
  // Read-path only: sort a copy by `order` (the intended shot sequence). The
  // store array is never mutated here — edits go over the bridge (sceneEdit.ts).
  const ordered = useMemo(
    () => (scenes ? [...scenes].sort((a, b) => a.order - b.order) : []),
    [scenes],
  );
  const hasScenes = ordered.length > 0;

  // Reorder is a card-level gesture but lives here because it needs the FULL
  // ordered id list. We reduce a move to (fromIndex, toIndex), compute the new
  // sequence with the pure `moveInOrder`, and POST the complete order. The
  // server recompacts; the refetch reflows. We surface failures via a panel-
  // level error line (a reorder isn't tied to one card's editor).
  const orderedIds = useMemo(() => ordered.map((s) => s.id), [ordered]);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const moveScene = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const next = moveInOrder(orderedIds, fromIndex, toIndex);
      if (next === orderedIds) return; // no-op / out of bounds
      setReorderError(null);
      try {
        await reorderScenesRemote(workId, next);
      } catch (err) {
        setReorderError(errorMessage(err));
      }
    },
    [orderedIds, workId],
  );

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
        {/* S5 — 剧本 (plan/script.md) editor sits ABOVE the storyboard cards.
            Independent of `hasScenes`: it always renders (empty → placeholder),
            so a script-less work still gets an editor and a scene-less work
            still gets its onboarding below. Neither implies the other. */}
        <ScriptEditor workId={workId} />

        <div style={{ marginTop: 14 }}>
          {hasScenes ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {reorderError && <ErrorLine msg={reorderError} />}
              {ordered.map((scene, index) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  workId={workId}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === ordered.length - 1}
                  onMove={moveScene}
                />
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}

function ScriptHeading() {
  const t = useT();
  return <>{t("studio.scriptPanel.heading")}</>;
}

// ─── 剧本 (plan/script.md) markdown editor ──────────────────────────────────
//
// The narrative outline that twins the storyboard. Edit (textarea) ↔ preview
// (react-markdown) toggle; commits the RAW markdown to disk on blur via
// saveScript (the same write path as `autoviral script edit`). Reads from the
// `useScript` store, which the bridge's `plan-changed` → refetchScript path
// also writes — so an external editor or the agent's CLI edit reflows here live.
//
// Empty-state is a PLACEHOLDER attribute, NEVER written into the file: the
// server returns "" for an unwritten plan and we keep it "" (no template in any
// language — #73/#83 i18n-string-as-data鐵律).
function ScriptEditor({ workId }: { workId: string }) {
  const t = useT();
  const script = useScript((s) => s.script);
  const loaded = useScript((s) => s.loaded);
  const storeWorkId = useScript((s) => s.workId);
  const setScript = useScript((s) => s.setScript);
  const reset = useScript((s) => s.reset);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // TENANCY GUARD (HIGH fix): the store is one global instance shared by every
  // work. The held script is OURS only when it's stamped with our workId AND a
  // load has resolved. While the store still holds another work's script (this
  // editor just mounted, or we're mid A→B route hop) we render empty + read-only
  // and refuse to commit — never leak/clobber across works.
  const isMine = storeWorkId === workId && loaded;

  // Mount-load: pull plan/script.md once per work into the store. The bridge's
  // refetchScript only fires on a CHANGE (plan-changed) — the initial on-disk
  // value has to be fetched here. Guard with a ref so a re-render / a store
  // update we caused doesn't re-fetch (and a workId switch re-fetches once).
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!workId) return;
    if (loadedFor.current === workId) return;
    loadedFor.current = workId;
    // If the store still holds a DIFFERENT work's script, clear it synchronously
    // so this editor never shows (or commits) the previous work's 剧本 during the
    // async load window. (Studio's workId-reset effect does the same at the page
    // level for when this tab isn't mounted during the switch.)
    if (useScript.getState().workId !== workId) reset();
    setLoadError(null);
    loadScript(workId)
      .then((md) => {
        // A stale load (workId switched again before this resolved) must not
        // overwrite the now-current work's store.
        if (loadedFor.current === workId) setScript(workId, md);
      })
      .catch((err) => {
        // No longer swallow: a real load failure (500 / network) must surface,
        // not leave the editor silently blank with no signal (MEDIUM fix).
        if (loadedFor.current === workId) setLoadError(errorMessage(err));
      });
  }, [workId, reset, setScript]);

  const commit = useCallback(
    async (next: string) => {
      // Cross-work guard: only write when the store holds THIS work's freshly
      // loaded script. During an A→B hop the store is reset (workId≠ours /
      // !loaded) until ours lands — committing here would PUT stale content into
      // the wrong work. Read fresh via getState (the callback closure can lag).
      const st = useScript.getState();
      if (st.workId !== workId || !st.loaded) return;
      if (next === st.script) return; // unchanged — no needless write
      setSaveError(null);
      // Optimistically reflect the edit in the store so the preview + a sibling
      // surface see it immediately; the broadcast→refetch reconverges on disk.
      setScript(workId, next);
      try {
        await saveScript(workId, next);
      } catch (err) {
        setSaveError(errorMessage(err));
      }
    },
    [workId, setScript],
  );

  return (
    <div
      style={{
        border: "1px solid var(--glass-border)",
        borderRadius: 10,
        background: "var(--surface-0)",
        padding: "10px 12px",
        marginBottom: 4,
      }}
    >
      {/* Heading + edit/preview toggle. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-dimmer)",
          }}
        >
          {t("studio.scriptPanel.scriptHeading")}
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          <ModeButton
            active={mode === "edit"}
            onClick={() => setMode("edit")}
          >
            {t("studio.scriptPanel.scriptModeEdit")}
          </ModeButton>
          <ModeButton
            active={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            {t("studio.scriptPanel.scriptModePreview")}
          </ModeButton>
        </div>
      </div>

      {/* Honest drift notice — the 剧本 and 分镜 are independently maintained. */}
      <div
        style={{
          fontSize: 10.5,
          lineHeight: 1.5,
          color: "var(--text-dimmer)",
          fontStyle: "italic",
          marginBottom: 8,
        }}
      >
        {t("studio.scriptPanel.driftNotice")}
      </div>

      {mode === "edit" ? (
        // key={workId} → a work switch REMOUNTS the textarea, discarding any
        // focused-but-uncommitted draft from the previous work (else a stale
        // focused draft could survive the switch and commit into the new work).
        // value/loaded gate on `isMine` so a not-yet-loaded foreign script never
        // renders here and the field stays read-only until our script lands.
        <ScriptTextarea
          key={workId}
          value={isMine ? script : ""}
          loaded={isMine}
          ariaLabel={t("studio.scriptPanel.editScriptAria")}
          placeholder={t("studio.scriptPanel.scriptPlaceholder")}
          onCommit={commit}
        />
      ) : (
        <div
          data-testid="script-preview"
          aria-label={t("studio.scriptPanel.scriptPreviewAria")}
          className="script-md-preview"
          style={{
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--text-dim)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {!isMine || script.trim() === "" ? (
            <span style={{ fontStyle: "italic", color: "var(--text-dimmer)" }}>
              {t("studio.scriptPanel.scriptEmptyPreview")}
            </span>
          ) : (
            <ReactMarkdown>{script}</ReactMarkdown>
          )}
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          style={{
            marginTop: 6,
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--status-error, #d4756c)",
          }}
        >
          {t("studio.scriptPanel.scriptLoadFailed", { msg: loadError })}
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          style={{
            marginTop: 6,
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--status-error, #d4756c)",
          }}
        >
          {t("studio.scriptPanel.scriptSaveFailed", { msg: saveError })}
        </div>
      )}
    </div>
  );
}

// Locally-controlled markdown textarea. Seeds from `value`; commits on blur.
// Reflows to a fresh `value` (a refetchScript landing) ONLY when not focused —
// so an external edit reflows but an in-flight draft is never yanked from under
// the user (mirror of EditableText's focus guard, S4).
function ScriptTextarea({
  value,
  loaded,
  ariaLabel,
  placeholder,
  onCommit,
}: {
  value: string;
  loaded: boolean;
  ariaLabel: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      // Until the first load resolves we keep the field read-only-ish (still
      // mounted so its placeholder/aria are testable) — but allow typing once
      // loaded so a brand-new work is immediately writable.
      readOnly={!loaded}
      rows={8}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        onCommit(draft);
      }}
      style={{
        width: "100%",
        minHeight: 140,
        background: "transparent",
        border: "1px solid var(--glass-border)",
        borderRadius: 6,
        color: "var(--text)",
        padding: "8px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.6,
        resize: "vertical",
      }}
    />
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-bare
      onClick={onClick}
      style={{
        padding: "2px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.04em",
        background: "transparent",
        border: "1px solid var(--glass-border)",
        borderRadius: 6,
        color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
        borderColor: active ? "var(--accent)" : "var(--glass-border)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
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

interface SceneCardProps {
  scene: Scene;
  workId: string;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
}

function SceneCard({ scene, workId, index, isFirst, isLast, onMove }: SceneCardProps) {
  const t = useT();
  const statusLabel = t(STATUS_KEY[scene.status]);
  const statusColor =
    scene.status === "stale" ? "var(--status-error, #d4756c)" : "var(--accent)";

  // Per-card commit: PATCH only the field(s) that changed, over the bridge. On
  // failure we keep the error visible (and the user's text in the controlled
  // input) instead of silently dropping it.
  const [saveError, setSaveError] = useState<string | null>(null);
  const commit = useCallback(
    async (patch: ScenePropsPatch) => {
      setSaveError(null);
      try {
        await patchScene(workId, scene.id, patch);
      } catch (err) {
        setSaveError(errorMessage(err));
      }
    },
    [workId, scene.id],
  );

  return (
    <div
      data-testid="scene-card"
      data-scene-id={scene.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("text/plain");
        const from = Number.parseInt(raw, 10);
        if (Number.isFinite(from) && from !== index) onMove(from, index);
      }}
      style={{
        border: "1px solid var(--glass-border)",
        borderRadius: 10,
        background: "var(--surface-0)",
        padding: "10px 12px",
      }}
    >
      {/* Top row: 镜号 + status dot + reorder controls + intent select. */}
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
        {/* Title — inline editable. */}
        <EditableText
          value={scene.title}
          ariaLabel={t("studio.scriptPanel.editTitleAria")}
          placeholder={t("studio.scriptPanel.editTitlePlaceholder")}
          multiline={false}
          onCommit={(next) => {
            if (next !== scene.title) void commit({ title: next });
          }}
          style={{ flex: 1, fontSize: 13, fontWeight: 500 }}
        />
        {/* Reorder controls — accessible, testable path (drag is a bonus). */}
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          {!isFirst && (
            <ReorderButton
              aria-label={t("studio.scriptPanel.moveUpAria", { n: scene.order + 1 })}
              onClick={() => onMove(index, index - 1)}
            >
              ↑
            </ReorderButton>
          )}
          {!isLast && (
            <ReorderButton
              aria-label={t("studio.scriptPanel.moveDownAria", { n: scene.order + 1 })}
              onClick={() => onMove(index, index + 1)}
            >
              ↓
            </ReorderButton>
          )}
        </div>
        <EnumSelect
          ariaLabel={t("studio.scriptPanel.editIntentAria")}
          value={scene.intent}
          options={INTENT_OPTIONS}
          labelFor={(v) => t(INTENT_KEY[v])}
          placeholder={t("studio.scriptPanel.optionNone")}
          onChange={(v) => {
            if (v !== (scene.intent ?? null)) void commit({ intent: v });
          }}
        />
      </div>

      {/* Prompt — visual description, inline editable (textarea). */}
      <EditableText
        value={scene.prompt ?? ""}
        ariaLabel={t("studio.scriptPanel.editPromptAria")}
        placeholder={t("studio.scriptPanel.editPromptPlaceholder")}
        multiline
        onCommit={(next) => {
          const norm = next.trim() === "" ? null : next;
          if (norm !== (scene.prompt ?? null)) void commit({ prompt: norm });
        }}
        style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 6 }}
      />

      {/* Narration — inline editable (textarea). */}
      <FieldRow label={t("studio.scriptPanel.narration")}>
        <EditableText
          value={scene.narration ?? ""}
          ariaLabel={t("studio.scriptPanel.editNarrationAria")}
          placeholder={t("studio.scriptPanel.editNarrationPlaceholder")}
          multiline
          onCommit={(next) => {
            const norm = next.trim() === "" ? null : next;
            if (norm !== (scene.narration ?? null))
              void commit({ narration: norm });
          }}
          style={{ fontSize: 12, lineHeight: 1.5 }}
        />
      </FieldRow>

      {/* Meta row: duration / shot size / camera — all editable. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
        }}
      >
        <MetaField label={t("studio.scriptPanel.duration")}>
          <DurationInput
            ariaLabel={t("studio.scriptPanel.editDurationAria")}
            value={scene.durationSec}
            onCommit={(next) => {
              if (next !== (scene.durationSec ?? null))
                void commit({ durationSec: next });
            }}
          />
        </MetaField>
        <MetaField label={t("studio.scriptPanel.shotSize")}>
          <EnumSelect
            ariaLabel={t("studio.scriptPanel.editShotSizeAria")}
            value={scene.shotSize}
            options={SHOT_OPTIONS}
            labelFor={(v) => t(SHOT_KEY[v])}
            placeholder={t("studio.scriptPanel.optionNone")}
            onChange={(v) => {
              if (v !== (scene.shotSize ?? null)) void commit({ shotSize: v });
            }}
          />
        </MetaField>
        <MetaField label={t("studio.scriptPanel.camera")}>
          <EnumSelect
            ariaLabel={t("studio.scriptPanel.editCameraAria")}
            value={scene.cameraMovement}
            options={CAMERA_OPTIONS}
            labelFor={(v) => t(CAMERA_KEY[v])}
            placeholder={t("studio.scriptPanel.optionNone")}
            onChange={(v) => {
              if (v !== (scene.cameraMovement ?? null))
                void commit({ cameraMovement: v });
            }}
          />
        </MetaField>
      </div>

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

      {saveError && <ErrorLine msg={saveError} />}
    </div>
  );
}

// ─── Inline-edit primitives ─────────────────────────────────────────────────

interface EditableTextProps {
  value: string;
  ariaLabel: string;
  placeholder: string;
  multiline: boolean;
  /** Fired on blur or Enter (single-line). Receives the current text. */
  onCommit: (next: string) => void;
  style?: React.CSSProperties;
}

// Locally-controlled text editor. Seeds from `value`; commits on blur (and on
// Enter for single-line). Re-syncs to `value` when it changes from outside
// (a refetch landing) AND the field isn't focused — so an in-flight edit isn't
// yanked out from under the user, but a server-fresh value reflows.
function EditableText({
  value,
  ariaLabel,
  placeholder,
  multiline,
  onCommit,
  style,
}: EditableTextProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const shared = {
    value: draft,
    "aria-label": ariaLabel,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      onCommit(draft);
    },
    style: {
      width: "100%",
      background: "transparent",
      border: "1px solid transparent",
      borderRadius: 6,
      color: "var(--text)",
      padding: "2px 4px",
      font: "inherit",
      resize: "none" as const,
      ...style,
    },
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={2}
        style={{ ...shared.style, color: "var(--text-dim)" }}
      />
    );
  }
  return (
    <input
      {...shared}
      type="text"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

interface DurationInputProps {
  ariaLabel: string;
  value: number | undefined;
  /** number when a valid value is entered, null when cleared. */
  onCommit: (next: number | null) => void;
}

// Honest number editor: an empty (or non-numeric) field commits `null` (clear),
// never a fake 0. A negative value is clamped to 0 (matches the schema's
// min(0); the bridge also rejects negatives, but clamping avoids a needless
// round-trip error). Commits on blur / Enter.
function DurationInput({ ariaLabel, value, onCommit }: DurationInputProps) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value == null ? "" : String(value));
  }, [value, focused]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      onCommit(null);
      return;
    }
    onCommit(Math.max(0, n));
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step="0.5"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{
        width: 52,
        background: "transparent",
        border: "1px solid var(--glass-border)",
        borderRadius: 6,
        color: "var(--text-dim)",
        padding: "2px 4px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    />
  );
}

interface EnumSelectProps<V extends string> {
  ariaLabel: string;
  value: V | undefined;
  options: V[];
  labelFor: (v: V) => string;
  /** placeholder = the "—" (unset) option text. */
  placeholder: string;
  /** null when the user picks the "—" option (clear); the literal otherwise. */
  onChange: (v: V | null) => void;
}

// Optional-enum select. The empty-string option clears the field. Value is the
// schema literal; the label is localised.
function EnumSelect<V extends string>({
  ariaLabel,
  value,
  options,
  labelFor,
  placeholder,
  onChange,
}: EnumSelectProps<V>) {
  return (
    <select
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : (v as V));
      }}
      style={{
        background: "transparent",
        border: "1px solid var(--glass-border)",
        borderRadius: 6,
        color: "var(--text-dim)",
        padding: "2px 4px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        maxWidth: 110,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {labelFor(opt)}
        </option>
      ))}
    </select>
  );
}

function ReorderButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-bare
      {...rest}
      style={{
        width: 22,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "1px solid var(--glass-border)",
        borderRadius: 6,
        color: "var(--text-dim)",
        cursor: "pointer",
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>
      <span
        style={{
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
          marginBottom: 2,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function MetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.04em",
      }}
    >
      <span
        style={{
          color: "var(--text-dimmer)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {children}
    </span>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  const t = useT();
  return (
    <div
      role="alert"
      style={{
        marginTop: 6,
        fontSize: 11,
        lineHeight: 1.4,
        color: "var(--status-error, #d4756c)",
      }}
    >
      {t("studio.scriptPanel.saveFailed", { msg })}
    </div>
  );
}

// Pull the server's localized/raw error out of an ApiError body, falling back
// to the Error message / string form.
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { error?: string } | undefined;
    return b?.error ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
