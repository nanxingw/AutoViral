import { useEffect, useRef } from "react";

/**
 * Round 41 — minimal focus management for custom (non-Radix) modals.
 *
 * Custom modals built with `motion.div` + portal in Round 13/14
 * (ReframeConfirmDialog / ExportProgress / DiveCanvas) lacked any
 * focus handling. Keyboard users opened them but Tab kept cycling
 * through the background — modal content was effectively unreachable
 * via keyboard.
 *
 * This hook does the minimum useful thing without a full focus-trap
 * implementation:
 *   - When the modal opens: snapshot the previously-focused element,
 *     then move focus into the modal (first focusable child OR the
 *     modal container itself).
 *   - When the modal closes: restore focus to the element that had it
 *     before. If that element is no longer in the DOM, fall back to
 *     `document.body` so focus doesn't end up on `null`.
 *
 * Tab cycling inside the modal still uses native browser order — this
 * hook doesn't trap. For most modals (1-3 focusable controls) the
 * minor risk of tabbing out is acceptable; the bigger UX gap was
 * "modal opens but keyboard is stuck on background" which this fixes.
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useModalFocus(open, containerRef);
 *
 *   return <div ref={containerRef} role="dialog">…</div>;
 */
export function useModalFocus(
  open: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  // Snapshot the element that had focus before the modal opened. Stored
  // in a ref (not state) so the effect's cleanup has access to it
  // without re-subscribing on every focus shuffle.
  const previousActive = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Capture current focus for restoration on close.
    const active = document.activeElement;
    previousActive.current =
      active instanceof HTMLElement ? active : null;

    // Move focus into the modal. Find the first focusable descendant
    // (button, [href], input, [tabindex]) — fall back to the container
    // itself with tabindex=-1 if none found. setTimeout 0 lets motion's
    // initial animation register the element as focusable first.
    const tid = window.setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      const focusable = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable) {
        focusable.focus();
      } else {
        // No focusable descendant — focus the container itself so the
        // modal at least owns focus. Caller should add tabIndex={-1}
        // on the container for this to work.
        root.focus();
      }
    }, 0);

    return () => {
      window.clearTimeout(tid);
      // Restore previous focus on close. document.body fallback if the
      // previous element was removed (rare — most triggers persist).
      const prev = previousActive.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      } else {
        document.body.focus();
      }
      previousActive.current = null;
    };
  }, [open, containerRef]);
}
