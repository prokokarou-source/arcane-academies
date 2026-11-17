import { useSyncExternalStore } from 'react';

/** Laptop layout from this width up; phones and tablets in portrait keep the phone layout. */
export const WIDE_QUERY = '(min-width: 1024px)';

const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null);

function subscribe(onChange: () => void) {
  const q = query();
  if (!q) return () => {};
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}

const isWide = () => query()?.matches ?? false;

/** True on a laptop-sized window (re-renders when the window crosses the breakpoint). */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, isWide, () => false);
}
