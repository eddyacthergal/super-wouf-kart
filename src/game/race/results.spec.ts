import { describe, expect, it } from 'vitest';
import type { RaceState } from '../core/types';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { computeRanks } from './ranking';
import { computeResults } from './results';

/** Course de 4 pilotes à `time` s, avec les progressions données (et arrivées éventuelles). */
function raceAt(time: number, progress: readonly number[]): RaceState {
  const race = createTestRace(createCircleTrack(60), progress.length);
  race.time = time;
  progress.forEach((value, i) => (race.racers[i].progress = value));
  return race;
}

function finish(race: RaceState, id: number, time: number): void {
  const racer = race.racers[id];
  racer.finished = true;
  racer.finishTime = time;
  race.finishOrder.push(id);
}

describe('computeResults', () => {
  it('liste les pilotes dans l’ordre du classement, avec leurs informations', () => {
    const race = raceAt(10, [100, 300, 200, 50]);
    computeRanks(race);
    const results = computeResults(race);
    expect(results.map((entry) => entry.racerId)).toEqual([1, 2, 0, 3]);
    expect(results.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(results[0]).toMatchObject({ name: 'Pilote 1', breed: 'jack-russell', isPlayer: false });
    expect(results[2]).toMatchObject({ racerId: 0, isPlayer: true });
  });

  it('temps réels pour les arrivés, estimations d’après la vitesse moyenne pour les autres', () => {
    const race = raceAt(30, [0, 0, 0, 0]);
    const L = race.trackLength;
    race.racers[0].progress = 3 * L + 2;
    finish(race, 0, 29.9);
    race.racers[1].progress = 2.5 * L;
    race.racers[2].progress = 2 * L;
    race.racers[3].progress = 1.5 * L;
    computeRanks(race);
    const [first, second, third, fourth] = computeResults(race);

    expect(first).toMatchObject({ racerId: 0, time: 29.9, estimated: false });
    // Restant 0,5 L à la vitesse moyenne 2,5 L / 30 s (toutes les moyennes dépassent 10 m/s).
    expect(second.racerId).toBe(1);
    expect(second.estimated).toBe(true);
    expect(second.time).toBeCloseTo(30 + (0.5 * L) / ((2.5 * L) / 30), 9);
    expect(third.time).toBeCloseTo(30 + L / ((2 * L) / 30), 9);
    expect(fourth.time).toBeCloseTo(30 + (1.5 * L) / ((1.5 * L) / 30), 9);
    expect(second.time).toBeLessThan(third.time);
    expect(third.time).toBeLessThan(fourth.time);
  });

  it('sans vitesse moyenne connue : 80 % de la vitesse max, au moins 10 m/s', () => {
    const race = raceAt(0, [-10, -15, -20, -25]);
    const L = race.trackLength;
    race.racers[3].tuning.maxSpeed = 5;
    computeRanks(race);
    const results = computeResults(race);
    const byId = (id: number): number => results.find((entry) => entry.racerId === id)?.time ?? NaN;
    expect(byId(0)).toBeCloseTo((3 * L + 10) / (race.racers[0].tuning.maxSpeed * 0.8), 9);
    // 5 × 0,8 = 4 m/s < 10 m/s : borné.
    expect(byId(3)).toBeCloseTo((3 * L + 25) / 10, 9);
    expect(results.every((entry) => entry.estimated)).toBe(true);
  });

  it('une progression invalide donne un temps fini, juste derrière le pilote précédent', () => {
    const race = raceAt(50, [1000, 900, 0, 800]);
    race.racers[2].progress = Number.NaN;
    computeRanks(race);
    const results = computeResults(race);
    expect(results.map((entry) => entry.racerId)).toEqual([0, 1, 3, 2]);
    for (const entry of results) expect(Number.isFinite(entry.time)).toBe(true);
    expect(results[3].time).toBeCloseTo(results[2].time + 0.1, 9);
    expect(results[3].estimated).toBe(true);
  });

  it('relève une estimation plus faible que le temps du pilote classé avant (+0,1 s)', () => {
    const race = raceAt(40, [0, 0, 0, 0]);
    const L = race.trackLength;
    race.racers[0].progress = 3 * L;
    // Temps d'arrivée postérieur au temps de course courant (état incohérent, mais possible en test).
    finish(race, 0, 60);
    race.racers[1].progress = 3 * L - 1;
    race.racers[2].progress = 3 * L - 2;
    race.racers[3].progress = 10;
    computeRanks(race);
    const results = computeResults(race);
    expect(results.map((entry) => entry.racerId)).toEqual([0, 1, 2, 3]);
    expect(results[1].time).toBeCloseTo(60.1, 9);
    expect(results[2].time).toBeCloseTo(60.2, 9);
    expect(results[3].time).toBeGreaterThan(60.2);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].time).toBeGreaterThanOrEqual(results[i - 1].time);
    }
  });
});
