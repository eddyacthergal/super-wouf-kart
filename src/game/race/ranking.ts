/** Classement : pilotes arrivés dans l'ordre d'arrivée, puis les autres par progression décroissante. */
import type { RaceState, RacerState } from '../core/types';

/** Tableau de travail réutilisé d'un pas à l'autre (vidé après usage). */
const order: RacerState[] = [];

export function computeRanks(race: RaceState): void {
  const finishOrder = race.finishOrder;
  for (const racer of race.racers) order.push(racer);
  order.sort((a, b) => compareRacers(a, b, finishOrder));
  for (let i = 0; i < order.length; i++) order[i].rank = i + 1;
  order.length = 0;
}

function compareRacers(a: RacerState, b: RacerState, finishOrder: readonly number[]): number {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.finished) {
    const byArrival = arrivalIndex(a, finishOrder) - arrivalIndex(b, finishOrder);
    if (byArrival !== 0) return byArrival;
  } else {
    const progressA = safeProgress(a);
    const progressB = safeProgress(b);
    if (progressA !== progressB) return progressA > progressB ? -1 : 1;
  }
  return a.id - b.id;
}

/** Rang d'arrivée ; un pilote marqué arrivé mais absent de finishOrder passe après les autres arrivés. */
function arrivalIndex(racer: RacerState, finishOrder: readonly number[]): number {
  const index = finishOrder.indexOf(racer.id);
  return index < 0 ? finishOrder.length : index;
}

/** Une progression invalide (NaN) passe derrière les autres. */
function safeProgress(racer: RacerState): number {
  return Number.isNaN(racer.progress) ? -Infinity : racer.progress;
}
