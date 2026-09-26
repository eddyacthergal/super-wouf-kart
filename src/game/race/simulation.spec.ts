import { describe, expect, it } from 'vitest';
import { AiController } from '../ai/ai-controller';
import { createAiPersonality } from '../ai/personality';
import { COUNTDOWN_SECONDS, FIXED_DT, RACE_LAPS, RACER_COUNT } from '../core/constants';
import { createRng } from '../core/rng';
import {
  EMPTY_SKINS,
  NEUTRAL_INPUT,
  type DriverContext,
  type DriverController,
  type DriverInput,
  type GameEvent,
  type RacerEntry,
  type TrackQuery,
} from '../core/types';
import { dot, forwardOf, sub, wrapAngle } from '../core/vec2';
import { BREEDS } from '../dogs/breeds';
import type { RaceResultEntry } from '../game-api';
import { tuningFromStats } from '../kart/tuning';
import { createCircleTrack } from '../testing/fake-track';
import { createGardenTrack, type Track } from '../track/track';
import { createRoster } from './roster';
import { RaceSimulation } from './simulation';

const garden: Track = createGardenTrack();

/** Contrôleur de test : commandes fixes, compte ses appels. */
class ScriptedController implements DriverController {
  calls = 0;
  constructor(
    readonly racerId: number,
    private readonly input: DriverInput,
  ) {}

  update(): DriverInput {
    this.calls++;
    return { ...this.input };
  }
}

const FULL_THROTTLE: DriverInput = { ...NEUTRAL_INPUT, throttle: true };

function entry(overrides: Partial<RacerEntry> = {}): RacerEntry {
  return {
    name: 'IA',
    breed: 'jack-russell',
    skins: { ...EMPTY_SKINS },
    kartColor: '#2d6cdf',
    isPlayer: false,
    aiSkill: 1,
    ...overrides,
  };
}

function aiControllers(sim: RaceSimulation, seed: number): Map<number, DriverController> {
  const personalityRng = createRng(seed);
  return new Map(
    sim.state.racers.map((racer) => [
      racer.id,
      new AiController(
        racer.id,
        createAiPersonality(personalityRng, racer.id),
        createRng(seed * 31 + racer.id),
      ),
    ]),
  );
}

/** Nombre de pas du compte à rebours (180 à 60 Hz). */
const COUNTDOWN_STEPS = Math.round(COUNTDOWN_SECONDS / FIXED_DT);

function skipCountdown(
  sim: RaceSimulation,
  controllers: ReadonlyMap<number, DriverController>,
): void {
  for (let i = 0; i < COUNTDOWN_STEPS; i++) sim.step(FIXED_DT, controllers);
  expect(sim.state.phase).toBe('racing');
}

