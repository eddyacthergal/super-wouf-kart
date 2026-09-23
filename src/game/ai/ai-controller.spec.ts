import { describe, expect, it } from 'vitest';
import { DRIFT, FIXED_DT, KART_RADIUS, PHYSICS, RACER_COUNT, ROAD_HALF_WIDTH, WALL_HALF_WIDTH } from '../core/constants';
import { applyBoost } from '../core/kart-state';
import { createRng } from '../core/rng';
import {
  NEUTRAL_INPUT,
  type DriftTier,
  type DriverInput,
  type GridSlot,
  type ItemKind,
  type KartState,
  type RaceState,
  type RacerState,
  type TrackProjection,
  type TrackQuery,
  type TrackSample,
} from '../core/types';
import {
  addScaled,
  approach,
  clone,
  distanceSq,
  dot,
  forwardOf,
  headingOf,
  leftOfDirection,
  scale,
  sub,
  wrapAngle,
  type Vec2,
} from '../core/vec2';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace, createTestRacer, TEST_TUNING } from '../testing/fixtures';
import { AiController } from './ai-controller';
import { createAiPersonality, type AiPersonality } from './personality';

// ---------------------------------------------------------------------------
// Circuit analytique fait de lignes droites et d'arcs (stade, épingle)
// ---------------------------------------------------------------------------

interface Segment {
  length: number;
  /** Courbure signée (1/m), > 0 = virage à gauche. */
  curvature: number;
}

/** Point atteint après `t` mètres depuis `start` au cap `heading`, sur un arc de courbure `k`. */
function arcPoint(start: Vec2, heading: number, k: number, t: number): Vec2 {
  if (Math.abs(k) < 1e-9) return addScaled(start, forwardOf(heading), t);
  const end = heading + k * t;
  return { x: start.x + (Math.cos(heading) - Math.cos(end)) / k, z: start.z + (Math.sin(end) - Math.sin(heading)) / k };
}

/** Stade : deux lignes droites reliées par deux demi-cercles, tous tournant du même côté. */
function stadium(straight: number, radius: number, turn: 1 | -1 = 1): Segment[] {
  const bend = { length: Math.PI * radius, curvature: turn / radius };
  return [{ length: straight, curvature: 0 }, bend, { length: straight, curvature: 0 }, bend];
}

function createSegmentTrack(segments: readonly Segment[]): TrackQuery {
  const starts: (Segment & { s: number; position: Vec2; heading: number })[] = [];
  let length = 0;
  let position: Vec2 = { x: 0, z: 0 };
  let heading = 0;
  for (const segment of segments) {
    starts.push({ ...segment, s: length, position, heading });
    position = arcPoint(position, heading, segment.curvature, segment.length);
    heading += segment.curvature * segment.length;
    length += segment.length;
  }
  const wrapS = (s: number): number => ((s % length) + length) % length;

  const sampleAt = (sRaw: number): TrackSample => {
    const s = wrapS(sRaw);
    let segment = starts[0];
    for (const candidate of starts) if (candidate.s <= s) segment = candidate;
    const t = s - segment.s;
    const tangent = forwardOf(segment.heading + segment.curvature * t);
    return {
      s,
      position: arcPoint(segment.position, segment.heading, segment.curvature, t),
      tangent,
      left: leftOfDirection(tangent),
      halfWidth: ROAD_HALF_WIDTH,
      curvature: segment.curvature,
    };
  };

  const count = Math.round(length);
  const spacing = length / count;
  const samples = Array.from({ length: count }, (_, i) => sampleAt(i * spacing));

  const project = (point: Vec2, hintIndex?: number): TrackProjection => {
    const from = hintIndex === undefined ? 0 : hintIndex - 40;
    const to = hintIndex === undefined ? count - 1 : hintIndex + 40;
    let best = 0;
    let bestSq = Infinity;
    for (let i = from; i <= to; i++) {
      const index = ((i % count) + count) % count;
      const d = distanceSq(point, samples[index].position);
      if (d < bestSq) {
        bestSq = d;
        best = index;
      }
    }
    const near = samples[best];
    const s = wrapS(near.s + dot(sub(point, near.position), near.tangent));
    const sample = sampleAt(s);
    return { s, lateral: dot(sub(point, sample.position), sample.left), index: Math.round(s / spacing) % count, sample };
  };

  const gridSlot = (index: number): GridSlot => {
    const progress = -(10 + Math.floor(index / 2) * 7 + (index % 2) * 3.5);
    const sample = sampleAt(progress);
    const lateral = index % 2 === 0 ? 3.5 : -3.5;
    return { position: addScaled(sample.position, sample.left, lateral), heading: headingOf(sample.tangent), progress };
  };

  return { length, wallHalfWidth: WALL_HALF_WIDTH, samples, sampleAt, project, gridSlot, itemBoxRows: [] };
}

// ---------------------------------------------------------------------------
// Intégrateur cinématique de test, fidèle aux conventions du moteur (sans importer src/game/kart)
// ---------------------------------------------------------------------------

class TestKartPhysics {
  private driftHeld = false;

