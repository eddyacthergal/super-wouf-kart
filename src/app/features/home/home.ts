import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BuildVersion } from './build-version';
import { ControlsHelp } from './controls-help';
import { PilotSummary } from './pilot-summary';

/** Écran d'accueil : titre, accès au jeu et au garage, pilote choisi, commandes et version. */
@Component({
  selector: 'app-home',
  imports: [RouterLink, PilotSummary, ControlsHelp, BuildVersion],
  template: `
    <main class="mx-auto flex min-h-dvh max-w-5xl flex-col items-center gap-10 px-4 py-10 sm:py-14">
      <header class="flex flex-col items-center text-center">
        <svg class="size-28 drop-shadow-md" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <circle cx="60" cy="60" r="56" fill="#ffcf3f" />
          <path d="M22 44 Q20 14 44 26 L40 52 Z" fill="#a4532b" />
          <path d="M98 44 Q100 14 76 26 L80 52 Z" fill="#a4532b" />
          <ellipse cx="60" cy="64" rx="36" ry="32" fill="#dba468" />
          <ellipse cx="60" cy="80" rx="20" ry="14" fill="#f6ddb8" />
          <circle cx="46" cy="58" r="6" fill="#1b1b1b" />
          <circle cx="74" cy="58" r="6" fill="#1b1b1b" />
          <circle cx="48" cy="56" r="2" fill="#fff" />
          <circle cx="76" cy="56" r="2" fill="#fff" />
          <ellipse cx="60" cy="72" rx="7" ry="5" fill="#1b1b1b" />
          <path d="M54 84 Q60 96 66 84 Z" fill="#e8657a" />
        </svg>
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
export class Home {}
