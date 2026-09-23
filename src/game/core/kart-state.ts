import { ITEMS } from './constants';
import type { KartState } from './types';
import { clone, type Vec2 } from './vec2';

/** Kart à l'arrêt, prêt au départ. */
export function createKartState(position: Vec2, heading: number, trackIndex = 0): KartState {
  return {
    position: clone(position),
    heading,
    speed: 0,
    steer: 0,
    drift: { active: false, direction: 0, charge: 0, tier: 0 },
    boostTime: 0,
    boostStrength: 1,
    hopTime: 0,
    spinTime: 0,
    offroad: false,
    wallContact: false,
    visualYaw: 0,
    prevPosition: clone(position),
    prevHeading: heading,
    trackIndex,
    lateral: 0,
  };
}

/**
 * Déclenche un boost. Un boost en cours n'est jamais raccourci :
 * on garde la plus longue durée et la plus forte intensité.
 */
export function applyBoost(kart: KartState, duration: number, strength: number): void {
  kart.boostStrength = kart.boostTime > 0 ? Math.max(kart.boostStrength, strength) : strength;
  kart.boostTime = Math.max(kart.boostTime, duration);
}

/** Tête-à-queue après un impact : perte de vitesse, dérapage et boost annulés. */
export function applySpinOut(kart: KartState): void {
  kart.spinTime = ITEMS.spinDuration;
  kart.speed *= ITEMS.spinSpeedFactor;
  kart.drift = { active: false, direction: 0, charge: 0, tier: 0 };
  kart.boostTime = 0;
  kart.boostStrength = 1;
}
