/**
 * Données du HUD : détection du contre-sens et instantané publié vers l'interface Angular.
 * Aucune dépendance au rendu ni au DOM.
 */
import type { RaceState, RacerState, TrackQuery, Vec2 } from './core/types';
import type { HudSnapshot } from './game-api';

/** dot(avant, tangente) sous lequel le kart roule à contre-sens. */
const WRONG_WAY_ALIGNMENT = -0.5;
/** Vitesse (m/s) au-delà de laquelle le contre-sens compte. */
const WRONG_WAY_MIN_SPEED = 3;
/** Durée (s) de contre-sens avant l'alerte. */
const WRONG_WAY_DELAY = 1;
/** Conversion m/s → km/h. */
const MS_TO_KMH = 3.6;

/**
 * Alerte « contre-sens » : vraie quand le kart roule dans le mauvais sens (nez opposé à la tangente,
 * vitesse > 3 m/s) depuis plus d'une seconde ; fausse dès qu'il se remet dans le bon sens.
 * Arrêté face au mauvais sens, le temps ne s'accumule plus mais une alerte déjà levée reste affichée.
 */
export class WrongWayTracker {
  private elapsed = 0;

  update(racer: RacerState, track: TrackQuery, dt: number): boolean {
    const kart = racer.kart;
    const tangent = tangentAt(track, kart.trackIndex, kart.position);
    const alignment = Math.sin(kart.heading) * tangent.x + Math.cos(kart.heading) * tangent.z;
    if (!(alignment < WRONG_WAY_ALIGNMENT)) {
      this.elapsed = 0;
      return false;
    }
    if (kart.speed > WRONG_WAY_MIN_SPEED && dt > 0 && Number.isFinite(dt)) this.elapsed += dt;
    return this.elapsed > WRONG_WAY_DELAY;
  }

  reset(): void {
    this.elapsed = 0;
  }
}

/** Tangente du circuit à l'échantillon connu du kart (projection complète si l'indice est invalide). */
function tangentAt(track: TrackQuery, index: number, position: Vec2): Vec2 {
  const sample = Number.isInteger(index) ? track.samples[index] : undefined;
  return sample ? sample.tangent : track.project(position).sample.tangent;
}

/** Instantané du HUD pour le joueur (ou le premier pilote s'il n'y a pas de joueur). */
export function buildHudSnapshot(state: RaceState, wrongWay: boolean): HudSnapshot {
  const player = state.racers.find((racer) => racer.id === state.playerId) ?? state.racers[0];
  const kart = player?.kart;
  return {
    phase: state.phase,
    countdown: state.phase === 'countdown' ? Math.max(1, Math.ceil(state.countdown)) : null,
    lap: player?.lap ?? 1,
    laps: state.laps,
    rank: player?.rank ?? 1,
    racerCount: state.racers.length,
    raceTime: state.time,
    item: player?.item ?? null,
    itemRolling: (player?.itemRoulette ?? 0) > 0,
    drifting: kart?.drift.active ?? false,
    driftTier: kart?.drift.active ? kart.drift.tier : 0,
    boosting: (kart?.boostTime ?? 0) > 0,
    wrongWay,
    speedKmh: kart ? Math.round(Math.abs(kart.speed) * MS_TO_KMH) : 0,
    dots: state.racers.map((racer) => ({
      id: racer.id,
      x: racer.kart.position.x,
      z: racer.kart.position.z,
    })),
  };
}
