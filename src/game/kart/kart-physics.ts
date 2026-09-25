/**
 * Physique arcade d'un kart sur le plan du sol : vitesse, direction, dérapage avec
 * mini-turbo, bas-côté, haies et tête-à-queue. Un appel = un pas de simulation.
 * Conventions : avant = (sin θ, cos θ) ; steer = +1 (droite) fait diminuer θ.
 */
import { DRIFT, KART_RADIUS, PHYSICS } from '../core/constants';
import { applyBoost } from '../core/kart-state';
import type { DriftState, DriftTier, DriverInput, KartEvent, KartState, KartTuning, TrackQuery } from '../core/types';
import { approach, clamp, clone, headingOf, lerpAngle, wrapAngle } from '../core/vec2';

/** Freinage naturel pendant un tête-à-queue (m/s²). */
const SPIN_DECELERATION = 18;
/** Vitesse de rotation visuelle pendant un tête-à-queue (rad/s). */
const SPIN_YAW_RATE = 14;
/** Convergence de la pose visuelle (visualYaw) vers sa cible (1/s). */
const VISUAL_YAW_RESPONSE = 8;
/** Retour vers la vitesse max effective quand on la dépasse (m/s²). */
const OVERSPEED_DECELERATION = 12;
/** Accélération dégressive : a × (1 − k × (v / vmax)²). */
const ACCELERATION_FALLOFF = 0.6;
/** Le boost double l'accélération. */
const BOOST_ACCELERATION_FACTOR = 2;
/** La marche arrière accélère deux fois moins vite. */
const REVERSE_ACCELERATION_FACTOR = 0.5;

/** Braquage minimal (|steer|) pour lancer un dérapage. */
const DRIFT_STEER_THRESHOLD = 0.2;
/** Sous cette fraction de DRIFT.minSpeed, le dérapage s'annule sans boost. */
const DRIFT_CANCEL_RATIO = 0.7;
/** Charge supplémentaire quand on braque dans le sens du dérapage. */
const DRIFT_CHARGE_STEER_BONUS = 0.5;
/** Paliers de charge signalés par un événement 'drift-tier'. */
const CHARGED_TIERS: readonly DriftTier[] = [1, 2, 3];

/** Perte de vitesse minimale d'un choc, même rasant (fraction de la perte maximale). */
const WALL_IMPACT_FLOOR = 0.2;
/** Freinage en frottant la haie après le choc (m/s²). */
const WALL_RUB_DECELERATION = 8;
/** Part de l'écart ramenée vers la tangente à chaque pas de contact. */
const WALL_HEADING_BLEND = 0.35;
/** En dessous de cette incidence, le cap est aligné d'un coup (glissade le long de la haie). */
const WALL_ALIGN_THRESHOLD = 0.1;
/** Le cap n'est aligné à contre-sens que si le kart pointe nettement vers l'arrière (cos de l'angle). */
const WALL_BACKWARD_ALIGN = -0.2;
/** Vitesse d'approche (m/s) donnant une intensité de choc de 1. */
const WALL_FULL_IMPACT_SPEED = 30;
/** Pendant un contact prolongé, seul un nouveau choc plus fort que ce seuil est signalé. */
const WALL_REPEAT_INTENSITY = 0.3;

/** État interne par kart, hors contrat (KartState est figé). */
interface KartMemory {
  /** État du bouton de dérapage au pas précédent (détection du front montant). */
  driftHeld: boolean;
  /** Contact avec une haie au pas précédent. */
  wallContact: boolean;
  /** Intensité du contact au pas précédent. */
  wallIntensity: number;
}

const memories = new WeakMap<KartState, KartMemory>();

function memoryOf(kart: KartState): KartMemory {
  let memory = memories.get(kart);
  if (!memory) {
    memory = { driftHeld: false, wallContact: kart.wallContact, wallIntensity: 0 };
    memories.set(kart, memory);
  }
  return memory;
}

/** Fait avancer le kart d'un pas `dt`. Modifie `kart` en place. */
export function stepKart(
  kart: KartState,
  input: DriverInput,
  tuning: KartTuning,
  track: TrackQuery,
  dt: number,
  emit: (event: KartEvent) => void,
): void {
  const memory = memoryOf(kart);
  const driftPressed = input.drift && !memory.driftHeld;
  memory.driftHeld = input.drift;

  kart.prevPosition = clone(kart.position);
  kart.prevHeading = kart.heading;
  kart.wallContact = false;

  tickTimers(kart, dt);

  const spinning = kart.spinTime > 0;
  if (spinning) {
    stepSpin(kart, dt);
  } else {
    // Une consigne invalide (NaN, infinie) vaut « tout droit » plutôt que d'empoisonner l'état.
    const steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    kart.steer = approach(kart.steer, steer, PHYSICS.steerResponse * dt);
    stepDrift(kart, input.drift, driftPressed, steer, dt, emit);
    stepSpeed(kart, input, tuning, dt);
    kart.heading = wrapAngle(kart.heading + turnDelta(kart, steer, tuning, dt));
  }

  const distance = kart.speed * dt;
  kart.position = {
    x: kart.position.x + Math.sin(kart.heading) * distance,
    z: kart.position.z + Math.cos(kart.heading) * distance,
  };

  collideWithTrack(kart, track, dt, memory, emit);

  if (!spinning) {
    const target = kart.drift.active ? driftVisualYaw(kart.drift.direction, kart.steer) : 0;
    kart.visualYaw += (target - kart.visualYaw) * Math.min(1, VISUAL_YAW_RESPONSE * dt);
  }
}

