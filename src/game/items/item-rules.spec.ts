import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import type { ItemKind, Rng } from '../core/types';
import { ITEM_KINDS, itemWeights, rankFraction, rollItem } from './item-rules';

const sumOf = (weights: Record<ItemKind, number>): number =>
  ITEM_KINDS.reduce((total, kind) => total + weights[kind], 0);

/** Rng qui renvoie toujours la même valeur (tirages prévisibles). */
function fixedRng(value: number): Rng {
  return {
    next: () => value,
    range: (min, max) => min + (max - min) * value,
    int: (min, max) => Math.floor(min + (max - min + 1) * value),
    pick: <T>(items: readonly T[]): T => items[Math.floor(value * items.length)],
  };
}

function drawProportions(
  rank: number,
  racerCount: number,
  draws: number,
  seed: number,
): Record<ItemKind, number> {
  const rng = createRng(seed);
  const counts: Record<ItemKind, number> = {
    bone: 0,
    mud: 0,
    'tennis-ball': 0,
    'kibble-turbo': 0,
    'golden-bone': 0,
    whistle: 0,
    'super-collar': 0,
  };
  for (let i = 0; i < draws; i++) counts[rollItem(rank, racerCount, rng)]++;
  for (const kind of ITEM_KINDS) counts[kind] /= draws;
  return counts;
}

describe('itemWeights', () => {
  it('reprend les poids de référence au premier, au milieu et au dernier rang', () => {
    expect(itemWeights(1, 8)).toEqual({
      bone: 40,
      mud: 40,
      'tennis-ball': 5,
      'kibble-turbo': 10,
      'golden-bone': 0,
      whistle: 0,
      'super-collar': 0,
    });
    expect(itemWeights(3, 5)).toEqual({
      bone: 25,
      mud: 15,
      'tennis-ball': 20,
      'kibble-turbo': 20,
      'golden-bone': 10,
      whistle: 3,
      'super-collar': 5,
    });
    expect(itemWeights(8, 8)).toEqual({
      bone: 10,
      mud: 5,
      'tennis-ball': 20,
      'kibble-turbo': 15,
      'golden-bone': 15,
      whistle: 8,
      'super-collar': 12,
    });
  });

  it('interpole linéairement entre les points de référence', () => {
    // Rang 2 sur 5 : f = 0,25, à mi-chemin entre le premier et le milieu.
    const weights = itemWeights(2, 5);
    expect(weights.bone).toBeCloseTo(32.5);
    expect(weights.mud).toBeCloseTo(27.5);
    expect(weights['tennis-ball']).toBeCloseTo(12.5);
    expect(weights['kibble-turbo']).toBeCloseTo(15);
    expect(weights['golden-bone']).toBeCloseTo(5);
    expect(weights.whistle).toBeCloseTo(1.5);
    expect(weights['super-collar']).toBeCloseTo(2.5);
  });

  it('favorise balle, croquette et os en or vers la fin du peloton', () => {
    let previousBall = -Infinity;
    for (let rank = 1; rank <= 8; rank++) {
      const weights = itemWeights(rank, 8);
      expect(sumOf(weights)).toBeGreaterThan(0);
      expect(weights['tennis-ball']).toBeGreaterThanOrEqual(previousBall);
      previousBall = weights['tennis-ball'];
    }
    expect(itemWeights(8, 8)['golden-bone']).toBeGreaterThan(itemWeights(1, 8)['golden-bone']);
  });

  it('traite un pilote seul comme premier et borne les rangs hors limites', () => {
    expect(rankFraction(1, 1)).toBe(0);
    expect(itemWeights(1, 1)).toEqual(itemWeights(1, 8));
    expect(rankFraction(12, 8)).toBe(1);
    expect(rankFraction(0, 8)).toBe(0);
  });

  it('retombe sur les poids du premier si le rang ou le nombre de pilotes est invalide', () => {
    expect(rankFraction(Number.NaN, 8)).toBe(0);
    expect(rankFraction(3, Number.NaN)).toBe(0);
    expect(itemWeights(Number.NaN, 8)).toEqual(itemWeights(1, 8));
  });
});

describe('rollItem', () => {
  it('suit les poids du premier sur 5000 tirages', () => {
    const proportions = drawProportions(1, 8, 5000, 7);
    const weights = itemWeights(1, 8);
    const total = sumOf(weights);
    for (const kind of ITEM_KINDS)
      expect(Math.abs(proportions[kind] - weights[kind] / total)).toBeLessThan(0.025);
  });

  it('suit les poids du dernier sur 5000 tirages', () => {
    const proportions = drawProportions(8, 8, 5000, 11);
    const weights = itemWeights(8, 8);
    const total = sumOf(weights);
    for (const kind of ITEM_KINDS)
      expect(Math.abs(proportions[kind] - weights[kind] / total)).toBeLessThan(0.025);
  });

  it('est déterministe pour une même graine', () => {
    const a = createRng(3);
    const b = createRng(3);
    const drawsA = Array.from({ length: 20 }, () => rollItem(4, 8, a));
    const drawsB = Array.from({ length: 20 }, () => rollItem(4, 8, b));
    expect(drawsA).toEqual(drawsB);
  });

  it('découpe [0, 1[ en tranches cumulées dans l’ordre de ITEM_KINDS', () => {
    // Dernier (poids 10 | 5 | 20 | 15 | 15 | 8 | 12, somme 85) : os [0 ; 10/85[, flaque [10/85 ; 15/85[,
    // balle [15/85 ; 35/85[, croquette [35/85 ; 50/85[, os en or [50/85 ; 65/85[, sifflet [65/85 ; 73/85[,
    // super-collier [73/85 ; 1[.
    const cases: [number, ItemKind][] = [
      [0, 'bone'],
      [0.115, 'bone'],
      [0.119, 'mud'],
      [0.175, 'mud'],
      [0.178, 'tennis-ball'],
      [0.41, 'tennis-ball'],
      [0.413, 'kibble-turbo'],
      [0.586, 'kibble-turbo'],
      [0.59, 'golden-bone'],
      [0.763, 'golden-bone'],
      [0.766, 'whistle'],
      [0.857, 'whistle'],
      [0.86, 'super-collar'],
      [0.999, 'super-collar'],
    ];
    for (const [value, kind] of cases) expect(rollItem(8, 8, fixedRng(value))).toBe(kind);
  });

  it('renvoie un objet valide même si le tirage atteint 1 (filet contre les arrondis)', () => {
    expect(rollItem(1, 8, fixedRng(1))).toBe('super-collar');
    expect(rollItem(8, 8, fixedRng(1))).toBe('super-collar');
  });
});
