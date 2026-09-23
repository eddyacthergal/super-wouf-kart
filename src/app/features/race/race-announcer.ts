import { Component, input, linkedSignal } from '@angular/core';
import { formatPlace } from '../../shared/format';

export interface AnnouncerState {
  lap: number | null;
  laps: number | null;
  finishRank: number | null;
}

/**
 * Message à annoncer quand l'état passe de `previous` à `current`, ou null s'il n'y a rien de neuf.
 * Seuls les changements comptent : un nouveau tour, le dernier tour, l'arrivée.
 */
export function announcementFor(current: AnnouncerState, previous: AnnouncerState | undefined): string | null {
  if (current.finishRank !== null && current.finishRank !== previous?.finishRank) {
    return `Arrivée : ${formatPlace(current.finishRank)}`;
  }
  const previousLap = previous?.lap ?? null;
  if (current.lap !== null && current.laps !== null && previousLap !== null && current.lap > previousLap) {
    return current.lap === current.laps ? 'Dernier tour !' : `Tour ${current.lap} sur ${current.laps}`;
  }
  return null;
}

/** Région aria-live (visuellement masquée) qui annonce les tours et l'arrivée. */
@Component({
  selector: 'app-race-announcer',
  template: `<p class="sr-only" aria-live="polite" aria-atomic="true">{{ message() }}</p>`,
})
export class RaceAnnouncer {
  readonly lap = input<number | null>(null);
  readonly laps = input<number | null>(null);
  readonly finishRank = input<number | null>(null);

  protected readonly message = linkedSignal<AnnouncerState, string>({
    source: () => ({ lap: this.lap(), laps: this.laps(), finishRank: this.finishRank() }),
    computation: (current, previous) => {
      // Nouvelle course (état remis à zéro) : on repart d'un message vide.
      if (current.lap === null && current.finishRank === null) return '';
      return announcementFor(current, previous?.source) ?? previous?.value ?? '';
    },
  });
}
