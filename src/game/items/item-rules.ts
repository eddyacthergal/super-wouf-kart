/**
 * Tirage des objets pondéré par le classement : les premiers reçoivent surtout
 * des os et des flaques, les derniers reçoivent aussi les objets les plus puissants
 * (balle, croquette turbo, os en or).
 */
import type { ItemKind, Rng } from '../core/types';
import { clamp } from '../core/vec2';

export const ITEM_KINDS: readonly ItemKind[] = [
  'bone',
  'mud',
  'tennis-ball',
  'kibble-turbo',
  'golden-bone',
];

/** Poids aux positions relatives 0 (premier), 0,5 (milieu) et 1 (dernier). */
const WEIGHT_TABLE: Readonly<Record<ItemKind, readonly [number, number, number]>> = {
  bone: [40, 25, 10],
  mud: [40, 15, 5],
  'tennis-ball': [5, 20, 20],
  'kibble-turbo': [10, 20, 15],
  'golden-bone': [0, 10, 15],
};

/** Position relative dans le classement : 0 = premier, 1 = dernier (0 si les données sont invalides). */
export function rankFraction(rank: number, racerCount: number): number {
  if (racerCount <= 1) return 0;
  const fraction = (rank - 1) / (racerCount - 1);
  return Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0;
}

/** Poids de chaque objet, interpolés linéairement selon la position relative. */
export function itemWeights(rank: number, racerCount: number): Record<ItemKind, number> {
  const f = rankFraction(rank, racerCount);
  const interpolate = ([first, middle, last]: readonly [number, number, number]): number =>
    f <= 0.5 ? first + (middle - first) * (f / 0.5) : middle + (last - middle) * ((f - 0.5) / 0.5);
  const weights = {} as Record<ItemKind, number>;
  for (const kind of ITEM_KINDS) weights[kind] = interpolate(WEIGHT_TABLE[kind]);
  return weights;
}

export function rollItem(rank: number, racerCount: number, rng: Rng): ItemKind {
  const weights = itemWeights(rank, racerCount);
  let total = 0;
  for (const kind of ITEM_KINDS) total += weights[kind];
  let roll = rng.next() * total;
  for (const kind of ITEM_KINDS) {
    roll -= weights[kind];
    if (roll < 0) return kind;
  }
  // Filet de sécurité contre les arrondis flottants.
  return ITEM_KINDS[ITEM_KINDS.length - 1];
}
