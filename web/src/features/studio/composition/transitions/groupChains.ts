// #54 Phase 1 — group a track's clips into transition CHAINS for rendering.
// A chain is a run of chronologically-adjacent clips connected by transitions:
// a clip with no outgoing transition becomes a length-1 chain (renders as a
// plain <Sequence>, preserving back-compat); a clip with an outgoing
// transition extends the current chain, which renders as a single
// <TransitionSeries> with .Sequence + .Transition interleaved.
//
// Pure & Konva/Remotion-free so it can be unit-tested without React.

import type { VideoClip, Transition } from "../../types";

export interface TransitionChain {
  /** Clips in chronological order (sorted by trackOffset). Length ≥ 1. */
  clips: VideoClip[];
  /** Transitions BETWEEN consecutive clips. transitions[i] sits between
   *  clips[i] and clips[i+1]. Length = clips.length - 1. */
  transitions: Transition[];
}

/**
 * Group a track's clips into transition chains. A transition links clips[i]
 * (where `afterClipId === clips[i].id`) to clips[i+1] — the chronological
 * next clip. Standalone clips form length-1 chains.
 */
export function groupChains(
  clips: VideoClip[],
  transitions: Transition[],
): TransitionChain[] {
  if (clips.length === 0) return [];
  const sorted = [...clips].sort((a, b) => a.trackOffset - b.trackOffset);
  const txByAfter = new Map<string, Transition>();
  for (const t of transitions) txByAfter.set(t.afterClipId, t);

  const chains: TransitionChain[] = [];
  let i = 0;
  while (i < sorted.length) {
    const chain: TransitionChain = { clips: [sorted[i]], transitions: [] };
    while (i < sorted.length - 1 && txByAfter.has(sorted[i].id)) {
      chain.transitions.push(txByAfter.get(sorted[i].id)!);
      chain.clips.push(sorted[i + 1]);
      i++;
    }
    chains.push(chain);
    i++;
  }
  return chains;
}
