// PRD-0014 S9 — caption script-alignment core.
//
// `alignScriptLines` takes ASR WORD-level timing + the GROUND-TRUTH script text
// and produces caption LINES whose text is the script truth (never the ASR's
// mis-heard words) while the timing rides the ASR anchors. The alignment is a
// COARSE, LCS-level anchoring (longest-common-subsequence over matchable atoms)
// — deliberately NOT a per-word forced alignment that would snap every script
// char to the ASR's wrong word boundaries. Where the ASR agrees with the script
// we anchor exactly; where it disagreed (mis-heard / hallucinated words) we
// linearly interpolate between the nearest anchors. Line-level timing is what we
// promise; sub-word precision is not.
//
// CJK lines are split at a `maxCjkChars` cap, breaking at punctuation and
// word (space-delimited) group boundaries so a word is never severed.
//
// Pure: no ASR, no I/O, no zod. Callers own transcription + persistence.

import type { CaptionModel, CaptionGroupStyle } from "../shared/composition.js";

export interface AsrWord {
  start: number;
  end: number;
  text: string;
}

// A single matchable atom (one CJK char / one latin word) with its own timing +
// the verbatim ground-truth text (adjacent punctuation attached). This is the
// per-word granularity the CaptionModel's `segments` half promises (CONTEXT.md:
// "immutable per-word segments"), so the overlay renderer can highlight word by
// word and the caption can be regrouped without re-running ASR.
export interface CaptionAtom {
  start: number;
  end: number;
  text: string;
  latin: boolean;
}

export interface CaptionLine {
  start: number;
  end: number;
  text: string;
  // The per-word atoms that make up this line (in reading order). Populated by
  // alignScriptLines; consumed by buildCaptionModelFromLines to emit per-word
  // segments. Optional so a hand-built {start,end,text} line still works.
  atoms?: CaptionAtom[];
}

// CJK ideographs + kana. A single such char is one matchable atom and counts 1
// toward the maxCjkChars cap.
const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ]/;
// Latin/digit run — one matchable atom.
const WORD_RE = /[A-Za-z0-9'À-ɏ]/;
// Terminal punctuation forces a hard line break after it.
const TERMINAL_RE = /[。！？!?…]/;
// Pause punctuation is a preferred break point (break after).
const PAUSE_RE = /[，、；：,;:]/;
// Opening punctuation attaches FORWARD to the next atom (leading quotes /
// brackets), everything else attaches BACK to the preceding atom. This is how
// we keep the ground truth byte-faithful without severing a matchable atom.
const OPENING_RE = /[「『（【〈《“‘"'([{]/;

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch);
}

// ─── Tokenisation ──────────────────────────────────────────────────────────

interface ScriptUnit {
  kind: "atom" | "space" | "punct";
  text: string; // the literal source slice (kept verbatim in output)
  norm?: string; // match key (atoms only)
  cjk?: boolean;
  terminal?: boolean; // punct only
  pause?: boolean; // punct only
}

// Break the script into ordered units, preserving punctuation + whitespace so
// the output line text is byte-faithful to the ground truth.
function tokenizeScript(text: string): ScriptUnit[] {
  const units: ScriptUnit[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      units.push({ kind: "space", text: ch });
      i++;
      continue;
    }
    if (isCjk(ch)) {
      units.push({ kind: "atom", text: ch, norm: ch, cjk: true });
      i++;
      continue;
    }
    if (WORD_RE.test(ch)) {
      let j = i;
      while (j < text.length && WORD_RE.test(text[j]!)) j++;
      const w = text.slice(i, j);
      units.push({ kind: "atom", text: w, norm: w.toLowerCase(), cjk: false });
      i = j;
      continue;
    }
    // Punctuation / symbol.
    units.push({
      kind: "punct",
      text: ch,
      terminal: TERMINAL_RE.test(ch),
      pause: PAUSE_RE.test(ch),
    });
    i++;
  }
  return units;
}

interface AsrAtom {
  norm: string;
  start: number;
  end: number;
}

