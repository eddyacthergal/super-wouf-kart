/** Préférence système « réduire les animations » ; faux si matchMedia est indisponible (jsdom, serveur). */
export function prefersReducedMotion(view: Window | null | undefined): boolean {
  if (!view || typeof view.matchMedia !== 'function') return false;
  try {
    return view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
