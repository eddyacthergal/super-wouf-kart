import { Component, ElementRef, afterNextRender, computed, input, output, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RaceResultEntry } from '../../../game/game-api';
import { breedName, formatPlace, formatRaceTime, formatRank, formatRankDisplay } from '../../shared/format';

/** Écran des résultats : classement final ; le titre reçoit le focus à l'affichage. */
@Component({
  selector: 'app-race-results',
  imports: [RouterLink],
  host: { class: 'absolute inset-0 block overflow-y-auto bg-slate-900/55' },
  template: `
    <section
      class="flex min-h-full items-center justify-center p-4"
      aria-labelledby="results-title"
      (keydown)="$event.stopPropagation()"
    >
      <div class="card w-full max-w-2xl p-6 text-leaf-900 sm:p-8">
        <h2 #title id="results-title" tabindex="-1" class="text-4xl font-black">Résultats</h2>
        @if (playerPlace(); as place) {
          <p class="mt-1 text-xl font-bold text-moss-700">Tu termines à la {{ place }} !</p>
        }
        <!-- Pas de zone défilante propre au tableau (elle ne serait pas atteignable au clavier) :
             cellules compactes sur petit écran, et c'est l'écran entier qui défile au besoin. -->
        <table class="mt-4 w-full border-collapse text-left">
          <caption class="pb-2 text-left text-sm font-bold text-moss-700">Classement de la course</caption>
          <thead>
            <tr class="border-b-2 border-leaf-200">
              <th scope="col" class="px-2 py-2 sm:px-3">Place</th>
              <th scope="col" class="px-2 py-2 sm:px-3">Pilote</th>
              <th scope="col" class="px-2 py-2 sm:px-3">Race</th>
              <th scope="col" class="px-2 py-2 text-right sm:px-3">Temps</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.racerId) {
              <tr class="border-b border-leaf-100" [class.bg-sun-200]="row.isPlayer" [class.font-black]="row.isPlayer">
                <th scope="row" class="px-2 py-2 text-lg sm:px-3">
                  <span aria-hidden="true">{{ row.rankDisplay }}</span>
                  <span class="sr-only">{{ row.rankSpoken }}</span>
                </th>
                <td class="px-2 py-2 sm:px-3">{{ row.pilot }}</td>
                <td class="px-2 py-2 sm:px-3">{{ row.breed }}</td>
                <td class="px-2 py-2 text-right tabular-nums sm:px-3">
                  {{ row.time }}
                  @if (row.estimated) {
                    <span class="font-normal text-moss-700">(estimé)</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <div class="mt-6 flex flex-wrap gap-3">
          <button type="button" class="btn btn-primary" (click)="replay.emit()">Rejouer</button>
          <a routerLink="/garage" class="btn btn-sun">Garage</a>
          <a routerLink="/" class="btn btn-light">Accueil</a>
        </div>
      </div>
    </section>
  `,
})
export class RaceResults {
  readonly results = input.required<readonly RaceResultEntry[]>();
  readonly replay = output<void>();

  private readonly title = viewChild.required<ElementRef<HTMLHeadingElement>>('title');

  protected readonly rows = computed(() =>
    this.results().map((entry) => ({
      racerId: entry.racerId,
      isPlayer: entry.isPlayer,
      rankDisplay: formatRankDisplay(entry.rank),
      rankSpoken: formatRank(entry.rank),
      pilot: entry.isPlayer ? 'Toi' : entry.name,
      breed: breedName(entry.breed),
      time: formatRaceTime(entry.time),
      estimated: entry.estimated,
    })),
  );

  protected readonly playerPlace = computed(() => {
    const player = this.results().find((entry) => entry.isPlayer);
    return player ? formatPlace(player.rank) : null;
  });

  constructor() {
    afterNextRender({ write: () => this.title().nativeElement.focus() });
  }
}
