/** Délai (ms) sous lequel deux appuis successifs forment un double appui (zoom du navigateur). */
const DOUBLE_TAP_MS = 350;

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"]';

/**
 * Pendant une course sur écran tactile, empêche le navigateur de zoomer (pincement, double appui) ou
 * de faire défiler la page sous les doigts du joueur : `touch-action: none` ne suffit pas partout
 * (Safari sur iPhone et iPad l'ignore en partie). Les zones marquées `data-scrollable` (résultats)
 * défilent toujours et les commandes (liens, boutons) gardent leurs clics. Renvoie la fonction qui
 * retire les écouteurs ; le zoom reste possible sur le reste de l'application.
 */
export function blockBrowserGestures(root: HTMLElement): () => void {
  const active = { passive: false } as const;
  let lastTouchEnd = Number.NEGATIVE_INFINITY;

  const inside = (target: EventTarget | null, selector: string): boolean =>
    target instanceof Element && target.closest(selector) !== null;

  const onTouchStart = (event: TouchEvent): void => {
    // Deux doigts ou plus : début d'un pincement.
    if (event.touches.length > 1) event.preventDefault();
  };
  const onTouchMove = (event: TouchEvent): void => {
    if (event.touches.length > 1 || !inside(event.target, '[data-scrollable]'))
      event.preventDefault();
  };
  const onTouchEnd = (event: TouchEvent): void => {
    const now = event.timeStamp;
    // Second appui rapproché hors d'une commande : double appui, qui zoomerait.
    if (now - lastTouchEnd < DOUBLE_TAP_MS && !inside(event.target, INTERACTIVE))
      event.preventDefault();
    lastTouchEnd = now;
  };
  // Pincement propre à Safari (gesturestart / gesturechange).
  const onGesture = (event: Event): void => event.preventDefault();

  root.addEventListener('touchstart', onTouchStart, active);
  root.addEventListener('touchmove', onTouchMove, active);
  root.addEventListener('touchend', onTouchEnd, active);
  root.addEventListener('gesturestart', onGesture, active);
  root.addEventListener('gesturechange', onGesture, active);
  root.addEventListener('dblclick', onGesture, active);

  return () => {
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('touchend', onTouchEnd);
    root.removeEventListener('gesturestart', onGesture);
    root.removeEventListener('gesturechange', onGesture);
    root.removeEventListener('dblclick', onGesture);
  };
}
