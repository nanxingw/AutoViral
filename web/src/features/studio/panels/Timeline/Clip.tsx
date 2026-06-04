import { useState } from "react";
import { useComposition } from "../../store";
import { useClipResize } from "./hooks/useClipResize";
import { ContextMenu } from "@/components/ContextMenu";
import { useComposerDraft } from "@/stores/composerDraft";
import { describeClip } from "@/features/chat/describeElement";
import { resolveDragTargetTrack } from "./dnd";
import { useT } from "@/i18n/useT";
import clsx from "clsx";

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
  if (!clip) return null;

  const dur = "duration" in clip ? clip.duration : clip.out - clip.in;
  // Phase 4.B — render the dragState preview position when the clip is
  // mid-drag (or being cascaded by another clip's drag). Falls back to the
  // committed trackOffset otherwise.
  const previewStart = dragState?.preview.get(clipId);
  const renderedOffset = previewStart ?? clip.trackOffset;
  const left = renderedOffset * pxPerSecond;
  const width = dur * pxPerSecond;
  const isSelected = selection === clipId;
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

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
    setSelection(clipId);
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
      updateDragCandidate(raw);
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

  let background: string;
  let borderColor: string;
  let fg: string;
  let fgDim: string;

  if (trackKind === "video") {
    // Bug 2 fix: video clip body must be transparent so the Filmstrip
    // (rendered beneath in Track.tsx) shows through. Pneuma's VideoTrack
    // (.cache/pneuma-clipcraft/.../timeline/VideoTrack.tsx:158-179) uses
    // the same pattern — the clip frame is just a border + label, the
    // thumbnails carry the visual identity. Selected state still adds a
    // subtle accent tint so the active clip is distinguishable.
    background = isSelected
      ? isLight
        ? "rgba(42,58,74,0.10)"
        : "rgba(168,197,214,0.12)"
      : "transparent";
    borderColor = "rgba(128,128,128,0.18)";
    fg = isLight ? "rgba(15,24,34,0.92)" : "rgba(255,255,255,0.95)";
    fgDim = isLight ? "rgba(15,24,34,0.55)" : "rgba(255,255,255,0.7)";
  } else if (trackKind === "audio") {
    background = "linear-gradient(90deg, rgba(192,132,252,0.15), rgba(192,132,252,0.1))";
    borderColor = "rgba(192,132,252,0.25)";
    fg = "#c084fc";
    fgDim = "rgba(192,132,252,0.6)";
  } else if (trackKind === "text") {
    background = "var(--glass-hi)";
    borderColor = "var(--glass-border)";
    fg = "var(--text)";
    fgDim = "var(--text-dim)";
  } else {
    background = "rgba(125,211,252,0.12)";
    borderColor = "rgba(125,211,252,0.25)";
    fg = "#7dd3fc";
    fgDim = "rgba(125,211,252,0.6)";
  }

  if (isSelected) {
    borderColor = "var(--accent)";
  }

  return (
    <>
    <div
      className={clsx("timeline-clip", clip.kind, isSelected && "selected")}
      style={{
        position: "absolute",
        left,
        width: Math.max(width, 24),
        top: 4,
        bottom: 4,
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        padding: "4px 6px",
        cursor: "grab",
        overflow: "hidden",
        boxShadow: isSelected ? "0 0 12px var(--accent-glow)" : "none",
        transition: "box-shadow 0.15s",
      }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      {/* R47-fix4: text clips skip the duration sub-label. Text track is
          a compact 44px row, and showing both "2.3s" + the actual subtitle
          forced overflow that cropped the text mid-line. Duration is
          already visible in the timeline header bar; for text the
          subtitle content is what matters. Video / audio still show it
          since the underlying media isn't readable from thumbnails. */}
      {trackKind !== "text" && (
        <div
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: fgDim,
            letterSpacing: "0.06em",
            // Bug 2 follow-up: video clips no longer have an opaque background
            // (the filmstrip is shown beneath), so labels need a soft shadow to
            // stay legible over thumbnails.
            textShadow:
              trackKind === "video" ? "0 1px 2px rgba(0,0,0,0.6)" : undefined,
          }}
        >
          {dur.toFixed(1)}s
        </div>
      )}
      <div
        style={{
          fontSize: 10,
          color: fg,
          fontWeight: 500,
          marginTop: 2,
          letterSpacing: "-0.01em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textShadow:
            trackKind === "video" ? "0 1px 2px rgba(0,0,0,0.6)" : undefined,
        }}
      >
        {label}
      </div>
      {/* #3 — cross-track move now lives on the clip BODY (CapCut/剪映/Premiere
          style): a vertical body-drag over a different same-kind lane retargets
          the clip via `resolveDragTargetTrack` + `updateDragTarget`, committed
          by `commitDrag`. The old dedicated native-DnD grip (I20) was removed —
          the body owns both horizontal scrub and cross-track move through one
          pointer pipeline, matching every mainstream NLE. Library→timeline
          asset DnD still rides native HTML5 DnD via dnd.ts (unchanged). */}
      <div
        data-testid="resize-left"
        onPointerDown={onHandleDown("left")}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -4,
          width: 8,
          cursor: "ew-resize",
          zIndex: 5,
        }}
      />
      <div
        data-testid="resize-right"
        onPointerDown={onHandleDown("right")}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: -4,
          width: 8,
          cursor: "ew-resize",
          zIndex: 5,
        }}
      />
    </div>
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
