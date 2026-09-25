import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SkinSlot } from '../../../game/core/types';
import { SettingsStore } from '../../core/settings.store';
import { BreedPicker } from './breed-picker';
import { DogPreview } from './dog-preview';
import { SkinPicker } from './skin-picker';

const SLOTS: ReadonlyArray<{ id: SkinSlot; label: string }> = [
  { id: 'head', label: 'Tête' },
  { id: 'neck', label: 'Cou' },
  { id: 'body', label: 'Corps' },
];

/** Garage : choix de la race et des accessoires, aperçu 3D, départ de la course. */
@Component({
  selector: 'app-garage',
  imports: [RouterLink, BreedPicker, SkinPicker, DogPreview],
  template: `
    <main class="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 tabindex="-1" class="text-5xl font-black tracking-tight">Garage</h1>
          <p class="mt-1 text-lg font-bold text-moss-700">Choisis ton pilote et habille-le pour la course.</p>
        </div>
        <a routerLink="/" class="btn btn-light"><span aria-hidden="true">←</span> Retour</a>
      </header>

      <div class="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <div class="flex flex-col gap-8">
          <app-breed-picker />

          <section class="card flex flex-col gap-5 p-6" aria-labelledby="accessories-title">
            <h2 id="accessories-title" class="text-2xl font-extrabold">Accessoires</h2>
            @for (slot of slots; track slot.id) {
              <app-skin-picker [slot]="slot.id" [legend]="slot.label" />
            }
          </section>
        </div>

        <section class="flex flex-col gap-4 lg:sticky lg:top-6" aria-labelledby="preview-title">
          <div class="card p-4">
            <h2 id="preview-title" class="text-2xl font-extrabold">Aperçu</h2>
            <app-dog-preview [breed]="settings.breed()" [skins]="settings.skins()" />
          </div>
          <a routerLink="/circuits" class="btn btn-primary w-full text-xl">Choisir le circuit</a>
        </section>
      </div>
    </main>
  `,
})
export class Garage {
  protected readonly settings = inject(SettingsStore);
  protected readonly slots = SLOTS;
}
