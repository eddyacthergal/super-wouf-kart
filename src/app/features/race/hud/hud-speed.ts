import { Component, computed, input } from '@angular/core';

/** Compteur de vitesse (km/h). */
@Component({
  selector: 'app-hud-speed',
  host: { class: 'hud-panel flex items-baseline gap-1' },
  template: `
    <span class="sr-only">Vitesse : </span>
    <span class="w-[3ch] text-right text-4xl leading-none font-black tabular-nums">{{ rounded() }}</span>
    <span class="text-base font-bold"> km/h</span>
  `,
})
export class HudSpeed {
  readonly kmh = input.required<number>();

  protected readonly rounded = computed(() => {
    const value = Math.round(Math.abs(this.kmh()));
    return Number.isFinite(value) ? value : 0;
  });
}
