import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RACE_LAPS } from '../../../game/core/constants';
import { TRACK_CATALOG } from '../../../game/track/catalog';
import type { TrackThemeId } from '../../../game/track/track-definition';
import { SettingsStore } from '../../core/settings.store';
import { TrackPreview } from './track-preview';

/** Nom court et fond de l'aperçu de chaque univers. */
const THEMES: Readonly<Record<TrackThemeId, { label: string; background: string }>> = {
  garden: { label: 'Jardin', background: '#e3f5d8' },
  snow: { label: 'Neige', background: '#eef4fb' },
  beach: { label: 'Plage', background: '#fbeccb' },
};

/** Choix du circuit, entre l'accueil (ou le garage) et la course : groupe radio natif présenté en cartes. */
@Component({
  selector: 'app-circuit-select',
  imports: [RouterLink, TrackPreview],
  template: `
    <main class="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 tabindex="-1" class="text-5xl font-black tracking-tight">Circuits</h1>
          <p class="mt-1 text-lg font-bold text-moss-700">Choisis ta piste.</p>
        </div>
        <a routerLink="/" class="btn btn-light"><span aria-hidden="true">←</span> Retour</a>
      </header>

      <fieldset class="mt-8">
        <legend class="sr-only">Circuit</legend>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          @for (circuit of circuits; track circuit.id) {
            <label
              class="card flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-leaf-500 has-checked:border-leaf-700 has-checked:bg-sun-200"
            >
              <app-track-preview
                class="aspect-square w-full rounded-xl p-2"
                [style.background-color]="themes[circuit.theme].background"
                [track]="circuit"
              />
              <span class="flex items-center gap-3">
                <input
                  type="radio"
                  name="track"
                  class="size-6 shrink-0 accent-leaf-700"
                  [value]="circuit.id"
                  [checked]="settings.track() === circuit.id"
                  [attr.aria-labelledby]="'track-name-' + circuit.id"
                  [attr.aria-describedby]="
                    'track-theme-' +
                    circuit.id +
                    ' track-desc-' +
                    circuit.id +
                    ' track-laps-' +
                    circuit.id
                  "
                  (change)="settings.setTrack(circuit.id)"
                />
                <span [id]="'track-name-' + circuit.id" class="text-xl leading-tight font-black">{{
                  circuit.name
                }}</span>
              </span>
              <span class="flex items-center gap-2">
                <span
                  [id]="'track-theme-' + circuit.id"
                  class="rounded-full bg-leaf-100 px-2 py-0.5 text-xs font-bold text-leaf-900"
                >
                  {{ themes[circuit.theme].label }}
                </span>
                <span
                  [id]="'track-laps-' + circuit.id"
                  class="ml-auto text-sm font-bold text-moss-700"
                >
                  {{ circuit.laps ?? defaultLaps }} tours
                </span>
              </span>
              <span [id]="'track-desc-' + circuit.id" class="text-sm text-moss-700">{{
                circuit.description
              }}</span>
            </label>
          }
        </div>
      </fieldset>

      <div class="mt-8 flex justify-center">
        <a routerLink="/course" class="btn btn-primary px-12 text-2xl">C’est parti !</a>
      </div>
    </main>
  `,
})
export class CircuitSelect {
  protected readonly settings = inject(SettingsStore);
  protected readonly circuits = TRACK_CATALOG;
  protected readonly defaultLaps = RACE_LAPS;
  protected readonly themes = THEMES;
}
