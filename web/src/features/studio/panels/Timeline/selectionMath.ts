export interface TimelineSelection {
  ids: string[];
  primaryId: string | null;
  anchorId: string | null;
}

export interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ClipBounds extends RectBounds {
  id: string;
  trackId: string;
}

export interface GroupMoveItem {
  id: string;
  trackId: string;
  start: number;
}

export function clearTimelineSelection(): TimelineSelection {
  return { ids: [], primaryId: null, anchorId: null };
}

export function replaceTimelineSelection(
  id: string | null,
): TimelineSelection {
  return id == null
    ? clearTimelineSelection()
    : { ids: [id], primaryId: id, anchorId: id };
}

export function toggleTimelineSelection(
  current: TimelineSelection,
  id: string,
): TimelineSelection {
  if (!current.ids.includes(id)) {
    const ids = [...current.ids, id];
    return {
      ids,
      primaryId: id,
      anchorId: current.anchorId && ids.includes(current.anchorId)
        ? current.anchorId
        : (current.primaryId ?? id),
    };
  }

  const ids = current.ids.filter((selectedId) => selectedId !== id);
  if (ids.length === 0) return clearTimelineSelection();
  const primaryId =
    current.primaryId && ids.includes(current.primaryId)
      ? current.primaryId
      : ids[0];
  const anchorId =
    current.anchorId && ids.includes(current.anchorId)
      ? current.anchorId
      : primaryId;
  return { ids, primaryId, anchorId };
}

export function unionTimelineSelection(
  current: TimelineSelection,
  incomingIds: Iterable<string>,
  preferredPrimaryId?: string | null,
): TimelineSelection {
  const ids = [...current.ids];
  for (const id of incomingIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return clearTimelineSelection();

  const primaryId =
    preferredPrimaryId && ids.includes(preferredPrimaryId)
      ? preferredPrimaryId
      : current.primaryId && ids.includes(current.primaryId)
        ? current.primaryId
        : ids[0];
  const anchorId =
    current.anchorId && ids.includes(current.anchorId)
      ? current.anchorId
      : primaryId;
  return { ids, primaryId, anchorId };
}

export function intersectingClipIds(
  clips: readonly ClipBounds[],
  marquee: RectBounds,
): string[] {
  const left = Math.min(marquee.left, marquee.right);
  const right = Math.max(marquee.left, marquee.right);
  const top = Math.min(marquee.top, marquee.bottom);
  const bottom = Math.max(marquee.top, marquee.bottom);
  return clips
    .filter(
      (clip) =>
        clip.right >= left &&
        clip.left <= right &&
        clip.bottom >= top &&
        clip.top <= bottom,
    )
    .map((clip) => clip.id);
}

export function reconcileTimelineSelection(
  current: TimelineSelection,
  existingIds: ReadonlySet<string>,
): TimelineSelection {
  const ids = current.ids.filter((id) => existingIds.has(id));
  if (ids.length === 0) return clearTimelineSelection();
  const primaryId =
    current.primaryId && existingIds.has(current.primaryId)
      ? current.primaryId
      : ids[0];
  const anchorId =
    current.anchorId && existingIds.has(current.anchorId)
      ? current.anchorId
      : primaryId;
  return { ids, primaryId, anchorId };
}

export function computeGroupMoveOffsets(
  items: readonly GroupMoveItem[],
  primaryId: string,
  nextPrimaryStart: number,
): Map<string, number> {
  const primary = items.find((item) => item.id === primaryId);
  if (!primary || items.length === 0) return new Map();

  const delta = nextPrimaryStart - primary.start;
  const earliest = Math.min(...items.map((item) => item.start + delta));
  const timelineCorrection = earliest < 0 ? -earliest : 0;
  return new Map(
    items.map((item) => [
      item.id,
      item.start + delta + timelineCorrection,
    ]),
  );
}
