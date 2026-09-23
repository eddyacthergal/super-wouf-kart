import { Component, input } from '@angular/core';

/** Tour en cours : « Tour 2/3 ». */
@Component({
  selector: 'app-hud-lap',
  host: { class: 'hud-panel block text-xl font-extrabold' },
  template: `
    <span aria-hidden="true">Tour {{ lap() }}/{{ laps() }}</span>
    <span class="sr-only">Tour {{ lap() }} sur {{ laps() }}</span>
  `,
})
export class HudLap {
  readonly lap = input.required<number>();
  readonly laps = input.required<number>();
}
