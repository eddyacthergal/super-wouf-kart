import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../core/vec2';
import { CameraRig, CHASE, type CameraTarget } from './camera-rig';

const DT = 1 / 60;

function rig(reducedMotion = false): { rig: CameraRig; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 2000);
  return { rig: new CameraRig(camera, reducedMotion), camera };
}

/** Cap horizontal de la direction de visée de la caméra. */
function viewHeading(camera: THREE.Camera): number {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  return Math.atan2(direction.x, direction.z);
}

describe('CameraRig', () => {
  it('se place à kart - avant × 7 + haut × 3,2 dès la première image', () => {
    const { rig: chase, camera } = rig();
    const target: CameraTarget = { x: 10, z: -4, heading: 2.2, boosting: false };
    chase.update(target, 'racing', 0, DT);
    expect(camera.position.x).toBeCloseTo(10 - Math.sin(2.2) * CHASE.distance, 6);
    expect(camera.position.z).toBeCloseTo(-4 - Math.cos(2.2) * CHASE.distance, 6);
    expect(camera.position.y).toBeCloseTo(CHASE.height, 6);
    expect(camera.fov).toBe(CHASE.fov);
    // Vise un point devant le kart, dans l'axe.
    expect(wrapAngle(viewHeading(camera) - 2.2)).toBeCloseTo(0, 6);
  });

  it('tourne moins vite que le kart puis le rattrape', () => {
    const { rig: chase, camera } = rig();
    const target: CameraTarget = { x: 0, z: 0, heading: 0, boosting: false };
    chase.update(target, 'racing', 0, DT);
    target.heading = 0.6;
    chase.update(target, 'racing', 0, DT);
    const behind = Math.atan2(-camera.position.x, -camera.position.z);
    expect(behind).toBeGreaterThan(0);
    expect(behind).toBeLessThan(0.2);
    for (let i = 0; i < 120; i++) chase.update(target, 'racing', 0, DT);
    expect(Math.atan2(-camera.position.x, -camera.position.z)).toBeCloseTo(0.6, 3);
  });

  it('élargit le champ de vision en boost en douceur', () => {
    const { rig: chase, camera } = rig();
    const target: CameraTarget = { x: 0, z: 0, heading: 0, boosting: true };
    chase.update(target, 'racing', 0, DT);
    expect(camera.fov).toBeGreaterThan(CHASE.fov);
    expect(camera.fov).toBeLessThan(CHASE.fov + 1);
    for (let i = 0; i < 120; i++) chase.update(target, 'racing', 0, DT);
    expect(camera.fov).toBeCloseTo(CHASE.boostFov, 1);
    target.boosting = false;
    for (let i = 0; i < 180; i++) chase.update(target, 'racing', 0, DT);
    expect(camera.fov).toBeCloseTo(CHASE.fov, 1);
  });

  it('« réduire les animations » : FOV fixe, pas de secousse ni de travelling', () => {
    const { rig: chase, camera } = rig(true);
    const target: CameraTarget = { x: 0, z: 0, heading: 0, boosting: true };
    chase.update(target, 'countdown', 3, DT);
    expect(camera.position.y).toBeCloseTo(CHASE.height, 6);
    const calm = camera.position.clone();
    chase.shake(0.5);
    chase.update(target, 'countdown', 3, DT);
    expect(camera.position.distanceTo(calm)).toBeLessThan(1e-9);
    expect(camera.fov).toBe(CHASE.fov);
  });

  it('recule et s’élève pendant le compte à rebours, en restant derrière', () => {
    const { rig: chase, camera } = rig();
    const target: CameraTarget = { x: 0, z: 0, heading: 0, boosting: false };
    chase.update(target, 'countdown', 3, DT);
    expect(camera.position.z).toBeLessThan(-CHASE.distance - 1);
    expect(camera.position.y).toBeGreaterThan(CHASE.height + 1);
    chase.update(target, 'countdown', 0, DT);
    expect(camera.position.z).toBeCloseTo(-CHASE.distance, 3);
  });

  it('secoue la caméra puis se stabilise', () => {
    const { rig: chase, camera } = rig();
    const target: CameraTarget = { x: 0, z: 0, heading: 0, boosting: false };
    chase.update(target, 'racing', 0, DT);
    const calm = camera.position.clone();
    chase.shake(0.4);
    chase.update(target, 'racing', 0, DT);
    expect(camera.position.distanceTo(calm)).toBeGreaterThan(0.01);
    for (let i = 0; i < 180; i++) chase.update(target, 'racing', 0, DT);
    expect(camera.position.distanceTo(calm)).toBeLessThan(1e-3);
  });

  it('ignore une cible invalide (NaN) sans perdre son cadrage', () => {
    const { rig: chase, camera } = rig();
    const target: CameraTarget = { x: 3, z: 4, heading: 0.5, boosting: false };
    chase.update(target, 'racing', 0, DT);
    const before = camera.position.clone();
    chase.update({ ...target, heading: Number.NaN }, 'racing', 0, DT);
    chase.update({ ...target, x: Number.NaN }, 'racing', 0, DT);
    expect(camera.position.equals(before)).toBe(true);
    chase.update(target, 'racing', 0, DT);
    expect(Number.isFinite(camera.position.x + camera.position.y + camera.position.z)).toBe(true);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
  });

  it('orbite lentement autour du kart après l’arrivée', () => {
    const { rig: chase, camera } = rig();
    const target: CameraTarget = { x: 5, z: 5, heading: 1, boosting: false };
    chase.update(target, 'racing', 0, DT);
    const angles: number[] = [];
    for (let i = 0; i < 600; i++) {
      chase.update(target, 'finished', 0, DT);
      angles.push(Math.atan2(camera.position.x - 5, camera.position.z - 5));
    }
    const turned = angles.slice(1).reduce((sum, angle, i) => sum + wrapAngle(angle - angles[i]), 0);
    expect(Math.abs(turned)).toBeGreaterThan(1.5);
    const distance = Math.hypot(camera.position.x - 5, camera.position.z - 5);
    expect(distance).toBeGreaterThan(8);
    expect(distance).toBeLessThan(10);
  });
});
