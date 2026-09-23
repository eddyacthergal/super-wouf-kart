import { describe, expect, it } from 'vitest';
import type { BreedId, StatBlock } from '../core/types';
import { BREED_LIST, BREEDS } from './breeds';

const EXPECTED_STATS: Record<BreedId, StatBlock> = {
  chihuahua: { speed: 3, acceleration: 5, weight: 1, handling: 5 },
  carlin: { speed: 4, acceleration: 2, weight: 5, handling: 3 },
  teckel: { speed: 5, acceleration: 3, weight: 4, handling: 2 },
  'jack-russell': { speed: 4, acceleration: 4, weight: 3, handling: 3 },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

describe('races', () => {
  it('BREED_LIST suit l’ordre du garage', () => {
    expect(BREED_LIST.map((breed) => breed.id)).toEqual([
      'chihuahua',
      'carlin',
      'teckel',
      'jack-russell',
    ]);
  });

  it('BREEDS est indexé par identifiant et reprend les mêmes définitions', () => {
    for (const breed of BREED_LIST) expect(BREEDS[breed.id]).toBe(breed);
    expect(Object.keys(BREEDS).sort()).toEqual(BREED_LIST.map((breed) => breed.id).sort());
  });

  it.each(Object.entries(EXPECTED_STATS))('%s a les stats de la spec', (id, stats) => {
    expect(BREEDS[id as BreedId].stats).toEqual(stats);
  });

  it('chaque race totalise 14 points, chaque stat entre 1 et 5', () => {
    for (const { stats } of BREED_LIST) {
      const values = [stats.speed, stats.acceleration, stats.weight, stats.handling];
      expect(values.reduce((sum, value) => sum + value, 0)).toBe(14);
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });

  it('noms et descriptions sont en français', () => {
    expect(BREED_LIST.map((breed) => breed.name)).toEqual([
      'Chihuahua',
      'Carlin',
      'Teckel',
      'Jack Russell',
    ]);
    expect(BREEDS.chihuahua.description).toBe('Minuscule, nerveux et très maniable.');
    for (const breed of BREED_LIST) expect(breed.description).toMatch(/^\S.*\.$/);
  });

  it('les couleurs sont des hexadécimaux CSS', () => {
    for (const { look } of BREED_LIST) {
      for (const color of [
        look.furColor,
        look.bellyColor,
        look.muzzleColor,
        look.earColor,
        look.innerEarColor,
      ]) {
        expect(color).toMatch(HEX_COLOR);
      }
      for (const color of [look.patchColor, look.eyeMaskColor])
        if (color !== null) expect(color).toMatch(HEX_COLOR);
    }
  });

  it('les silhouettes se distinguent', () => {
    const { chihuahua, carlin, teckel } = BREEDS;
    const jack = BREEDS['jack-russell'];
    expect(chihuahua.look.earStyle).toBe('erect');
    expect(carlin.look).toMatchObject({
      earStyle: 'folded',
      tailStyle: 'corkscrew',
      muzzleLength: 0,
      wrinkles: true,
    });
    expect(carlin.look.eyeMaskColor).not.toBeNull();
    expect(teckel.look.earStyle).toBe('floppy');
    expect(jack.look.earStyle).toBe('semi-floppy');
    expect(jack.look.patchColor).not.toBeNull();
    // Le teckel a le corps et le museau les plus longs ; le chihuahua les plus grandes oreilles.
    for (const other of [chihuahua, carlin, jack]) {
      expect(teckel.look.torsoLength).toBeGreaterThan(other.look.torsoLength * 2);
      expect(teckel.look.muzzleLength).toBeGreaterThan(other.look.muzzleLength);
    }
    for (const other of [carlin, teckel, jack]) {
      expect(chihuahua.look.earLength).toBeGreaterThan(other.look.earLength);
    }
  });
});
