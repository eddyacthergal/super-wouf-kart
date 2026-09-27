import { Component, input } from '@angular/core';
import type { ItemKind } from '../../../../game/core/types';
import { ItemIcon } from './item-icon';

export const ROULETTE: readonly ItemKind[] = ['bone', 'tennis-ball', 'mud', 'kibble-turbo'];

/**
 * Case d'objet : icône de l'objet tenu, ou roulette pendant le tirage (« ? » fixe si animations
 * réduites), ou empreinte de patte estompée si la case est vide. Utilisée en grand (objet
 * suivant) et en petit (réserve).
 */
@Component({
  selector: 'app-hud-item-slot',
  imports: [ItemIcon],
  host: { class: 'block' },
  template: `
    <div
      role="img"
      [attr.aria-label]="label()"
      class="grid place-items-center overflow-hidden border-white/85 bg-slate-900/80 shadow-lg"
      [class]="large() ? 'size-20 rounded-2xl border-4' : 'size-12 rounded-xl border-2'"
    >
      @let held = kind();
      @let iconSize = large() ? 'size-14' : 'size-8';
      @if (rolling()) {
        <span class="roulette block overflow-hidden" [class]="iconSize">
          <span class="roulette-strip flex flex-col">
            @for (roll of roulette; track roll) {
              <app-item-icon class="shrink-0" [class]="iconSize" [kind]="roll" />
            }
          </span>
        </span>
        <span
          class="roulette-static font-black text-white"
          [class]="large() ? 'text-4xl' : 'text-xl'"
          >?</span
        >
      } @else if (held) {
        <app-item-icon [class]="iconSize" [kind]="held" />
      } @else {
        <!-- Case vide : empreinte de patte estompée (décor), le libellé dit l'état vide. -->
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
export class HudItemSlot {
  readonly kind = input<ItemKind | null>(null);
  readonly rolling = input(false);
  readonly large = input(true);
  /** Libellé complet de la case (« Objet : Os », « Réserve : vide »…). */
  readonly label = input.required<string>();
  protected readonly roulette = ROULETTE;
}
