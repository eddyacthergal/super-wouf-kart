import { describe, expect, it } from 'vitest';
import type { GameEvent, RaceState, RacerState, TrackQuery } from '../core/types';
import { addScaled } from '../core/vec2';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { createGardenTrack } from '../track/track';
import { updateProgress } from './progress';

/** Téléporte le kart à l'abscisse non bouclée `progress` (et au décalage `lateral`). */
function placeAt(track: TrackQuery, racer: RacerState, progress: number, lateral = 0): void {
  const sample = track.sampleAt(progress);
  racer.kart.position = addScaled(sample.position, sample.left, lateral);
}

/**
 * Déplace le kart par petits pas de `from` à `to` (abscisses non bouclées) en appelant
 * updateProgress à chaque pas ; renvoie les événements émis.
 */
function drive(
  track: TrackQuery,
  race: RaceState,
  racer: RacerState,
  from: number,
  to: number,
  step = 1,
): GameEvent[] {
  const events: GameEvent[] = [];
  const direction = Math.sign(to - from);
  const count = Math.ceil(Math.abs(to - from) / step);
  for (let k = 1; k <= count; k++) {
    const target = k === count ? to : from + direction * k * step;
    placeAt(track, racer, target);
    updateProgress(racer, race, track, (event) => events.push(event));
  }
  return events;
}

function setup(track: TrackQuery = createCircleTrack(60)): {
  track: TrackQuery;
  race: RaceState;
  racer: RacerState;
} {
  const race = createTestRace(track, 2);
  return { track, race, racer: race.racers[0] };
}

