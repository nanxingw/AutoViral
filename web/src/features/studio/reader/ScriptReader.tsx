import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Markdown } from "@/features/chat/Markdown";
import { useT } from "@/i18n/useT";
import type { AssetEntry, Scene } from "@shared/composition";
import { useComposition } from "../store";
import { useScript } from "../scriptStore";
import { loadScript } from "../services/script";
import { useReader } from "./readerStore";
import { useDive } from "../dive/diveStore";
import { splitScriptByAnchors } from "./interleave";
import { resolveAssetUrl } from "../composition/resolveAssetUrl";
import { STATUS_KEY, INTENT_KEY, SHOT_KEY, STATUS_FILLED } from "../sceneI18n";

// ─────────────────────────────────────────────────────────────────────────────
// ScriptReader — center-column DOCKED reading panel (剧本 + 分镜 interleaved).
//
// Was a fullscreen modal; now a docked panel that covers the preview/timeline
// column ONLY, so the chat (left) and the SCRIPT sidebar (right) stay visible
// and interactive. That turns the sidebar into a NAVIGATOR: a card's ⤢ opens
// the panel scrolled to that shot (readerStore.focusSceneId), a card's "edit"
// jump expands the sidebar Inspector while the reading surface stays put —
// read in the center, edit on the right, both at once.
//
// It reads the 剧本 markdown top-to-bottom in a ~720px editorial column and
// threads each 分镜 as a READ-ONLY card right after the heading its `mdAnchor`
// matches (splitScriptByAnchors, the pure kernel). Unmatched scenes collect in
// a 分镜册 section after the prose. A right-edge mini-TOC of 镜号 jumps to any
// card.
//
// NON-modal contract: no backdrop, no aria-modal, no focus trap — a labelled
// region. ESC closes, EXCEPT while focus sits in an editable field (the
// sidebar edit surface is live alongside; ESC there means "leave the field",
// not "tear down my reading position").
//
// Background is the OPAQUE --canvas-bg plane (glass/backdrop-filter is banned
// in scroll-heavy content areas, DESIGN.md) — the Remotion preview underneath
// must never ghost through the prose.
// ─────────────────────────────────────────────────────────────────────────────

