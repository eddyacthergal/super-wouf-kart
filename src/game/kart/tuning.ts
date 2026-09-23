/** Conversion des stats d'une race (1 à 5 points) en réglages physiques du kart. */
import { PHYSICS } from '../core/constants';
import type { KartTuning, StatBlock } from '../core/types';
import { clamp } from '../core/vec2';

const STAT_MIN = 1;
const STAT_MAX = 5;

/** Une stat hors bornes (donnée corrompue) est ramenée dans [1, 5]. */
const points = (value: number): number => clamp(value, STAT_MIN, STAT_MAX);

export function tuningFromStats(stats: StatBlock): KartTuning {
  const speed = points(stats.speed);
  const acceleration = points(stats.acceleration);
  const weight = points(stats.weight);
  const handling = points(stats.handling);
  return {
    maxSpeed: PHYSICS.maxSpeedBase + PHYSICS.maxSpeedPerPoint * speed,
    acceleration: PHYSICS.accelerationBase + PHYSICS.accelerationPerPoint * acceleration,
    turnRate: PHYSICS.turnRateBase + PHYSICS.turnRatePerPoint * handling,
    mass: PHYSICS.massBase + PHYSICS.massPerPoint * weight,
    offroadFactor: PHYSICS.offroadFactorBase + PHYSICS.offroadFactorPerPoint * weight,
  };
}
