import type { AssetEntry, Clip, Composition, ProvenanceEdge, Track, VideoClip, AudioClip, TextClip, OverlayClip } from "../features/studio/types";
import { makeEmptyComposition } from "../features/studio/types";

const baseTransform = { scale: 1, x: 0, y: 0, rotation: 0 };
const baseFilters = { brightness: 0, contrast: 0, saturation: 0 };

export function makeVideoClip(over: Partial<VideoClip> & Pick<VideoClip, "id">): VideoClip {
  return {
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 2,
    trackOffset: 0,
    transforms: baseTransform,
    filters: baseFilters,
    ...over,
  } as VideoClip;
}

export function makeAudioClip(over: Partial<AudioClip> & Pick<AudioClip, "id">): AudioClip {
  return {
    kind: "audio",
    src: "/a.mp3",
    in: 0,
    out: 4,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
    ...over,
  } as AudioClip;
}

export function makeTextClip(over: Partial<TextClip> & Pick<TextClip, "id">): TextClip {
  return {
    kind: "text",
    text: "hello",
    trackOffset: 0,
    duration: 2,
    style: { font: "Inter", size: 64, weight: 700, italic: false, tracking: 0, color: "#fff" },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
    ...over,
  } as TextClip;
}

export function makeOverlayClip(over: Partial<OverlayClip> & Pick<OverlayClip, "id">): OverlayClip {
  return {
    kind: "overlay",
    src: "/o.png",
    trackOffset: 0,
    duration: 2,
    position: { xPct: 50, yPct: 50, wPct: 20, hPct: 20 },
    opacity: 1,
    ...over,
  } as OverlayClip;
}

export function makeCompositionWithClips(clips: Clip[], opts: { workId?: string } = {}): Composition {
  const c = makeEmptyComposition({ workId: opts.workId ?? "w" });
  // First track in makeEmptyComposition is the video track.
  c.tracks[0].clips.push(...(clips as VideoClip[]));
  c.duration = Math.max(
    0,
    ...clips.map((cl) =>
      cl.kind === "video" || cl.kind === "audio"
        ? cl.trackOffset + (cl.out - cl.in)
        : cl.trackOffset + cl.duration,
    ),
  );
  return c;
}

export function threeClipVideoTrack(): { track: Track; clips: VideoClip[] } {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
  const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
  const d = makeVideoClip({ id: "d", trackOffset: 5, in: 0, out: 1 });
  const track: Track = {
    id: "track-video",
    kind: "video",
    label: "Video",
    displayOrder: 0,
    volume: 0,
    muted: false,
    hidden: false,
    transitions: [],
    clips: [a, b, d],
  };
  return { track, clips: [a, b, d] };
}

export function makeAssetEntry(
  over: Partial<AssetEntry> & Pick<AssetEntry, "id">,
): AssetEntry {
  return {
    uri: `/assets/${over.id}.png`,
    kind: "image",
    metadata: {},
    status: "ready",
    ...over,
  };
}

export function makeProvenanceEdge(
  over: Partial<ProvenanceEdge> & Pick<ProvenanceEdge, "toAssetId">,
): ProvenanceEdge {
  return {
    fromAssetId: null,
    operation: {
      type: "upload",
      actor: "user",
      timestamp: "2026-05-06T00:00:00Z",
      params: {},
    },
    ...over,
  };
}

/**
 * Build a Composition pre-populated with an asset graph.
 * `edges` is an array of [fromAssetId, toAssetId] pairs; assets without an
 * incoming edge are roots (fromAssetId === null in the resulting edge).
 *
 * Example: makeAssetGraph({ ids: ["a", "b", "c"], edges: [["a", "b"], ["a", "c"]] })
 *   → assets: [a, b, c]; provenance: [{to:a, from:null}, {to:b, from:a}, {to:c, from:a}]
 */
export function makeAssetGraph(opts: {
  ids: string[];
  edges?: Array<[string, string]>;
  workId?: string;
  /**
   * Per-id overrides applied on top of makeAssetEntry's defaults.
   * Example: { b: { kind: "audio", uri: "/b.mp3" } } → asset b is an audio
   * file at /b.mp3 instead of an image at /assets/b.png.
   */
  overrides?: Record<string, Partial<AssetEntry>>;
}): Composition {
  const c = makeEmptyComposition({ workId: opts.workId ?? "w" });
  const childToParent = new Map<string, string>();
  for (const [from, to] of opts.edges ?? []) childToParent.set(to, from);

  c.assets = opts.ids.map((id) =>
    makeAssetEntry({ id, ...(opts.overrides?.[id] ?? {}) }),
  );
  c.provenance = opts.ids.map((id) =>
    makeProvenanceEdge({ toAssetId: id, fromAssetId: childToParent.get(id) ?? null }),
  );
  return c;
}
