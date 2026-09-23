/** Création de l'état initial d'une course : grille de départ, réglages des karts, boîtes à objets. */
import { COUNTDOWN_SECONDS, RACE_LAPS } from '../core/constants';
import { createKartState } from '../core/kart-state';
import type { RaceState, RacerEntry, RacerState, TrackQuery } from '../core/types';
import { BREEDS } from '../dogs/breeds';
import { createItemBoxes } from '../items/item-system';
import { tuningFromStats } from '../kart/tuning';
import { computeRanks } from './ranking';

export interface RaceOptions {
  /** Nombre de tours (RACE_LAPS par défaut). */
  laps?: number;
}

export function createRaceState(
  track: TrackQuery,
  entries: readonly RacerEntry[],
  options: RaceOptions = {},
): RaceState {
  const racers = entries.map((entry, id) => createRacer(track, entry, id));
  const player = racers.find((racer) => racer.isPlayer);
  const race: RaceState = {
    phase: 'countdown',
    countdown: COUNTDOWN_SECONDS,
    time: 0,
    laps: sanitizeLaps(options.laps),
    trackLength: track.length,
    racers,
    playerId: player?.id ?? -1,
    items: [],
    itemBoxes: createItemBoxes(track),
    nextEntityId: 1,
    finishOrder: [],
  };
  computeRanks(race);
  return race;
}

function createRacer(track: TrackQuery, entry: RacerEntry, id: number): RacerState {
  const slot = track.gridSlot(id);
  const projection = track.project(slot.position);
  const kart = createKartState(slot.position, slot.heading, projection.index);
  kart.lateral = projection.lateral;
  return {
    id,
    name: entry.name,
    breed: entry.breed,
    skins: { ...entry.skins },
    kartColor: entry.kartColor,
    isPlayer: entry.isPlayer,
    aiSkill: entry.aiSkill,
    tuning: tuningFromStats(BREEDS[entry.breed].stats),
    kart,
    progress: slot.progress,
    lap: 1,
    lastS: projection.s,
    finished: false,
    finishTime: null,
    rank: id + 1,
    item: null,
    itemRoulette: 0,
    hitImmunity: 0,
  };
}

/** Nombre de tours entier ≥ 1 ; une valeur absente ou invalide donne RACE_LAPS. */
function sanitizeLaps(laps: number | undefined): number {
  if (laps === undefined || !Number.isFinite(laps)) return RACE_LAPS;
  return Math.max(1, Math.round(laps));
}
