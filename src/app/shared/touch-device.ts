/**
 * Vrai si le pointeur principal est un doigt (téléphone, tablette) : le jeu affiche alors ses
 * commandes tactiles. Faux si matchMedia est indisponible (jsdom, serveur).
 */
export function prefersTouchControls(view: Window | null | undefined): boolean {
  if (!view || typeof view.matchMedia !== 'function') return false;
  try {
    return view.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
