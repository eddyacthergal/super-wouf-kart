import { Component, computed, input } from '@angular/core';

/** Compteur de vitesse (km/h) ; version réduite (`compact`) sur écran tactile. */
@Component({
  selector: 'app-hud-speed',
  host: { class: 'hud-panel flex items-baseline gap-1' },
  template: `
    <span class="sr-only">Vitesse : </span>
    <span
      class="w-[3ch] text-right leading-none font-black tabular-nums"
      [class.text-4xl]="!compact()"
      [class.text-xl]="compact()"
      >{{ rounded() }}</span
    >
    <span class="font-bold" [class.text-base]="!compact()" [class.text-xs]="compact()"> km/h</span>
  `,
})
export class HudSpeed {
  readonly kmh = input.required<number>();
  /** Version réduite, pour laisser la piste visible sur petit écran. */
  readonly compact = input(false);

  protected readonly rounded = computed(() => {
    const value = Math.round(Math.abs(this.kmh()));
    return Number.isFinite(value) ? value : 0;
  });
}
