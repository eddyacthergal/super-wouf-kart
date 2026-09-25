/**
 * Modèle three.js complet d'un pilote : kart + chien + accessoires, avec son animation légère.
 * `root` n'est jamais déplacé ici (le rendu le positionne) : seuls des sous-groupes sont animés.
 */
import * as THREE from 'three';
import { PHYSICS } from '../core/constants';
import type { BreedId, SkinSelection } from '../core/types';
import { clamp } from '../core/vec2';
import { BREEDS } from './breeds';
import { buildDog, computeDogLayout } from './dog-model';
import { buildKart, FRONT_WHEEL, MAX_WHEEL_STEER, REAR_WHEEL, steeringGrips } from './kart-model';
import { ResourceScope, smoothTowards } from './model-resources';
import { buildSkin, type SkinInstance } from './skin-models';
import { isSkinInSlot, SKIN_SLOTS } from './skins-catalog';

export interface RacerVisualState {
  /** Vitesse signée (m/s). */
  speed: number;
  /** Braquage -1..1 (+1 = droite). */
  steer: number;
  /** Sens du dérapage : -1 = gauche, +1 = droite, 0 = aucun. */
  driftDirection: -1 | 0 | 1;
  boosting: boolean;
  spinning: boolean;
  /** Hauteur du petit saut, 0..1. */
  hop: number;
}

export interface RacerModel {
  root: THREE.Group;
  /**
   * Sorties des pots d'échappement, gauche puis droite. Sans rotation propre : le gaz part
   * vers -Z du kart (getWorldDirection() renvoie l'avant du kart, pas le sens du gaz).
   */
  exhausts: THREE.Object3D[];
  /** Centres des roues arrière, gauche (+X) puis droite, sans rotation (étincelles de dérapage). */
  rearWheels: THREE.Object3D[];
  update(dt: number, state: RacerVisualState): void;
  dispose(): void;
}

export interface RacerModelOptions {
  breed: BreedId;
  skins: SkinSelection;
  /** Couleur de carrosserie (#rrggbb). */
  kartColor: string;
}

/** Réglages de l'animation. */
const ANIMATION = {
  /** Vitesse de référence pour normaliser les effets (m/s). */
  referenceSpeed: PHYSICS.maxSpeedBase + PHYSICS.maxSpeedPerPoint * 3,
  hopHeight: 0.35,
  driftTilt: 0.09,
  /** Braquage (fraction) des roues avant en contre-braquage pendant un dérapage. */
  driftCounterSteer: 0.6,
  steerSmoothing: 12,
  tiltSmoothing: 8,
  /** Lissage de la vitesse perçue (oreilles, cape) : pas de saut quand la vitesse chute (impact). */
  speedSmoothing: 6,
  spinSmoothing: 10,
  steeringWheelTurn: 1.1,
  headRoll: 0.22,
  headYaw: 0.3,
  earWind: 1,
  bounceHeight: 0.022,
  rumbleHeight: 0.004,
  tailAmplitude: 0.55,
} as const;

const TWO_PI = Math.PI * 2;

