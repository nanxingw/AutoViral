/**
 * Tiny dependency-free syntax highlighter for the languages autoviral
 * actually emits in chat: yaml, json, bash. Returns an array of
 * (text, className) tuples — the consumer wraps them in <span>s.
 *
 * Rationale for not pulling shiki / prism / hljs: bundle weight + the
 * surface we need to cover is tight (~5 token kinds for yaml, ~5 for
 * json). The full ecosystem highlighters add 50-300KB. Hand-rolled
 * regex stays under 60 lines and covers the common case.
 *
 * Falls back to a single (text, "") tuple for unknown languages so the
 * caller can render plain text without branching.
 */

export type Lang = "yaml" | "json" | "bash" | string;
export type HighlightToken = readonly [text: string, kind: string];

const TOKEN_CLASS: Record<string, string> = {
  key: "hl-key",
  str: "hl-str",
  num: "hl-num",
  bool: "hl-bool",
  comment: "hl-comment",
  cmd: "hl-cmd",
  flag: "hl-flag",
  punct: "hl-punct",
};

/** Walk a regex with named alternation across the source and stitch
 *  matched + unmatched runs into the token list. */
function tokenizeWith(
  source: string,
  re: RegExp,
  classify: (m: RegExpExecArray) => string,
): HighlightToken[] {
  const out: HighlightToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(source))) {
    if (m.index > last) {
      out.push([source.slice(last, m.index), ""]);
    }
    const cls = classify(m);
    out.push([m[0], TOKEN_CLASS[cls] ?? ""]);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // safety
  }
  if (last < source.length) {
    out.push([source.slice(last), ""]);
  }
  return out;
}

const YAML_RE =
  /(#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|(^\s*-\s)|(^[ \t]*[\w.-]+(?=:\s|:$))/gm;

function tokenizeYaml(src: string): HighlightToken[] {
  return tokenizeWith(src, YAML_RE, (m) => {
    if (m[1]) return "comment";
    if (m[2]) return "str";
    if (m[3]) return "num";
    if (m[4]) return "bool";
    if (m[5]) return "punct";
    if (m[6]) return "key";
    return "";
  });
}

const JSON_RE =
  /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(\b\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g;

function tokenizeJson(src: string): HighlightToken[] {
  return tokenizeWith(src, JSON_RE, (m) => {
    if (m[1]) return "key";
    if (m[2]) return "str";
    if (m[3]) return "num";
    if (m[4]) return "bool";
    return "";
  });
}

const BASH_RE = /(#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(--?[\w-]+)|(^|\s)([a-zA-Z_][\w-]*)(?=\s|$)/gm;

function tokenizeBash(src: string): HighlightToken[] {
  // Tag the first non-flag word on a line as a command. This is "good enough"
  // — pipes and subshells fall through as plain text but stay readable.
  const out: HighlightToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BASH_RE.lastIndex = 0;
  let firstWordOnLine = true;
  while ((m = BASH_RE.exec(src))) {
    if (m.index > last) {
      const slice = src.slice(last, m.index);
      out.push([slice, ""]);
      if (slice.includes("\n")) firstWordOnLine = true;
    }
    if (m[1]) out.push([m[0], TOKEN_CLASS.comment]);
    else if (m[2]) out.push([m[0], TOKEN_CLASS.str]);
    else if (m[3]) out.push([m[0], TOKEN_CLASS.flag]);
    else if (m[5]) {
      if (m[4]) {
        out.push([m[4], ""]);
        // The leading whitespace group can itself contain a newline
        // (e.g. "\nfind"), in which case the WORD is the first on its
        // own line and should be tagged as a command.
        if (m[4].includes("\n")) firstWordOnLine = true;
      }
      out.push([m[5], firstWordOnLine ? TOKEN_CLASS.cmd : ""]);
      firstWordOnLine = false;
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push([src.slice(last), ""]);
  return out;
}

export function highlightCode(source: string, lang: Lang): HighlightToken[] {
  if (lang === "yaml" || lang === "yml") return tokenizeYaml(source);
  if (lang === "json") return tokenizeJson(source);
  if (lang === "bash" || lang === "sh" || lang === "shell") return tokenizeBash(source);
  return [[source, ""]];
}
