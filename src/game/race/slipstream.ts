/**
 * Aspiration : un kart qui roule dans le sillage d'un autre (assez près, dans son axe, assez vite,
 * dans le même sens) remplit une jauge ; pleine, elle donne un turbo. Vaut pour tous les pilotes.
 */
import { SLIPSTREAM } from '../core/constants';
import { applyBoost } from '../core/kart-state';
import type { EmitEvent, RacerState } from '../core/types';
import { wrapAngle } from '../core/vec2';

/** Vrai si `self` roule dans le sillage d'un autre pilote. */
export function inSlipstream(self: RacerState, racers: readonly RacerState[]): boolean {
  const kart = self.kart;
  if (kart.spinTime > 0) return false;
  if (kart.speed < SLIPSTREAM.minSpeedRatio * self.tuning.maxSpeed) return false;
  const minSq = SLIPSTREAM.minDistance ** 2;
  const maxSq = SLIPSTREAM.maxDistance ** 2;
  for (const other of racers) {
    if (other.id === self.id) continue;
    const dx = other.kart.position.x - kart.position.x;
    const dz = other.kart.position.z - kart.position.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < minSq || distanceSq > maxSq) continue;
    // Même sens : un kart qui arrive en face ne protège pas du vent.
    if (Math.cos(other.kart.heading - kart.heading) <= 0) continue;
    const bearing = wrapAngle(Math.atan2(dx, dz) - kart.heading);
    if (Math.abs(bearing) <= SLIPSTREAM.halfAngle) return true;
  }
  return false;
}

/** Remplit ou vide la jauge de chaque pilote ; turbo quand elle est pleine. */
export function stepSlipstream(racers: readonly RacerState[], dt: number, emit: EmitEvent): void {
  const rate = dt / SLIPSTREAM.chargeTime;
  for (const racer of racers) {
    const kart = racer.kart;
    kart.slipstream = inSlipstream(racer, racers)
      ? kart.slipstream + rate
      : Math.max(0, kart.slipstream - rate * SLIPSTREAM.decayFactor);
    if (kart.slipstream >= 1 - 1e-9) {
      kart.slipstream = 0;
      applyBoost(kart, SLIPSTREAM.boostDuration, SLIPSTREAM.boostStrength);
      emit({ type: 'boost', racerId: racer.id, source: 'slipstream' });
    }
  }
}