describe('RaceSimulation', () => {
  describe('compte à rebours', () => {
    it('émet 3, 2, 1 puis GO au pas près, sans qu’aucun kart ne bouge', () => {
      const sim = new RaceSimulation(garden, createRoster('carlin', EMPTY_SKINS, createRng(5)), {
        rng: createRng(6),
      });
      const controllers = new Map(
        sim.state.racers.map((racer) => [
          racer.id,
          new ScriptedController(racer.id, FULL_THROTTLE),
        ]),
      );
      const grid = sim.state.racers.map((racer) => ({ ...racer.kart.position }));
      const headings = sim.state.racers.map((racer) => racer.kart.heading);
      const timeline: { step: number; events: GameEvent[] }[] = [];

      for (let step = 1; step <= COUNTDOWN_STEPS; step++) {
        const events = sim.step(FIXED_DT, controllers);
        if (events.length > 0) timeline.push({ step, events });
        if (step < COUNTDOWN_STEPS) expect(sim.state.phase).toBe('countdown');
        expect(sim.state.time).toBe(0);
        sim.state.racers.forEach((racer, i) => {
          expect(racer.kart.position).toEqual(grid[i]);
          expect(racer.kart.prevPosition).toEqual(grid[i]);
          expect(racer.kart.heading).toBe(headings[i]);
          expect(racer.kart.prevHeading).toBe(headings[i]);
          expect(racer.kart.speed).toBe(0);
        });
      }

      expect(timeline).toEqual([
        { step: 1, events: [{ type: 'countdown', value: 3 }] },
        { step: 60, events: [{ type: 'countdown', value: 2 }] },
        { step: 120, events: [{ type: 'countdown', value: 1 }] },
        { step: 180, events: [{ type: 'go' }] },
      ]);
      expect(sim.state.phase).toBe('racing');
      expect(sim.state.countdown).toBe(0);
      // Les contrôleurs sont consultés (et ignorés) pendant le compte à rebours.
      expect(controllers.get(0)?.calls).toBe(COUNTDOWN_STEPS);

      // Premier pas de course : le temps démarre et les karts avancent.
      sim.step(FIXED_DT, controllers);
      expect(sim.state.time).toBeCloseTo(FIXED_DT, 12);
      for (const racer of sim.state.racers) expect(racer.kart.speed).toBeGreaterThan(0);
    });

    it('un grand pas franchit plusieurs secondes : toutes les valeurs sont annoncées, dans l’ordre', () => {
      const sim = new RaceSimulation(garden, [entry({ isPlayer: true })], { rng: createRng(1) });
      const events = [...sim.step(1.5, new Map()), ...sim.step(2, new Map())];
      expect(events).toEqual([
        { type: 'countdown', value: 3 },
        { type: 'countdown', value: 2 },
        { type: 'countdown', value: 1 },
        { type: 'go' },
      ]);
    });

    it('ignore un pas invalide', () => {
      const sim = new RaceSimulation(garden, [entry({ isPlayer: true })], { rng: createRng(1) });
      expect(sim.step(Number.NaN, new Map())).toEqual([]);
      expect(sim.step(0, new Map())).toEqual([]);
      expect(sim.state.countdown).toBe(COUNTDOWN_SECONDS);
    });

    it('recale prevPosition et prevHeading sur l’état courant (interpolation stable)', () => {
      const sim = new RaceSimulation(garden, [entry({ isPlayer: true })], { rng: createRng(1) });
      const kart = sim.state.racers[0].kart;
      // État « début de pas » périmé (ex. téléportation avant le départ).
      kart.prevPosition = { x: kart.position.x + 5, z: kart.position.z - 3 };
      kart.prevHeading = kart.heading + 1;
      sim.step(FIXED_DT, new Map());
      expect(kart.prevPosition).toEqual(kart.position);
      expect(kart.prevPosition).not.toBe(kart.position);
      expect(kart.prevHeading).toBe(kart.heading);
    });
  });

  describe('pas de simulation', () => {
    /** Contrôleur qui mémorise les contextes reçus. */
    class RecordingController implements DriverController {
      readonly contexts: { racerId: number; race: unknown; track: unknown; dt: number }[] = [];
      constructor(readonly racerId: number) {}

      update(context: DriverContext): DriverInput {
        this.contexts.push({
          racerId: context.racer.id,
          race: context.race,
          track: context.track,
          dt: context.dt,
        });
        return { ...FULL_THROTTLE };
      }
    }

    it('chaque contrôleur reçoit son pilote, la course, le circuit et le pas', () => {
      const sim = new RaceSimulation(garden, createRoster('carlin', EMPTY_SKINS, createRng(5)), {
        rng: createRng(6),
      });
      const controllers = new Map(
        sim.state.racers.map((racer) => [racer.id, new RecordingController(racer.id)]),
      );
      sim.step(FIXED_DT, controllers);
      sim.state.phase = 'racing';
      sim.step(FIXED_DT / 2, controllers);
      for (const [id, controller] of controllers) {
        expect(controller.contexts).toHaveLength(2);
        for (const context of controller.contexts) {
          expect(context.racerId).toBe(id);
          expect(context.race).toBe(sim.state);
          expect(context.track).toBe(sim.track);
        }
        expect(controller.contexts.map((context) => context.dt)).toEqual([FIXED_DT, FIXED_DT / 2]);
      }
    });

    it('renvoie un nouveau tableau à chaque pas, que les pas suivants ne modifient plus', () => {
      const sim = new RaceSimulation(garden, [entry({ isPlayer: true })], { rng: createRng(1) });
      const first = sim.step(FIXED_DT, new Map());
      const snapshot = [...first];
      const second = sim.step(1, new Map());
      expect(second).not.toBe(first);
      expect(first).toEqual(snapshot);
      expect(second.length).toBeGreaterThan(0);
    });

    it('les événements de stepKart portent l’identifiant du pilote qui les a produits', () => {
      // Cercle de 200 m vers la gauche : le pilote 0 file tout droit jusqu'à la haie extérieure,
      // le pilote 1 prend de la vitesse puis appuie sur Saut en tournant à gauche : il dérape.
      const circle = createCircleTrack(200);
      const sim = new RaceSimulation(circle, [entry(), entry()], { rng: createRng(4) });
      const controllers = new Map<number, DriverController>([
        [0, new ScriptedController(0, FULL_THROTTLE)],
        [1, new ScriptedController(1, { ...FULL_THROTTLE, steer: -1 })],
      ]);
      skipCountdown(sim, controllers);
      const events: GameEvent[] = [];
      for (let i = 0; i < 6 / FIXED_DT; i++) {
        if (i === Math.round(2 / FIXED_DT)) {
          controllers.set(
            1,
            new ScriptedController(1, { ...FULL_THROTTLE, drift: true, steer: -1 }),
          );
        }
        events.push(...sim.step(FIXED_DT, controllers));
      }

      const driftEvents = events.filter(
        (event) => event.type === 'drift-start' || event.type === 'drift-tier',
      );
      expect(driftEvents.length).toBeGreaterThan(0);
      for (const event of driftEvents) expect(event).toMatchObject({ racerId: 1 });
      expect(events).toContainEqual(expect.objectContaining({ type: 'wall', racerId: 0 }));
    });

    it('utilise l’objet quand la commande le demande ; frein maintenu = os lancé en arrière', () => {
      const straight = createCircleTrack(3000);
      for (const backwards of [false, true]) {
        const sim = new RaceSimulation(straight, [entry(), entry({ isPlayer: true })], {
          rng: createRng(2),
        });
        const input: DriverInput = { ...NEUTRAL_INPUT, brake: backwards, useItem: true };
        const controllers = new Map<number, DriverController>([
          [0, new ScriptedController(0, NEUTRAL_INPUT)],
          [1, new ScriptedController(1, input)],
        ]);
        skipCountdown(sim, controllers);
        const racer = sim.state.racers[1];
        racer.item = 'bone';
        racer.itemRoulette = 0;
        const events = sim.step(FIXED_DT, controllers);

        expect(events).toContainEqual({ type: 'item-use', racerId: 1, item: 'bone' });
        expect(racer.item).toBeNull();
        expect(sim.state.items).toHaveLength(1);
        const [bone] = sim.state.items;
        expect(bone.ownerId).toBe(1);
        const forward = forwardOf(racer.kart.heading);
        const offset = dot(sub(bone.position, racer.kart.position), forward);
        const expectedHeading = backwards ? racer.kart.heading + Math.PI : racer.kart.heading;
        expect(wrapAngle(bone.heading - expectedHeading)).toBeCloseTo(0, 9);
        if (backwards) expect(offset).toBeLessThan(0);
        else expect(offset).toBeGreaterThan(0);
      }
    });
  });

  describe('pilotage', () => {
    it('un pilote sans contrôleur est conduit par une IA interne', () => {
      const sim = new RaceSimulation(garden, createRoster('teckel', EMPTY_SKINS, createRng(2)), {
        rng: createRng(3),
      });
      const none = new Map<number, DriverController>();
      skipCountdown(sim, none);
      const start = sim.state.racers.map((racer) => racer.progress);
      for (let i = 0; i < 5 / FIXED_DT; i++) sim.step(FIXED_DT, none);
      sim.state.racers.forEach((racer, i) => expect(racer.progress - start[i]).toBeGreaterThan(40));
    });

    it('à l’arrivée du joueur : phase « finished », résultats figés, IA interne au volant', () => {
      const sim = new RaceSimulation(garden, createRoster('chihuahua', EMPTY_SKINS, createRng(4)), {
        rng: createRng(5),
        laps: 1,
      });
      const controllers = aiControllers(sim, 11);
      const playerId = sim.state.playerId;
      const pilot = new ScriptedController(playerId, FULL_THROTTLE);
      // Le joueur file tout droit sur la ligne droite de départ ; on l'amène juste avant l'arrivée.
      controllers.set(playerId, pilot);
      skipCountdown(sim, controllers);
      const player = sim.state.racers[playerId];
      player.progress += sim.state.laps * garden.length;

      let steps = 0;
      const events: GameEvent[] = [];
      while (!player.finished && steps++ < 600) events.push(...sim.step(FIXED_DT, controllers));
      expect(player.finished).toBe(true);
      expect(events).toContainEqual({ type: 'finish', racerId: playerId, rank: 1 });
      expect(sim.state.phase).toBe('finished');
      const results = sim.results;
      expect(results).not.toBeNull();
      expect(results?.[0]).toMatchObject({
        racerId: playerId,
        rank: 1,
        isPlayer: true,
        estimated: false,
      });
      expect(results?.slice(1).every((result) => result.estimated)).toBe(true);

      // La course continue derrière l'écran de résultats, sans recalculer les résultats.
      const callsAtFinish = pilot.calls;
      const time = sim.state.time;
      for (let i = 0; i < 120; i++) sim.step(FIXED_DT, controllers);
      expect(sim.state.time).toBeGreaterThan(time);
      expect(sim.results).toBe(results);
      expect(sim.state.phase).toBe('finished');
      expect(pilot.calls).toBe(callsAtFinish);
    });

    it('sans joueur : la course se termine quand tous les pilotes sont arrivés', () => {
      const sim = new RaceSimulation(garden, [entry(), entry({ breed: 'carlin' })], {
        rng: createRng(8),
        laps: 1,
      });
      expect(sim.state.playerId).toBe(-1);
      const none = new Map<number, DriverController>();
      skipCountdown(sim, none);
      sim.state.racers[0].progress += garden.length;
      for (let i = 0; i < 240; i++) sim.step(FIXED_DT, none);
      expect(sim.state.racers[0].finished).toBe(true);
      expect(sim.state.phase).toBe('racing');
      expect(sim.results).toBeNull();
      sim.state.racers[1].progress += garden.length;
      for (let i = 0; i < 240; i++) sim.step(FIXED_DT, none);
      expect(sim.state.phase).toBe('finished');
      expect(sim.results?.map((result) => result.racerId)).toEqual([0, 1]);
    });
  });

  describe('rubber band des IA', () => {
    /** Course de 20 s en ligne (quasi) droite, le joueur (s'il existe) crédité de `playerLead` m d'avance. */
    function cruise(track: TrackQuery, entries: RacerEntry[], playerLead: number): RaceSimulation {
      const sim = new RaceSimulation(track, entries, { rng: createRng(9) });
      const controllers = aiControllers(sim, 21);
      skipCountdown(sim, controllers);
      const player = sim.state.racers[sim.state.playerId];
      if (player) player.progress += playerLead;
      for (let i = 0; i < 20 / FIXED_DT; i++) sim.step(FIXED_DT, controllers);
      return sim;
    }

    /** Vitesse de croisière atteinte par chaque pilote. */
    function cruiseSpeeds(track: TrackQuery, entries: RacerEntry[], playerLead: number): number[] {
      return cruise(track, entries, playerLead).state.racers.map((racer) => racer.kart.speed);
    }

    const straight = createCircleTrack(3000);
    const base = tuningFromStats(BREEDS['jack-russell'].stats).maxSpeed;

    it('joueur loin devant : IA à vitesse max × niveau × 1,08 ; le joueur n’est pas touché', () => {
      const [ai, player] = cruiseSpeeds(
        straight,
        [entry({ aiSkill: 0.95 }), entry({ isPlayer: true })],
        800,
      );
      expect(ai).toBeCloseTo(base * 0.95 * 1.08, 1);
      expect(player).toBeCloseTo(base, 1);
    });

    it('joueur loin derrière : IA à vitesse max × niveau × 0,94', () => {
      const [ai] = cruiseSpeeds(
        straight,
        [entry({ aiSkill: 0.95 }), entry({ isPlayer: true })],
        -800,
      );
      expect(ai).toBeCloseTo(base * 0.95 * 0.94, 1);
    });

    it('sans joueur : IA à vitesse max × niveau', () => {
      const [ai] = cruiseSpeeds(straight, [entry({ aiSkill: 0.95 })], 0);
      expect(ai).toBeCloseTo(base * 0.95, 1);
    });

    it.each([200, -200])(
      'entre les bornes, facteur linéaire 1 + écart / 400 × 0,08 (avance du joueur %d m)',
      (lead) => {
        const sim = cruise(straight, [entry({ aiSkill: 0.95 }), entry({ isPlayer: true })], lead);
        const [ai, player] = sim.state.racers;
        const factor = 1 + ((player.progress - ai.progress) / 400) * 0.08;
        // Zone linéaire : ni 0,94 ni 1,08.
        expect(factor).toBeGreaterThan(0.95);
        expect(factor).toBeLessThan(1.07);
        expect(Math.sign(factor - 1)).toBe(Math.sign(lead));
        expect(ai.kart.speed).toBeCloseTo(base * 0.95 * factor, 2);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Intégration : une course complète de 8 IA (le joueur en pilote automatique) sur le jardin
// ---------------------------------------------------------------------------

interface RaceRun {
  finished: boolean;
  raceTime: number;
  finishOrder: number[];
  finishTimes: (number | null)[];
  names: string[];
  counts: Record<string, number>;
  boostsBySource: Record<string, number>;
  finishEvents: GameEvent[];
  maxLateral: number;
  invalidValues: number;
  results: RaceResultEntry[] | null;
  playerId: number;
}

const MAX_RACE_TIME = 420;

function runFullRace(seed: number): RaceRun {
  const rng = createRng(seed);
  const entries = createRoster('jack-russell', EMPTY_SKINS, rng);
  const sim = new RaceSimulation(garden, entries, { rng });
  const controllers = aiControllers(sim, seed + 1000);
  const state = sim.state;
  const counts: Record<string, number> = {};
  const boostsBySource: Record<string, number> = {};
  const finishEvents: GameEvent[] = [];
  let maxLateral = 0;
  let invalidValues = 0;

  const maxSteps = Math.round((COUNTDOWN_SECONDS + MAX_RACE_TIME) / FIXED_DT);
  for (let step = 0; step < maxSteps && !state.racers.every((racer) => racer.finished); step++) {
    for (const event of sim.step(FIXED_DT, controllers)) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      if (event.type === 'boost')
        boostsBySource[event.source] = (boostsBySource[event.source] ?? 0) + 1;
      if (event.type === 'finish') finishEvents.push(event);
    }
    for (const racer of state.racers) {
      const kart = racer.kart;
      maxLateral = Math.max(maxLateral, Math.abs(kart.lateral));
      for (const value of [
        kart.position.x,
        kart.position.z,
        kart.heading,
        kart.speed,
        kart.lateral,
        racer.progress,
      ]) {
        if (!Number.isFinite(value)) invalidValues++;
      }
    }
  }

  return {
    finished: state.racers.every((racer) => racer.finished),
    raceTime: state.time,
    finishOrder: [...state.finishOrder],
    finishTimes: state.racers.map((racer) => racer.finishTime),
    names: state.racers.map((racer) => racer.name),
    counts,
    boostsBySource,
    finishEvents,
    maxLateral,
    invalidValues,
    results: sim.results,
    playerId: state.playerId,
  };
}

const runs = new Map<number, RaceRun>();
function fullRace(seed: number): RaceRun {
  let run = runs.get(seed);
  if (!run) {
    run = runFullRace(seed);
    runs.set(seed, run);
  }
  return run;
}

const SEED = 2026;
const INTEGRATION_TIMEOUT = 120_000;

describe('RaceSimulation — course complète sur le jardin', () => {
  it(
    'les 8 pilotes terminent les 3 tours avec des temps au tour plausibles',
    () => {
      const run = fullRace(SEED);
      expect(run.finished).toBe(true);
      expect(run.raceTime).toBeLessThanOrEqual(MAX_RACE_TIME);
      expect(run.finishOrder).toHaveLength(RACER_COUNT);
      expect(new Set(run.finishOrder).size).toBe(RACER_COUNT);
      for (const time of run.finishTimes) {
        expect(time).not.toBeNull();
        const lapTime = (time ?? Infinity) / RACE_LAPS;
        expect(lapTime).toBeGreaterThan(20);
        expect(lapTime).toBeLessThan(70);
      }
    },
    INTEGRATION_TIMEOUT,
  );

  it(
    'les karts restent entre les haies et aucune valeur ne devient invalide',
    () => {
      const run = fullRace(SEED);
      expect(run.invalidValues).toBe(0);
      expect(run.maxLateral).toBeLessThanOrEqual(garden.wallHalfWidth);
    },
    INTEGRATION_TIMEOUT,
  );

  it(
    'tous les types d’événements de course se produisent',
    () => {
      const { counts } = fullRace(SEED);
      expect(counts['countdown']).toBe(3);
      expect(counts['go']).toBe(1);
      for (const type of ['drift-start', 'boost', 'item-box', 'item-use', 'hit']) {
        expect(counts[type] ?? 0, type).toBeGreaterThan(0);
      }
      expect(counts['lap']).toBe(RACER_COUNT * (RACE_LAPS - 1));
      expect(counts['final-lap']).toBe(RACER_COUNT);
      expect(counts['finish']).toBe(RACER_COUNT);
    },
    INTEGRATION_TIMEOUT,
  );

  it(
    'l’ordre d’arrivée est cohérent avec les temps, les événements et les résultats',
    () => {
      const run = fullRace(SEED);
      const orderedTimes = run.finishOrder.map((id) => run.finishTimes[id] ?? NaN);
      for (let i = 1; i < orderedTimes.length; i++) {
        expect(orderedTimes[i]).toBeGreaterThanOrEqual(orderedTimes[i - 1]);
      }
      expect(run.finishEvents).toEqual(
        run.finishOrder.map((racerId, i) => ({ type: 'finish', racerId, rank: i + 1 })),
      );

      const results = run.results;
      expect(results).not.toBeNull();
      if (!results) return;
      expect(results.map((result) => result.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].time).toBeGreaterThanOrEqual(results[i - 1].time);
      }
      const player = results.find((result) => result.isPlayer);
      expect(player?.estimated).toBe(false);
      expect(player?.time).toBe(run.finishTimes[run.playerId]);
      // Les pilotes arrivés avant le joueur ont leur temps réel.
      const playerIndex = run.finishOrder.indexOf(run.playerId);
      for (const result of results.slice(0, playerIndex + 1)) {
        expect(result.estimated).toBe(false);
        expect(result.time).toBe(run.finishTimes[result.racerId]);
      }
    },
    INTEGRATION_TIMEOUT,
  );

  it(
    'est déterministe : même graine, même course',
    () => {
      const first = fullRace(SEED);
      const second = runFullRace(SEED);
      expect(second).toEqual(first);
    },
    INTEGRATION_TIMEOUT,
  );
});
