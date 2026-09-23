import { Component } from '@angular/core';

/** Bandeau d'alerte quand le joueur roule à contre-sens. */
@Component({
  selector: 'app-wrong-way-banner',
  host: { class: 'block' },
  template: `
    <p
      class="flex items-center gap-3 rounded-full border-4 border-sun-400 bg-red-800/90 px-6 py-2 text-3xl font-black text-white shadow-xl"
    >
      <span aria-hidden="true">⟲</span> Contre-sens !
    </p>
  `,
})
export class WrongWayBanner {}