// Flatten ASR words into matchable atoms with per-atom timing. A multi-char CJK
// word (word_timestamps can still hand back a 2-char token) is sliced evenly
// across its span; a latin word is one atom carrying the whole span.
function asrAtoms(words: AsrWord[]): AsrAtom[] {
  const atoms: AsrAtom[] = [];
  for (const w of words) {
    const start = Number(w.start);
    const end = Number(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const sub: string[] = [];
    let i = 0;
    const t = String(w.text ?? "");
    while (i < t.length) {
      const ch = t[i]!;
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (isCjk(ch)) {
        sub.push(ch);
        i++;
        continue;
      }
      if (WORD_RE.test(ch)) {
        let j = i;
        while (j < t.length && WORD_RE.test(t[j]!)) j++;
        sub.push(t.slice(i, j));
        i = j;
        continue;
      }
      i++; // skip punctuation inside an ASR token
    }
    if (sub.length === 0) continue;
    const span = Math.max(0, end - start);
    for (let k = 0; k < sub.length; k++) {
      atoms.push({
        norm: sub[k]!.toLowerCase(),
        start: start + (span * k) / sub.length,
        end: start + (span * (k + 1)) / sub.length,
      });
    }
  }
  return atoms;
}

// ─── LCS anchoring ───────────────────────────────────────────────────────────

// Longest common subsequence between the ASR atom stream and the script's
// matchable atoms. Returns anchor pairs {a, s} (indices into each stream) in
// increasing order — the coarse anchors we hang timing off of.
function lcsAnchors(asr: AsrAtom[], scriptNorms: string[]): Array<{ a: number; s: number }> {
  const n = asr.length;
  const m = scriptNorms.length;
  if (n === 0 || m === 0) return [];
  // DP table of LCS lengths.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--) {
    for (let s = m - 1; s >= 0; s--) {
      dp[a]![s] = asr[a]!.norm === scriptNorms[s]
        ? dp[a + 1]![s + 1]! + 1
        : Math.max(dp[a + 1]![s]!, dp[a]![s + 1]!);
    }
  }
  const anchors: Array<{ a: number; s: number }> = [];
  let a = 0;
  let s = 0;
  while (a < n && s < m) {
    if (asr[a]!.norm === scriptNorms[s]) {
      anchors.push({ a, s });
      a++;
      s++;
    } else if (dp[a + 1]![s]! >= dp[a]![s + 1]!) {
      a++;
    } else {
      s++;
    }
  }
  return anchors;
}

// Given the anchors, assign a {start,end} to EVERY matchable script atom.
// Anchored atoms take their ASR atom's timing; unanchored runs are linearly
// interpolated between neighbours (leading/trailing runs extrapolate by the
// mean anchored atom duration).
function timeScriptAtoms(
  asr: AsrAtom[],
  matchCount: number,
  anchors: Array<{ a: number; s: number }>,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = new Array(matchCount);
  if (matchCount === 0) return out;
  if (anchors.length === 0) {
    // No anchors at all — spread evenly across the whole ASR span.
    const t0 = asr.length ? asr[0]!.start : 0;
    const t1 = asr.length ? asr[asr.length - 1]!.end : matchCount;
    const step = (t1 - t0) / matchCount;
    for (let s = 0; s < matchCount; s++) {
      out[s] = { start: t0 + step * s, end: t0 + step * (s + 1) };
    }
    return out;
  }
  // 1) Anchored atoms get exact ASR timing.
  for (const { a, s } of anchors) {
    out[s] = { start: asr[a]!.start, end: asr[a]!.end };
  }
  const avg =
    anchors.reduce((sum, { a }) => sum + Math.max(0, asr[a]!.end - asr[a]!.start), 0) /
      anchors.length || 0.3;

  // 2) Interior gaps: linear interpolation between the surrounding anchors.
  for (let i = 0; i < anchors.length - 1; i++) {
    const sa = anchors[i]!.s;
    const sb = anchors[i + 1]!.s;
    const count = sb - sa - 1;
    if (count <= 0) continue;
    const gapStart = out[sa]!.end;
    const gapEnd = out[sb]!.start;
    const span = Math.max(0, gapEnd - gapStart);
    for (let k = 1; k <= count; k++) {
      const f0 = (k - 1) / count;
      const f1 = k / count;
      out[sa + k] = { start: gapStart + span * f0, end: gapStart + span * f1 };
    }
  }
  // 3) Leading run before the first anchor.
  const first = anchors[0]!.s;
  for (let s = first - 1; s >= 0; s--) {
    const end = out[s + 1]!.start;
    out[s] = { start: Math.max(0, end - avg), end };
  }
  // 4) Trailing run after the last anchor.
  const last = anchors[anchors.length - 1]!.s;
  for (let s = last + 1; s < matchCount; s++) {
    const start = out[s - 1]!.end;
    out[s] = { start, end: start + avg };
  }
  return out;
}

// ─── Line splitting ──────────────────────────────────────────────────────────

interface PendingLine {
  text: string;
  matchIdxs: number[];
  cjk: number;
}

// A "word" = a run of matchable atoms NOT separated by whitespace, with any
// trailing punctuation attached. Words are the unit we pack lines out of, so a
// cap-break never severs a word group ('不断词组边界').
interface Word {
  text: string;
  matchIdxs: number[];
  cjk: number;
  latinStart: boolean;
  latinEnd: boolean;
  forceBreakAfter: boolean; // terminal / pause punctuation trailed this word
}

