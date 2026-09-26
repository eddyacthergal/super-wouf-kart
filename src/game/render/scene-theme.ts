/**
 * Thème de rendu d'un circuit : ambiance (ciel, brouillard, lumière, nuages) et construction du
 * monde autour de la piste (sol, bordures, décor, animaux). La course elle-même ne dépend pas du
 * thème : un thème change l'ambiance, pas la conduite.
 */
import type * as THREE from 'three';
import type { TrackQuery } from '../core/types';
import type { TrackDecorHints } from '../track/track-definition';

export interface SkyStyle {
  top: string;
  horizon: string;
  sun: string;
  /** Direction du sol vers le soleil (normalisée par le rendu). */
  sunDirection: readonly [number, number, number];
  /** Taille du halo du soleil : 1 pour le soleil d'été, plus pour un soleil couchant. */
  sunGlow: number;
}

export interface LightStyle {
  hemisphereSky: string;
  hemisphereGround: string;
  hemisphereIntensity: number;
  sun: string;
  sunIntensity: number;
}

export interface CloudStyle {
  color: string;
  emissive: string;
}

/**
 * Monde construit autour de la piste ; `update` reçoit le temps écoulé depuis le départ (s) et la
 * position de la caméra (effets qui la suivent, comme la neige qui tombe).
 */
export interface ThemeWorld {
  root: THREE.Group;
  update(time: number, camera?: THREE.Vector3): void;
  dispose(): void;
}

export interface SceneTheme {
  sky: SkyStyle;
  fog: { color: string; near: number; far: number };
  light: LightStyle;
  clouds: CloudStyle;
  buildWorld(track: TrackQuery, decor?: TrackDecorHints): ThemeWorld;
}
