// A7 (PRD-0010) — fetch a text asset's body for in-library preview.
//
// Library cards read a short snippet (SNIPPET_MAX_CHARS) so a creator can tell
// text files apart WITHOUT opening each one; the preview modal reads
// (effectively) the whole document. Any network / non-2xx failure resolves to
// { text: null, failed: true } so callers degrade to a filename-only card
// instead of showing a broken body.
import { useEffect, useState } from "react";

export interface AssetTextState {
  /** The fetched body, sliced to `maxChars`. null while loading / on failure. */
  text: string | null;
  /** True when the body was longer than `maxChars` and got clipped. */
  truncated: boolean;
  /** True when the fetch failed (network or non-2xx). */
  failed: boolean;
  loading: boolean;
}

/** Default snippet budget for library cards (~3 lines of mono). */
export const SNIPPET_MAX_CHARS = 200;

/** Budget for the full-document preview modal. Generous but bounded so a
 *  pathological multi-MB text asset can't lock up the modal. */
export const FULL_TEXT_MAX_CHARS = 200_000;

export function useAssetText(
  url: string | null,
  maxChars: number = SNIPPET_MAX_CHARS,
): AssetTextState {
  const [state, setState] = useState<AssetTextState>({
    text: null,
    truncated: false,
    failed: false,
    loading: url != null,
  });

  useEffect(() => {
    if (!url) {
      setState({ text: null, truncated: false, failed: false, loading: false });
      return;
    }
    let cancelled = false;
    setState({ text: null, truncated: false, failed: false, loading: true });
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((raw) => {
        if (cancelled) return;
        const truncated = raw.length > maxChars;
        setState({
          text: truncated ? raw.slice(0, maxChars) : raw,
          truncated,
          failed: false,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ text: null, truncated: false, failed: true, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url, maxChars]);

  return state;
}
