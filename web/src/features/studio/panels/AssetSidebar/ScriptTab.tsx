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
  generateScene,
  reorderScenesRemote,
  moveInOrder,
  addSceneRemote,
  removeSceneRemote,
  type ScenePropsPatch,
} from "./sceneEdit";
import { resolveAssetUrl } from "../../composition/resolveAssetUrl";
import type { AssetEntry } from "@shared/composition";

// ─────────────────────────────────────────────────────────────────────────────
// ScriptTab — the work's storyboard skeleton (剧本·分镜), PRD-0007 → PRD-0008.
//
// comp.scenes (the 分镜 / shots an agent drafted via `autoviral scene add`, or a
// human edits here) render as a card list — the whole film's bones at a glance.
//
// PRD-0008 (折叠镜表 / shot sheet) reshapes the dense per-card control panel into
// a FOLDING shot sheet: each card is a one-line read-only SUMMARY ROW by default
// (zero form controls), and clicking it expands an in-card Inspector with the
// full editing surface (accordion — at most ONE card open at a time, owned by
// the `expandedSceneId` state here). A hover ⋯ menu carries reorder + delete;
// a footer ＋ button (and the empty-state primary button) add a shot.
//
// THE INVARIANT (ADR-009 / ADR-012 agent-人一致): every write — patch, reorder,
// generate, ADD, REMOVE — goes through the SAME per-intent bridge route the
// agent's CLI uses (sceneEdit.ts), NOT the Studio store's 800ms whole-comp
// autosave. `comp.scenes` in the store is a READ-ONLY mirror — only the
// `composition-changed` → refetch path (useBridgeEvents) ever rewrites it. We
// NEVER mutate scenes in the store here.
//
// The 剧本 (free-text narrative outline, ScriptEditor) and the 分镜 (structured
// storyboard cards) are TWO independent surfaces, weakly linked by
// `scene.mdAnchor`. PRD-0008 T4 wraps ScriptEditor in a ▾/▸ fold so the narrative
// layer can collapse out of the way, surfacing the execution layer (the cards).
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
  const t = useT();
  const scenes = useComposition((s) => s.comp?.scenes);
  const workId = useComposition((s) => s.comp?.workId ?? "");
  // S7 — the asset registry (read-only mirror, like comp.scenes). A generated
  // scene's `selectedAssetId` is resolved against this to render its thumbnail.
  const assets = useComposition((s) => s.comp?.assets);
  // Read-path only: sort a copy by `order` (the intended shot sequence). The
  // store array is never mutated here — edits go over the bridge (sceneEdit.ts).
  const ordered = useMemo(
    () => (scenes ? [...scenes].sort((a, b) => a.order - b.order) : []),
    [scenes],
  );
  const hasScenes = ordered.length > 0;

  // PRD-0008 — accordion: at most ONE expanded card. Lifted here (not per-card)
  // so opening one closes the rest. A null = all collapsed.
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const toggleExpanded = useCallback(
    (sceneId: string) =>
      setExpandedSceneId((cur) => (cur === sceneId ? null : sceneId)),
    [],
  );

  // Reorder is a card-level gesture but lives here because it needs the FULL
  // ordered id list. We reduce a move to (fromIndex, toIndex), compute the new
  // sequence with the pure `moveInOrder`, and POST the complete order. The
  // server recompacts; the refetch reflows.
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

  // PRD-0008 T3 — add a new shot via the bridge (POST /scene), the SAME route
  // the agent's `autoviral scene add` CLI hits (ADR-012). The title is a
  // localized placeholder ("Untitled shot") the user renames. `addSceneRemote`
  // returns the new scene id; we stash it and auto-expand the card once the
  // composition-changed refetch lands it (the store mirror, never local
  // setState — the S4 invariant). If the id ever comes back empty we fall back
  // to matching the just-sent placeholder title.
  const [addError, setAddError] = useState<string | null>(null);
  const pendingExpand = useRef<{ id: string; title: string } | null>(null);
  const runAdd = useCallback(async () => {
    const title = t("studio.scriptPanel.newSceneTitle");
    setAddError(null);
    try {
      const newId = await addSceneRemote(workId, { title });
      pendingExpand.current = { id: newId, title };
    } catch (err) {
      setAddError(errorMessage(err));
    }
  }, [workId, t]);

  // When a just-added scene appears in the refetched list, auto-expand it —
  // prefer the returned id, fall back to the placeholder title.
  useEffect(() => {
    const pending = pendingExpand.current;
    if (!pending) return;
    // Title fallback ONLY when the bridge didn't return an id — with a valid
    // id, a placeholder-title collision must never match an older card.
    const match = ordered.find((s) =>
      pending.id ? s.id === pending.id : s.title === pending.title,
    );
    if (match) {
      setExpandedSceneId(match.id);
      pendingExpand.current = null;
    }
  }, [ordered]);

  // Remove a shot via the bridge (DELETE /scene/:id) — same route as the
  // agent's `autoviral scene remove`. If the removed card was open, collapse.
  const [removeError, setRemoveError] = useState<string | null>(null);
  const removeScene = useCallback(
    async (sceneId: string) => {
      setRemoveError(null);
      try {
        await removeSceneRemote(workId, sceneId);
        setExpandedSceneId((cur) => (cur === sceneId ? null : cur));
      } catch (err) {
        setRemoveError(errorMessage(err));
      }
    },
    [workId],
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
        {/* T4 — 剧本 (plan/script.md) editor sits ABOVE the storyboard cards,
            now wrapped in a ▾/▸ fold so the narrative layer can collapse out of
            the way. Independent of `hasScenes`: it always renders. */}
        <ScriptEditorFold workId={workId} />

        <div style={{ marginTop: 14 }}>
          {hasScenes ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {reorderError && <ErrorLine msg={reorderError} kind="reorder" />}
              {removeError && <ErrorLine msg={removeError} kind="remove" />}
              {ordered.map((scene, index) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  workId={workId}
                  assets={assets}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === ordered.length - 1}
                  expanded={expandedSceneId === scene.id}
                  onToggle={() => toggleExpanded(scene.id)}
                  onMove={moveScene}
                  onRemove={() => removeScene(scene.id)}
                />
              ))}
              {/* ＋ New shot — persistent footer button. */}
              <AddSceneButton onClick={() => void runAdd()} variant="footer" />
              {addError && <ErrorLine msg={addError} kind="add" />}
            </div>
          ) : (
            <EmptyState onAdd={() => void runAdd()} addError={addError} />
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

// ─── T4 · script fold ───────────────────────────────────────────────────────
//
// Wraps the existing ScriptEditor in a ▾/▸ collapse toggle so the narrative
// layer can fold out of the way, surfacing the execution layer (the cards).
// Default = expanded; the state is remembered in localStorage under a single
// global key (not per-work — a UI affordance preference, not work data).
const SCRIPT_FOLD_KEY = "autoviral.scriptFold.collapsed";

function ScriptEditorFold({ workId }: { workId: string }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SCRIPT_FOLD_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SCRIPT_FOLD_KEY, next ? "1" : "0");
      } catch {
        /* ignore quota / disabled storage */
      }
      return next;
    });
  }, []);

  return (
    <div>
      <button
        type="button"
        data-bare
        aria-expanded={!collapsed}
        aria-label={t(
          collapsed
            ? "studio.scriptPanel.scriptFoldExpand"
            : "studio.scriptPanel.scriptFoldCollapse",
        )}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "4px 2px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        <span aria-hidden style={{ fontSize: 9 }}>
          {collapsed ? "▸" : "▾"}
        </span>
        <span>{t("studio.scriptPanel.scriptHeading")}</span>
      </button>
      {!collapsed && <ScriptEditor workId={workId} />}
    </div>
  );
}

