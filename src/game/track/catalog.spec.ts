import { describe, expect, it } from 'vitest';
import { AiController } from '../ai/ai-controller';
import { createAiPersonality } from '../ai/personality';
import { COUNTDOWN_SECONDS, FIXED_DT, RACE_LAPS } from '../core/constants';
import { createRng } from '../core/rng';
import { EMPTY_SKINS, type DriverController } from '../core/types';
import { createRoster } from '../race/roster';
import { RaceSimulation } from '../race/simulation';
import { DEFAULT_TRACK_ID, TRACK_CATALOG, findTrack, isTrackId } from './catalog';
import { createTrack } from './track';
import type { TrackDefinition } from './track-definition';
import { validateTrack } from './track-validator';

/** Course complète entre IA (le joueur compris) : temps au tour extrêmes et écart latéral maximal. */
function aiRace(definition: TrackDefinition, seed = 7) {
  const track = createTrack(definition);
  const rng = createRng(seed);
  const laps = definition.laps ?? RACE_LAPS;
  const sim = new RaceSimulation(track, createRoster('jack-russell', EMPTY_SKINS, rng), {
    laps,
    rng,
  });
  const personalities = createRng(seed + 1);
  const controllers = new Map<number, DriverController>(
    sim.state.racers.map((racer) => [
      racer.id,
      new AiController(
        racer.id,
        createAiPersonality(personalities, racer.id),
        createRng(seed * 31 + racer.id),
      ),
    ]),
  );
  let maxLateral = 0;
  const maxSteps = Math.round((COUNTDOWN_SECONDS + 150 * laps) / FIXED_DT);
  const racers = sim.state.racers;
  for (let step = 0; step < maxSteps && !racers.every((racer) => racer.finished); step++) {
    sim.step(FIXED_DT, controllers);
    for (const racer of racers) maxLateral = Math.max(maxLateral, Math.abs(racer.kart.lateral));
  }
  const lapTimes = racers.map((racer) => (racer.finishTime ?? Infinity) / laps);
  return {
    finished: racers.every((racer) => racer.finished),
    fastestLap: Math.min(...lapTimes),
    slowestLap: Math.max(...lapTimes),
    maxLateral,
    wallHalfWidth: track.wallHalfWidth,
  };
}

describe('catalogue des circuits', () => {
  it('identifiants uniques, en minuscules et tirets ; textes renseignés', () => {
    const ids = TRACK_CATALOG.map((track) => track.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const track of TRACK_CATALOG) {
      expect(track.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(track.name.trim()).not.toBe('');
      expect(track.description.trim()).not.toBe('');
    }
  });

  it('circuit par défaut, recherche et repli sur un identifiant inconnu', () => {
    expect(isTrackId(DEFAULT_TRACK_ID)).toBe(true);
    expect(isTrackId('circuit-inconnu')).toBe(false);
    expect(isTrackId(42)).toBe(false);
    expect(findTrack(TRACK_CATALOG.at(-1)?.id)).toBe(TRACK_CATALOG.at(-1));
    expect(findTrack('circuit-inconnu').id).toBe(DEFAULT_TRACK_ID);
    expect(findTrack(undefined).id).toBe(DEFAULT_TRACK_ID);
  });

  // Toutes les définitions sont des données pures : elles passent telles quelles en JSON.
  it.each(TRACK_CATALOG.map((track) => [track.name, track] as const))(
    '%s : définition sérialisable en JSON',
    (_name, definition) => {
      expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    },
  );

  it.each(TRACK_CATALOG.map((track) => [track.name, track] as const))(
    '%s : tracé valide',
    (_name, definition) => {
      expect(validateTrack(createTrack(definition))).toEqual([]);
    },
  );

  it.each(TRACK_CATALOG.map((track) => [track.name, track] as const))(
    '%s : 8 IA terminent la course, entre 20 et 70 s au tour, sans franchir les murs',
    (_name, definition) => {
      const race = aiRace(definition);
      expect(race.finished).toBe(true);
      expect(race.fastestLap).toBeGreaterThan(20);
      expect(race.slowestLap).toBeLessThan(70);
      expect(race.maxLateral).toBeLessThanOrEqual(race.wallHalfWidth);
    },
    120_000,
  );
});
