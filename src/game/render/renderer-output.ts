/**
 * Réglages de sortie communs à la course et à l'aperçu du garage : le pilote a la même lumière
 * aux deux endroits. three.js est passé en paramètre (type seul ici) : le garage le charge à la
 * demande et ce module ne l'ajoute pas au bundle.
 */
import type * as THREE from 'three';

/** Exposition du tone mapping ACES (1 = neutre). */
export const TONE_MAPPING_EXPOSURE = 1;

/** Constantes de three.js utilisées ici. */
export type RendererOutputConstants = Pick<
  typeof THREE,
  'SRGBColorSpace' | 'ACESFilmicToneMapping' | 'PCFShadowMap'
>;

/** Partie du WebGLRenderer réglée ici. */
export type RendererOutputTarget = Pick<
  THREE.WebGLRenderer,
  'outputColorSpace' | 'toneMapping' | 'toneMappingExposure'
> & { shadowMap: Pick<THREE.WebGLShadowMap, 'enabled' | 'type'> };

export function applyRendererOutput(
  renderer: RendererOutputTarget,
  three: RendererOutputConstants,
): void {
  renderer.outputColorSpace = three.SRGBColorSpace;
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap a été retiré de three r186 (avertissement puis repli) : PCFShadowMap
  // y filtre désormais en douceur selon shadow.radius.
  renderer.shadowMap.type = three.PCFShadowMap;
}
