import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsStore } from '../../core/settings.store';
import { DogPortrait } from '../../shared/dog-portrait';
import { BuildVersion } from './build-version';
import { ControlsHelp } from './controls-help';
import { PilotSummary } from './pilot-summary';

/** Écran d'accueil : titre, accès au jeu et au garage, pilote choisi, commandes et version. */
@Component({
  selector: 'app-home',
  imports: [RouterLink, DogPortrait, PilotSummary, ControlsHelp, BuildVersion],
  template: `
    <main class="mx-auto flex min-h-dvh max-w-5xl flex-col items-center gap-10 px-4 py-10 sm:py-14">
      <header class="flex flex-col items-center text-center">
        <!-- Portrait du pilote choisi au garage. -->
        <app-dog-portrait class="size-28 drop-shadow-md" [breed]="breed()" />
        <h1 tabindex="-1" class="mt-4 text-6xl font-black tracking-tight text-leaf-900 sm:text-8xl">Wouf Kart</h1>
        <p class="mt-3 text-xl font-bold text-moss-700 sm:text-2xl">La course de kart des petits chiens !</p>
      </header>

      <nav aria-label="Menu principal" class="flex flex-wrap justify-center gap-4">
        <a routerLink="/course" class="btn btn-primary px-12 text-2xl">Jouer</a>
        <a routerLink="/garage" class="btn btn-sun px-10 text-2xl">Garage</a>
      </nav>

      <div class="grid w-full gap-6 md:grid-cols-2">
        <app-pilot-summary />
        <app-controls-help />
      </div>

      <footer class="mt-auto text-center">
        <app-build-version />
      </footer>
    </main>
  `,
})
export class Home {
  /** Race choisie au garage : le portrait de l'en-tête la représente. */
  protected readonly breed = inject(SettingsStore).breed;
}