export function buildRacerModel(options: RacerModelOptions): RacerModel {
  const breed = BREEDS[options.breed];
  const scope = new ResourceScope();
  const layout = computeDogLayout(breed.look);
  const kart = buildKart(scope, {
    color: options.kartColor,
    steeringCenter: layout.steeringCenter,
    seatBack: breed.look.seatBack,
  });

  const bodySkin = isSkinInSlot(options.skins.body, 'body') ? options.skins.body : null;
  const dog = buildDog(scope, breed, layout, {
    grips: steeringGrips(layout.steeringCenter),
    showBelly: bodySkin !== 'sweater',
  });
  kart.chassis.add(dog.root);

  const skins: SkinInstance[] = [];
  for (const slot of SKIN_SLOTS) {
    const id = options.skins[slot];
    if (!isSkinInSlot(id, slot)) continue;
    const skin = buildSkin(scope, id, dog.fit);
    if (!skin) continue;
    dog.attach[slot].add(skin.object);
    skins.push(skin);
  }

  const root = new THREE.Group();
  root.name = 'racer';
  root.add(kart.lift);
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });

  let time = 0;
  let steer = 0;
  let wheelSteer = 0;
  let tilt = 0;
  let frontSpin = 0;
  let rearSpin = 0;
  let speedFactor = 0;
  let spinBlend = 0;
  // Phases intégrées pas à pas : sin(time × fréquence variable) ferait sauter les oreilles
  // et la queue dès que la vitesse change, d'autant plus fort que la course dure.
  let earPhase = 0;
  let tailPhase = 0;
  let disposed = false;
  const dogBaseY = dog.root.position.y;

  const update = (dt: number, state: RacerVisualState): void => {
    if (disposed) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const speed = Number.isFinite(state.speed) ? state.speed : 0;
    time += step;
    speedFactor = smoothTowards(
      speedFactor,
      clamp(Math.abs(speed) / ANIMATION.referenceSpeed, 0, 1.3),
      ANIMATION.speedSmoothing,
      step,
    );
    spinBlend = smoothTowards(spinBlend, state.spinning ? 1 : 0, ANIMATION.spinSmoothing, step);

    // Roues : rotation selon la vitesse, braquage des roues avant.
    frontSpin = (frontSpin + (speed / FRONT_WHEEL.radius) * step) % TWO_PI;
    rearSpin = (rearSpin + (speed / REAR_WHEEL.radius) * step) % TWO_PI;
    kart.wheelSpins[0].rotation.x = frontSpin;
    kart.wheelSpins[1].rotation.x = frontSpin;
    kart.wheelSpins[2].rotation.x = rearSpin;
    kart.wheelSpins[3].rotation.x = rearSpin;
    steer = smoothTowards(steer, clamp(state.steer || 0, -1, 1), ANIMATION.steerSmoothing, step);
    // Dérapage : le kart glisse nez vers l'intérieur, les roues avant contre-braquent vers l'extérieur.
    const driftDirection = clamp(state.driftDirection || 0, -1, 1);
    const wheelTarget =
      driftDirection === 0 ? steer : -driftDirection * ANIMATION.driftCounterSteer;
    wheelSteer = smoothTowards(wheelSteer, wheelTarget, ANIMATION.steerSmoothing, step);
    for (const pivot of kart.frontPivots) pivot.rotation.y = -wheelSteer * MAX_WHEEL_STEER;
    kart.steeringSpinner.rotation.z = steer * ANIMATION.steeringWheelTurn;

    // Saut, inclinaison en dérapage, vibration du moteur.
    kart.lift.position.y = clamp(state.hop || 0, 0, 1) * ANIMATION.hopHeight;
    // Dérapage à droite (+1) : le châssis roule vers l'extérieur du virage (+X, la gauche).
    tilt = smoothTowards(
      tilt,
      -driftDirection * ANIMATION.driftTilt,
      ANIMATION.tiltSmoothing,
      step,
    );
    kart.chassis.rotation.z = tilt;
    kart.chassis.position.y = Math.sin(time * 37) * ANIMATION.rumbleHeight * (0.3 + speedFactor);

    // Chien : léger rebond, tête qui s'incline dans les virages (et tourne en tête-à-queue).
    dog.root.position.y =
      dogBaseY +
      Math.abs(Math.sin(time * 9)) * ANIMATION.bounceHeight * speedFactor +
      Math.sin(time * 2.4) * 0.004;
    const wobble = Math.sin(time * 16) * 0.35 * spinBlend;
    dog.head.rotation.z = steer * ANIMATION.headRoll + wobble;
    dog.head.rotation.y = -steer * ANIMATION.headYaw + wobble * 0.5;
    dog.head.rotation.x = state.boosting ? -0.08 : 0;

    // Oreilles : repoussées par le vent et battantes selon la vitesse.
    const wind = ANIMATION.earWind * speedFactor * (state.boosting ? 1.2 : 1);
    const flapSpeed = 7 + 12 * speedFactor + 10 * spinBlend;
    const flapAmount = 0.3 + 1.2 * speedFactor + spinBlend;
    earPhase = (earPhase + flapSpeed * step) % TWO_PI;
    for (const ear of dog.ears) {
      const flap = Math.sin(earPhase + ear.phase) * flapAmount;
      ear.pivot.rotation.x = ear.windX * wind + ear.flapX * flap;
      ear.pivot.rotation.z = ear.windZ * wind + ear.flapZ * flap;
    }

    // Queue : remue, beaucoup plus vite pendant un boost.
    const wagSpeed = state.boosting ? 24 : 8 + 5 * speedFactor;
    tailPhase = (tailPhase + wagSpeed * step) % TWO_PI;
    dog.tail.rotation.z = Math.sin(tailPhase) * ANIMATION.tailAmplitude;

    for (const skin of skins) skin.animate?.(step, speedFactor);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    scope.dispose();
  };

  return { root, exhausts: kart.exhausts, rearWheels: kart.rearWheels, update, dispose };
}
