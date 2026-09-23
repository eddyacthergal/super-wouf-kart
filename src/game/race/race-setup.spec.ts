import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_SECONDS,
  KART_RADIUS,
  RACE_LAPS,
  RACER_COUNT,
  ROAD_HALF_WIDTH,
} from '../core/constants';
import { createRng } from '../core/rng';
import { EMPTY_SKINS, type RacerEntry } from '../core/types';
import { distance, dot, forwardOf } from '../core/vec2';
import { BREEDS } from '../dogs/breeds';
import { tuningFromStats } from '../kart/tuning';
import { createCircleTrack } from '../testing/fake-track';
import { createGardenTrack } from '../track/track';
import { createRaceState } from './race-setup';
import { createRoster } from './roster';

const track = createGardenTrack();

function entry(overrides: Partial<RacerEntry> = {}): RacerEntry {
  return {
    name: 'Pilote',
    breed: 'teckel',
    skins: { ...EMPTY_SKINS },
    kartColor: '#2d6cdf',
    isPlayer: false,
    aiSkill: 0.95,
    ...overrides,
  };
}

describe('createRaceState', () => {
  const roster = createRoster('carlin', EMPTY_SKINS, createRng(3));
  const race = createRaceState(track, roster);

  it('démarre en phase de compte à rebours, avec les valeurs par défaut', () => {
    expect(race.phase).toBe('countdown');
    expect(race.countdown).toBe(COUNTDOWN_SECONDS);
    expect(race.time).toBe(0);
    expect(race.laps).toBe(RACE_LAPS);
    expect(race.trackLength).toBe(track.length);
    expect(race.items).toEqual([]);
    expect(race.finishOrder).toEqual([]);
    expect(race.playerId).toBe(RACER_COUNT - 1);
  });

  it('place 8 karts distincts sur la route, derrière la ligne, dans le sens de la course', () => {
    expect(race.racers).toHaveLength(RACER_COUNT);
    race.racers.forEach((racer, i) => {
      expect(racer.id).toBe(i);
      const slot = track.gridSlot(i);
      expect(racer.kart.position).toEqual(slot.position);
      expect(racer.kart.heading).toBe(slot.heading);
      expect(racer.progress).toBe(slot.progress);
      expect(racer.progress).toBeLessThan(0);
      const projection = track.project(racer.kart.position);
      expect(Math.abs(projection.lateral)).toBeLessThan(ROAD_HALF_WIDTH - KART_RADIUS);
      expect(racer.kart.lateral).toBeCloseTo(projection.lateral, 9);
      expect(racer.kart.trackIndex).toBe(projection.index);
      expect(racer.lastS).toBeCloseTo(projection.s, 9);
      // Derrière la ligne : abscisse bouclée juste avant la fin du tour.
      expect(racer.lastS).toBeGreaterThan(track.length / 2);
      expect(dot(forwardOf(racer.kart.heading), projection.sample.tangent)).toBeGreaterThan(0.99);
      expect(racer.kart.speed).toBe(0);
      expect(racer.lap).toBe(1);
      expect(racer.finished).toBe(false);
      expect(racer.finishTime).toBeNull();
      expect(racer.item).toBeNull();
    });
    for (let i = 0; i < race.racers.length; i++) {
      for (let j = i + 1; j < race.racers.length; j++) {
        expect(
          distance(race.racers[i].kart.position, race.racers[j].kart.position),
        ).toBeGreaterThan(2 * KART_RADIUS);
      }
    }
  });

  it('reprend les données des entrées et les réglages de la race', () => {
    race.racers.forEach((racer, i) => {
      const source = roster[i];
      expect(racer.name).toBe(source.name);
      expect(racer.breed).toBe(source.breed);
      expect(racer.skins).toEqual(source.skins);
      expect(racer.skins).not.toBe(source.skins);
      expect(racer.kartColor).toBe(source.kartColor);
      expect(racer.isPlayer).toBe(source.isPlayer);
      expect(racer.aiSkill).toBe(source.aiSkill);
      expect(racer.tuning).toEqual(tuningFromStats(BREEDS[source.breed].stats));
    });
  });

  it('classe la pole en tête et le joueur, parti dernier, 8ᵉ', () => {
    expect(race.racers.map((racer) => racer.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(race.racers[race.playerId].rank).toBe(RACER_COUNT);
  });

  it('pose 4 boîtes par rangée de track.itemBoxRows (12 sur le jardin)', () => {
    expect(track.itemBoxRows).toHaveLength(3);
    expect(race.itemBoxes).toHaveLength(12);
    expect(race.itemBoxes.every((box) => box.respawn === 0)).toBe(true);
  });

  it('accepte un nombre de tours, et sans joueur, playerId vaut -1', () => {
    const circle = createCircleTrack(80);
    const custom = createRaceState(circle, [entry(), entry({ breed: 'chihuahua' })], { laps: 1 });
    expect(custom.laps).toBe(1);
    expect(custom.playerId).toBe(-1);
    expect(custom.itemBoxes).toHaveLength(circle.itemBoxRows.length * 4);
    expect(createRaceState(circle, [entry()], { laps: Number.NaN }).laps).toBe(RACE_LAPS);
    expect(createRaceState(circle, [entry()], { laps: 0 }).laps).toBe(1);
  });
});
