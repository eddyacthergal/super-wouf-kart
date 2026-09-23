/**
 * Progression d'un pilote : distance non bouclée, tours et arrivée.
 * `progress` suit l'abscisse curviligne pas à pas ; un recul la fait diminuer, mais un tour
 * déjà annoncé n'est jamais perdu ni réannoncé.
 */
import type { EmitEvent, RaceState, RacerState, TrackQuery } from '../core/types';

/** Vitesse minimale (m/s) retenue pour interpoler l'instant d'arrivée sous le pas. */
const MIN_FINISH_SPEED = 1;

export function updateProgress(
  racer: RacerState,
  race: RaceState,
  track: TrackQuery,
  emit: EmitEvent,
): void {
  const kart = racer.kart;
  // Position invalide (NaN, ±∞) : la projection renverrait une abscisse arbitraire et fausserait
  // la progression pour le reste de la course ; on garde le dernier état connu.
  if (!Number.isFinite(kart.position.x) || !Number.isFinite(kart.position.z)) return;
  // Projection exacte (la position a pu changer après stepKart : collisions entre karts).
  const projection = track.project(kart.position, kart.trackIndex);
  kart.trackIndex = projection.index;
  kart.lateral = projection.lateral;

  const length = track.length;
  const half = length / 2;
  let ds = projection.s - racer.lastS;
  if (ds > half) ds -= length;
  else if (ds < -half) ds += length;
  racer.progress += ds;
  racer.lastS = projection.s;

  const completedLaps = Math.floor(racer.progress / length);
  const lap = Math.min(race.laps, completedLaps + 1);
  for (let next = racer.lap + 1; next <= lap; next++) {
    emit({ type: 'lap', racerId: racer.id, lap: next });
    if (next === race.laps) emit({ type: 'final-lap', racerId: racer.id });
  }
  if (lap > racer.lap) racer.lap = lap;

  const raceDistance = race.laps * length;
  if (racer.finished || !(racer.progress >= raceDistance)) return;
  racer.finished = true;
  // Instant du franchissement, interpolé sous le pas ; l'ordre d'arrivée fait foi si deux
  // pilotes franchissent la ligne pendant le même pas.
  const overshoot = racer.progress - raceDistance;
  const crossing = race.time - overshoot / Math.max(Math.abs(kart.speed), MIN_FINISH_SPEED);
  const finishTime = Number.isFinite(crossing) ? crossing : race.time;
  racer.finishTime = Math.max(0, finishTime, previousFinishTime(race));
  race.finishOrder.push(racer.id);
  emit({ type: 'finish', racerId: racer.id, rank: race.finishOrder.length });
}

/** Temps du dernier pilote arrivé (0 si personne). */
function previousFinishTime(race: RaceState): number {
  const count = race.finishOrder.length;
  if (count === 0) return 0;
  const lastId = race.finishOrder[count - 1];
  const last = race.racers.find((racer) => racer.id === lastId);
  return last?.finishTime ?? 0;
}
