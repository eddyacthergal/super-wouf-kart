import { Component, input } from '@angular/core';
import type { ItemKind } from '../../../../game/core/types';

/** Icône SVG décorative d'un objet (le libellé accessible est porté par le parent). */
@Component({
  selector: 'app-item-icon',
  host: { class: 'block' },
  template: `
    <svg viewBox="0 0 48 48" class="size-full" aria-hidden="true" focusable="false">
      @switch (kind()) {
        @case ('bone') {
          <g transform="rotate(-30 24 24)">
            <g fill="#6b4423">
              <rect x="11" y="19" width="26" height="10" rx="4" />
              <circle cx="11" cy="18.5" r="6.5" />
              <circle cx="11" cy="29.5" r="6.5" />
              <circle cx="37" cy="18.5" r="6.5" />
              <circle cx="37" cy="29.5" r="6.5" />
            </g>
            <g fill="#fdf6e3">
              <rect x="11" y="20.5" width="26" height="7" rx="3" />
              <circle cx="11" cy="18.5" r="5" />
              <circle cx="11" cy="29.5" r="5" />
              <circle cx="37" cy="18.5" r="5" />
              <circle cx="37" cy="29.5" r="5" />
            </g>
          </g>
        }
        @case ('tennis-ball') {
          <circle cx="24" cy="24" r="18" fill="#d4e83a" stroke="#6f7f10" stroke-width="2" />
          <path d="M10 13 Q21 24 10 35" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" />
          <path d="M38 13 Q27 24 38 35" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" />
        }
        @case ('mud') {
          <path
            d="M7 31 C3 23 13 16 19 20 C23 11 35 13 35 21 C43 21 46 31 38 35 C32 41 13 41 7 31 Z"
            fill="#6b4423"
          />
          <ellipse cx="19" cy="27" rx="5" ry="2.5" fill="#8f6136" />
          <ellipse cx="31" cy="31" rx="4" ry="2" fill="#8f6136" />
          <circle cx="27" cy="22" r="1.8" fill="#a8774a" />
        }
        @case ('kibble-turbo') {
          <path d="M11 18 Q24 7 37 18 Q43 30 31 38 Q18 43 11 32 Q7 24 11 18 Z" fill="#a0612b" stroke="#5c3310" stroke-width="2" />
          <path
            d="M27 10 L16 27 L23 27 L20 39 L33 21 L26 21 L29 10 Z"
            fill="#ffcf3f"
            stroke="#7a3d0a"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        }
      }
    </svg>
  `,
})
export class ItemIcon {
  readonly kind = input.required<ItemKind>();
}
