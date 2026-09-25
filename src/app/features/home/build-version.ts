import { Component, computed, input } from '@angular/core';
import { BUILD_INFO } from '../../core/build-info';

const BUILD_DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
});

/** Version du jeu (package.json) et date du build, en pied de l'accueil. */
@Component({
  selector: 'app-build-version',
  template: `
    <p class="text-sm text-moss-700">
      Version {{ version() }} · build du
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
    return Number.isNaN(date.getTime()) ? iso : BUILD_DATE_FORMAT.format(date);
  });
}