  step(racer: RacerState, rawInput: DriverInput, track: TrackQuery, dt: number): void {
    const kart = racer.kart;
    const input = kart.spinTime > 0 ? NEUTRAL_INPUT : rawInput;
    kart.prevPosition = clone(kart.position);
    kart.prevHeading = kart.heading;
    kart.spinTime = Math.max(0, kart.spinTime - dt);
    kart.boostTime = Math.max(0, kart.boostTime - dt);
    kart.steer = approach(kart.steer, input.steer, PHYSICS.steerResponse * dt);
    this.stepDrift(kart, input, dt);
    this.stepSpeed(racer, input, dt);

    // dθ = −steer × turnRate × min(1, |v| / 6) × signe(v) ; en dérapage, rotation entre steerMin et steerMax.
    const grip = Math.min(1, Math.abs(kart.speed) / PHYSICS.minTurnSpeed) * Math.sign(kart.speed);
    const d = kart.drift.direction;
    const turn = kart.drift.active
      ? d * (DRIFT.steerMin + ((DRIFT.steerMax - DRIFT.steerMin) * (kart.steer * d + 1)) / 2)
      : kart.steer;
    kart.heading -= turn * racer.tuning.turnRate * grip * dt;
    kart.position = addScaled(kart.position, forwardOf(kart.heading), kart.speed * dt);
    this.collide(racer, track);
  }

  private stepDrift(kart: KartState, input: DriverInput, dt: number): void {
    const pressed = input.drift && !this.driftHeld;
    this.driftHeld = input.drift;
    if (kart.drift.active) {
      if (!input.drift) {
        const tier = kart.drift.tier;
        if (tier > 0) applyBoost(kart, DRIFT.boostDurations[tier], DRIFT.boostStrength);
        kart.drift = { active: false, direction: 0, charge: 0, tier: 0 };
      } else if (kart.speed < DRIFT.minSpeed * 0.7) {
        kart.drift = { active: false, direction: 0, charge: 0, tier: 0 };
      } else {
        kart.drift.charge += dt;
        kart.drift.tier = DRIFT.tierThresholds.filter((threshold) => kart.drift.charge >= threshold).length as DriftTier;
      }
      return;
    }
    if (pressed) kart.hopTime = DRIFT.hopDuration;
    if (kart.hopTime <= 0) return;
    kart.hopTime = Math.max(0, kart.hopTime - dt);
    if (kart.hopTime === 0 && input.drift && Math.abs(kart.steer) > 0.2 && kart.speed >= DRIFT.minSpeed) {
      kart.drift = { active: true, direction: kart.steer < 0 ? -1 : 1, charge: 0, tier: 0 };
    }
  }

  private stepSpeed(racer: RacerState, input: DriverInput, dt: number): void {
    const { kart, tuning } = racer;
    const boosting = kart.boostTime > 0;
    const max = tuning.maxSpeed * (boosting ? kart.boostStrength : 1) * (kart.offroad && !boosting ? tuning.offroadFactor : 1);
    if (input.brake) {
      kart.speed =
        kart.speed > 0
          ? Math.max(0, kart.speed - PHYSICS.brakeDeceleration * dt)
          : Math.max(-PHYSICS.reverseMaxSpeed, kart.speed - tuning.acceleration * 0.5 * dt);
    } else if (input.throttle) {
      kart.speed =
        kart.speed > max
          ? approach(kart.speed, max, 8 * dt)
          : Math.min(max, kart.speed + tuning.acceleration * (1 - (0.6 * Math.max(0, kart.speed)) / max) * dt);
    } else {
      kart.speed = approach(kart.speed, 0, PHYSICS.coastDeceleration * dt);
    }
  }

  /** Haies : replacement à la limite et perte de vitesse selon l'angle d'impact ; mise à jour de la progression. */
  private collide(racer: RacerState, track: TrackQuery): void {
    const kart = racer.kart;
    const projection = track.project(kart.position, kart.trackIndex);
    const limit = track.wallHalfWidth - KART_RADIUS;
    let lateral = projection.lateral;
    kart.wallContact = Math.abs(lateral) > limit;
    if (kart.wallContact) {
      const side = Math.sign(lateral);
      lateral = side * limit;
      kart.position = addScaled(projection.sample.position, projection.sample.left, lateral);
      const into = side * dot(forwardOf(kart.heading), projection.sample.left) * Math.sign(kart.speed);
      if (into > 0) kart.speed *= 1 - (1 - PHYSICS.wallSpeedRetention) * into;
    }
    kart.trackIndex = projection.index;
    kart.lateral = lateral;
    kart.offroad = Math.abs(lateral) > projection.sample.halfWidth;
    let ds = projection.s - racer.lastS;
    if (ds > track.length / 2) ds -= track.length;
    else if (ds < -track.length / 2) ds += track.length;
    racer.progress += ds;
    racer.lastS = projection.s;
  }
}

// ---------------------------------------------------------------------------
// Outils de scénario
// ---------------------------------------------------------------------------

const STEADY: AiPersonality = { laneOffset: 0, skill: 1, aggression: 0.5, driftSkill: 0, targetTier: 1 };
const DRIFTER: AiPersonality = { laneOffset: 0, skill: 1, aggression: 0.5, driftSkill: 1, targetTier: 2 };

