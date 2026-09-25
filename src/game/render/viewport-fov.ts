/**
 * Champ de vision vertical adapté à l'écran. En paysage, il reste tel quel. En portrait (téléphone
 * tenu droit), l'angle horizontal deviendrait étroit au point de cacher la route : on élargit
 * l'angle vertical pour garder à l'horizontale l'ouverture qu'on aurait sur un écran carré.
 */

/** Angle vertical maximal (degrés), pour éviter une déformation excessive. */
const MAX_PORTRAIT_FOV = 100;

/** Champ de vision vertical (degrés) à appliquer pour `fov` et le rapport largeur / hauteur `aspect`. */
export function fitFovToAspect(fov: number, aspect: number): number {
  if (!(aspect > 0 && aspect < 1) || !Number.isFinite(fov)) return fov;
  const halfTan = Math.tan((fov * Math.PI) / 360) / aspect;
  const fitted = (Math.atan(halfTan) * 360) / Math.PI;
  return Math.min(Math.max(fov, fitted), MAX_PORTRAIT_FOV);
}