function buildWords(units: ScriptUnit[]): Word[] {
  const words: Word[] = [];
  let cur: Word | null = null;
  let matchCursor = 0;
  const push = () => {
    if (cur && cur.matchIdxs.length > 0) words.push(cur);
    cur = null;
  };
  for (const u of units) {
    if (u.kind === "atom") {
      if (!cur) {
        cur = {
          text: "",
          matchIdxs: [],
          cjk: 0,
          latinStart: !u.cjk,
          latinEnd: !u.cjk,
          forceBreakAfter: false,
        };
      }
      cur.text += u.text;
      cur.matchIdxs.push(matchCursor);
      cur.cjk += 1;
      cur.latinEnd = !u.cjk;
      matchCursor++;
    } else if (u.kind === "punct") {
      if (cur) {
        cur.text += u.text;
        cur.latinEnd = false;
        if (u.terminal || u.pause) {
          cur.forceBreakAfter = true;
          push();
        }
      }
      // Punctuation with no preceding word (leading punct) is dropped.
    } else {
      // Whitespace ends the current word (word boundary).
      push();
    }
  }
  push();
  return words;
}

// Greedily pack whole words into lines up to the maxCjkChars cap. A word that
// alone exceeds the cap (a long unspaced CJK run) is the only case we hard-split
// — otherwise breaks always land on word boundaries. `matchIdxs` records which
// matchable-atom indices landed in each line so we can read their timing.
function splitLines(units: ScriptUnit[], maxCjkChars: number): PendingLine[] {
  const words = buildWords(units);
  const lines: PendingLine[] = [];
  let cur: PendingLine = { text: "", matchIdxs: [], cjk: 0 };
  let curLatinEnd = false;

  const flush = () => {
    if (cur.matchIdxs.length > 0) lines.push({ ...cur, text: cur.text.trim() });
    cur = { text: "", matchIdxs: [], cjk: 0 };
    curLatinEnd = false;
  };

  for (const word of words) {
    // A single over-cap word (unspaced CJK run) — hard-split it at the cap.
    if (word.cjk > maxCjkChars) {
      flush();
      // Split the word's atoms into cap-sized chunks. Re-derive char slices from
      // the CJK text (latin words never exceed the cap in practice).
      const chars = [...word.text];
      let idxCursor = 0;
      for (let start = 0; start < word.matchIdxs.length; start += maxCjkChars) {
        const slice = word.matchIdxs.slice(start, start + maxCjkChars);
        const textSlice = chars.slice(idxCursor, idxCursor + slice.length).join("");
        idxCursor += slice.length;
        lines.push({ text: textSlice, matchIdxs: slice, cjk: slice.length });
      }
      continue;
    }
    // Would overflow → break BEFORE this word.
    if (cur.cjk + word.cjk > maxCjkChars && cur.matchIdxs.length > 0) flush();
    // Latin readability: keep a space between two latin words.
    if (curLatinEnd && word.latinStart) cur.text += " ";
    cur.text += word.text;
    cur.matchIdxs.push(...word.matchIdxs);
    cur.cjk += word.cjk;
    curLatinEnd = word.latinEnd;
    if (word.forceBreakAfter) flush();
  }
  flush();
  return lines;
}

// Build the verbatim display text for EACH matchable atom (parallel to the
// atom stream), attaching adjacent punctuation so nothing in the ground truth
// is dropped: an OPENING punct (leading quote / bracket) prepends to the NEXT
// atom; any other punct (terminal / pause / closing quote) appends to the
// PRECEDING atom. A closing punct that somehow precedes the first atom is
// buffered forward too. This replaces the old buildWords path that silently
// dropped leading punctuation and truncated a hard-split line's trailing
// terminal punctuation (S9 review findings #4).
function atomDisplayTexts(units: ScriptUnit[]): string[] {
  const texts: string[] = [];
  let pendingPrefix = "";
  for (const u of units) {
    if (u.kind === "atom") {
      texts.push(pendingPrefix + u.text);
      pendingPrefix = "";
    } else if (u.kind === "punct") {
      if (OPENING_RE.test(u.text) || texts.length === 0) {
        pendingPrefix += u.text; // attach to the next atom
      } else {
        texts[texts.length - 1] += u.text; // attach to the preceding atom
      }
    }
    // whitespace carries no display char — inter-word spacing is re-derived
    // from the per-atom `latin` flag when a line is assembled.
  }
  if (pendingPrefix && texts.length > 0) {
    texts[texts.length - 1] += pendingPrefix;
  }
  return texts;
}

// ─── Public API ────────────────────────────────────────────────────────────

