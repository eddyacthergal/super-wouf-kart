import { DOCUMENT, Injector, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Titre principal de page (chaque page lui donne tabindex="-1" pour pouvoir le focaliser). */
export const PAGE_HEADING_SELECTOR = 'main h1';

/**
 * Après chaque navigation (sauf le premier affichage), place le focus sur le titre principal
 * de la nouvelle page : les lecteurs d'écran annoncent la page et le clavier repart du haut.
 * À appeler dans un contexte d'injection (constructeur du composant racine).
 */
export function focusPageHeadingOnNavigation(): void {
  const router = inject(Router);
  const injector = inject(Injector);
  const document = inject(DOCUMENT);
  let firstNavigation = true;

  router.events
    .pipe(
      filter((event) => event instanceof NavigationEnd),
      takeUntilDestroyed(),
    )
    .subscribe(() => {
      if (firstNavigation) {
        firstNavigation = false;
        return;
      }
      afterNextRender(
        { write: () => document.querySelector<HTMLElement>(PAGE_HEADING_SELECTOR)?.focus({ preventScroll: false }) },
        { injector },
      );
    });
}
