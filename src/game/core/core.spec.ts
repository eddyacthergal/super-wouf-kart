import { describe, expect, it } from 'vitest';
import { applyBoost, applySpinOut, createKartState } from './kart-state';
import { createRng } from './rng';
import { forwardOf, headingOf, leftOf, leftOfDirection, wrapAngle } from './vec2';

describe('conventions de repère', () => {
  it('le cap 0 regarde vers +Z et la gauche du pilote est +X', () => {
    expect(forwardOf(0).x).toBeCloseTo(0);
    expect(forwardOf(0).z).toBeCloseTo(1);
    expect(leftOf(0).x).toBeCloseTo(1);
    expect(leftOf(0).z).toBeCloseTo(0);
  });

  it('tourner à gauche (cap croissant) fait pivoter l’avant vers la gauche', () => {
    const turned = forwardOf(0.1);
    expect(turned.x).toBeGreaterThan(0);
  });

  it('leftOfDirection est cohérent avec leftOf', () => {
    const h = 1.234;
    const a = leftOf(h);
    const b = leftOfDirection(forwardOf(h));
    expect(a.x).toBeCloseTo(b.x);
    expect(a.z).toBeCloseTo(b.z);
    expect(headingOf(forwardOf(h))).toBeCloseTo(h);
  });

  it('wrapAngle ramène dans ]-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });
});

describe('createRng', () => {
  it('est déterministe pour une même graine', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('int respecte les bornes incluses', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const v = rng.int(2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(4);
    }
  });
});

describe('effets sur le kart', () => {
  it('un boost plus court ne raccourcit pas le boost en cours', () => {
    const kart = createKartState({ x: 0, z: 0 }, 0);
    applyBoost(kart, 1.5, 1.3);
    applyBoost(kart, 0.5, 1.2);
    expect(kart.boostTime).toBe(1.5);
    expect(kart.boostStrength).toBe(1.3);
  });

  it('le tête-à-queue annule dérapage et boost', () => {
    const kart = createKartState({ x: 0, z: 0 }, 0);
    kart.speed = 20;
    kart.drift = { active: true, direction: 1, charge: 1, tier: 1 };
    applyBoost(kart, 1, 1.3);
    applySpinOut(kart);
    expect(kart.spinTime).toBeGreaterThan(0);
    expect(kart.speed).toBeLessThan(20);
    expect(kart.drift.active).toBe(false);
    expect(kart.boostTime).toBe(0);
  });
});
