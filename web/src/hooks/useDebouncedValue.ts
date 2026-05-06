import { useEffect, useState } from "react";

/**
 * Returns `value` debounced by `delayMs`. Each new `value` resets the timer;
 * the returned debounced value updates only after `delayMs` of stillness.
 *
 * Phase 8.1.C — D8 mandates 300ms for the search input.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
