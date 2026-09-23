import { Component, computed, inject } from '@angular/core';
import { BREEDS } from '../../../game/dogs/breeds';
import { SettingsStore } from '../../core/settings.store';
import { equippedSkinNames, joinWithEt } from '../../shared/format';

/** Résumé du pilote choisi au garage : race et accessoires. */
@Component({
  selector: 'app-pilot-summary',
  template: `
    <section class="card flex h-full flex-col gap-3 p-6" aria-labelledby="pilot-title">
      <h2 id="pilot-title" class="text-2xl font-extrabold">Ton pilote</h2>
      <p class="flex items-center gap-3 text-3xl font-black">
        <span
          class="inline-block size-8 shrink-0 rounded-full border-4 border-white shadow"
          [style.background-color]="breed().look.furColor"
          aria-hidden="true"
        ></span>
        {{ breed().name }}
      </p>
      <p class="text-moss-700">{{ breed().description }}</p>
      <p class="font-bold">
        @if (accessories(); as list) {
          Accessoires : {{ list }}
        } @else {
          Aucun accessoire pour l’instant.
        }
      </p>
    </section>
  `,
})
export class PilotSummary {
  private readonly settings = inject(SettingsStore);

  protected readonly breed = computed(() => BREEDS[this.settings.breed()]);
  protected readonly accessories = computed(() => joinWithEt(equippedSkinNames(this.settings.skins())));
}
