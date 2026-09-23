/**
 * Tableau des résultats dans l'ordre du classement. Les pilotes pas encore arrivés reçoivent un
 * temps estimé d'après leur vitesse moyenne ; les temps ne décroissent jamais d'un rang au suivant.
 */
import type { RaceState, RacerState } from '../core/types';
import type { RaceResultEntry } from '../game-api';

/** Part de la vitesse max retenue quand la vitesse moyenne n'est pas encore connue. */
const FALLBACK_SPEED_FACTOR = 0.8;
/** Vitesse moyenne minimale (m/s) d'une estimation. */
const MIN_AVERAGE_SPEED = 10;
/** Écart (s) imposé à une estimation qui passerait devant le pilote classé juste avant. */
const ESTIMATE_GAP = 0.1;

export function computeResults(race: RaceState): RaceResultEntry[] {
  const ordered = race.racers.slice().sort((a, b) => a.rank - b.rank || a.id - b.id);
  const results: RaceResultEntry[] = [];
  let previousTime = 0;
  for (const racer of ordered) {
    const finished = racer.finished && racer.finishTime !== null;
    let time = finished ? (racer.finishTime ?? race.time) : estimateTime(racer, race);
    // Estimation impossible (progression invalide) : juste derrière le pilote précédent.
    if (!Number.isFinite(time)) time = Math.max(previousTime, race.time) + ESTIMATE_GAP;
    if (!finished && results.length > 0 && time < previousTime) time = previousTime + ESTIMATE_GAP;
    results.push({
      rank: results.length + 1,
      racerId: racer.id,
      name: racer.name,
      breed: racer.breed,
      isPlayer: racer.isPlayer,
      time,
      estimated: !finished,
    });
    previousTime = time;
  }
  return results;
}

/** Temps actuel + distance restante / vitesse moyenne (ou une vitesse par défaut en début de course). */
function estimateTime(racer: RacerState, race: RaceState): number {
  const remaining = Math.max(0, race.laps * race.trackLength - racer.progress);
  const average =
    racer.progress > 0 && race.time > 0
      ? racer.progress / race.time
      : racer.tuning.maxSpeed * FALLBACK_SPEED_FACTOR;
  const speed = Math.max(MIN_AVERAGE_SPEED, Number.isFinite(average) ? average : 0);
  return race.time + remaining / speed;
}