interface Placement {
  headingOffset?: number;
  speed?: number;
  overrides?: Partial<RacerState>;
}

/** Pilote placé à l'abscisse `s` et au décalage `lateral`, cap aligné sur la tangente (+ décalage). */
function placeRacer(track: TrackQuery, id: number, s: number, lateral: number, placement: Placement = {}): RacerState {
  const sample = track.sampleAt(s);
  const position = addScaled(sample.position, sample.left, lateral);
  const projection = track.project(position);
  const heading = headingOf(sample.tangent) + (placement.headingOffset ?? 0);
  const racer = createTestRacer(id, position, heading, { progress: s, lastS: projection.s, ...placement.overrides });
  racer.kart.trackIndex = projection.index;
  racer.kart.lateral = projection.lateral;
  racer.kart.speed = placement.speed ?? 0;
  return racer;
}

function raceOf(track: TrackQuery, racers: RacerState[]): RaceState {
  return { ...createTestRace(track, 0), racers };
}

function racerById(race: RaceState, id: number): RacerState {
  const racer = race.racers.find((candidate) => candidate.id === id);
  if (!racer) throw new Error(`pilote ${id} introuvable`);
  return racer;
}

/**
 * Fait rouler les IA pendant `seconds` secondes. Un objet utilisé est consommé.
 * `onStep` peut renvoyer true pour arrêter la simulation.
 */
function simulate(
  track: TrackQuery,
  race: RaceState,
  controllers: readonly AiController[],
  seconds: number,
  onStep: (inputs: readonly DriverInput[], time: number) => boolean | void = () => false,
): void {
  const racers = controllers.map((controller) => racerById(race, controller.racerId));
  const physics = controllers.map(() => new TestKartPhysics());
  const steps = Math.round(seconds / FIXED_DT);
  for (let step = 0; step < steps; step++) {
    const inputs = controllers.map((controller, i) => controller.update({ racer: racers[i], race, track, dt: FIXED_DT }));
    inputs.forEach((input, i) => {
      physics[i].step(racers[i], input, track, FIXED_DT);
      if (input.useItem) racers[i].item = null;
    });
    race.time += FIXED_DT;
    if (onStep(inputs, race.time) === true) return;
  }
}

