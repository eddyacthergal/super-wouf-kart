import { describe, expect, it } from 'vitest';
import type { RaceState } from '../core/types';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { computeRanks } from './ranking';

function raceWithProgress(progress: readonly number[]): RaceState {
  const race = createTestRace(createCircleTrack(60), progress.length);
  progress.forEach((value, i) => (race.racers[i].progress = value));
  return race;
}

const ranks = (race: RaceState): number[] => race.racers.map((racer) => racer.rank);

describe('computeRanks', () => {
  it('classe par progression décroissante (rangs 1-based)', () => {
    const race = raceWithProgress([10, 250, -5, 100]);
    computeRanks(race);
    expect(ranks(race)).toEqual([3, 1, 4, 2]);
  });

  it('égalité de progression : l’id le plus petit devant', () => {
    const race = raceWithProgress([50, 80, 50, 80]);
    computeRanks(race);
    expect(ranks(race)).toEqual([3, 1, 4, 2]);
  });

  it('les arrivés passent devant, dans l’ordre d’arrivée, quelle que soit leur progression', () => {
    const race = raceWithProgress([2000, 1200, 1500, 1300]);
    for (const id of [3, 1]) {
      race.racers[id].finished = true;
      race.finishOrder.push(id);
    }
    // Le premier arrivé (3) a moins de progression que le second (1) : l'ordre d'arrivée fait foi.
    race.racers[3].progress = 1150;
    computeRanks(race);
    expect(ranks(race)).toEqual([3, 2, 4, 1]);
  });

  it('une progression invalide passe en dernier', () => {
    const race = raceWithProgress([Number.NaN, 10, 20]);
    computeRanks(race);
    expect(ranks(race)).toEqual([3, 2, 1]);
  });

  it('les rangs forment une permutation de 1..n', () => {
    const race = raceWithProgress([5, 3, 9, 1, 7, 7, 0, 2]);
    computeRanks(race);
    expect([...ranks(race)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
