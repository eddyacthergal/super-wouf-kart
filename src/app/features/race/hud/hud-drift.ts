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

/**
 * Jauge de dérapage : allumée dès que le joueur dérape (avant le premier palier), puis trois segments
 * remplis selon le palier, dans la couleur du palier.
 */
@Component({
  selector: 'app-hud-drift',
  host: { class: 'block' },
  template: `
    <div
      role="img"
      [attr.aria-label]="label()"
      class="hud-panel flex items-center gap-2 outline-2 outline-offset-2"
      [class.outline-sun-400]="drifting()"
      [class.outline-transparent]="!drifting()"
    >
      <span
        class="font-bold"
        [class.text-sm]="!compact()"
        [class.text-xs]="compact()"
        [class.text-sun-400]="drifting()"
      >
        {{ drifting() ? 'Dérapage !' : 'Dérapage' }}
      </span>
      <span class="flex gap-1">
        @for (filled of segments(); track $index) {
          <span
            class="rounded-full border-2 border-white/80"
            [class.h-3]="!compact()"
            [class.w-7]="!compact()"
            [class.h-2]="compact()"
            [class.w-4]="compact()"
            [style.background-color]="filled ? color() : 'transparent'"
          ></span>
        }
      </span>
      @if (boosting()) {
        <span
          class="font-black text-sun-400"
          [class.text-sm]="!compact()"
          [class.text-xs]="compact()"
          >Turbo !</span
        >
      }
    </div>
  `,
})
export class HudDrift {
  /** Vrai pendant tout le dérapage, y compris avant le premier palier. */
  readonly drifting = input(false);
  readonly tier = input<DriftTier>(0);
  readonly boosting = input(false);
  /** Version réduite, pour laisser la piste visible sur petit écran. */
  readonly compact = input(false);

  protected readonly color = computed(() => {
    const tier = this.tier();
    return tier === 0 ? 'transparent' : TIERS[tier].color;
  });
  protected readonly segments = computed(() => [1, 2, 3].map((level) => level <= this.tier()));
  protected readonly label = computed(() => {
    const tier = this.tier();
    const charge =
      tier !== 0
        ? `Dérapage : palier ${tier} sur 3 (${TIERS[tier].name})`
        : this.drifting()
          ? 'Dérapage en cours : pas encore de charge'
          : 'Dérapage : pas de charge';
    return this.boosting() ? `${charge}, turbo actif` : charge;
  });
}
