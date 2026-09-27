import { Component, input } from '@angular/core';

/** « Aspiration ! » pendant la charge (texte clair sur le panneau sombre : contraste AA). */
@Component({
  selector: 'app-hud-slipstream',
  host: { class: 'block' },
  template: `
    @if (active()) {
      <p
        class="hud-panel font-black text-sky-200"
        [class.text-sm]="!compact()"
        [class.text-xs]="compact()"
      >
        Aspiration !
      </p>
    }
  `,
})
export class HudSlipstream {
  readonly active = input(false);
  readonly compact = input(false);
}
