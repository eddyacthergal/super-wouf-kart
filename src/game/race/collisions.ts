/**
 * Collisions entre karts : cercles de rayon KART_RADIUS. Séparation et impulsion pondérées par
 * l'inverse de la masse (un kart lourd est moins dévié). Le cap ne change pas : seule la composante
 * de la nouvelle vitesse le long du cap est conservée.
 */
import { KART_RADIUS } from '../core/constants';
import type { EmitEvent, KartState, RacerState } from '../core/types';
import { clamp } from '../core/vec2';

/** Coefficient de restitution du choc. */
const RESTITUTION = 0.3;
/** Vitesse de rapprochement (m/s) au-delà de laquelle un choc est signalé. */
const BUMP_MIN_SPEED = 2;
/** Vitesse de rapprochement (m/s) donnant une intensité de 1. */
const BUMP_FULL_SPEED = 15;
/** Masse minimale prise en compte (évite une division par zéro sur des réglages corrompus). */
const MIN_MASS = 0.1;
/** En deçà (m), les centres sont confondus : on choisit une normale arbitraire mais déterministe. */
const COINCIDENT_DISTANCE = 1e-6;

export function resolveKartCollisions(racers: readonly RacerState[], emit: EmitEvent): void {
  const minDistance = 2 * KART_RADIUS;
  const minDistanceSq = minDistance * minDistance;
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i];
      const b = racers[j];
      const dx = b.kart.position.x - a.kart.position.x;
      const dz = b.kart.position.z - a.kart.position.z;
      const distanceSq = dx * dx + dz * dz;
      if (!(distanceSq < minDistanceSq)) continue;
      const distance = Math.sqrt(distanceSq);
      // Normale unitaire de a vers b ; centres confondus : b est poussé vers la gauche de a.
      let nx: number;
      let nz: number;
      if (distance > COINCIDENT_DISTANCE) {
        nx = dx / distance;
        nz = dz / distance;
      } else {
        nx = Math.cos(a.kart.heading);
        nz = -Math.sin(a.kart.heading);
      }
      const inverseA = 1 / Math.max(a.tuning.mass, MIN_MASS);
      const inverseB = 1 / Math.max(b.tuning.mass, MIN_MASS);
      const inverseSum = inverseA + inverseB;

      separate(
        a.kart,
        b.kart,
        nx,
        nz,
        minDistance - distance,
        inverseA / inverseSum,
        inverseB / inverseSum,
      );

      const closing = exchangeImpulse(a.kart, b.kart, nx, nz, inverseA, inverseB);
      if (closing > BUMP_MIN_SPEED) {
        emit({
          type: 'bump',
          racerId: a.id,
          otherId: b.id,
          intensity: clamp(closing / BUMP_FULL_SPEED, 0, 1),
        });
      }
    }
  }
}

/**
 * Écarte les deux karts le long de la normale ; chacun recule selon sa part de l'inverse des masses.
 * Les positions sont remplacées (et non modifiées en place) : l'objet peut être partagé ailleurs.
 */
function separate(
  a: KartState,
  b: KartState,
  nx: number,
  nz: number,
  overlap: number,
  shareA: number,
  shareB: number,
): void {
  a.position = { x: a.position.x - nx * overlap * shareA, z: a.position.z - nz * overlap * shareA };
  b.position = { x: b.position.x + nx * overlap * shareB, z: b.position.z + nz * overlap * shareB };
}

/**
 * Impulsion le long de la normale si les karts se rapprochent. Renvoie la vitesse de rapprochement
 * (m/s, 0 s'ils s'éloignent déjà).
 */
function exchangeImpulse(
  a: KartState,
  b: KartState,
  nx: number,
  nz: number,
  inverseA: number,
  inverseB: number,
): number {
  const forwardAx = Math.sin(a.heading);
  const forwardAz = Math.cos(a.heading);
  const forwardBx = Math.sin(b.heading);
  const forwardBz = Math.cos(b.heading);
  const velocityAx = forwardAx * a.speed;
  const velocityAz = forwardAz * a.speed;
  const velocityBx = forwardBx * b.speed;
  const velocityBz = forwardBz * b.speed;
  const closing = (velocityAx - velocityBx) * nx + (velocityAz - velocityBz) * nz;
  if (!(closing > 0)) return 0;

  const impulse = ((1 + RESTITUTION) * closing) / (inverseA + inverseB);
  const newAx = velocityAx - nx * impulse * inverseA;
  const newAz = velocityAz - nz * impulse * inverseA;
  const newBx = velocityBx + nx * impulse * inverseB;
  const newBz = velocityBz + nz * impulse * inverseB;
  a.speed = newAx * forwardAx + newAz * forwardAz;
  b.speed = newBx * forwardBx + newBz * forwardBz;
  return closing;
}
