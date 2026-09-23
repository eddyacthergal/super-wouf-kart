import { Component, computed, input } from '@angular/core';
import { formatRank, formatRankDisplay } from '../../../shared/format';

/** Position du joueur : « 3ᵉ » en grand, « / 8 » à côté. */
@Component({
  selector: 'app-hud-position',
  host: { class: 'hud-panel flex items-baseline gap-1' },
  template: `
    <span class="text-5xl leading-none font-black tabular-nums" aria-hidden="true">{{ display() }}</span>
    <span class="text-xl font-bold" aria-hidden="true">/ {{ total() }}</span>
    <span class="sr-only">Position : {{ spoken() }} sur {{ total() }}</span>
  `,
})
export class HudPosition {
  readonly rank = input.required<number>();
  readonly total = input.required<number>();

  protected readonly display = computed(() => formatRankDisplay(this.rank()));
  protected readonly spoken = computed(() => formatRank(this.rank()));
}
