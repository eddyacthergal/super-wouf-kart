import { Component, computed, input } from '@angular/core';
import type { ItemKind } from '../../../../game/core/types';
import { itemHint, itemName } from '../../../shared/format';
import { HudItemSlot } from './hud-item-slot';

/**
 * HUD objets : l'objet suivant (utilisé au prochain appui) en grande case, la réserve en petite
 * case à côté. Sous les cases, le nom de l'objet suivant et son effet en quelques mots.
 */
@Component({
  selector: 'app-hud-item',
  imports: [HudItemSlot],
  host: { class: 'flex flex-col items-end gap-1' },
  template: `
    <div class="flex items-end gap-2">
      <app-hud-item-slot
        [large]="false"
        [kind]="items()[1] ?? null"
        [rolling]="rollingSlot() === 1"
        [label]="reserveLabel()"
      />
      <app-hud-item-slot
        [kind]="items()[0] ?? null"
        [rolling]="rollingSlot() === 0"
        [timeLeft]="goldenBoneTime()"
        [label]="mainLabel()"
      />
    </div>
    @if (caption(); as text) {
      <p class="hud-panel max-w-48 text-right leading-tight">
        <!-- Le nom est déjà dans le libellé de la case : seul l'effet est lu ici. -->
        <span class="block font-black" aria-hidden="true">{{ text.name }}</span>
        <span class="block text-xs font-bold">{{ text.hint }}</span>
      </p>
    }
  `,
})
export class HudItem {
  readonly items = input<readonly ItemKind[]>([]);
  readonly rollingSlot = input<0 | 1 | null>(null);
  /** Temps restant de l'os en or actif (s) ; 0 : inactif. */
  readonly goldenBoneTime = input(0);

  /** Nom et effet de l'objet suivant (rien pendant son tirage ni sans objet). */
  protected readonly caption = computed(() => {
    const item = this.items()[0];
    return item && this.rollingSlot() !== 0 ? { name: itemName(item), hint: itemHint(item) } : null;
  });
  protected readonly mainLabel = computed(() => {
    const item = this.items()[0];
    const golden = this.goldenBoneTime();
    if (item === 'golden-bone' && golden > 0)
      return `Objet : ${itemName(item)}, ${Math.ceil(golden)} s`;
    return slotLabel('Objet', 'aucun', item, this.rollingSlot() === 0);
  });
  protected readonly reserveLabel = computed(() =>
    slotLabel('Réserve', 'vide', this.items()[1], this.rollingSlot() === 1),
  );
}

/** « Objet : Os », « Réserve : tirage en cours », « Objet : aucun »… */
function slotLabel(
  name: string,
  empty: string,
  kind: ItemKind | undefined,
  rolling: boolean,
): string {
  if (rolling) return `${name} : tirage en cours`;
  return kind ? `${name} : ${itemName(kind)}` : `${name} : ${empty}`;
}
