import { Component, computed, input } from '@angular/core';
import { formatRaceTime } from '../../../shared/format';

/** Chronomètre de course (m:ss.d) : le HUD est publié ~10 fois par seconde, d'où les dixièmes. */
@Component({
  selector: 'app-hud-timer',
  host: { class: 'hud-panel block text-xl font-extrabold tabular-nums' },
  template: `<span class="sr-only">Temps : </span>{{ text() }}`,
})
export class HudTimer {
  readonly seconds = input.required<number>();

  protected readonly text = computed(() => formatRaceTime(this.seconds(), 1));
}
