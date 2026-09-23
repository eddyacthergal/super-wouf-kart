import { Component, computed, input } from '@angular/core';

/** Barre de statistique en pastilles (« Vitesse : 3 sur 5 » pour les lecteurs d'écran). */
@Component({
  selector: 'app-stat-bar',
  host: { class: 'block' },
  template: `
    <span role="img" [attr.aria-label]="accessibleLabel()" class="flex items-center gap-2">
      <span class="w-28 shrink-0 text-sm font-bold">{{ label() }}</span>
      <span class="flex gap-1">
        @for (filled of pips(); track $index) {
          <span
            class="h-3 w-5 rounded-full border-2 border-leaf-700"
            [class.bg-leaf-700]="filled"
            [class.bg-white]="!filled"
          ></span>
        }
      </span>
      <span class="text-sm font-bold text-moss-700">{{ value() }}/{{ max() }}</span>
    </span>
  `,
})
export class StatBar {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly max = input(5);

  protected readonly accessibleLabel = computed(() => `${this.label()} : ${this.value()} sur ${this.max()}`);
  protected readonly pips = computed(() => Array.from({ length: this.max() }, (_, index) => index < this.value()));
}