export function ScriptReader() {
  const t = useT();
  const open = useReader((s) => s.open);
  const closeReader = useReader((s) => s.closeReader);
  const focusSceneId = useReader((s) => s.focusSceneId);
  const consumeFocus = useReader((s) => s.consumeFocus);
  const jumpToScene = useDive((s) => s.jumpToScene);

  const comp = useComposition((s) => s.comp);
  const workId = comp?.workId ?? "";
  const assets = comp?.assets;
  const scenes = comp?.scenes;

  // Tenancy guard (mirrors ScriptModal): the useScript store is one global
  // instance — the held script is OURS only when stamped with our workId AND a
  // load resolved.
  const script = useScript((s) => s.script);
  const loaded = useScript((s) => s.loaded);
  const loading = useScript((s) => s.loading);
  const storeWorkId = useScript((s) => s.workId);
  const setScript = useScript((s) => s.setScript);
  const beginLoad = useScript((s) => s.beginLoad);
  const endLoad = useScript((s) => s.endLoad);
  const isMine = storeWorkId === workId && loaded;
  const scriptText = isMine ? script : "";

  // F1 — SELF-LOAD. The reader is opened from the Studio top bar, INDEPENDENTLY
  // of the sidebar's ScriptTab (the only other loadScript caller). Open it from
  // the LIBRARY tab (ScriptTab never mounted) and the useScript store holds no
  // script for this work, so `scriptText` is "" and every scene falls into the
  // trailing 分镜册 bucket — a silent degradation into a non-interleaved view.
  // So when we open for a work whose script isn't loaded — and no ScriptTab load
  // is already in flight (dedup on the shared `loading` flag) — fetch it here
  // through the SAME plain-text service.
  const [loadError, setLoadError] = useState(false);
  const loadFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      // Re-arm on close so a later reopen re-checks (and a previously-errored
      // work gets another chance).
      loadFiredFor.current = null;
      setLoadError(false);
      return;
    }
    if (!workId) return;
    if (isMine) return; // already loaded for this work
    if (loading) return; // a ScriptTab load is already in flight — dedup
    if (loadFiredFor.current === workId) return; // our own load already fired
    loadFiredFor.current = workId;
    setLoadError(false);
    beginLoad(workId);
    loadScript(workId)
      .then((md) => setScript(workId, md))
      .catch(() => {
        setLoadError(true);
        endLoad();
      });
  }, [open, workId, isMine, loading, beginLoad, endLoad, setScript]);

  // Loading = we have a work open but its script isn't ours yet and we haven't
  // errored. Rendered INSTEAD of the flow so the non-interleaved degradation
  // never shows; on error we fall through to the normal (best-effort) render.
  const isLoading = !!comp && !isMine && !loadError;

  const flow = useMemo(
    () => splitScriptByAnchors(scriptText, scenes ?? []),
    [scriptText, scenes],
  );
  // Reading-order flat list for the mini-TOC (anchored scenes first, in segment
  // order, then the trailing 分镜册 scenes).
  const flowScenes = useMemo(
    () => [...flow.segments.flatMap((s) => s.scenes), ...flow.trailing],
    [flow],
  );

  // ESC closes — UNLESS the user is typing in an editable field. The panel is
  // non-modal: the sidebar's inputs are live alongside, and ESC inside one
  // means "leave this field", never "collapse my reading position".
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          el.isContentEditable
        )
          return;
      }
      closeReader();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeReader]);

  // Focus-scene deep link (sidebar ⤢ hand-off): scroll the named card into
  // view, flash it, then consume the request. If the card isn't rendered yet
  // (scenes still loading) the request stays pending and we retry when the
  // flow reflows — mirrors the ScriptTab pendingSceneJump pattern.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open || !focusSceneId || isLoading) return;
    const el = document.getElementById(`reader-scene-${focusSceneId}`);
    if (!el) return; // not in the flow yet — retry on the next reflow
    let reduced = false;
    try {
      reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* matchMedia unavailable in the test DOM — default to smooth */
    }
    el.scrollIntoView?.({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
    setFlashId(focusSceneId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1600);
    consumeFocus();
  }, [open, focusSceneId, isLoading, flowScenes, consumeFocus]);

  const onEditScene = (sceneId: string) => {
    // Hand the sidebar the jump target (switch to Script tab + expand the card).
    // The reader STAYS open — reading center + editing right is the whole point
    // of the docked layout.
    jumpToScene(sceneId);
  };

  const empty = !comp || (scriptText.trim() === "" && (scenes?.length ?? 0) === 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="reader-panel"
          data-testid="reader-panel"
          role="region"
          aria-labelledby="reader-title"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            background: "var(--canvas-bg)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}
        >
          <header
            style={{
              padding: "12px 18px",
              borderBottom: "1px solid var(--divider)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <h2
              id="reader-title"
              style={{
                margin: 0,
                fontFamily: "var(--font-editorial)",
                fontStyle: "italic",
                fontSize: 20,
                letterSpacing: "-0.015em",
                color: "var(--text)",
              }}
            >
              {t("studio.scriptReader.title")}
            </h2>
            <button
              type="button"
              onClick={closeReader}
              aria-label={t("studio.scriptReader.closeAria")}
              title={t("studio.scriptReader.closeAria")}
              data-bare
              style={{
                width: 28,
                height: 28,
                display: "grid",
                placeItems: "center",
                borderRadius: 6,
                border: "1px solid var(--glass-border)",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ×
            </button>
          </header>

          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            {isLoading ? (
              <ReaderLoading />
            ) : empty ? (
              <ReaderEmpty />
            ) : (
              <div
                data-testid="reader-scroll"
                style={{
                  position: "absolute",
                  inset: 0,
                  overflowY: "auto",
                }}
              >
                <div
                  style={{
                    maxWidth: 720,
                    margin: "0 auto",
                    padding: "36px 28px 96px",
                  }}
                >
                  {/* Interleaved prose + anchored scene cards. */}
                  {flow.segments.map((seg, i) => (
                    <Fragment key={i}>
                      {seg.markdown.trim() !== "" && (
                        <div
                          className="md-bubble"
                          style={{
                            fontSize: 16,
                            lineHeight: 1.75,
                            color: "var(--text)",
                          }}
                        >
                          <Markdown text={seg.markdown} workId={workId} />
                        </div>
                      )}
                      {seg.scenes.map((scene) => (
                        <ReaderSceneCard
                          key={scene.id}
                          scene={scene}
                          workId={workId}
                          assets={assets}
                          highlight={flashId === scene.id}
                          onEdit={() => onEditScene(scene.id)}
                        />
                      ))}
                    </Fragment>
                  ))}

                  {/* 分镜册 — scenes with no matching heading anchor. */}
                  {flow.trailing.length > 0 && (
                    <section data-testid="reader-storyboard-section">
                      <h3
                        style={{
                          margin: "36px 0 12px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "var(--text-dimmer)",
                        }}
                      >
                        {t("studio.scriptReader.storyboardSection")}
                      </h3>
                      {flow.trailing.map((scene) => (
                        <ReaderSceneCard
                          key={scene.id}
                          scene={scene}
                          workId={workId}
                          assets={assets}
                          highlight={flashId === scene.id}
                          onEdit={() => onEditScene(scene.id)}
                        />
                      ))}
                    </section>
                  )}
                </div>
              </div>
            )}

            {/* Right-edge mini-TOC — one 镜号 per scene, in reading order.
                Hidden while loading (the flow it indexes isn't shown yet). */}
            {!isLoading && flowScenes.length > 0 && (
              <MiniToc scenes={flowScenes} t={t} />
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

// ─── read-only scene card ────────────────────────────────────────────────────
//
// Mirrors the SceneGroupNode / SceneSummaryRow visual language (serif italic
// zero-padded 镜号, three-state status dot, multi-encoded stale badge, mono
// intent/shot chips) but is STRICTLY READ-ONLY: zero form controls, one "edit"
// button that hands off to the sidebar's editing surface.
function ReaderSceneCard({
  scene,
  workId,
  assets,
  highlight,
  onEdit,
}: {
  scene: Scene;
  workId: string;
  assets: AssetEntry[] | undefined;
  /** Brief ring after a ⤢ deep-link lands on this card. */
  highlight: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const shotNo = scene.order + 1;
  const status = scene.status;
  const isStale = status === "stale";
  const statusLabel = t(STATUS_KEY[status]);
  const statusColor = isStale ? "var(--status-warn, #fbbf24)" : "var(--accent)";
  const intentLabel = scene.intent ? t(INTENT_KEY[scene.intent]) : null;
  const shotLabel = scene.shotSize ? t(SHOT_KEY[scene.shotSize]) : null;

  // Resolve the selected take's thumbnail (image → <img>, video → muted <video>).
  const takeAsset =
    scene.selectedAssetId != null
      ? assets?.find((a) => a.id === scene.selectedAssetId)
      : undefined;
  const takeSrc =
    takeAsset && (takeAsset.kind === "image" || takeAsset.kind === "video")
      ? resolveAssetUrl(takeAsset.uri, workId)
      : null;

  return (
    <div
      data-testid="reader-scene-card"
      data-scene-id={scene.id}
      id={`reader-scene-${scene.id}`}
      style={{
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface-1)",
        padding: "14px 16px",
        margin: "18px 0",
        scrollMarginTop: 24,
        boxShadow: highlight ? "0 0 0 2px var(--accent-hi)" : "none",
        transition: "box-shadow 400ms ease",
      }}
    >
      {/* Title row: 镜号 · status · stale · title · edit. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{
            fontFamily: "var(--font-editorial)",
            fontStyle: "italic",
            fontSize: 22,
            lineHeight: 1,
            color: "var(--accent)",
            flexShrink: 0,
            minWidth: 28,
            fontFeatureSettings: '"tnum"',
          }}
        >
          {String(shotNo).padStart(2, "0")}
        </span>
        <span
          data-status={status}
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            flexShrink: 0,
            background: STATUS_FILLED[status] ? statusColor : "transparent",
            border: `1.5px solid ${statusColor}`,
          }}
        />
        {isStale && (
          <span
            data-testid="reader-stale-badge"
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
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span aria-hidden>⚠</span>
            {t("studio.scriptPanel.staleBadge")}
          </span>
        )}
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: "var(--text)",
            flex: 1,
            minWidth: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {scene.title}
        </span>
        <button
          type="button"
          data-bare
          data-testid="reader-edit-scene"
          onClick={onEdit}
          aria-label={t("studio.scriptReader.editScene", { n: shotNo })}
          title={t("studio.scriptReader.editScene", { n: shotNo })}
          style={{
            flexShrink: 0,
            padding: "3px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            background: "transparent",
            border: "1px solid var(--glass-border)",
            borderRadius: 6,
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
        >
          {t("studio.scriptReader.edit")}
        </button>
      </div>

      {/* Meta chips: intent · shot size. */}
      {(intentLabel || shotLabel) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.04em",
            color: "var(--text-dimmer)",
          }}
        >
          {intentLabel && <span data-testid="reader-intent">{intentLabel}</span>}
          {shotLabel && <span data-testid="reader-shot">{shotLabel}</span>}
        </div>
      )}

      {/* Selected take thumbnail. */}
      {takeSrc && (
        <div style={{ marginTop: 12 }}>
          {takeAsset?.kind === "video" ? (
            <video
              data-testid="reader-thumb"
              src={takeSrc}
              muted
              playsInline
              style={{
                width: "100%",
                maxHeight: 320,
                objectFit: "contain",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--glass-border)",
                background: "var(--surface-0)",
              }}
            />
          ) : (
            <img
              data-testid="reader-thumb"
              src={takeSrc}
              alt={scene.title}
              style={{
                width: "100%",
                maxHeight: 320,
                objectFit: "contain",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--glass-border)",
                background: "var(--surface-0)",
              }}
            />
          )}
        </div>
      )}

      {/* Narration (旁白/台词) + visual description — read-only, shown only when
          the Scene schema fields carry text. */}
      {scene.narration && scene.narration.trim() !== "" && (
        <ReaderField label={t("studio.scriptReader.narrationLabel")}>
          {scene.narration}
        </ReaderField>
      )}
      {scene.prompt && scene.prompt.trim() !== "" && (
        <ReaderField label={t("studio.scriptReader.descriptionLabel")}>
          {scene.prompt}
        </ReaderField>
      )}
    </div>
  );
}

function ReaderField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-dim)",
          whiteSpace: "pre-wrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── right-edge mini-TOC ─────────────────────────────────────────────────────
//
// A fixed vertical rail of 镜号 buttons. Clicking one scrolls its card into view;
// the card currently in the viewport highlights (IntersectionObserver, guarded so
// happy-dom / SSR without the API degrades to no-highlight rather than crashing).
function MiniToc({
  scenes,
  t,
}: {
  scenes: Scene[];
  t: ReturnType<typeof useT>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const id = (visible.target as HTMLElement).dataset.sceneId;
          if (id) setActiveId(id);
        }
      },
      { threshold: [0.25, 0.6] },
    );
    for (const scene of scenes) {
      const el = document.getElementById(`reader-scene-${scene.id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [scenes]);

  const jump = (sceneId: string) => {
    const el = document.getElementById(`reader-scene-${sceneId}`);
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  return (
    <nav
      data-testid="reader-toc"
      aria-label={t("studio.scriptReader.tocAria")}
      style={{
        position: "absolute",
        top: "50%",
        right: 14,
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: "80%",
        overflowY: "auto",
        padding: "6px 4px",
      }}
    >
      {scenes.map((scene) => {
        const shotNo = scene.order + 1;
        const active = activeId === scene.id;
        return (
          <button
            key={scene.id}
            type="button"
            data-bare
            data-testid="reader-toc-item"
            onClick={() => jump(scene.id)}
            aria-current={active ? "true" : undefined}
            aria-label={t("studio.scriptReader.tocItemAria", { n: shotNo })}
            style={{
              minWidth: 22,
              height: 18,
              padding: "0 5px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 5,
              border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {String(shotNo).padStart(2, "0")}
          </button>
        );
      })}
    </nav>
  );
}

// Lightweight in-flight placeholder while the reader self-loads the 剧本 (F1).
// Deliberately spare — a single mono line, no spinner — matching the editorial
// restraint of the rest of the reader.
function ReaderLoading() {
  const t = useT();
  return (
    <div
      data-testid="reader-loading"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        {t("studio.scriptReader.loading")}
      </div>
    </div>
  );
}

function ReaderEmpty() {
  const t = useT();
  return (
    <div
      data-testid="reader-empty"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div
          aria-hidden
          style={{
            fontFamily: "var(--font-editorial)",
            fontStyle: "italic",
            fontSize: 44,
            lineHeight: 1,
            color: "var(--text-dimmer)",
            marginBottom: 14,
          }}
        >
          ∅
        </div>
        <div
          style={{
            fontFamily: "var(--font-editorial)",
            fontStyle: "italic",
            fontSize: 20,
            letterSpacing: "-0.01em",
            color: "var(--text-dim)",
            marginBottom: 8,
          }}
        >
          {t("studio.scriptReader.emptyTitle")}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.7,
            color: "var(--text-dimmer)",
          }}
        >
          {t("studio.scriptReader.empty")}
        </div>
      </div>
    </div>
  );
}
