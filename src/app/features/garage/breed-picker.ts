import { Component, inject } from '@angular/core';
import type { BreedId, StatBlock } from '../../../game/core/types';
import { BREED_LIST } from '../../../game/dogs/breeds';
import { SettingsStore } from '../../core/settings.store';
import { StatBar } from './stat-bar';

const STAT_LABELS: ReadonlyArray<{ key: keyof StatBlock; label: string }> = [
  { key: 'speed', label: 'Vitesse' },
  { key: 'acceleration', label: 'Accélération' },
  { key: 'weight', label: 'Poids' },
  { key: 'handling', label: 'Maniabilité' },
];

/** Choix de la race : groupe radio natif présenté en cartes, avec les statistiques. */
@Component({
  selector: 'app-breed-picker',
  imports: [StatBar],
  template: `
    <fieldset>
      <legend class="text-2xl font-extrabold">Race</legend>
      <div class="mt-3 grid gap-4 sm:grid-cols-2">
        @for (breed of breeds; track breed.id) {
          <label
            class="card flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-leaf-500 has-checked:border-leaf-700 has-checked:bg-sun-200"
          >
            <span class="flex items-center gap-3">
              <input
                type="radio"
                name="breed"
                class="size-6 shrink-0 accent-leaf-700"
                [value]="breed.id"
                [checked]="settings.breed() === breed.id"
                [attr.aria-labelledby]="'breed-name-' + breed.id"
                [attr.aria-describedby]="'breed-desc-' + breed.id + ' breed-stats-' + breed.id"
                (change)="select(breed.id)"
              />
              <span [id]="'breed-name-' + breed.id" class="text-xl font-black">{{ breed.name }}</span>
              <span
                class="ml-auto inline-block size-7 shrink-0 rounded-full border-4 border-white shadow"
                [style.background-color]="breed.look.furColor"
                aria-hidden="true"
              ></span>
            </span>
            <span [id]="'breed-desc-' + breed.id" class="text-sm text-moss-700">{{ breed.description }}</span>
            <span [id]="'breed-stats-' + breed.id" class="flex flex-col gap-1">
              @for (stat of stats; track stat.key) {
                <app-stat-bar [label]="stat.label" [value]="breed.stats[stat.key]" />
              }
            </span>
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class BreedPicker {
  protected readonly settings = inject(SettingsStore);
  protected readonly breeds = BREED_LIST;
  protected readonly stats = STAT_LABELS;

  protected select(id: BreedId): void {
    this.settings.setBreed(id);
  }
}
