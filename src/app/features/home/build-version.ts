import { Component, computed, inject, input, signal } from '@angular/core';
import { APP_VERSION, BUILD_DATE_LOADER } from '../../core/build-info';

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** Date au format dd/MM/yyyy HH:mm:ss, dans le fuseau du navigateur. */
export function formatBuildDate(date: Date): string {
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear(), 4)}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day} ${time}`;
}

/** Version du jeu (package.json) et date du build, en pied de l'accueil. */
@Component({
  selector: 'app-build-version',
  template: `
    <p class="text-sm text-moss-700">
      Version {{ version() }}
      @if (buildDateLabel(); as label) {
        · build <time [attr.datetime]="buildDate()">{{ label }}</time>
      }
    </p>
  `,
})
export class BuildVersion {
  readonly version = input<string>(APP_VERSION);
  /** Date ISO 8601 du build, chargée depuis build-info.json ; null tant qu'elle est inconnue. */
  protected readonly buildDate = signal<string | null>(null);

  protected readonly buildDateLabel = computed(() => {
    const iso = this.buildDate();
    if (iso === null) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : formatBuildDate(date);
  });

  constructor() {
    void inject(BUILD_DATE_LOADER)().then((date) => this.buildDate.set(date));
  }
}
