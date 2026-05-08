import type { Composition } from "../types";

/**
 * Build a `<viewer-context>` block summarising the studio's current
 * selection, playhead, and composition shape. Prepended to outgoing chat
 * messages so the agent can ground "this clip" / "here" without asking.
 *
 * Pneuma clipcraft does the same via ModeManifest.extractContext — see
 * `.cache/pneuma-clipcraft/modes/clipcraft/pneuma-mode.ts:17`.
 */
export function buildStudioViewerContext(
  comp: Composition | null,
  selection: string | null,
  currentFrame: number,
): string | null {
  if (!comp) return null;

  const sec = (currentFrame / comp.fps).toFixed(2);
  const lines: string[] = [];
  lines.push(`mode: short-video-studio`);
  lines.push(
    `composition: ${comp.width}×${comp.height}, ${comp.fps}fps, ${comp.duration.toFixed(2)}s, aspect=${comp.aspect}`,
  );
  lines.push(
    `playhead: frame=${currentFrame}, time=${sec}s/${comp.duration.toFixed(2)}s`,
  );

  if (selection) {
    let kind = "unknown";
    let trackKind = "unknown";
    for (const t of comp.tracks) {
      const c = t.clips.find((c) => c.id === selection);
      if (c) {
        kind = c.kind;
        trackKind = t.kind;
        break;
      }
    }
    lines.push(
      `selectedClip: id=${selection}, kind=${kind}, track=${trackKind}`,
    );
  } else {
    lines.push(`selectedClip: <none>`);
  }

  const trackSummary = comp.tracks
    .map((t) => `${t.kind}(${t.clips.length})`)
    .join(", ");
  lines.push(`tracks: ${trackSummary}`);

  return `<viewer-context mode="short-video-studio">\n${lines.join("\n")}\n</viewer-context>`;
}
