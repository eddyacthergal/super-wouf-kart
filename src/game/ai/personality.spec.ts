import { describe, expect, it } from 'vitest';
import { RACER_COUNT } from '../core/constants';
import { createRng } from '../core/rng';
import { createAiPersonality } from './personality';

describe('createAiPersonality', () => {
  it('reste dans les bornes annoncées', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed);
      for (let index = 0; index < RACER_COUNT; index++) {
        const p = createAiPersonality(rng, index);
        expect(Math.abs(p.laneOffset)).toBeLessThanOrEqual(3);
        expect(p.skill).toBeGreaterThanOrEqual(0.9);
        expect(p.skill).toBeLessThanOrEqual(1);
        expect(p.aggression).toBeGreaterThanOrEqual(0);
        expect(p.aggression).toBeLessThanOrEqual(1);
        expect(p.driftSkill).toBeGreaterThanOrEqual(0);
        expect(p.driftSkill).toBeLessThanOrEqual(1);
        expect([1, 2]).toContain(p.targetTier);
      }
    }
  });

  it('est déterministe pour une même graine et un même indice', () => {
    expect(createAiPersonality(createRng(7), 3)).toEqual(createAiPersonality(createRng(7), 3));
  });

  it('varie selon la graine', () => {
    expect(createAiPersonality(createRng(1), 0)).not.toEqual(createAiPersonality(createRng(2), 0));
  });

  it('répartit les couloirs des deux côtés de la route', () => {
    const rng = createRng(11);
    const lanes = Array.from({ length: RACER_COUNT }, (_, index) => createAiPersonality(rng, index).laneOffset);
    expect(lanes.some((lane) => lane < -1)).toBe(true);
    expect(lanes.some((lane) => lane > 1)).toBe(true);
    expect(new Set(lanes.map((lane) => lane.toFixed(2))).size).toBe(RACER_COUNT);
  });

  it('les IA douées au dérapage visent le palier 2', () => {
    const rng = createRng(5);
    const all = Array.from({ length: 200 }, (_, index) => createAiPersonality(rng, index));
    const experts = all.filter((p) => p.targetTier === 2);
    const others = all.filter((p) => p.targetTier === 1);
    expect(experts.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    expect(Math.min(...experts.map((p) => p.driftSkill))).toBeGreaterThan(Math.max(...others.map((p) => p.driftSkill)));
  });

  it('accepte un indice hors de la grille', () => {
    const p = createAiPersonality(createRng(3), -5);
    expect(Number.isFinite(p.laneOffset)).toBe(true);
  });
});
