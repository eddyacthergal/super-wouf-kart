import { Component, computed, inject, input } from '@angular/core';
import type { SkinSlot } from '../../../game/core/types';
import { skinsForSlot } from '../../../game/dogs/skins-catalog';
import { SettingsStore } from '../../core/settings.store';

/** Accessoires d'un emplacement (tête, cou ou corps) : « Aucun » puis les accessoires du catalogue. */
@Component({
  selector: 'app-skin-picker',
  host: { class: 'block' },
  template: `
    <fieldset>
      <legend class="text-lg font-extrabold">{{ legend() }}</legend>
      <div class="mt-2 flex flex-wrap gap-2">
        <label [class]="chipClass">
          <input
            type="radio"
            class="size-5 accent-leaf-700"
            [name]="groupName()"
            value=""
            [checked]="selected() === null"
            (change)="select(null)"
          />
          Aucun
        </label>
        @for (skin of skins(); track skin.id) {
          <label [class]="chipClass">
            <input
              type="radio"
              class="size-5 accent-leaf-700"
              [name]="groupName()"
              [value]="skin.id"
              [checked]="selected() === skin.id"
              (change)="select(skin.id)"
            />
            {{ skin.name }}
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class SkinPicker {
  readonly slot = input.required<SkinSlot>();
  readonly legend = input.required<string>();

  private readonly settings = inject(SettingsStore);

  protected readonly chipClass =
    'flex cursor-pointer items-center gap-2 rounded-full border-2 border-leaf-200 bg-white px-4 py-2 font-bold ' +
    'transition-colors hover:border-leaf-500 has-checked:border-leaf-700 has-checked:bg-sun-200';
  protected readonly groupName = computed(() => `skin-${this.slot()}`);
  protected readonly skins = computed(() => skinsForSlot(this.slot()));
  protected readonly selected = computed(() => this.settings.skins()[this.slot()]);

  protected select(id: string | null): void {
    this.settings.setSkin(this.slot(), id);
  }
}
