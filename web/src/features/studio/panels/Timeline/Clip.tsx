import { useState } from "react";
import { useComposition } from "../../store";
import { useClipResize } from "./hooks/useClipResize";
import { ContextMenu } from "@/components/ContextMenu";
import { useComposerDraft } from "@/stores/composerDraft";
import { describeClip } from "@/features/chat/describeElement";
import { resolveDragTargetTrack } from "./dnd";
import { useT } from "@/i18n/useT";
import styles from "./Clip.module.css";
import {
  replaceTimelineSelection,
  toggleTimelineSelection,
  unionTimelineSelection,
} from "./selectionMath";

export function Clip({
  clipId,
  pxPerSecond,
  trackKind,
  color: _color,
}: {
  clipId: string;
  pxPerSecond: number;
  trackKind: "video" | "audio" | "text" | "overlay";
  color: string;
}) {
  const clip = useComposition((s) =>
    s.comp?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId),
  );
  const selection = useComposition((s) => s.selection);
  const timelineSelection = useComposition((s) => s.timelineSelection);
  const setSelection = useComposition((s) => s.setSelection);
  const dragState = useComposition((s) => s.dragState);
  const beginDrag = useComposition((s) => s.beginDrag);
  const updateDragCandidate = useComposition((s) => s.updateDragCandidate);
  const updateDragTarget = useComposition((s) => s.updateDragTarget);
  const commitDrag = useComposition((s) => s.commitDrag);
  const cancelDrag = useComposition((s) => s.cancelDrag);
  // Phase 4.F — edge-drag resize hook. The hook is pointer-source agnostic;
  // we wire window-level pointermove/up/cancel/keydown listeners below so
  // resize works even when the cursor leaves the handle.
  const resize = useClipResize({ clipId, pxPerSecond });
  const t = useT();
  const inject = useComposerDraft((s) => s.inject);
  // #5 — right-click "加入聊天上下文" menu anchor (viewport coords), or null.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  if (!clip) return null;

  const dur = "duration" in clip ? clip.duration : clip.out - clip.in;
  // Phase 4.B — render the dragState preview position when the clip is
  // mid-drag (or being cascaded by another clip's drag). Falls back to the
  // committed trackOffset otherwise.
  const previewStart = dragState?.preview.get(clipId);
  const renderedOffset = previewStart ?? clip.trackOffset;
  const left = renderedOffset * pxPerSecond;
  const width = dur * pxPerSecond;
  const effectiveTimelineSelection =
    timelineSelection.primaryId === selection
      ? timelineSelection
      : replaceTimelineSelection(selection);
  const isSelected = effectiveTimelineSelection.ids.includes(clipId);
  const isDragging = dragState?.preview.has(clipId) ?? false;
  const presentationState = isDragging
    ? "dragging"
    : isSelected
      ? "selected"
      : focusVisible
        ? "focus-visible"
        : hovered
          ? "hover"
          : "normal";

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setSelection(clipId); // select so the viewer-context envelope carries this clip's id
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Only the primary (left) button starts a drag — right/middle click is for
    // the context menu, and without this guard a right-click would also kick
    // off the body-drag pipeline and move the clip.
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const store = useComposition.getState();
    if (e.metaKey || e.ctrlKey) {
      store.setTimelineSelection(
        toggleTimelineSelection(effectiveTimelineSelection, clipId),
      );
    } else if (e.shiftKey) {
      store.setTimelineSelection(
        unionTimelineSelection(effectiveTimelineSelection, [clipId], clipId),
      );
    } else if (
      effectiveTimelineSelection.ids.length > 1 &&
      effectiveTimelineSelection.ids.includes(clipId)
    ) {
      // Pointer-down on any member of an existing group keeps the group
      // intact and promotes the grabbed member to primary. beginDrag below
      // can then build one relative-offset preview for the entire selection.
      store.setTimelineSelection({
        ...effectiveTimelineSelection,
        primaryId: clipId,
      });
    } else {
      setSelection(clipId);
    }
    beginDrag(clipId);
    const startX = e.clientX;
    const startOffset = clip.trackOffset;
    // #3 — the clip's source track id, resolved once at drag-start. The
    // cross-track move target is computed against this on every pointermove.
    const comp = useComposition.getState().comp;
    const sourceTrackId =
      comp?.tracks.find((tr) => tr.clips.some((c) => c.id === clipId))?.id ??
      null;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / pxPerSecond;
      const raw = Math.max(0, startOffset + delta);
      updateDragCandidate(raw, pxPerSecond);
      // #3 — track-aware: find the lane under the cursor (vertical axis) and
      // retarget the clip there when it's a different SAME-KIND lane. The lane
      // div carries `data-track-id` (Track.tsx); hovering the label column or
      // outside any lane → closest() returns null → no target. The pure
      // resolver re-applies the #88 kind guard so a cross-kind lane is a no-op.
      const tracks =
        useComposition.getState().comp?.tracks.map((tr) => ({
          id: tr.id,
          kind: tr.kind,
        })) ?? [];
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const hoveredTrackId =
        under?.closest("[data-track-id]")?.getAttribute("data-track-id") ??
        null;
      updateDragTarget(
        resolveDragTargetTrack(tracks, sourceTrackId, hoveredTrackId),
      );
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc);
    };
    const up = () => {
      cleanup();
      commitDrag();
    };
    const cancel = () => {
      cleanup();
      cancelDrag();
    };
    const esc = (kev: KeyboardEvent) => {
      if (kev.key === "Escape") {
        cleanup();
        cancelDrag();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc);
  };

  // Phase 4.F — handles. `stopPropagation` prevents the body-drag pipeline
  // (4.B) from also firing on edge pointerdown. Window-level listeners live
  // for the duration of one drag and are torn down on pointerup/cancel.
  const onHandleDown = (edge: "left" | "right") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    resize.beginResize(edge, e.clientX);
    const move = (ev: PointerEvent) => resize.dragResize(ev.clientX);
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
    const up = () => {
      cleanup();
      resize.endResize();
    };
    const cancel = () => {
      cleanup();
      resize.cancelResize();
    };
    const key = (kev: KeyboardEvent) => {
      if (kev.key === "Escape") {
        cleanup();
        resize.cancelResize();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  };

  const label =
    clip.kind === "text"
      ? clip.text.slice(0, 24)
      : clip.kind === "video" || clip.kind === "audio"
      ? clip.src.split("/").pop()?.replace(/\.[^.]+$/, "").slice(0, 18) ?? clipId
      : clipId;

  return (
    <>
    <div
      className={`timeline-clip ${clip.kind} ${styles.clip}`}
      data-clip-id={clipId}
      data-kind={trackKind}
      data-state={presentationState}
      tabIndex={0}
      style={{
        left,
        width: Math.max(width, 24),
      }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusVisible(true)}
      onBlur={() => setFocusVisible(false)}
    >
      {/* R47-fix4: text clips skip the duration sub-label. Text track is
          a compact 44px row, and showing both "2.3s" + the actual subtitle
          forced overflow that cropped the text mid-line. Duration is
          already visible in the timeline header bar; for text the
          subtitle content is what matters. Video / audio still show it
          since the underlying media isn't readable from thumbnails. */}
      {trackKind === "text" ? (
        <div className={styles.captionContent}>
          <span className={styles.ccBadge}>CC</span>
          <span className={styles.captionLabel}>{label}</span>
        </div>
      ) : (
        <div className={styles.mediaContent}>
          <span className={styles.duration}>{dur.toFixed(1)}s</span>
          <span className={styles.label}>{label}</span>
        </div>
      )}
      {/* #3 — cross-track move now lives on the clip BODY (CapCut/剪映/Premiere
          style): a vertical body-drag over a different same-kind lane retargets
          the clip via `resolveDragTargetTrack` + `updateDragTarget`, committed
          by `commitDrag`. The old dedicated native-DnD grip (I20) was removed —
          the body owns both horizontal scrub and cross-track move through one
          pointer pipeline, matching every mainstream NLE. Library→timeline
          asset DnD still rides native HTML5 DnD via dnd.ts (unchanged). */}
      <div
        data-testid="resize-left"
        aria-label={t("studio.timeline.trimLeftAria")}
        className={`${styles.resizeHandle} ${styles.resizeLeft}`}
        onPointerDown={onHandleDown("left")}
      >
        <span data-trim-rail aria-hidden="true" className={styles.trimRail} />
      </div>
      <div
        data-testid="resize-right"
        aria-label={t("studio.timeline.trimRightAria")}
        className={`${styles.resizeHandle} ${styles.resizeRight}`}
        onPointerDown={onHandleDown("right")}
      >
        <span data-trim-rail aria-hidden="true" className={styles.trimRail} />
      </div>
    </div>
      {resize.sourceGhost && (
        <div
          data-testid="source-ghost"
          aria-hidden="true"
          className={styles.sourceGhost}
          style={{
            left: resize.sourceGhost.startSec * pxPerSecond,
            width:
              (resize.sourceGhost.endSec - resize.sourceGhost.startSec) *
              pxPerSecond,
          }}
        />
      )}
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          ariaLabel={t("chat.addToContext.menuAria")}
          items={[
            {
              label: t("chat.addToContext.add"),
              onSelect: () =>
                inject(
                  describeClip(clip, {
                    video: t("chat.addToContext.clip.video"),
                    audio: t("chat.addToContext.clip.audio"),
                    text: t("chat.addToContext.clip.text"),
                    overlay: t("chat.addToContext.clip.overlay"),
                  }),
                ),
            },
          ]}
        />
      )}
    </>
  );
}