export function alignScriptLines(
  asrWords: AsrWord[],
  scriptText: string,
  opts?: { maxCjkChars?: number },
): CaptionLine[] {
  const maxCjkChars = Math.max(1, Math.floor(opts?.maxCjkChars ?? 14));
  const units = tokenizeScript(scriptText ?? "");
  const atomUnits = units.filter((u) => u.kind === "atom");
  const scriptNorms = atomUnits.map((u) => u.norm!);
  if (scriptNorms.length === 0) return [];
  const asr = asrAtoms(asrWords ?? []);
  if (asr.length === 0) return [];

  const anchors = lcsAnchors(asr, scriptNorms);
  const times = timeScriptAtoms(asr, scriptNorms.length, anchors);
  const atomTexts = atomDisplayTexts(units);
  const atomLatin = atomUnits.map((u) => !u.cjk);
  const pending = splitLines(units, maxCjkChars);

  const lines: CaptionLine[] = [];
  for (const p of pending) {
    if (p.matchIdxs.length === 0) continue;
    // Per-word atoms for this line, timing straight off timeScriptAtoms.
    const atoms: CaptionAtom[] = p.matchIdxs.map((idx) => ({
      start: times[idx]!.start,
      end: Math.max(times[idx]!.start, times[idx]!.end),
      text: atomTexts[idx]!,
      latin: atomLatin[idx]!,
    }));
    // Line text is re-derived from the atoms (byte-faithful), a single space
    // between two adjacent latin atoms for readability, none around CJK.
    let text = "";
    for (let i = 0; i < atoms.length; i++) {
      if (i > 0 && atoms[i - 1]!.latin && atoms[i]!.latin) text += " ";
      text += atoms[i]!.text;
    }
    const firstIdx = p.matchIdxs[0]!;
    const lastIdx = p.matchIdxs[p.matchIdxs.length - 1]!;
    let start = times[firstIdx]!.start;
    let end = times[lastIdx]!.end;
    // Guard monotonicity against interpolation rounding.
    if (lines.length > 0 && start < lines[lines.length - 1]!.end) {
      start = lines[lines.length - 1]!.end;
    }
    if (end < start) end = start;
    lines.push({ start, end, text, atoms });
  }
  return lines;
}

// Default caption group style (cool-steel editorial, mirrors the manual's
// overlay recipe defaults). Callers may override per group after the fact.
const DEFAULT_GROUP_STYLE: CaptionGroupStyle = {
  fontSize: 56,
  color: "#ffffff",
  background: "rgba(0,0,0,0.55)",
  padding: "8px 14px",
  borderRadius: 6,
  textAlign: "center",
  bottomOffsetPx: 120,
};

export function buildCaptionModelFromLines(
  lines: CaptionLine[],
  opts: {
    modelId: string;
    language?: string;
    audioTrackId?: string | null;
    style?: CaptionGroupStyle;
  },
): CaptionModel {
  const style = opts.style ?? DEFAULT_GROUP_STYLE;
  // CaptionModel's two halves (CONTEXT.md): immutable PER-WORD `segments` (from
  // ASR timing) + visual `groups` that decide the on-screen lines. Each line
  // becomes ONE group referencing its atoms' segments — so the overlay renderer
  // highlights word by word and the caption can be regrouped without re-running
  // ASR. A line without per-atom data (a hand-built {start,end,text}) falls back
  // to a single whole-line segment so older callers keep working.
  const segments: CaptionModel["segments"] = [];
  const groups: CaptionModel["groups"] = [];
  let segCounter = 0;
  lines.forEach((l, gi) => {
    const atoms: CaptionAtom[] =
      l.atoms && l.atoms.length > 0
        ? l.atoms
        : [{ start: l.start, end: l.end, text: l.text, latin: false }];
    const segmentIds: string[] = [];
    for (const atom of atoms) {
      const segmentId = `seg_${String(segCounter).padStart(4, "0")}`;
      segCounter++;
      segments.push({
        segmentId,
        start: Math.max(0, atom.start),
        end: Math.max(0, Math.max(atom.start, atom.end)),
        text: atom.text,
      });
      segmentIds.push(segmentId);
    }
    groups.push({
      groupId: `grp_${String(gi).padStart(3, "0")}`,
      start: Math.max(0, l.start),
      end: Math.max(0, l.end),
      segmentIds,
      style,
    });
  });
  const model: CaptionModel = {
    modelId: opts.modelId,
    segments,
    groups,
  };
  if (opts.language) model.language = opts.language;
  if (opts.audioTrackId !== undefined) model.audioTrackId = opts.audioTrackId;
  return model;
}

export function alignScriptToCaptionModel(
  asrWords: AsrWord[],
  scriptText: string,
  opts: {
    maxCjkChars?: number;
    modelId: string;
    language?: string;
    audioTrackId?: string | null;
    style?: CaptionGroupStyle;
  },
): CaptionModel {
  const lines = alignScriptLines(asrWords, scriptText, {
    maxCjkChars: opts.maxCjkChars,
  });
  return buildCaptionModelFromLines(lines, opts);
}
