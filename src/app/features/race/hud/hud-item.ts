import { Component, computed, input } from '@angular/core';
import type { ItemKind } from '../../../../game/core/types';
import { itemName } from '../../../shared/format';
import { ItemIcon } from './item-icon';

const ROULETTE: readonly ItemKind[] = ['bone', 'tennis-ball', 'mud', 'kibble-turbo'];

/** Case d'objet : icône de l'objet tenu, ou roulette pendant le tirage (« ? » fixe si animations réduites). */
@Component({
  selector: 'app-hud-item',
  imports: [ItemIcon],
  host: { class: 'block' },
  template: `
    <div
      role="img"
      [attr.aria-label]="label()"
      class="grid size-20 place-items-center overflow-hidden rounded-2xl border-4 border-white/85 bg-slate-900/80 shadow-lg"
    >
      @let held = item();
      @if (rolling()) {
        <span class="roulette block size-14 overflow-hidden">
          <span class="roulette-strip flex flex-col">
            @for (kind of roulette; track kind) {
              <app-item-icon class="size-14 shrink-0" [kind]="kind" />
            }
          </span>
        </span>
        <span class="roulette-static text-4xl font-black text-white">?</span>
      } @else if (held) {
        <app-item-icon class="size-14" [kind]="held" />
      } @else {
        <!-- Case vide : empreinte de patte estompée (décor), le libellé dit « aucun ». -->
        <svg viewBox="0 0 48 48" class="size-11 text-white/25" aria-hidden="true" focusable="false">
          <g fill="currentColor">
            <ellipse cx="24" cy="31" rx="10" ry="8.5" />
            <ellipse cx="11.5" cy="20" rx="4.2" ry="5.2" transform="rotate(-20 11.5 20)" />
            <ellipse cx="19.5" cy="12.5" rx="4.2" ry="5.4" transform="rotate(-6 19.5 12.5)" />
            <ellipse cx="28.5" cy="12.5" rx="4.2" ry="5.4" transform="rotate(6 28.5 12.5)" />
            <ellipse cx="36.5" cy="20" rx="4.2" ry="5.2" transform="rotate(20 36.5 20)" />
          </g>
        </svg>
      }
    </div>
  `,
  styles: `
    .roulette-strip {
      animation: item-roulette 0.36s steps(4) infinite;
    }
    .roulette-static {
      display: none;
    }
    @keyframes item-roulette {
      to {
        transform: translateY(-100%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .roulette {
        display: none;
      }
      .roulette-static {
        display: block;
      }
    }
  `,
})
export class HudItem {
  readonly item = input<ItemKind | null>(null);
  readonly rolling = input(false);

  protected readonly roulette = ROULETTE;
  protected readonly label = computed(() => {
    if (this.rolling()) return 'Objet : tirage en cours';
    const item = this.item();
    return item ? `Objet : ${itemName(item)}` : 'Objet : aucun';
  });
}
