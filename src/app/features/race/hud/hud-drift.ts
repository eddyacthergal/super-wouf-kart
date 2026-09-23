import { Component, computed, input } from '@angular/core';
import type { DriftTier } from '../../../../game/core/types';

/**
 * Couleur et nom de chaque palier de mini-turbo (1 bleu, 2 orange, 3 violet).
 * Teintes claires : au moins 3:1 contre le panneau sombre du HUD (WCAG 1.4.11),
 * soit 4,0:1 (bleu), 4,8:1 (orange) et 3,9:1 (violet) dans le pire cas (décor blanc derrière le panneau).
 */
const TIERS: Readonly<Record<Exclude<DriftTier, 0>, { color: string; name: string }>> = {
  1: { color: '#60a5fa', name: 'bleu' },
  2: { color: '#f59e0b', name: 'orange' },
  3: { color: '#c084fc', name: 'violet' },
};

/** Jauge de dérapage : trois segments remplis selon le palier, dans la couleur du palier. */
@Component({
  selector: 'app-hud-drift',
  host: { class: 'block' },
  template: `
    <div role="img" [attr.aria-label]="label()" class="hud-panel flex items-center gap-2">
      <span class="text-sm font-bold">Dérapage</span>
      <span class="flex gap-1">
        @for (filled of segments(); track $index) {
          <span
            class="h-3 w-7 rounded-full border-2 border-white/80"
            [style.background-color]="filled ? color() : 'transparent'"
          ></span>
        }
      </span>
      @if (boosting()) {
        <span class="text-sm font-black text-sun-400">Turbo !</span>
      }
    </div>
  `,
})
export class HudDrift {
  readonly tier = input<DriftTier>(0);
  readonly boosting = input(false);

  protected readonly color = computed(() => {
    const tier = this.tier();
    return tier === 0 ? 'transparent' : TIERS[tier].color;
  });
  protected readonly segments = computed(() => [1, 2, 3].map((level) => level <= this.tier()));
  protected readonly label = computed(() => {
    const tier = this.tier();
    const charge = tier === 0 ? 'Dérapage : pas de charge' : `Dérapage : palier ${tier} sur 3 (${TIERS[tier].name})`;
    return this.boosting() ? `${charge}, turbo actif` : charge;
  });
}
