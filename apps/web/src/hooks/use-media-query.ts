import { useEffect, useState } from "react";

/**
 * SSR-safe media query hook. Returns `false` on server (mobile-first).
 * Listens to `change` events for live resize updates.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Returns `true` when viewport is ≥ 1024px (matches Tailwind `lg:` breakpoint). */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
