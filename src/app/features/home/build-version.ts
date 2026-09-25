import { Component, computed, input } from '@angular/core';
import { BUILD_INFO } from '../../core/build-info';

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
      Version {{ version() }} · build
      <time [attr.datetime]="buildDate()">{{ buildDateLabel() }}</time>
    </p>
  `,
})
export class BuildVersion {
  readonly version = input<string>(BUILD_INFO.version);
  /** Date ISO 8601 du build. */
  readonly buildDate = input<string>(BUILD_INFO.buildDate);

  protected readonly buildDateLabel = computed(() => {
    const iso = this.buildDate();
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : formatBuildDate(date);
  });
}
