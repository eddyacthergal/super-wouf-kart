/**
 * Lumière de la scène (réglée par le thème) : ciel/sol (HemisphereLight) et soleil (DirectionalLight) dont la caméra d'ombre
 * suit le joueur, recalée sur la grille de texels de la carte d'ombre pour éviter le scintillement.
 */
import * as THREE from 'three';
import type { LightStyle } from './scene-theme';
import { PALETTE } from './palette';
import { SUN_DIRECTION } from './sky';

/** Lumière d'été du jardin. */
export const SUMMER_LIGHT: LightStyle = {
  hemisphereSky: PALETTE.hemisphereSky,
  hemisphereGround: PALETTE.hemisphereGround,
  hemisphereIntensity: 1.35,
  sun: PALETTE.sunLight,
  sunIntensity: 2.7,
};

/** Demi-côté (m) de la zone couverte par les ombres autour du joueur. */
const SHADOW_EXTENT = 45;
const SHADOW_MAP_SIZE = 2048;
/** Distance (m) du soleil à sa cible. */
const SUN_DISTANCE = 120;

export class SceneLighting {
  readonly hemisphere: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  private readonly sunDirection: THREE.Vector3;
  private readonly right: THREE.Vector3;
  private readonly up: THREE.Vector3;
  private readonly texel = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
  private readonly snapped = new THREE.Vector3();

  constructor(style: LightStyle = SUMMER_LIGHT, sunDirection: THREE.Vector3 = SUN_DIRECTION) {
    this.hemisphere = new THREE.HemisphereLight(
      style.hemisphereSky,
      style.hemisphereGround,
      style.hemisphereIntensity,
    );
    this.sun = new THREE.DirectionalLight(style.sun, style.sunIntensity);
    this.sunDirection = sunDirection.clone().normalize();
    this.hemisphere.name = 'hemisphere-light';
    this.sun.name = 'sun-light';
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    shadow.camera.left = -SHADOW_EXTENT;
    shadow.camera.right = SHADOW_EXTENT;
    shadow.camera.top = SHADOW_EXTENT;
    shadow.camera.bottom = -SHADOW_EXTENT;
    shadow.camera.near = 1;
    shadow.camera.far = SUN_DISTANCE * 2;
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.0004;
    shadow.normalBias = 0.04;
    shadow.radius = 3;
    // Axes de la caméra d'ombre (même construction que lookAt avec Y vers le haut).
    this.right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), this.sunDirection)
      .normalize();
    this.up = new THREE.Vector3().crossVectors(this.sunDirection, this.right);
    this.follow(0, 0);
  }

  /** Centre la zone d'ombre sur (x, z). */
  follow(x: number, z: number): void {
    const a = Math.round((x * this.right.x + z * this.right.z) / this.texel) * this.texel;
    const b = Math.round((x * this.up.x + z * this.up.z) / this.texel) * this.texel;
    const c = x * this.sunDirection.x + z * this.sunDirection.z;
    this.snapped
      .copy(this.right)
      .multiplyScalar(a)
      .addScaledVector(this.up, b)
      .addScaledVector(this.sunDirection, c);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).addScaledVector(this.sunDirection, SUN_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.hemisphere, this.sun, this.sun.target);
  }

  dispose(): void {
    this.sun.dispose();
    this.hemisphere.dispose();
  }
}
