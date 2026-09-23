/** Fabriques d'états de course pour les tests unitaires. */
import { RACE_LAPS } from '../core/constants';
import { createKartState } from '../core/kart-state';
import { EMPTY_SKINS, type KartTuning, type RaceState, type RacerState, type TrackQuery } from '../core/types';
import type { Vec2 } from '../core/vec2';

/** Réglages moyens (équivalents à des stats 3/3/3/3). */
export const TEST_TUNING: KartTuning = { maxSpeed: 28.5, acceleration: 13, turnRate: 2.2, mass: 1.1, offroadFactor: 0.59 };

export function createTestRacer(id: number, position: Vec2, heading: number, overrides: Partial<RacerState> = {}): RacerState {
  return {
    id,
    name: `Pilote ${id}`,
    breed: 'jack-russell',
    skins: { ...EMPTY_SKINS },
    kartColor: '#d7322e',
    isPlayer: id === 0,
    aiSkill: 1,
    tuning: { ...TEST_TUNING },
    kart: createKartState(position, heading),
    progress: 0,
    lap: 1,
    lastS: 0,
    finished: false,
    finishTime: null,
    rank: id + 1,
    item: null,
    itemRoulette: 0,
    hitImmunity: 0,
    ...overrides,
  };
}

/**
 * Course en phase « racing » avec `count` pilotes placés sur la grille du circuit
 * (le pilote 0 est le joueur). Les abscisses (progress, lastS, trackIndex) sont cohérentes.
 */
export function createTestRace(track: TrackQuery, count = 4): RaceState {
  const racers: RacerState[] = [];
  for (let i = 0; i < count; i++) {
    const slot = track.gridSlot(i);
    const projection = track.project(slot.position);
    const racer = createTestRacer(i, slot.position, slot.heading, {
      progress: slot.progress,
      lastS: projection.s,
      rank: i + 1,
    });
    racer.kart.trackIndex = projection.index;
    racer.kart.lateral = projection.lateral;
    racers.push(racer);
  }
  return {
    phase: 'racing',
    countdown: 0,
    time: 0,
    laps: RACE_LAPS,
    trackLength: track.length,
    racers,
    playerId: 0,
    items: [],
    itemBoxes: [],
    nextEntityId: 1,
    finishOrder: [],
  };
}