// ─── 剧本 (plan/script.md) markdown editor ──────────────────────────────────
//
// The narrative outline that twins the storyboard. Edit (textarea) ↔ preview
// (react-markdown) toggle; commits the RAW markdown to disk on blur via
// saveScript (the same write path as `autoviral script edit`). Reads from the
// `useScript` store, which the bridge's `plan-changed` → refetchScript path
// also writes — so an external editor or the agent's CLI edit reflows here live.
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

  // TENANCY GUARD: the store is one global instance shared by every work. The
  // held script is OURS only when it's stamped with our workId AND a load has
  // resolved.
  const isMine = storeWorkId === workId && loaded;

  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!workId) return;
    if (loadedFor.current === workId) return;
    loadedFor.current = workId;
    if (useScript.getState().workId !== workId) reset();
    setLoadError(null);
    loadScript(workId)
      .then((md) => {
        if (loadedFor.current === workId) setScript(workId, md);
      })
      .catch((err) => {
        if (loadedFor.current === workId) setLoadError(errorMessage(err));
      });
  }, [workId, reset, setScript]);

  const commit = useCallback(
    async (next: string) => {
      const st = useScript.getState();
      if (st.workId !== workId || !st.loaded) return;
      if (next === st.script) return; // unchanged — no needless write
      setSaveError(null);
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
// Reflows to a fresh `value` (a refetchScript landing) ONLY when not focused.
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

// PRD-0008 — empty state now carries a PRIMARY add button (replaces the
// "ask the agent / create later" dead copy with a real affordance).
function EmptyState({
  onAdd,
  addError,
}: {
  onAdd: () => void;
  addError: string | null;
}) {
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
          marginBottom: 12,
        }}
      >
        {t("studio.scriptPanel.emptyTitle")}
      </div>
      <AddSceneButton onClick={onAdd} variant="primary" />
      {addError && <ErrorLine msg={addError} kind="add" />}
    </div>
  );
}

