/**
 * Placement déterministe du décor géant du jardin (aucune dépendance à three.js).
 * Chaque objet est validé : sa distance à la ligne médiane dépasse la haie de son rayon + 2 m,
 * il reste dans la clôture (sauf les arbres du pourtour) et ne chevauche aucun autre objet.
 */
import { createRng, type Rng } from '../core/rng';
import type { TrackQuery } from '../core/types';
import { headingOf } from '../core/vec2';
import { type Bounds, corridorClearance, trackBounds } from './track-geometry';

export type DecorKind =
  | 'daisy'
  | 'tulip'
  | 'sunflower'
  | 'tennis-ball'
  | 'doghouse'
  | 'watering-can'
  | 'kibble-bowl'
  | 'giant-bone'
  | 'gnome'
  | 'sprinkler'
  | 'tree'
  | 'bush'
  | 'stepping-stone';

export interface DecorPlacement {
  kind: DecorKind;
  x: number;
  z: number;
  /** Rayon d'encombrement au sol (m). */
  radius: number;
  /** Taille caractéristique : hauteur (fleur, arbre) ou rayon (balle, buisson, pierre) ; 1 pour les pièces uniques. */
  size: number;
  /** Cap de l'objet (rad) : son avant (+Z local) regarde généralement le circuit. */
  rotation: number;
  /** Variante (couleur, forme), entier ≥ 0. */
  variant: number;
}

export interface DecorPlan {
  placements: DecorPlacement[];
  /** Rectangle de la clôture en bois. */
  fence: Bounds;
}

/** Marge minimale (m) entre le bord d'un objet de décor et la haie. */
export const DECOR_CORRIDOR_MARGIN = 2;
/** Distance entre le circuit (haies comprises) et la clôture. */
const FENCE_MARGIN = 36;
/** Écart minimal (m) entre deux objets de décor. */
const DECOR_GAP = 1;
const DECOR_SEED = 0x60f1d;

interface Landmark {
  kind: DecorKind;
  x: number;
  z: number;
  radius: number;
}

/** Pièces uniques, positions pensées pour le jardin (validées et déplacées au besoin). */
const LANDMARKS: readonly Landmark[] = [
  { kind: 'doghouse', x: -40, z: -114, radius: 5.5 },
  { kind: 'kibble-bowl', x: 47, z: 58, radius: 4.4 },
  { kind: 'watering-can', x: 72, z: -50, radius: 6.2 },
  // Rayon = portée des jets d'eau tournants (~7,4 m), pas seulement le pied de l'arroseur.
  { kind: 'sprinkler', x: -8, z: -46, radius: 7.6 },
  { kind: 'giant-bone', x: -64, z: -46, radius: 6.5 },
  { kind: 'gnome', x: -3, z: 30, radius: 2.8 },
  { kind: 'gnome', x: 112, z: 42, radius: 2.8 },
];

interface ScatterRule {
  kind: DecorKind;
  count: number;
  size: readonly [number, number];
  radius: (size: number) => number;
  /** Distance supplémentaire au-delà de la marge minimale (m). */
  band: readonly [number, number];
  variants: number;
  facesTrack: boolean;
}

const SCATTER: readonly ScatterRule[] = [
  {
    kind: 'sunflower',
    count: 12,
    size: [8, 12],
    radius: (h) => h * 0.17,
    band: [4, 26],
    variants: 1,
    facesTrack: true,
  },
  {
    kind: 'daisy',
    count: 26,
    size: [4, 9],
    radius: (h) => Math.max(1.2, h * 0.17),
    band: [1, 24],
    variants: 1,
    facesTrack: true,
  },
  {
    kind: 'tulip',
    count: 22,
    size: [4, 7],
    radius: (h) => Math.max(1.1, h * 0.13),
    band: [1, 22],
    variants: 5,
    facesTrack: true,
  },
  {
    kind: 'tennis-ball',
    count: 10,
    size: [1.8, 3.2],
    radius: (r) => r,
    band: [3, 34],
    variants: 1,
    facesTrack: false,
  },
  {
    kind: 'bush',
    count: 34,
    size: [1.8, 3.6],
    radius: (r) => r * 1.25,
    band: [1, 30],
    variants: 3,
    facesTrack: false,
  },
  {
    kind: 'tree',
    count: 14,
    size: [16, 24],
    radius: (h) => h * 0.3,
    band: [8, 45],
    variants: 3,
    facesTrack: false,
  },
];

/** Arbres de fond, hors de la clôture. */
const OUTER_TREES = { count: 46, size: [18, 30] as const, inner: 8, outer: 80 };

/** Pierres de gué : un chemin sinueux qui traverse la pelouse centrale. */
const STEPPING_PATH = {
  from: { x: -94, z: -30 },
  to: { x: 114, z: -24 },
  spacing: 2.9,
  wave: 6,
  radius: 1.25,
};

