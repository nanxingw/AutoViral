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
 * Tab cycling inside the modal uses native browser order. By default the
 * hook does NOT trap: for the small confirm-style modals (1-3 focusable
 * controls) the minor risk of tabbing out is acceptable, and the bigger
 * UX gap was "modal opens but keyboard is stuck on background".
 *
 * Opt into `{ trap: true }` for fullscreen / `aria-modal="true"` surfaces
 * (e.g. ScriptReader) where Tab must NOT escape to the fully-obscured
 * background — otherwise the aria-modal contract is a lie for keyboard
 * users. Trapping wraps Tab / Shift+Tab around the first↔last focusable
 * descendant and pulls focus back in if it ever lands outside.
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useModalFocus(open, containerRef);              // no trap
 *   useModalFocus(open, containerRef, { trap: true }); // aria-modal surfaces
 *
 *   return <div ref={containerRef} role="dialog">…</div>;
 */

// Focusable descendants — shared by the focus-in step and the trap.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocus(
  open: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  options: { trap?: boolean } = {},
) {
  const trap = options.trap ?? false;
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
      const focusable = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
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

  // Focus trap (opt-in). Wraps Tab / Shift+Tab around the modal's focusable
  // descendants so keyboard focus can't leave an `aria-modal="true"` surface.
  // Capture-phase on `document` so it fires wherever focus currently is —
  // including pulling focus back if it somehow escaped to the background.
  useEffect(() => {
    if (!open || !trap) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        // Nothing focusable inside — keep focus on the container itself.
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !root.contains(active);
      if (e.shiftKey) {
        if (active === first || active === root || outside) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || outside) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, trap, containerRef]);
}