// ＋ New shot button — two visual variants (footer / empty-state primary), one
// behaviour. Both go through the panel's runAdd (the bridge add op).
function AddSceneButton({
  onClick,
  variant,
}: {
  onClick: () => void;
  variant: "footer" | "primary";
}) {
  const t = useT();
  const primary = variant === "primary";
  return (
    <button
      type="button"
      data-bare
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        alignSelf: primary ? "center" : "stretch",
        margin: primary ? "0 auto" : undefined,
        padding: primary ? "6px 16px" : "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.04em",
        background: "transparent",
        border: `1px ${primary ? "solid" : "dashed"} var(--accent)`,
        borderRadius: 8,
        color: "var(--accent-hi)",
        cursor: "pointer",
      }}
    >
      <span aria-hidden>＋</span>
      {t("studio.scriptPanel.addScene")}
    </button>
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
  /** The composition's asset registry — used to resolve the generated thumbnail. */
  assets: AssetEntry[] | undefined;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  /** Accordion: is THIS the open card? (owned by ScriptTab). */
  expanded: boolean;
  /** Toggle this card open/closed (closes any other). */
  onToggle: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  /** Delete this scene (bridge DELETE /scene/:id). */
  onRemove: () => void;
}

function SceneCard({
  scene,
  workId,
  assets,
  index,
  isFirst,
  isLast,
  expanded,
  onToggle,
  onMove,
  onRemove,
}: SceneCardProps) {
  const t = useT();
  const statusLabel = t(STATUS_KEY[scene.status]);
  // Three-way encoding (e2e Hard rule 5: never colour-ALONE). stale gets the
  // amber --status-warn token AND a "Needs regen" text badge; generated gets the
  // accent fill; planned is a hollow outline. The text badge is what tests
  // assert (textContent, not hue).
  const isStale = scene.status === "stale";
  const statusColor = isStale
    ? "var(--status-warn, #fbbf24)"
    : "var(--accent)";

  // Per-card commit: PATCH only the field(s) that changed, over the bridge.
  const [saveError, setSaveError] = useState<string | null>(null);
  // ✓ saved micro-feedback — set on a successful PATCH, auto-fades after ~1.5s.
  const [savedTick, setSavedTick] = useState(false);
  const tickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tickTimer.current) clearTimeout(tickTimer.current);
    },
    [],
  );
  const commit = useCallback(
    async (patch: ScenePropsPatch) => {
      setSaveError(null);
      try {
        await patchScene(workId, scene.id, patch);
        setSavedTick(true);
        if (tickTimer.current) clearTimeout(tickTimer.current);
        tickTimer.current = setTimeout(() => setSavedTick(false), 1500);
      } catch (err) {
        setSaveError(errorMessage(err));
      }
    },
    [workId, scene.id],
  );

  // S7 — generate / reshoot via the SAME per-intent bridge.
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const runGenerate = useCallback(async () => {
    if (generating) return; // reentrancy guard (slow op)
    setGenerating(true);
    setGenerateError(null);
    try {
      await generateScene(workId, scene.id);
    } catch (err) {
      setGenerateError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }, [workId, scene.id, generating]);

  // Resolve the selected take's AssetEntry from the registry → thumbnail.
  const isGenerated = scene.status === "generated";
  const thumbAsset =
    isGenerated && scene.selectedAssetId
      ? assets?.find((a) => a.id === scene.selectedAssetId)
      : undefined;
  const thumbSrc =
    thumbAsset && thumbAsset.kind === "image"
      ? resolveAssetUrl(thumbAsset.uri, workId)
      : null;

  const shotNo = scene.order + 1;
  const intentLabel = scene.intent ? t(INTENT_KEY[scene.intent]) : "—";
  const shotSizeLabel = scene.shotSize ? t(SHOT_KEY[scene.shotSize]) : "—";

  return (
    <div
      data-testid="scene-card"
      data-scene-id={scene.id}
      data-expanded={expanded ? "true" : "false"}
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
        overflow: "hidden",
      }}
    >
      {/* ── Collapsed summary row (always shown — the row header) ─────────────
          A single button row: 镜号 · status dot+badge · title · duration ·
          shot size · intent · thumbnail · ⋯ menu. ZERO form controls. Clicking
          toggles the in-card Inspector below. */}
      <SceneSummaryRow
        scene={scene}
        expanded={expanded}
        onToggle={onToggle}
        statusLabel={statusLabel}
        statusColor={statusColor}
        statusFilled={STATUS_FILLED[scene.status]}
        isStale={isStale}
        intentLabel={intentLabel}
        shotSizeLabel={shotSizeLabel}
        thumbSrc={thumbSrc}
        shotNo={shotNo}
        isFirst={isFirst}
        isLast={isLast}
        index={index}
        onMove={onMove}
        onRemove={onRemove}
      />

      {/* ── Expanded in-card Inspector ───────────────────────────────────────
          The full editing surface, migrated verbatim from the old always-on
          card body. Mounts only when this card is the open accordion item. */}
      {expanded && (
        <div
          style={{
            padding: "4px 12px 12px",
            borderTop: "1px solid var(--divider)",
          }}
        >
          {/* Title — inline editable. */}
          <div style={{ marginTop: 8, marginBottom: 6 }}>
            <EditableText
              value={scene.title}
              ariaLabel={t("studio.scriptPanel.editTitleAria")}
              placeholder={t("studio.scriptPanel.editTitlePlaceholder")}
              multiline={false}
              onCommit={(next) => {
                if (next !== scene.title) void commit({ title: next });
              }}
              style={{ fontSize: 13, fontWeight: 500 }}
            />
          </div>

          {/* Intent + reorder controls. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
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
            <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
              {!isFirst && (
                <ReorderButton
                  aria-label={t("studio.scriptPanel.moveUpAria", {
                    n: shotNo,
                  })}
                  onClick={() => onMove(index, index - 1)}
                >
                  ↑
                </ReorderButton>
              )}
              {!isLast && (
                <ReorderButton
                  aria-label={t("studio.scriptPanel.moveDownAria", {
                    n: shotNo,
                  })}
                  onClick={() => onMove(index, index + 1)}
                >
                  ↓
                </ReorderButton>
              )}
            </div>
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

          {/* S7 — generate / reshoot button + ✓ saved tick. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
            }}
          >
            <button
              type="button"
              data-bare
              onClick={() => void runGenerate()}
              disabled={generating}
              style={{
                padding: "3px 10px",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.04em",
                background: "transparent",
                border: "1px solid var(--glass-border)",
                borderRadius: 6,
                color: generating ? "var(--text-dimmer)" : "var(--accent-hi)",
                borderColor: generating ? "var(--glass-border)" : "var(--accent)",
                cursor: generating ? "default" : "pointer",
              }}
            >
              {generating
                ? t("studio.scriptPanel.generating")
                : isGenerated
                  ? t("studio.scriptPanel.reshoot")
                  : t("studio.scriptPanel.generateScene")}
            </button>
            {savedTick && (
              // Brief ✓ saved micro-feedback — unmounts after ~1.5s (the
              // setTimeout in `commit`), giving an appear-then-fade without a
              // bespoke keyframe.
              <span
                role="status"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.04em",
                  color: "var(--accent)",
                  opacity: 0.9,
                }}
              >
                {t("studio.scriptPanel.savedTick")}
              </span>
            )}
          </div>

          {generateError && (
            <div
              role="alert"
              style={{
                marginTop: 6,
                fontSize: 11,
                lineHeight: 1.4,
                color: "var(--status-error, #d4756c)",
              }}
            >
              {t("studio.scriptPanel.generateFailed", { msg: generateError })}
            </div>
          )}

          {saveError && <ErrorLine msg={saveError} />}
        </div>
      )}
    </div>
  );
}

// ─── PRD-0008 collapsed summary row ──────────────────────────────────────────
//
// The clickable header of a SceneCard: a read-only one-line summary plus the
// hover/focus ⋯ menu. ZERO form controls (the editing surface lives in the
// expanded Inspector). Clicking the row body toggles the accordion.
interface SceneSummaryRowProps {
  scene: Scene;
  expanded: boolean;
  onToggle: () => void;
  statusLabel: string;
  statusColor: string;
  statusFilled: boolean;
  isStale: boolean;
  intentLabel: string;
  shotSizeLabel: string;
  thumbSrc: string | null;
  shotNo: number;
  isFirst: boolean;
  isLast: boolean;
  index: number;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemove: () => void;
}

function SceneSummaryRow({
  scene,
  expanded,
  onToggle,
  statusLabel,
  statusColor,
  statusFilled,
  isStale,
  intentLabel,
  shotSizeLabel,
  thumbSrc,
  shotNo,
  isFirst,
  isLast,
  index,
  onMove,
  onRemove,
}: SceneSummaryRowProps) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        position: "relative",
      }}
    >
      {/* The clickable summary — a button so it's keyboard-reachable and
          announces expand/collapse. */}
      <button
        type="button"
        data-bare
        aria-expanded={expanded}
        aria-label={t(
          expanded
            ? "studio.scriptPanel.collapseSceneAria"
            : "studio.scriptPanel.expandSceneAria",
          { n: shotNo },
        )}
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          padding: 0,
        }}
      >
        {/* 镜号 */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--text-dimmer)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {t("studio.scriptPanel.shotNumber", { n: shotNo })}
        </span>
        {/* status dot — three-state (hollow / filled accent / filled amber). */}
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
            background: statusFilled ? statusColor : "transparent",
            border: `1.5px solid ${statusColor}`,
          }}
        />
        {/* stale text badge — multi-encoding (NOT colour-alone). */}
        {isStale && (
          <span
            data-testid="stale-badge"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--status-warn, #fbbf24)",
              border: "1px solid var(--status-warn, #fbbf24)",
              borderRadius: 4,
              padding: "0 4px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {t("studio.scriptPanel.staleBadge")}
          </span>
        )}
        {/* generated thumbnail (image takes only) — inline-sized. */}
        {thumbSrc && (
          <img
            data-testid="scene-thumb"
            src={thumbSrc}
            alt={scene.title}
            style={{
              width: 22,
              height: 22,
              objectFit: "cover",
              borderRadius: 4,
              flexShrink: 0,
              border: "1px solid var(--glass-border)",
            }}
          />
        )}
        {/* title — plain text (NOT an input). */}
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {scene.title}
        </span>
        {/* compact meta — duration / shot size / intent (— for empty). */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.03em",
            color: "var(--text-dimmer)",
            whiteSpace: "nowrap",
            flexShrink: 0,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {scene.durationSec != null && (
            <span data-testid="summary-duration">
              {scene.durationSec.toFixed(1)}s
            </span>
          )}
          <span data-testid="summary-shot">{shotSizeLabel}</span>
          <span data-testid="summary-intent">{intentLabel}</span>
        </span>
      </button>

      {/* ⋯ menu trigger — appears on hover/focus or while the menu is open. */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          type="button"
          data-bare
          aria-label={t("studio.scriptPanel.sceneMenuAria", { n: shotNo })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          onClick={() => setMenuOpen((o) => !o)}
          style={{
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: 6,
            color: "var(--text-dim)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            // Keep it focusable but visually quiet until hovered/open.
            opacity: hovered || menuOpen ? 1 : 0,
            transition: "opacity 0.12s",
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <SceneRowMenu
            isFirst={isFirst}
            isLast={isLast}
            index={index}
            onMove={onMove}
            onRemove={onRemove}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// The ⋯ popover menu: move up / move down / delete (two-click confirm). Closes
// on any action (except the first delete click, which arms confirm) and on an
// outside click. Two-click delete follows #66 — never a global Delete key.
function SceneRowMenu({
  isFirst,
  isLast,
  index,
  onMove,
  onRemove,
  onClose,
}: {
  isFirst: boolean;
  isLast: boolean;
  index: number;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Outside click resets confirm + closes the menu (so a primed "confirm
  // delete?" can't linger if the user clicks away — matches #66 reset).
  // Escape closes too — keyboard users must be able to dismiss without
  // clicking elsewhere (mirrors the ModelSwitcher menu).
  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "5px 12px",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.03em",
    background: "transparent",
    border: "none",
    color: "var(--text-dim)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 20,
        minWidth: 130,
        padding: "4px 0",
        background: "var(--surface-1, var(--surface-0))",
        border: "1px solid var(--glass-border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
      }}
    >
      {!isFirst && (
        <button
          type="button"
          data-bare
          role="menuitem"
          onClick={() => {
            onMove(index, index - 1);
            onClose();
          }}
          style={itemStyle}
        >
          ↑ {t("studio.scriptPanel.sceneMenuMoveUp")}
        </button>
      )}
      {!isLast && (
        <button
          type="button"
          data-bare
          role="menuitem"
          onClick={() => {
            onMove(index, index + 1);
            onClose();
          }}
          style={itemStyle}
        >
          ↓ {t("studio.scriptPanel.sceneMenuMoveDown")}
        </button>
      )}
      <button
        type="button"
        data-bare
        role="menuitem"
        onClick={() => {
          if (confirmingDelete) {
            onRemove();
            setConfirmingDelete(false);
            onClose();
          } else {
            setConfirmingDelete(true);
          }
        }}
        style={{
          ...itemStyle,
          color: "var(--status-error, #d4756c)",
        }}
      >
        {confirmingDelete
          ? t("studio.scriptPanel.sceneMenuDeleteConfirm")
          : t("studio.scriptPanel.sceneMenuDelete")}
      </button>
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
// (a refetch landing) AND the field isn't focused.
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
// never a fake 0. A negative value is clamped to 0. Commits on blur / Enter.
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

function ErrorLine({
  msg,
  kind,
}: {
  msg: string;
  kind?: "add" | "remove" | "reorder";
}) {
  const t = useT();
  const key =
    kind === "add"
      ? "studio.scriptPanel.addSceneFailed"
      : kind === "remove"
        ? "studio.scriptPanel.removeSceneFailed"
        : kind === "reorder"
          ? "studio.scriptPanel.reorderSceneFailed"
          : "studio.scriptPanel.saveFailed";
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
      {t(key, { msg })}
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
