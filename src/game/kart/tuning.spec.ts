import { describe, expect, it } from 'vitest';
import type { KartTuning, StatBlock } from '../core/types';
import { TEST_TUNING } from '../testing/fixtures';
import { tuningFromStats } from './tuning';

const uniform = (points: number): StatBlock => ({ speed: points, acceleration: points, weight: points, handling: points });

function expectTuning(actual: KartTuning, expected: KartTuning): void {
  for (const key of Object.keys(expected) as (keyof KartTuning)[]) {
    expect(actual[key], key).toBeCloseTo(expected[key], 9);
  }
}

describe('tuningFromStats', () => {
  it('stats à 1 : bas des plages de la spec', () => {
    expectTuning(tuningFromStats(uniform(1)), {
      maxSpeed: 25.5,
      acceleration: 9,
      turnRate: 1.8,
      mass: 0.9,
      offroadFactor: 0.53,
    });
  });

  it('stats à 5 : haut des plages de la spec', () => {
    expectTuning(tuningFromStats(uniform(5)), {
      maxSpeed: 31.5,
      acceleration: 17,
      turnRate: 2.6,
      mass: 1.3,
      offroadFactor: 0.65,
    });
  });

  it('stats à 3 : réglages moyens des tests', () => {
    expectTuning(tuningFromStats(uniform(3)), TEST_TUNING);
  });

  it('chaque stat pilote ses propres réglages', () => {
    const tuning = tuningFromStats({ speed: 5, acceleration: 1, weight: 5, handling: 1 });
    expect(tuning.maxSpeed).toBeCloseTo(31.5, 9);
    expect(tuning.acceleration).toBeCloseTo(9, 9);
    expect(tuning.mass).toBeCloseTo(1.3, 9);
    expect(tuning.offroadFactor).toBeCloseTo(0.65, 9);
    expect(tuning.turnRate).toBeCloseTo(1.8, 9);
  });

  it('ramène les stats hors bornes dans [1, 5]', () => {
    expectTuning(tuningFromStats(uniform(0)), tuningFromStats(uniform(1)));
    expectTuning(tuningFromStats(uniform(9)), tuningFromStats(uniform(5)));
  });
});