/** Écart du cap par rapport à la tangente locale (+ = tourné vers la gauche). */
function headingVsTrack(track: TrackQuery, kart: KartState): number {
  return wrapAngle(kart.heading - headingOf(track.project(kart.position, kart.trackIndex).sample.tangent));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiController', () => {
  it('ne fait rien pendant le compte à rebours', () => {
    const track = createCircleTrack(60, 'left');
    const race = createTestRace(track, 2);
    race.phase = 'countdown';
    race.racers[1].item = 'kibble-turbo';
    const controller = new AiController(1, STEADY, createRng(1));
    for (let i = 0; i < 120; i++) {
      expect(controller.update({ racer: race.racers[1], race, track, dt: FIXED_DT })).toEqual(NEUTRAL_INPUT);
    }
  });

  describe('direction', () => {
    const track = createCircleTrack(2000, 'left');

    it('cible à gauche : steer < 0 et le cap augmente', () => {
      const racer = placeRacer(track, 1, 100, -4, { speed: 20 });
      const race = raceOf(track, [racer]);
      const controller = new AiController(1, STEADY, createRng(1));
      expect(controller.update({ racer, race, track, dt: FIXED_DT }).steer).toBeLessThan(0);
      const before = headingVsTrack(track, racer.kart);
      simulate(track, race, [controller], 0.4);
      expect(headingVsTrack(track, racer.kart) - before).toBeGreaterThan(0.02);
    });

    it('cible à droite : steer > 0 et le cap diminue', () => {
      const racer = placeRacer(track, 1, 100, 4, { speed: 20 });
      const race = raceOf(track, [racer]);
      const controller = new AiController(1, STEADY, createRng(1));
      expect(controller.update({ racer, race, track, dt: FIXED_DT }).steer).toBeGreaterThan(0);
      const before = headingVsTrack(track, racer.kart);
      simulate(track, race, [controller], 0.4);
      expect(headingVsTrack(track, racer.kart) - before).toBeLessThan(-0.02);
    });

    it('en marche arrière, braquage inversé : le nez tourne quand même vers la cible', () => {
      const racer = placeRacer(track, 1, 100, -4, { speed: -5 });
      const race = raceOf(track, [racer]);
      const controller = new AiController(1, STEADY, createRng(1));
      expect(controller.update({ racer, race, track, dt: FIXED_DT }).steer).toBeGreaterThan(0);
      const before = headingVsTrack(track, racer.kart);
      simulate(track, race, [controller], 0.25);
      expect(racer.kart.speed).toBeLessThan(0);
      expect(headingVsTrack(track, racer.kart) - before).toBeGreaterThan(0.01);
    });

    it('rejoint son couloir sur une ligne droite', () => {
      const racer = placeRacer(track, 1, 100, -5, { speed: 20 });
      const race = raceOf(track, [racer]);
      simulate(track, race, [new AiController(1, { ...STEADY, laneOffset: 2 }, createRng(1))], 6);
      expect(racer.kart.lateral).toBeCloseTo(2, 0);
      expect(Math.abs(headingVsTrack(track, racer.kart))).toBeLessThan(0.05);
    });

    it('se décale du côté opposé à un kart juste devant', () => {
      const steerAfterAvoiding = (blockerLateral: number | null): number => {
        const racer = placeRacer(track, 1, 100, 0, { speed: 20 });
        const others = blockerLateral === null ? [] : [placeRacer(track, 2, 106, blockerLateral, { speed: 10 })];
        const race = raceOf(track, [racer, ...others]);
        const controller = new AiController(1, STEADY, createRng(1));
        let steer = 0;
        for (let i = 0; i < 30; i++) steer = controller.update({ racer, race, track, dt: FIXED_DT }).steer;
        return steer;
      };
      const free = steerAfterAvoiding(null);
      expect(steerAfterAvoiding(0.5)).toBeGreaterThan(free + 0.05);
      expect(steerAfterAvoiding(-0.5)).toBeLessThan(free - 0.05);
    });

    it('ignore un kart hors du cône d’évitement ou à plus de 9 m', () => {
      const steerWith = (others: [number, number][]): number => {
        const racer = placeRacer(track, 1, 100, 0, { speed: 20 });
        const race = raceOf(track, [racer, ...others.map(([s, lateral], i) => placeRacer(track, 2 + i, s, lateral))]);
        const controller = new AiController(1, STEADY, createRng(1));
        let steer = 0;
        for (let i = 0; i < 30; i++) steer = controller.update({ racer, race, track, dt: FIXED_DT }).steer;
        return steer;
      };
      const free = steerWith([]);
      // 6 m devant et 5 m à gauche : vu sous 0.69 rad > 0.5 ; 12 m devant dans l'axe : trop loin.
      expect(steerWith([[106, 5]])).toBeCloseTo(free, 6);
      expect(steerWith([[112, 0.5]])).toBeCloseTo(free, 6);
    });
  });

  describe.each([
    ['left', 1],
    ['right', -1],
  ] as const)('préférence pour l’intérieur (cercle de 60 m, %s)', (direction, inside) => {
    it('roule du côté intérieur du virage', () => {
      const track = createCircleTrack(60, direction);
      const racer = placeRacer(track, 1, 0, 0, { speed: 20 });
      const race = raceOf(track, [racer]);
      simulate(track, race, [new AiController(1, STEADY, createRng(1))], 8);
      // Courbure 1/60 × 120 = 2 m vers l'intérieur (lateral > 0 = gauche = intérieur d'un virage à gauche).
      expect(racer.kart.lateral * inside).toBeGreaterThan(1.5);
      expect(racer.kart.lateral * inside).toBeLessThan(2.5);
    });
  });

  describe.each(['left', 'right'] as const)('cercle de 60 m (%s)', (direction) => {
    it.each([-3, 0, 3])('boucle deux tours sur la route sans se bloquer (couloir %d m)', (laneOffset) => {
      const track = createCircleTrack(60, direction);
      const race = createTestRace(track, 1);
      const racer = race.racers[0];
      const controller = new AiController(0, { ...DRIFTER, laneOffset }, createRng(3));
      let maxLateral = 0;
      let walls = 0;
      let reversed = false;
      let drifted = false;
      let minCruiseSpeed = Infinity;
      simulate(track, race, [controller], 60, ([input], time) => {
        maxLateral = Math.max(maxLateral, Math.abs(racer.kart.lateral));
        if (racer.kart.wallContact) walls++;
        if (racer.kart.speed < 0) reversed = true;
        if (input.drift) drifted = true;
        if (time > 3) minCruiseSpeed = Math.min(minCruiseSpeed, racer.kart.speed);
        return racer.progress >= 2 * track.length;
      });
      expect(racer.progress).toBeGreaterThanOrEqual(2 * track.length);
      expect(maxLateral).toBeLessThanOrEqual(ROAD_HALF_WIDTH + 1);
      expect(walls).toBe(0);
      expect(reversed).toBe(false);
      expect(minCruiseSpeed).toBeGreaterThan(20);
      // Courbure 1/60 < 1/45 : pas assez serré pour déraper.
      expect(drifted).toBe(false);
    });

    it('un peloton de 8 IA boucle deux tours sans sortir de la route', () => {
      const track = createCircleTrack(60, direction);
      const race = createTestRace(track, RACER_COUNT);
      const personalityRng = createRng(99);
      const controllers = race.racers.map(
        (racer, index) => new AiController(racer.id, createAiPersonality(personalityRng, index), createRng(100 + index)),
      );
      let maxLateral = 0;
      simulate(track, race, controllers, 60, () => {
        for (const racer of race.racers) maxLateral = Math.max(maxLateral, Math.abs(racer.kart.lateral));
        return race.racers.every((racer) => racer.progress >= 2 * track.length);
      });
      for (const racer of race.racers) expect(racer.progress).toBeGreaterThanOrEqual(2 * track.length);
      expect(maxLateral).toBeLessThanOrEqual(ROAD_HALF_WIDTH + 1);
    });
  });

  describe.each([1, -1] as const)('épingle de 16 m (sens %d)', (turn) => {
    it('freine avant le virage serré et le passe sur la route', () => {
      const straight = 150;
      const radius = 16;
      const track = createSegmentTrack(stadium(straight, radius, turn));
      const racer = placeRacer(track, 1, 30, 0, { speed: TEST_TUNING.maxSpeed });
      const race = raceOf(track, [racer]);
      let approachSpeed = 0;
      let brakedBefore = false;
      let entrySpeed = Number.NaN;
      let maxLateral = 0;
      let walls = 0;
      simulate(track, race, [new AiController(1, STEADY, createRng(1))], 20, ([input]) => {
        const s = racer.progress;
        if (s < straight - 50) approachSpeed = Math.max(approachSpeed, racer.kart.speed);
        if (s > straight - 50 && s < straight && input.brake) brakedBefore = true;
        if (Number.isNaN(entrySpeed) && s >= straight) entrySpeed = racer.kart.speed;
        maxLateral = Math.max(maxLateral, Math.abs(racer.kart.lateral));
        if (racer.kart.wallContact) walls++;
        return s > track.length + 30;
      });
      expect(approachSpeed).toBeGreaterThan(27);
      expect(brakedBefore).toBe(true);
      expect(entrySpeed).toBeLessThanOrEqual(Math.sqrt(26 * radius) + 2.5);
      expect(racer.progress).toBeGreaterThan(track.length + 30);
      expect(maxLateral).toBeLessThanOrEqual(ROAD_HALF_WIDTH + 1);
      expect(walls).toBe(0);
    });
  });

  describe('dérapage', () => {
    describe.each([1, -1] as const)('long virage serré (sens %d)', (turn) => {
      it.each([1, 2] as const)('dérape, atteint le palier %d visé, relâche en sortie et reste sur la route', (targetTier) => {
        const straight = 120;
        const radius = 24;
        const track = createSegmentTrack(stadium(straight, radius, turn));
        const racer = placeRacer(track, 1, 20, 0, { speed: TEST_TUNING.maxSpeed });
        const race = raceOf(track, [racer]);
        const controller = new AiController(1, { ...DRIFTER, targetTier }, createRng(1));
        const bendEnd = straight + Math.PI * radius;
        let driftSteps = 0;
        let direction = 0;
        let lastTier = 0;
        let releasedTier = -1;
        let releasedAt = Number.NaN;
        let boostAtRelease = 0;
        let wasActive = false;
        let maxLateral = 0;
        simulate(track, race, [controller], 20, () => {
          const drift = racer.kart.drift;
          if (drift.active) {
            driftSteps++;
            direction = drift.direction;
            lastTier = drift.tier;
          } else if (wasActive && releasedTier < 0) {
            releasedTier = lastTier;
            releasedAt = racer.progress;
            boostAtRelease = racer.kart.boostTime;
          }
          wasActive = drift.active;
          maxLateral = Math.max(maxLateral, Math.abs(racer.kart.lateral));
          return racer.progress > bendEnd + 40;
        });
        expect(driftSteps).toBeGreaterThan(60);
        // Virage à gauche (turn = 1) → dérapage vers la gauche (direction -1).
        expect(direction).toBe(-turn);
        expect(releasedTier).toBeGreaterThanOrEqual(targetTier);
        expect(boostAtRelease).toBeGreaterThan(0);
        expect(releasedAt).toBeGreaterThan(straight);
        expect(releasedAt).toBeLessThan(bendEnd + 5);
        expect(racer.kart.drift.active).toBe(false);
        expect(maxLateral).toBeLessThanOrEqual(ROAD_HALF_WIDTH);
      });
    });

    it('une IA qui vise le palier 2 tient son dérapage plus longtemps que celle qui vise le palier 1', () => {
      const releases = (targetTier: 1 | 2): { tier: number; at: number }[] => {
        const track = createSegmentTrack(stadium(100, 20));
        const racer = placeRacer(track, 1, 10, 0, { speed: 20 });
        const race = raceOf(track, [racer]);
        const result: { tier: number; at: number }[] = [];
        let wasActive = false;
        let lastTier = 0;
        simulate(track, race, [new AiController(1, { ...DRIFTER, targetTier }, createRng(1))], 30, () => {
          if (wasActive && !racer.kart.drift.active) result.push({ tier: lastTier, at: racer.progress });
          wasActive = racer.kart.drift.active;
          lastTier = racer.kart.drift.tier;
          return racer.progress > track.length;
        });
        return result;
      };
      const tierOne = releases(1);
      const tierTwo = releases(2);
      // Deux virages par tour : relâché dès le palier 1 en sortie, ou tenu jusqu'au palier 2.
      expect(tierOne.map((release) => release.tier)).toEqual([1, 1]);
      expect(tierTwo.map((release) => release.tier)).toEqual([2, 2]);
      tierOne.forEach((release, i) => expect(release.at).toBeLessThan(tierTwo[i].at));
    });

    it('ne dérape pas en ligne droite', () => {
      const track = createCircleTrack(2000, 'left');
      const racer = placeRacer(track, 1, 20, 0, { speed: TEST_TUNING.maxSpeed });
      const race = raceOf(track, [racer]);
      let drifted = false;
      simulate(track, race, [new AiController(1, DRIFTER, createRng(1))], 10, ([input]) => {
        drifted ||= input.drift;
      });
      expect(drifted).toBe(false);
    });

    it.each([
      [4, 24],
      [3, 20],
    ])('pas de dérapage sans boost : virages trop courts pour charger un palier (%d coins, rayon %d m)', (corners, radius) => {
      // Polygone aux coins arrondis : virages serrés de 90° (38 m) ou 120° (42 m) de long.
      const corner = { length: (2 * Math.PI * radius) / corners, curvature: 1 / radius };
      const track = createSegmentTrack(Array.from({ length: corners }, () => [{ length: 60, curvature: 0 }, corner]).flat());
      const racer = placeRacer(track, 1, 10, 0, { speed: 20 });
      const race = raceOf(track, [racer]);
      const releasedTiers: number[] = [];
      let wasActive = false;
      let lastTier = 0;
      let maxLateral = 0;
      simulate(track, race, [new AiController(1, DRIFTER, createRng(1))], 60, () => {
        if (wasActive && !racer.kart.drift.active) releasedTiers.push(lastTier);
        wasActive = racer.kart.drift.active;
        lastTier = racer.kart.drift.tier;
        maxLateral = Math.max(maxLateral, Math.abs(racer.kart.lateral));
        return racer.progress > 2 * track.length;
      });
      expect(racer.progress).toBeGreaterThan(2 * track.length);
      expect(releasedTiers.filter((tier) => tier === 0)).toEqual([]);
      expect(maxLateral).toBeLessThanOrEqual(ROAD_HALF_WIDTH + 1);
    });

    it('ne dérape pas si la personnalité ne le tente pas', () => {
      const track = createSegmentTrack(stadium(120, 24));
      const racer = placeRacer(track, 1, 20, 0, { speed: TEST_TUNING.maxSpeed });
      const race = raceOf(track, [racer]);
      let drifted = false;
      simulate(track, race, [new AiController(1, { ...DRIFTER, driftSkill: 0 }, createRng(1))], 15, ([input]) => {
        drifted ||= input.drift;
      });
      expect(drifted).toBe(false);
    });
  });

  describe('objets', () => {
    const straight = createCircleTrack(2000, 'left');

    interface ItemScenario {
      item: ItemKind;
      track?: TrackQuery;
      personality?: Partial<AiPersonality>;
      overrides?: Partial<RacerState>;
      /** Autres karts : [abscisse, décalage latéral]. */
      others?: [number, number][];
    }

    function scenario({ item, track = straight, personality, overrides, others = [] }: ItemScenario) {
      const racer = placeRacer(track, 1, 100, 0, { speed: 20, overrides: { item, rank: 2, ...overrides } });
      const opponents = others.map(([s, lateral], i) => placeRacer(track, 10 + i, s, lateral, { speed: 20 }));
      const race = raceOf(track, [racer, ...opponents]);
      const controller = new AiController(1, { ...STEADY, ...personality }, createRng(4));
      const step = (): DriverInput => controller.update({ racer, race, track, dt: FIXED_DT });
      /** Instant (s) du premier usage, ou null. Le kart reste immobile : seule la décision est testée. */
      const firstUse = (seconds: number): number | null => {
        for (let i = 1; i <= Math.round(seconds / FIXED_DT); i++) if (step().useItem) return i * FIXED_DT;
        return null;
      };
      return { racer, race, step, firstUse };
    }

    it('croquette turbo : utilisée en ligne droite', () => {
      expect(scenario({ item: 'kibble-turbo' }).firstUse(0.5)).toBeLessThanOrEqual(2 * FIXED_DT);
    });

    it('croquette turbo : gardée dans un virage', () => {
      expect(scenario({ item: 'kibble-turbo', track: createCircleTrack(40, 'right') }).firstUse(10)).toBeNull();
    });

    it('os : lancé tout de suite sur un kart devant dans l’axe', () => {
      expect(scenario({ item: 'bone', others: [[118, 0.5]] }).firstUse(0.5)).toBeLessThanOrEqual(2 * FIXED_DT);
    });

    it('os : pas de lancer immédiat sur un kart hors de l’axe, puis lancer après 4 à 8 s', () => {
      const time = scenario({ item: 'bone', personality: { aggression: 0 }, others: [[112, 6]] }).firstUse(10);
      expect(time).not.toBeNull();
      expect(time).toBeGreaterThanOrEqual(4);
      expect(time).toBeLessThanOrEqual(8);
    });

    it('os : une IA agressive le lance plus tôt', () => {
      const time = scenario({ item: 'bone', personality: { aggression: 1 } }).firstUse(10);
      expect(time).toBeGreaterThanOrEqual(2);
      expect(time).toBeLessThanOrEqual(4);
    });

    it('balle de tennis : lancée après 0.5 à 2 s si pas premier', () => {
      const time = scenario({ item: 'tennis-ball', overrides: { rank: 3 } }).firstUse(5);
      expect(time).toBeGreaterThanOrEqual(0.5);
      expect(time).toBeLessThanOrEqual(2);
    });

    it('balle de tennis : gardée en tête de course', () => {
      expect(scenario({ item: 'tennis-ball', overrides: { rank: 1 } }).firstUse(10)).toBeNull();
    });

    it('balle de tennis : lancée dès que l’IA perd la tête', () => {
      const { racer, step, firstUse } = scenario({ item: 'tennis-ball', overrides: { rank: 1 } });
      for (let i = 0; i < 180; i++) expect(step().useItem).toBe(false);
      racer.rank = 2;
      expect(firstUse(0.5)).toBeLessThanOrEqual(2 * FIXED_DT);
    });

    it('flaque : déposée tout de suite si un kart suit de près', () => {
      const { race, firstUse } = scenario({ item: 'mud', others: [[90, 2]] });
      race.racers[1].progress = 90;
      expect(firstUse(0.5)).toBeLessThanOrEqual(2 * FIXED_DT);
    });

    it('flaque : sinon déposée après 3 à 10 s', () => {
      const time = scenario({ item: 'mud', others: [[60, 2]] }).firstUse(12);
      expect(time).toBeGreaterThanOrEqual(3);
      expect(time).toBeLessThanOrEqual(10);
    });

    it('os : le frein est relâché le temps du lancer (frein maintenu = lancer en arrière)', () => {
      const hairpin = createSegmentTrack(stadium(150, 16));
      const firstInput = (item: ItemKind | null): DriverInput => {
        const racer = placeRacer(hairpin, 1, 130, 0, { speed: TEST_TUNING.maxSpeed, overrides: { item } });
        const ahead = placeRacer(hairpin, 2, 145, 0, { speed: 15 });
        const controller = new AiController(1, STEADY, createRng(1));
        return controller.update({ racer, race: raceOf(hairpin, [racer, ahead]), track: hairpin, dt: FIXED_DT });
      };
      // Sans objet, l'IA freine à l'approche de l'épingle...
      expect(firstInput(null).brake).toBe(true);
      // ... mais l'os visé sur le kart de devant doit partir vers l'avant.
      const input = firstInput('bone');
      expect(input.useItem).toBe(true);
      expect(input.brake).toBe(false);
    });

    it('aucun usage pendant la roulette', () => {
      expect(scenario({ item: 'kibble-turbo', overrides: { itemRoulette: 1 } }).firstUse(5)).toBeNull();
    });

    it('useItem est un front montant : vrai sur un seul pas', () => {
      // Objet jamais consommé : jamais deux pas de suite.
      const kept = scenario({ item: 'kibble-turbo' });
      let previous = false;
      let uses = 0;
      for (let i = 0; i < 180; i++) {
        const use = kept.step().useItem;
        expect(use && previous).toBe(false);
        if (use) uses++;
        previous = use;
      }
      expect(uses).toBeGreaterThan(0);

      // Objet consommé : un seul usage.
      const consumed = scenario({ item: 'kibble-turbo' });
      uses = 0;
      for (let i = 0; i < 180; i++) {
        if (consumed.step().useItem) {
          uses++;
          consumed.racer.item = null;
        }
      }
      expect(uses).toBe(1);
    });
  });

  describe('situations difficiles', () => {
    it('se dégage en reculant quand il est collé face à une haie', () => {
      const track = createCircleTrack(60, 'left');
      const limit = WALL_HALF_WIDTH - KART_RADIUS;
      // Cap tourné de 90° vers la gauche : le nez est face à la haie gauche.
      const racer = placeRacer(track, 1, 50, limit - 0.05, { headingOffset: Math.PI / 2 });
      const race = raceOf(track, [racer]);
      const start = racer.progress;
      let reversed = false;
      let freedAt = Number.NaN;
      simulate(track, race, [new AiController(1, STEADY, createRng(1))], 12, (_, time) => {
        if (racer.kart.speed < -1) reversed = true;
        if (racer.progress - start > 40) {
          freedAt = time;
          return true;
        }
        return false;
      });
      expect(reversed).toBe(true);
      expect(freedAt).toBeLessThan(8);
      expect(Math.abs(headingVsTrack(track, racer.kart))).toBeLessThan(0.5);
    });

    it('blocage : marche arrière braquage inversé après 1.5 s à l’arrêt, pendant 1 s', () => {
      const track = createCircleTrack(2000, 'left');
      // Cible à gauche : en marche avant l'IA braque à gauche (steer < 0).
      const racer = placeRacer(track, 1, 100, -4);
      const race = raceOf(track, [racer]);
      const controller = new AiController(1, STEADY, createRng(1));
      const inputs = Array.from({ length: Math.round(3 / FIXED_DT) }, () =>
        controller.update({ racer, race, track, dt: FIXED_DT }),
      );
      const firstReverse = inputs.findIndex((input) => input.brake);
      const reverseSteps = inputs.slice(firstReverse).findIndex((input) => !input.brake);
      expect(inputs[0].steer).toBeLessThan(0);
      expect(inputs[0].throttle).toBe(true);
      expect(firstReverse * FIXED_DT).toBeGreaterThanOrEqual(1.5);
      expect(firstReverse * FIXED_DT).toBeLessThan(1.6);
      expect(reverseSteps * FIXED_DT).toBeCloseTo(1, 1);
      for (const input of inputs.slice(firstReverse, firstReverse + reverseSteps)) {
        expect(input.throttle).toBe(false);
        expect(input.steer).toBe(1);
      }
      // Reprise en marche avant ensuite.
      expect(inputs[firstReverse + reverseSteps].throttle).toBe(true);
    });

    it('pas de blocage détecté pendant le compte à rebours', () => {
      const track = createCircleTrack(2000, 'left');
      const racer = placeRacer(track, 1, 100, 0);
      const race = raceOf(track, [racer]);
      race.phase = 'countdown';
      const controller = new AiController(1, STEADY, createRng(1));
      for (let i = 0; i < Math.round(3 / FIXED_DT); i++) controller.update({ racer, race, track, dt: FIXED_DT });
      race.phase = 'racing';
      expect(controller.update({ racer, race, track, dt: FIXED_DT })).toMatchObject({ throttle: true, brake: false });
    });

    it('contre-sens seulement quand dot(avant, tangente) < -0.3', () => {
      const track = createCircleTrack(2000, 'left');
      const firstInput = (headingOffset: number): DriverInput => {
        const racer = placeRacer(track, 1, 100, 0, { speed: 15, headingOffset, overrides: { item: 'kibble-turbo' } });
        return new AiController(1, STEADY, createRng(1)).update({ racer, race: raceOf(track, [racer]), track, dt: FIXED_DT });
      };
      // cos(1.75) ≈ -0.18 : conduite normale (gaz, objet autorisé en ligne droite).
      expect(firstInput(1.75)).toMatchObject({ throttle: true, brake: false, useItem: true });
      // cos(2.2) ≈ -0.59 : demi-tour, braquage à fond, vitesse réduite, aucun objet.
      const uTurn = firstInput(2.2);
      expect(uTurn).toMatchObject({ throttle: false, brake: true, useItem: false });
      expect(Math.abs(uTurn.steer)).toBe(1);
    });

    it.each([0, 5, -5])('fait demi-tour à contre-sens (décalage %d m)', (lateral) => {
      const track = createCircleTrack(60, 'left');
      const racer = placeRacer(track, 1, 50, lateral, { headingOffset: Math.PI, speed: 10 });
      const race = raceOf(track, [racer]);
      let turnedAt = Number.NaN;
      let walls = 0;
      simulate(track, race, [new AiController(1, STEADY, createRng(1))], 8, (_, time) => {
        if (racer.kart.wallContact) walls++;
        if (Number.isNaN(turnedAt) && Math.cos(headingVsTrack(track, racer.kart)) > 0.9) turnedAt = time;
        return false;
      });
      expect(turnedAt).toBeLessThan(4);
      expect(walls).toBe(0);
      expect(Math.cos(headingVsTrack(track, racer.kart))).toBeGreaterThan(0.9);
      expect(racer.kart.speed).toBeGreaterThan(15);
    });

    it('n’agit pas pendant un tête-à-queue', () => {
      const track = createCircleTrack(60, 'left');
      const racer = placeRacer(track, 1, 50, 0, { speed: 5, overrides: { item: 'kibble-turbo' } });
      racer.kart.spinTime = 1;
      const race = raceOf(track, [racer]);
      const input = new AiController(1, STEADY, createRng(1)).update({ racer, race, track, dt: FIXED_DT });
      expect(input).toEqual(NEUTRAL_INPUT);
      expect(input).not.toBe(NEUTRAL_INPUT);
    });
  });

  it('est déterministe : même graine, mêmes commandes', () => {
    const run = (seed: number): string => {
      const track = createSegmentTrack(stadium(100, 22));
      const race = createTestRace(track, 4);
      const kinds: ItemKind[] = ['bone', 'tennis-ball', 'mud', 'kibble-turbo'];
      race.racers.forEach((racer, i) => (racer.item = kinds[i]));
      const personalityRng = createRng(seed);
      const controllers = race.racers.map(
        (racer, i) => new AiController(racer.id, createAiPersonality(personalityRng, i), createRng(seed * 31 + i)),
      );
      const log: DriverInput[][] = [];
      simulate(track, race, controllers, 20, (inputs) => {
        log.push(inputs.map((input) => ({ ...input })));
      });
      return JSON.stringify(log);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
});

// Garde-fou : le circuit de test respecte les conventions du contrat.
describe('circuit de test en segments', () => {
  it.each([1, -1] as const)('ferme la boucle et suit la convention de courbure (sens %d)', (turn) => {
    const track = createSegmentTrack(stadium(100, 20, turn));
    const end = track.sampleAt(track.length - 0.001);
    expect(Math.hypot(end.position.x, end.position.z)).toBeLessThan(0.01);
    const bend = wrapAngle(headingOf(track.sampleAt(130).tangent) - headingOf(track.sampleAt(110).tangent));
    expect(Math.sign(bend)).toBe(turn);
    const sample = track.sampleAt(42);
    const projection = track.project(addScaled(sample.position, sample.left, 3));
    expect(projection.s).toBeCloseTo(42, 3);
    expect(projection.lateral).toBeCloseTo(3, 3);
    const inBend = track.sampleAt(140);
    const projected = track.project(addScaled(inBend.position, scale(inBend.left, -1), 4), 120);
    expect(projected.lateral).toBeCloseTo(-4, 2);
  });
});
