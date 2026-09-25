/**
 * Caméra de poursuite : derrière le kart suivi, cap lissé (elle tourne moins que le kart en dérapage),
 * champ de vision élargi en boost, petite secousse sur les chocs. Léger travelling pendant le compte
 * à rebours, lente orbite après l'arrivée. « Réduire les animations » : ni FOV variable, ni secousse,
 * ni travelling. En portrait (téléphone tenu droit), le champ vertical s'élargit pour garder la route
 * dans l'image.
 */
import * as THREE from 'three';
import { COUNTDOWN_SECONDS } from '../core/constants';
import type { RacePhase } from '../core/types';
import { clamp, lerpAngle } from '../core/vec2';
import { smoothTowards } from './resources';
import { fitFovToAspect } from './viewport-fov';

export const CHASE = {
  distance: 7,
  height: 3.2,
  lookAhead: 4,
  lookHeight: 1,
  /** Vitesse de convergence du cap de la caméra (1/s). */
  headingRate: 6,
  fov: 65,
  boostFov: 75,
  fovRate: 4,
} as const;

/** Cadrage de départ du compte à rebours (plus loin, plus haut, un peu de côté). */
const INTRO = { distance: 6, height: 2.6, yaw: 0.45 } as const;
const ORBIT = { distance: 9, height: 3.6, speed: 0.3, blendRate: 1.2 } as const;
const SHAKE = { decay: 6, max: 0.6 } as const;
/** Pas de temps maximal pris en compte (onglet masqué, à-coups). */
const MAX_DT = 0.1;

export interface CameraTarget {
  x: number;
  z: number;
  /** Cap du kart (sans la rotation visuelle du dérapage). */
  heading: number;
  boosting: boolean;
}

export class CameraRig {
  private heading = 0;
  private initialized = false;
  private fov: number = CHASE.fov;
  private shakeAmount = 0;
  private time = 0;
  private orbiting = false;
  private orbitAngle = 0;
  private orbitBlend = 0;
  private readonly lookTarget = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly reducedMotion: boolean,
  ) {
    camera.fov = fitFovToAspect(CHASE.fov, camera.aspect);
    camera.updateProjectionMatrix();
  }

  /** Secousse (m) ; ignorée si « réduire les animations ». */
  shake(amount: number): void {
    if (this.reducedMotion || !(amount > 0)) return;
    this.shakeAmount = Math.min(SHAKE.max, Math.max(this.shakeAmount, amount));
  }

  update(target: CameraTarget, phase: RacePhase, countdown: number, frameDt: number): void {
    const dt = clamp(Number.isFinite(frameDt) ? frameDt : 0, 0, MAX_DT);
    // Cible invalide : on garde le dernier cadrage plutôt que d'empoisonner le cap lissé avec NaN.
    const valid =
      Number.isFinite(target.x) && Number.isFinite(target.z) && Number.isFinite(target.heading);
    if (!valid) return;
    this.time += dt;
    if (!this.initialized) {
      // Première image : cap exact du kart, sans glissement depuis 0.
      this.initialized = true;
      this.heading = target.heading;
    } else {
      this.heading = lerpAngle(this.heading, target.heading, 1 - Math.exp(-CHASE.headingRate * dt));
    }
    const chaseAngle = this.heading + Math.PI;

    let distance: number = CHASE.distance;
    let height: number = CHASE.height;
    let yaw = 0;
    if (phase === 'countdown' && !this.reducedMotion) {
      const k = clamp(countdown / COUNTDOWN_SECONDS, 0, 1) ** 2;
      distance += INTRO.distance * k;
      height += INTRO.height * k;
      yaw = INTRO.yaw * k;
    }

    // Orbite de fin de course : part de la position de poursuite puis tourne lentement.
    if (phase === 'finished') {
      if (!this.orbiting) {
        this.orbiting = true;
        this.orbitAngle = chaseAngle;
      }
      this.orbitBlend = smoothTowards(this.orbitBlend, 1, ORBIT.blendRate, dt);
      this.orbitAngle += ORBIT.speed * dt;
    } else {
      this.orbiting = false;
      this.orbitBlend = 0;
    }
    const blend = this.orbitBlend;
    const angle = lerpAngle(chaseAngle + yaw, this.orbitAngle, blend);
    distance += (ORBIT.distance - distance) * blend;
    height += (ORBIT.height - height) * blend;
    const lookAhead = CHASE.lookAhead * (1 - blend);

    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);
    const camera = this.camera;
    camera.position.set(
      target.x + Math.sin(angle) * distance,
      height,
      target.z + Math.cos(angle) * distance,
    );
    this.lookTarget.set(
      target.x + forwardX * lookAhead,
      CHASE.lookHeight,
      target.z + forwardZ * lookAhead,
    );

    if (this.shakeAmount > 1e-4) {
      const t = this.time;
      const a = this.shakeAmount;
      const dx = Math.sin(t * 47) * a;
      const dy = Math.sin(t * 39 + 1.3) * a * 0.6;
      const dz = Math.sin(t * 53 + 2.1) * a;
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
      this.lookTarget.x += dx * 0.5;
      this.lookTarget.y += dy * 0.5;
      this.lookTarget.z += dz * 0.5;
      this.shakeAmount *= Math.exp(-SHAKE.decay * dt);
    } else {
      this.shakeAmount = 0;
    }
    camera.lookAt(this.lookTarget);

    if (!this.reducedMotion) {
      const targetFov = target.boosting ? CHASE.boostFov : CHASE.fov;
      this.fov = smoothTowards(this.fov, targetFov, CHASE.fovRate, dt);
    }
    // Suit aussi les changements d'orientation de l'écran (rapport largeur / hauteur).
    const fov = fitFovToAspect(this.fov, camera.aspect);
    if (Math.abs(fov - camera.fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