/** Angle de glisse visé en dérapage : plus prononcé en braquant dans le sens du dérapage. */
function driftVisualYaw(direction: number, steer: number): number {
  return -direction * (DRIFT.visualYaw + DRIFT.visualYawSteer * steer * direction);
}

function tickTimers(kart: KartState, dt: number): void {
  kart.hopTime = Math.max(0, kart.hopTime - dt);
  kart.spinTime = Math.max(0, kart.spinTime - dt);
  if (kart.boostTime > 0) {
    kart.boostTime = Math.max(0, kart.boostTime - dt);
    if (kart.boostTime === 0) kart.boostStrength = 1;
  }
}

/** Tête-à-queue : aucune commande, le kart glisse en ralentissant et tourne sur lui-même (visuel). */
function stepSpin(kart: KartState, dt: number): void {
  kart.steer = 0;
  resetDrift(kart.drift);
  kart.speed = approach(kart.speed, 0, SPIN_DECELERATION * dt);
  // Au retour du contrôle, la pose visuelle revient vers 0 par le plus court chemin.
  kart.visualYaw = wrapAngle(kart.visualYaw + SPIN_YAW_RATE * dt);
}

function resetDrift(drift: DriftState): void {
  drift.active = false;
  drift.direction = 0;
  drift.charge = 0;
  drift.tier = 0;
}

function tierFor(charge: number): DriftTier {
  const [blue, orange, purple] = DRIFT.tierThresholds;
  if (charge >= purple) return 3;
  if (charge >= orange) return 2;
  return charge >= blue ? 1 : 0;
}

function stepDrift(
  kart: KartState,
  held: boolean,
  pressed: boolean,
  steer: number,
  dt: number,
  emit: (event: KartEvent) => void,
): void {
  const drift = kart.drift;

  if (drift.active) {
    if (!held) {
      const tier = drift.tier;
      if (tier > 0) {
        applyBoost(kart, DRIFT.boostDurations[tier], DRIFT.boostStrength);
        emit({ type: 'boost', source: 'drift', tier });
      }
      resetDrift(drift);
    } else if (kart.speed < DRIFT_CANCEL_RATIO * DRIFT.minSpeed) {
      resetDrift(drift);
    } else {
      drift.charge += dt * (1 + DRIFT_CHARGE_STEER_BONUS * Math.max(0, steer * drift.direction));
      // Un événement par palier franchi, même si un grand pas en franchit plusieurs.
      const tier = tierFor(drift.charge);
      for (const reached of CHARGED_TIERS) {
        if (reached > drift.tier && reached <= tier) emit({ type: 'drift-tier', tier: reached });
      }
      if (tier > drift.tier) drift.tier = tier;
    }
    return;
  }

  if (!held) return;
  if (Math.abs(steer) > DRIFT_STEER_THRESHOLD && kart.speed >= DRIFT.minSpeed) {
    drift.active = true;
    drift.direction = steer > 0 ? 1 : -1;
    drift.charge = 0;
    drift.tier = 0;
    kart.hopTime = DRIFT.hopDuration;
    emit({ type: 'drift-start' });
  } else if (pressed) {
    // Appui sans braquage suffisant (ou trop lent) : simple saut.
    kart.hopTime = DRIFT.hopDuration;
  }
}

