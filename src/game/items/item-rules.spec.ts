import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import type { ItemKind, Rng } from '../core/types';
import { ITEM_KINDS, itemWeights, rankFraction, rollItem } from './item-rules';

const sumOf = (weights: Record<ItemKind, number>): number => ITEM_KINDS.reduce((total, kind) => total + weights[kind], 0);

/** Rng qui renvoie toujours la même valeur (tirages prévisibles). */
function fixedRng(value: number): Rng {
  return {
    next: () => value,
    range: (min, max) => min + (max - min) * value,
    int: (min, max) => Math.floor(min + (max - min + 1) * value),
    pick: <T>(items: readonly T[]): T => items[Math.floor(value * items.length)],
  };
}

function drawProportions(rank: number, racerCount: number, draws: number, seed: number): Record<ItemKind, number> {
  const rng = createRng(seed);
  const counts: Record<ItemKind, number> = { bone: 0, mud: 0, 'tennis-ball': 0, 'kibble-turbo': 0 };
  for (let i = 0; i < draws; i++) counts[rollItem(rank, racerCount, rng)]++;
  for (const kind of ITEM_KINDS) counts[kind] /= draws;
  return counts;
}

describe('itemWeights', () => {
  it('reprend les poids de référence au premier, au milieu et au dernier rang', () => {
    expect(itemWeights(1, 8)).toEqual({ bone: 45, mud: 45, 'tennis-ball': 5, 'kibble-turbo': 5 });
    expect(itemWeights(3, 5)).toEqual({ bone: 30, mud: 20, 'tennis-ball': 25, 'kibble-turbo': 25 });
    expect(itemWeights(8, 8)).toEqual({ bone: 15, mud: 5, 'tennis-ball': 40, 'kibble-turbo': 40 });
  });

  it('interpole linéairement entre les points de référence', () => {
    // Rang 2 sur 5 : f = 0,25, à mi-chemin entre le premier et le milieu.
    const weights = itemWeights(2, 5);
    expect(weights.bone).toBeCloseTo(37.5);
    expect(weights.mud).toBeCloseTo(32.5);
    expect(weights['tennis-ball']).toBeCloseTo(15);
    expect(weights['kibble-turbo']).toBeCloseTo(15);
  });

  it('garde une somme constante et favorise balles et turbos vers la fin du peloton', () => {
    let previousBall = -Infinity;
    for (let rank = 1; rank <= 8; rank++) {
      const weights = itemWeights(rank, 8);
      expect(sumOf(weights)).toBeCloseTo(100, 9);
      expect(weights['tennis-ball']).toBeGreaterThan(previousBall);
      previousBall = weights['tennis-ball'];
    }
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
    expect(sumOf(itemWeights(Number.NaN, 8))).toBeCloseTo(100, 9);
  });
});

describe('rollItem', () => {
  it('suit les poids du premier sur 5000 tirages', () => {
    const proportions = drawProportions(1, 8, 5000, 7);
    const weights = itemWeights(1, 8);
    for (const kind of ITEM_KINDS) expect(Math.abs(proportions[kind] - weights[kind] / 100)).toBeLessThan(0.025);
  });

  it('suit les poids du dernier sur 5000 tirages', () => {
    const proportions = drawProportions(8, 8, 5000, 11);
    const weights = itemWeights(8, 8);
    for (const kind of ITEM_KINDS) expect(Math.abs(proportions[kind] - weights[kind] / 100)).toBeLessThan(0.025);
  });

  it('est déterministe pour une même graine', () => {
    const a = createRng(3);
    const b = createRng(3);
    const drawsA = Array.from({ length: 20 }, () => rollItem(4, 8, a));
    const drawsB = Array.from({ length: 20 }, () => rollItem(4, 8, b));
    expect(drawsA).toEqual(drawsB);
  });

  it('découpe [0, 1[ en tranches cumulées dans l’ordre de ITEM_KINDS', () => {
    // Premier : os [0 ; 0,45[, flaque [0,45 ; 0,90[, balle [0,90 ; 0,95[, turbo [0,95 ; 1[.
    const cases: [number, ItemKind][] = [
      [0, 'bone'],
      [0.449, 'bone'],
      [0.451, 'mud'],
      [0.899, 'mud'],
      [0.901, 'tennis-ball'],
      [0.949, 'tennis-ball'],
      [0.951, 'kibble-turbo'],
    ];
    for (const [value, kind] of cases) expect(rollItem(1, 8, fixedRng(value))).toBe(kind);
  });

  it('renvoie un objet valide même si le tirage atteint 1 (filet contre les arrondis)', () => {
    expect(rollItem(1, 8, fixedRng(1))).toBe('kibble-turbo');
    expect(rollItem(8, 8, fixedRng(1))).toBe('kibble-turbo');
  });
});