describe('updateProgress', () => {
  it('suit la distance parcourue et annonce le tour 2 au franchissement de la ligne', () => {
    const { track, race, racer } = setup();
    const L = track.length;
    const start = racer.progress;
    expect(start).toBeLessThan(0);

    const beforeLine = drive(track, race, racer, start, -0.5, 0.5);
    expect(beforeLine).toEqual([]);
    expect(racer.progress).toBeCloseTo(-0.5, 6);
    expect(racer.lap).toBe(1);

    expect(drive(track, race, racer, -0.5, 0.5, 0.5)).toEqual([]);
    expect(racer.lap).toBe(1);

    const events = drive(track, race, racer, 0.5, L + 5);
    expect(events).toEqual([{ type: 'lap', racerId: 0, lap: 2 }]);
    expect(racer.progress).toBeCloseTo(L + 5, 6);
    expect(racer.lap).toBe(2);
  });

  it('annonce le dernier tour avec « final-lap », puis l’arrivée une seule fois', () => {
    const { track, race, racer } = setup();
    const L = track.length;
    race.time = 80;
    racer.kart.speed = 25;

    const laps = drive(track, race, racer, racer.progress, 2 * L + 1);
    expect(laps).toEqual([
      { type: 'lap', racerId: 0, lap: 2 },
      { type: 'lap', racerId: 0, lap: 3 },
      { type: 'final-lap', racerId: 0 },
    ]);
    expect(racer.lap).toBe(3);

    const finish = drive(track, race, racer, 2 * L + 1, 3 * L + 0.5);
    expect(finish).toEqual([{ type: 'finish', racerId: 0, rank: 1 }]);
    expect(racer.finished).toBe(true);
    expect(racer.lap).toBe(3);
    expect(race.finishOrder).toEqual([0]);

    // Après l'arrivée, le kart continue : plus aucun événement, le tour reste plafonné.
    expect(drive(track, race, racer, 3 * L + 0.5, 4 * L + 10)).toEqual([]);
    expect(racer.lap).toBe(3);
    expect(racer.progress).toBeCloseTo(4 * L + 10, 6);
    expect(race.finishOrder).toEqual([0]);
  });

  it('reculer puis ré-avancer ne fait ni perdre ni recompter un tour', () => {
    const { track, race, racer } = setup();
    const L = track.length;
    expect(drive(track, race, racer, racer.progress, L + 3)).toEqual([
      { type: 'lap', racerId: 0, lap: 2 },
    ]);

    expect(drive(track, race, racer, L + 3, L - 20)).toEqual([]);
    expect(racer.progress).toBeCloseTo(L - 20, 6);
    expect(racer.lap).toBe(2);

    expect(drive(track, race, racer, L - 20, 2 * L - 1)).toEqual([]);
    expect(racer.progress).toBeCloseTo(2 * L - 1, 6);
    expect(racer.lap).toBe(2);

    expect(drive(track, race, racer, 2 * L - 1, 2 * L + 1)).toEqual([
      { type: 'lap', racerId: 0, lap: 3 },
      { type: 'final-lap', racerId: 0 },
    ]);
  });

  it('reculer derrière la grille rend la progression plus négative sans changer de tour', () => {
    const { track, race, racer } = setup();
    const start = racer.progress;
    expect(drive(track, race, racer, start, start - 30)).toEqual([]);
    expect(racer.progress).toBeCloseTo(start - 30, 6);
    expect(racer.lap).toBe(1);
  });

  it('interpole l’instant d’arrivée sous le pas', () => {
    const { track, race, racer } = setup();
    const L = track.length;
    drive(track, race, racer, racer.progress, 3 * L - 1);
    race.time = 100;
    racer.kart.speed = 20;
    placeAt(track, racer, 3 * L + 1);
    updateProgress(racer, race, track, () => undefined);
    expect(racer.finished).toBe(true);
    // 1 m au-delà de la ligne à 20 m/s : franchie 0,05 s avant la fin du pas.
    expect(racer.finishTime).toBeCloseTo(99.95, 6);
  });

  it('interpolation avec une vitesse nulle : au moins 1 m/s, jamais un temps négatif', () => {
    const { track, race, racer } = setup();
    const L = track.length;
    drive(track, race, racer, racer.progress, 3 * L - 1);
    race.time = 0.5;
    racer.kart.speed = 0;
    placeAt(track, racer, 3 * L + 2);
    updateProgress(racer, race, track, () => undefined);
    expect(racer.finishTime).toBe(0);

    const other = setup();
    drive(other.track, other.race, other.racer, other.racer.progress, 3 * L - 1);
    other.race.time = 50;
    other.racer.kart.speed = 0;
    placeAt(other.track, other.racer, 3 * L + 2);
    updateProgress(other.racer, other.race, other.track, () => undefined);
    expect(other.racer.finishTime).toBeCloseTo(48, 6);
  });

  it('deux arrivées dans le même pas : rangs 1 puis 2, temps dans l’ordre d’arrivée', () => {
    const { track, race } = setup();
    const L = track.length;
    const [first, second] = race.racers;
    drive(track, race, first, first.progress, 3 * L - 0.5);
    drive(track, race, second, second.progress, 3 * L - 0.2);
    race.time = 60;
    first.kart.speed = 30;
    second.kart.speed = 30;
    const events: GameEvent[] = [];
    // Le premier traité franchit la ligne plus tard dans le pas que le second.
    placeAt(track, first, 3 * L + 0.1);
    updateProgress(first, race, track, (event) => events.push(event));
    placeAt(track, second, 3 * L + 0.7);
    updateProgress(second, race, track, (event) => events.push(event));
    expect(events).toEqual([
      { type: 'finish', racerId: 0, rank: 1 },
      { type: 'finish', racerId: 1, rank: 2 },
    ]);
    expect(race.finishOrder).toEqual([0, 1]);
    expect(second.finishTime).toBeGreaterThanOrEqual(first.finishTime ?? Infinity);
  });

  it('une position invalide (NaN) ne corrompt ni la progression ni le tour', () => {
    const { track, race, racer } = setup();
    drive(track, race, racer, racer.progress, 20);
    const before = { progress: racer.progress, lastS: racer.lastS, lap: racer.lap };
    const events: GameEvent[] = [];
    racer.kart.position = { x: Number.NaN, z: 0 };
    updateProgress(racer, race, track, (event) => events.push(event));
    racer.kart.position = { x: 0, z: Number.POSITIVE_INFINITY };
    updateProgress(racer, race, track, (event) => events.push(event));
    expect(events).toEqual([]);
    expect({ progress: racer.progress, lastS: racer.lastS, lap: racer.lap }).toEqual(before);
    // Position redevenue valide : la progression reprend normalement.
    expect(drive(track, race, racer, 20, 25)).toEqual([]);
    expect(racer.progress).toBeCloseTo(25, 6);
  });

  it('course en un tour : l’arrivée sans tour intermédiaire', () => {
    const { track, race, racer } = setup();
    race.laps = 1;
    expect(drive(track, race, racer, racer.progress, track.length + 1)).toEqual([
      { type: 'finish', racerId: 0, rank: 1 },
    ]);
    expect(racer.lap).toBe(1);
  });

  it('sur le jardin, suit un tour complet et met à jour l’indice et le décalage latéral', () => {
    const { track, race, racer } = setup(createGardenTrack());
    const L = track.length;
    const events: GameEvent[] = [];
    let last = racer.progress;
    for (let p = racer.progress + 1; p <= L + 2; p += 1) {
      placeAt(track, racer, p, 2);
      updateProgress(racer, race, track, (event) => events.push(event));
      expect(racer.kart.lateral).toBeCloseTo(2, 3);
      last = p;
    }
    expect(events).toEqual([{ type: 'lap', racerId: 0, lap: 2 }]);
    expect(racer.progress).toBeCloseTo(last, 3);
    expect(racer.kart.trackIndex).toBe(track.project(racer.kart.position).index);
  });
});
