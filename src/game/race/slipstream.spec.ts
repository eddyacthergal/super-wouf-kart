import { describe, expect, it } from 'vitest';
import { FIXED_DT, SLIPSTREAM } from '../core/constants';
import type { GameEvent, RacerState } from '../core/types';
import { TEST_TUNING, createTestRacer } from '../testing/fixtures';
import { inSlipstream, stepSlipstream } from './slipstream';

/** Deux pilotes sur l'axe +z (cap 0) : le suiveur en (x, 0), le meneur en (0, ahead). */
function pair(ahead: number, x = 0, speedRatio = 0.8, leaderHeading = 0): [RacerState, RacerState] {
  const follower = createTestRacer(1, { x, z: 0 }, 0);
  follower.kart.speed = speedRatio * TEST_TUNING.maxSpeed;
  const leader = createTestRacer(2, { x: 0, z: ahead }, leaderHeading);
  return [follower, leader];
}

describe('aspiration', () => {
  it('dans le sillage : assez près, dans l’axe, assez vite, même sens', () => {
    const [follower, leader] = pair(8);
    expect(inSlipstream(follower, [follower, leader])).toBe(true);
  });

  it.each([
    ['trop près', pair(2)],
    ['trop loin', pair(16)],
    ['hors du cône', pair(8, 8 * Math.tan((20 * Math.PI) / 180))],
    ['trop lent', pair(8, 0, 0.5)],
    ['kart en face (contresens)', pair(8, 0, 0.8, Math.PI)],
  ])('pas d’aspiration : %s', (_label, [follower, leader]) => {
    expect(inSlipstream(follower, [follower, leader])).toBe(false);
  });

  it('pas d’aspiration en tête-à-queue', () => {
    const [follower, leader] = pair(8);
    follower.kart.spinTime = 0.5;
    expect(inSlipstream(follower, [follower, leader])).toBe(false);
  });

  it('la jauge se remplit en 1,2 s puis donne un turbo, une seule fois', () => {
    const [follower, leader] = pair(8);
    const events: GameEvent[] = [];
    const steps = Math.round(SLIPSTREAM.chargeTime / FIXED_DT);
    for (let i = 0; i < steps - 1; i++)
      stepSlipstream([follower, leader], FIXED_DT, (e) => events.push(e));
    expect(follower.kart.slipstream).toBeGreaterThan(0.95);
    expect(follower.kart.boostTime).toBe(0);
    stepSlipstream([follower, leader], FIXED_DT, (e) => events.push(e));
    stepSlipstream([follower, leader], FIXED_DT, (e) => events.push(e));
    expect(events).toEqual([{ type: 'boost', racerId: 1, source: 'slipstream' }]);
    expect(follower.kart.boostTime).toBeCloseTo(SLIPSTREAM.boostDuration, 5);
    expect(follower.kart.boostStrength).toBe(SLIPSTREAM.boostStrength);
    expect(follower.kart.slipstream).toBeLessThan(0.1);
  });

  it('hors du sillage, la jauge se vide deux fois plus vite', () => {
    const [follower, leader] = pair(30);
    follower.kart.slipstream = 0.5;
    const steps = Math.round(0.3 / FIXED_DT);
    for (let i = 0; i < steps; i++) stepSlipstream([follower, leader], FIXED_DT, () => undefined);
    expect(follower.kart.slipstream).toBeCloseTo(0, 5);
  });
});
