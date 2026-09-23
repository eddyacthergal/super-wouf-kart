import { describe, expect, it } from 'vitest';
import { FIXED_DT } from './core/constants';
import type { RacerState, TrackQuery } from './core/types';
import { headingOf } from './core/vec2';
import { buildHudSnapshot, WrongWayTracker } from './hud';
import { createCircleTrack } from './testing/fake-track';
import { createTestRace } from './testing/fixtures';

const track: TrackQuery = createCircleTrack(2000);

/** Place le kart sur le circuit à l'abscisse s, dans le sens de la course (ou à l'envers). */
function place(racer: RacerState, s: number, reversed: boolean, speed: number): void {
  const sample = track.sampleAt(s);
  const kart = racer.kart;
  kart.position = { ...sample.position };
  kart.heading = headingOf(sample.tangent) + (reversed ? Math.PI : 0);
  kart.speed = speed;
  kart.trackIndex = track.project(kart.position).index;
}

/** Avance le suivi de `seconds` secondes ; renvoie la dernière valeur. */
function run(tracker: WrongWayTracker, racer: RacerState, seconds: number): boolean {
  let wrongWay = false;
  for (let t = 0; t < seconds - 1e-9; t += FIXED_DT)
    wrongWay = tracker.update(racer, track, FIXED_DT);
  return wrongWay;
}

describe('WrongWayTracker', () => {
  it('reste faux dans le bon sens', () => {
    const racer = createTestRace(track, 1).racers[0];
    place(racer, 100, false, 20);
    expect(run(new WrongWayTracker(), racer, 3)).toBe(false);
  });

  it('devient vrai après plus d’une seconde à contre-sens, pas avant', () => {
    const racer = createTestRace(track, 1).racers[0];
    place(racer, 100, true, 10);
    const tracker = new WrongWayTracker();
    expect(run(tracker, racer, 0.95)).toBe(false);
    expect(run(tracker, racer, 0.1)).toBe(true);
  });

  it('ignore un kart presque à l’arrêt face au mauvais sens', () => {
    const racer = createTestRace(track, 1).racers[0];
    place(racer, 100, true, 2);
    expect(run(new WrongWayTracker(), racer, 3)).toBe(false);
  });

  it('ignore un kart de travers (dot entre -0,5 et 0)', () => {
    const racer = createTestRace(track, 1).racers[0];
    place(racer, 100, false, 10);
    racer.kart.heading += 1.9; // cos(1,9) ≈ -0,32
    expect(run(new WrongWayTracker(), racer, 3)).toBe(false);
  });

  it('redevient faux dès que le kart se remet dans le bon sens, et le délai repart de zéro', () => {
    const racer = createTestRace(track, 1).racers[0];
    const tracker = new WrongWayTracker();
    place(racer, 100, true, 10);
    expect(run(tracker, racer, 1.5)).toBe(true);

    place(racer, 100, false, 10);
    expect(tracker.update(racer, track, FIXED_DT)).toBe(false);

    place(racer, 100, true, 10);
    expect(run(tracker, racer, 0.5)).toBe(false);
  });

  it('une alerte levée reste affichée si le kart s’arrête face au mauvais sens', () => {
    const racer = createTestRace(track, 1).racers[0];
    const tracker = new WrongWayTracker();
    place(racer, 100, true, 10);
    expect(run(tracker, racer, 1.5)).toBe(true);
    racer.kart.speed = 0;
    expect(run(tracker, racer, 0.5)).toBe(true);
  });

  it('reset() efface le temps accumulé', () => {
    const racer = createTestRace(track, 1).racers[0];
    const tracker = new WrongWayTracker();
    place(racer, 100, true, 10);
    expect(run(tracker, racer, 1.5)).toBe(true);
    tracker.reset();
    expect(tracker.update(racer, track, FIXED_DT)).toBe(false);
  });
});

describe('buildHudSnapshot', () => {
  it('reprend l’état du joueur et la position de tous les pilotes', () => {
    const race = createTestRace(track, 3);
    race.playerId = 1;
    race.time = 42.5;
    race.laps = 3;
    const player = race.racers[1];
    player.lap = 2;
    player.rank = 2;
    player.item = 'bone';
    player.itemRoulette = 0.4;
    player.kart.speed = -10;
    player.kart.boostTime = 0.3;
    player.kart.drift = { active: true, direction: 1, charge: 1.7, tier: 2 };

    const hud = buildHudSnapshot(race, true);
    expect(hud).toEqual({
      phase: 'racing',
      countdown: null,
      lap: 2,
      laps: 3,
      rank: 2,
      racerCount: 3,
      raceTime: 42.5,
      item: 'bone',
      itemRolling: true,
      driftTier: 2,
      boosting: true,
      wrongWay: true,
      speedKmh: 36,
      dots: race.racers.map((racer) => ({
        id: racer.id,
        x: racer.kart.position.x,
        z: racer.kart.position.z,
      })),
    });
  });

  it('palier de dérapage nul hors dérapage, pas de roulette ni de boost au repos', () => {
    const race = createTestRace(track, 2);
    const kart = race.racers[0].kart;
    kart.drift = { active: false, direction: 0, charge: 0, tier: 3 };
    kart.speed = 27.9;
    const hud = buildHudSnapshot(race, false);
    expect(hud.driftTier).toBe(0);
    expect(hud.itemRolling).toBe(false);
    expect(hud.boosting).toBe(false);
    expect(hud.wrongWay).toBe(false);
    expect(hud.speedKmh).toBe(100);
  });

  it.each([
    { countdown: 3, shown: 3 },
    { countdown: 2.5, shown: 3 },
    { countdown: 1.01, shown: 2 },
    { countdown: 0.4, shown: 1 },
    { countdown: 0, shown: 1 },
  ])('compte à rebours $countdown s → affiche $shown', ({ countdown, shown }) => {
    const race = createTestRace(track, 2);
    race.phase = 'countdown';
    race.countdown = countdown;
    expect(buildHudSnapshot(race, false).countdown).toBe(shown);
  });

  it('pas de compte à rebours en course ni après l’arrivée', () => {
    const race = createTestRace(track, 2);
    expect(buildHudSnapshot(race, false).countdown).toBeNull();
    race.phase = 'finished';
    expect(buildHudSnapshot(race, false)).toMatchObject({ phase: 'finished', countdown: null });
  });
});
