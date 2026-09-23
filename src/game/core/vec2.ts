/**
 * Vecteurs 2D sur le plan du sol (x, z). La simulation est entièrement 2D ;
 * la hauteur (y) n'existe que dans le rendu.
 *
 * Conventions (voir aussi docs/superpowers/specs/2026-09-23-wouf-kart-design.md) :
 * - repère three.js : Y vers le haut, main droite ;
 * - cap (heading) θ en radians : avant = (sin θ, cos θ) ; un modèle 3D orienté vers +Z
 *   local reçoit `rotation.y = θ` ;
 * - gauche du pilote = (cos θ, -sin θ) ; tourner à gauche augmente θ, tourner à droite le diminue.
 */
export interface Vec2 {
  x: number;
  z: number;
}

export const vec2 = (x = 0, z = 0): Vec2 => ({ x, z });

export const clone = (a: Vec2): Vec2 => ({ x: a.x, z: a.z });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });

export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });

/** a + b * k */
export const addScaled = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + b.x * k, z: a.z + b.z * k });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;

/** Produit vectoriel 2D (composante y de a × b dans le repère three.js). */
export const cross = (a: Vec2, b: Vec2): number => a.z * b.x - a.x * b.z;

export const lengthSq = (a: Vec2): number => a.x * a.x + a.z * a.z;

export const length = (a: Vec2): number => Math.hypot(a.x, a.z);

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export const distanceSq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len > 1e-9 ? { x: a.x / len, z: a.z / len } : { x: 0, z: 0 };
}

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

/** Vecteur « avant » pour un cap θ. */
export const forwardOf = (heading: number): Vec2 => ({ x: Math.sin(heading), z: Math.cos(heading) });

/** Vecteur « gauche du pilote » pour un cap θ. */
export const leftOf = (heading: number): Vec2 => ({ x: Math.cos(heading), z: -Math.sin(heading) });

/** Gauche d'une direction unitaire quelconque (même convention que leftOf). */
export const leftOfDirection = (dir: Vec2): Vec2 => ({ x: dir.z, z: -dir.x });

/** Cap θ correspondant à une direction (inverse de forwardOf). */
export const headingOf = (dir: Vec2): number => Math.atan2(dir.x, dir.z);

/** Ramène un angle dans ]-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  else if (r > Math.PI) r -= twoPi;
  return r;
}

/** Interpolation d'angle par le plus court chemin. */
export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

/** Rapproche `current` de `target` d'au plus `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}