export function planDecor(track: TrackQuery, seed = DECOR_SEED): DecorPlan {
  const rng = createRng(seed);
  const fence = trackBounds(track, track.wallHalfWidth + FENCE_MARGIN);
  const placements: DecorPlacement[] = [];
  const minClearance = (radius: number): number =>
    track.wallHalfWidth + radius + DECOR_CORRIDOR_MARGIN;

  const insideFence = (x: number, z: number, radius: number): boolean =>
    x - radius > fence.minX + 1 &&
    x + radius < fence.maxX - 1 &&
    z - radius > fence.minZ + 1 &&
    z + radius < fence.maxZ - 1;

  const overlaps = (x: number, z: number, radius: number): boolean =>
    placements.some(
      (other) => Math.hypot(other.x - x, other.z - z) < other.radius + radius + DECOR_GAP,
    );

  const accepts = (x: number, z: number, radius: number, inside = true): boolean =>
    (!inside || insideFence(x, z, radius)) &&
    !overlaps(x, z, radius) &&
    corridorClearance(track, x, z) > minClearance(radius);

  const facing = (x: number, z: number): number => {
    const target = track.project({ x, z }).sample.position;
    return headingOf({ x: target.x - x, z: target.z - z });
  };

  // 1. Pièces uniques : position prévue, sinon recherche en spirale autour.
  for (const landmark of LANDMARKS) {
    const spot = spiralSearch(landmark.x, landmark.z, (x, z) => accepts(x, z, landmark.radius));
    if (!spot) continue;
    placements.push({
      kind: landmark.kind,
      x: spot.x,
      z: spot.z,
      radius: landmark.radius,
      size: 1,
      rotation: facing(spot.x, spot.z),
      variant: placements.filter((p) => p.kind === landmark.kind).length,
    });
  }

  // 2. Pierres de gué.
  const { from, to, spacing, wave, radius } = STEPPING_PATH;
  const pathLength = Math.hypot(to.x - from.x, to.z - from.z);
  const stones = Math.floor(pathLength / spacing);
  for (let i = 0; i <= stones; i++) {
    const t = i / stones;
    const x = from.x + (to.x - from.x) * t + rng.range(-0.3, 0.3);
    const z =
      from.z + (to.z - from.z) * t + Math.sin(t * Math.PI * 5) * wave + rng.range(-0.3, 0.3);
    const size = radius * rng.range(0.85, 1.1);
    // Les pierres voisines peuvent se frôler : on ne teste le chevauchement qu'avec le reste du décor.
    const clear =
      insideFence(x, z, size) &&
      corridorClearance(track, x, z) > minClearance(size) &&
      !placements.some(
        (other) =>
          other.kind !== 'stepping-stone' &&
          Math.hypot(other.x - x, other.z - z) < other.radius + size + DECOR_GAP,
      );
    if (!clear) continue;
    placements.push({
      kind: 'stepping-stone',
      x,
      z,
      radius: size,
      size,
      rotation: rng.range(0, Math.PI * 2),
      variant: rng.int(0, 3),
    });
  }

  // 3. Fleurs, balles, buissons et arbres, près du circuit pour qu'on les voie passer.
  for (const rule of SCATTER) {
    let placed = 0;
    for (let attempt = 0; attempt < rule.count * 40 && placed < rule.count; attempt++) {
      const size = rng.range(rule.size[0], rule.size[1]);
      const r = rule.radius(size);
      const sample = track.sampleAt(rng.range(0, track.length));
      const side = rng.next() < 0.5 ? -1 : 1;
      const distance = minClearance(r) + 0.6 + rng.range(rule.band[0], rule.band[1]);
      const x = sample.position.x + sample.left.x * side * distance;
      const z = sample.position.z + sample.left.z * side * distance;
      if (!accepts(x, z, r)) continue;
      placements.push({
        kind: rule.kind,
        x,
        z,
        radius: r,
        size,
        rotation: rule.facesTrack ? facing(x, z) + rng.range(-0.4, 0.4) : rng.range(0, Math.PI * 2),
        variant: rng.int(0, rule.variants - 1),
      });
      placed++;
    }
  }

  // 4. Arbres de fond, au-delà de la clôture.
  let outer = 0;
  for (let attempt = 0; attempt < OUTER_TREES.count * 40 && outer < OUTER_TREES.count; attempt++) {
    const size = rng.range(OUTER_TREES.size[0], OUTER_TREES.size[1]);
    const r = size * 0.3;
    const spot = ringPoint(rng, fence, OUTER_TREES.inner + r, OUTER_TREES.outer);
    if (!accepts(spot.x, spot.z, r, false)) continue;
    placements.push({
      kind: 'tree',
      x: spot.x,
      z: spot.z,
      radius: r,
      size,
      rotation: rng.range(0, Math.PI * 2),
      variant: rng.int(0, 2),
    });
    outer++;
  }

  return { placements, fence };
}

/** Premier point valide d'une spirale autour de (x, z), ou null. */
function spiralSearch(
  x: number,
  z: number,
  valid: (x: number, z: number) => boolean,
): { x: number; z: number } | null {
  for (let k = 0; k < 60; k++) {
    const angle = k * 2.399963;
    const reach = k === 0 ? 0 : 1.5 + k * 0.8;
    const px = x + Math.cos(angle) * reach;
    const pz = z + Math.sin(angle) * reach;
    if (valid(px, pz)) return { x: px, z: pz };
  }
  return null;
}

/** Point au hasard dans la couronne entre le rectangle `bounds` élargi de `inner` et de `outer`. */
function ringPoint(
  rng: Rng,
  bounds: Bounds,
  inner: number,
  outer: number,
): { x: number; z: number } {
  const depth = rng.range(inner, outer);
  const alongX = rng.range(bounds.minX - outer, bounds.maxX + outer);
  const alongZ = rng.range(bounds.minZ - outer, bounds.maxZ + outer);
  switch (rng.int(0, 3)) {
    case 0:
      return { x: alongX, z: bounds.minZ - depth };
    case 1:
      return { x: alongX, z: bounds.maxZ + depth };
    case 2:
      return { x: bounds.minX - depth, z: alongZ };
    default:
      return { x: bounds.maxX + depth, z: alongZ };
  }
}