function stepSpeed(kart: KartState, input: DriverInput, tuning: KartTuning, dt: number): void {
  const boosting = kart.boostTime > 0;
  const maxSpeed =
    tuning.maxSpeed * (boosting ? kart.boostStrength : 1) * (kart.offroad && !boosting ? tuning.offroadFactor : 1);

  if (input.brake) {
    kart.speed =
      kart.speed > 0
        ? Math.max(0, kart.speed - PHYSICS.brakeDeceleration * dt)
        : approach(kart.speed, -PHYSICS.reverseMaxSpeed, REVERSE_ACCELERATION_FACTOR * tuning.acceleration * dt);
  } else if (input.throttle || boosting) {
    if (kart.speed < maxSpeed) {
      const ratio = kart.speed / maxSpeed;
      const boostFactor = boosting ? BOOST_ACCELERATION_FACTOR : 1;
      const acceleration = tuning.acceleration * boostFactor * (1 - ACCELERATION_FALLOFF * ratio * ratio);
      kart.speed = Math.min(maxSpeed, kart.speed + acceleration * dt);
    } else {
      kart.speed = approach(kart.speed, maxSpeed, OVERSPEED_DECELERATION * dt);
    }
  } else {
    // Au-dessus du max effectif (fin de boost, entrée sur le bas-côté), lâcher les gaz ne doit pas
    // ralentir moins vite que les garder : on redescend au moins comme avec les gaz.
    const coasting = approach(kart.speed, 0, PHYSICS.coastDeceleration * dt);
    kart.speed =
      kart.speed > maxSpeed ? Math.min(coasting, approach(kart.speed, maxSpeed, OVERSPEED_DECELERATION * dt)) : coasting;
  }
}

/** Variation de cap du pas (rad). */
function turnDelta(kart: KartState, steer: number, tuning: KartTuning, dt: number): number {
  const drift = kart.drift;
  if (drift.active) {
    // Contre-braquer élargit la courbe (steerMin), braquer dans le sens du dérapage la resserre (steerMax).
    const t = (steer * drift.direction + 1) / 2;
    const tightness = DRIFT.steerMin + (DRIFT.steerMax - DRIFT.steerMin) * t;
    return -drift.direction * tuning.turnRate * tightness * dt;
  }
  const grip = Math.min(1, Math.abs(kart.speed) / PHYSICS.minTurnSpeed);
  return -kart.steer * tuning.turnRate * grip * Math.sign(kart.speed) * dt;
}

/** Projection sur le circuit, bas-côté et haies. */
function collideWithTrack(
  kart: KartState,
  track: TrackQuery,
  dt: number,
  memory: KartMemory,
  emit: (event: KartEvent) => void,
): void {
  const projection = track.project(kart.position, kart.trackIndex);
  const { sample } = projection;
  kart.trackIndex = projection.index;
  kart.lateral = projection.lateral;
  kart.offroad = Math.abs(projection.lateral) > sample.halfWidth;

  const wasInContact = memory.wallContact;
  const previousIntensity = memory.wallIntensity;
  memory.wallContact = false;
  memory.wallIntensity = 0;

  const limit = track.wallHalfWidth - KART_RADIUS;
  if (Math.abs(kart.lateral) <= limit) return;

  // Replacement à la limite le long de la normale : l'abscisse du kart ne change pas.
  const side = kart.lateral > 0 ? 1 : -1;
  const excess = kart.lateral - side * limit;
  kart.position = { x: kart.position.x - sample.left.x * excess, z: kart.position.z - sample.left.z * excess };
  kart.lateral = side * limit;
  kart.wallContact = true;
  memory.wallContact = true;

  // Incidence : part du mouvement dirigée vers la haie (0 si le kart s'en éloigne ou la longe).
  const forwardX = Math.sin(kart.heading);
  const forwardZ = Math.cos(kart.heading);
  const motionSign = kart.speed < 0 ? -1 : 1;
  const normal = Math.max(0, (forwardX * sample.left.x + forwardZ * sample.left.z) * side * motionSign);
  if (normal === 0) return;

  // Un choc (premier contact, ou choc plus fort pendant un contact) coûte une part de la vitesse
  // selon l'incidence ; ensuite, le kart qui frotte la haie freine simplement.
  const intensity = clamp((normal * Math.abs(kart.speed)) / WALL_FULL_IMPACT_SPEED, 0, 1);
  memory.wallIntensity = intensity;
  const impact = !wasInContact || (intensity > WALL_REPEAT_INTENSITY && intensity > previousIntensity);
  if (impact) {
    kart.speed *= 1 - (1 - PHYSICS.wallSpeedRetention) * Math.min(1, normal * 2 + WALL_IMPACT_FLOOR);
    if (intensity > 0) emit({ type: 'wall', intensity });
  } else {
    kart.speed = approach(kart.speed, 0, WALL_RUB_DECELERATION * dt);
  }

  // Cap ramené le long de la haie, dans le sens de la course sauf si le kart pointe nettement à contre-sens.
  const tangentHeading = headingOf(sample.tangent);
  const along = forwardX * sample.tangent.x + forwardZ * sample.tangent.z;
  const target = along >= WALL_BACKWARD_ALIGN ? tangentHeading : wrapAngle(tangentHeading + Math.PI);
  kart.heading = normal > WALL_ALIGN_THRESHOLD ? wrapAngle(lerpAngle(kart.heading, target, WALL_HEADING_BLEND)) : target;
}
