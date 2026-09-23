import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ParticlePool } from './particles';
import { DisposalBag } from './resources';

const WHITE = new THREE.Color('#ffffff');

describe('ParticlePool', () => {
  it('émet, fait vivre puis éteint les particules', () => {
    const bag = new DisposalBag();
    const pool = new ParticlePool(16, true, bag);
    pool.emit(0, 1, 0, 1, 0, 0, WHITE, 0.2, 0.5, { gravity: -10 });
    pool.emit(0, 1, 0, 0, 0, 1, WHITE, 0.2, 1);
    expect(pool.activeCount).toBe(2);
    pool.update(0.1);
    const positions = pool.points.geometry.getAttribute('position');
    expect(positions.getX(0)).toBeCloseTo(0.1, 5);
    expect(positions.getY(0)).toBeLessThan(1);
    expect(positions.getZ(1)).toBeCloseTo(0.1, 5);
    pool.update(0.5);
    expect(pool.activeCount).toBe(1);
    expect(pool.points.geometry.getAttribute('alpha').getX(0)).toBe(0);
    pool.update(1);
    expect(pool.activeCount).toBe(0);
    bag.dispose();
  });

  it('recycle les plus anciennes quand la réserve est pleine, sans jamais grandir', () => {
    const bag = new DisposalBag();
    const pool = new ParticlePool(8, false, bag);
    for (let i = 0; i < 30; i++) pool.emit(i, 1, 0, 0, 0, 0, WHITE, 0.3, 2);
    pool.update(0.01);
    expect(pool.activeCount).toBe(8);
    expect(pool.points.geometry.getAttribute('position').count).toBe(8);
    // Les 8 dernières émissions occupent la réserve.
    const xs = Array.from({ length: 8 }, (_, i) =>
      pool.points.geometry.getAttribute('position').getX(i),
    );
    expect(Math.min(...xs)).toBe(22);
    bag.dispose();
  });

  it('ignore une émission de durée nulle, négative ou NaN', () => {
    const bag = new DisposalBag();
    const pool = new ParticlePool(4, true, bag);
    for (const life of [0, -1, Number.NaN]) pool.emit(0, 1, 0, 0, 0, 0, WHITE, 0.2, life);
    expect(pool.activeCount).toBe(0);
    pool.update(0.1);
    expect(pool.activeCount).toBe(0);
    const alphas = pool.points.geometry.getAttribute('alpha');
    for (let i = 0; i < alphas.count; i++) expect(alphas.getX(i)).toBe(0);
    bag.dispose();
  });

  it('ne descend pas sous le sol et garde une taille positive', () => {
    const bag = new DisposalBag();
    const pool = new ParticlePool(4, true, bag);
    pool.emit(0, 0.5, 0, 0, -20, 0, WHITE, 0.1, 1, { growth: -1 });
    pool.update(0.3);
    expect(pool.points.geometry.getAttribute('position').getY(0)).toBeGreaterThan(0);
    expect(pool.points.geometry.getAttribute('size').getX(0)).toBeGreaterThanOrEqual(0);
    bag.dispose();
  });
});
