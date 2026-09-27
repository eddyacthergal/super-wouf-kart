import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriftTier, GameEvent, RaceState } from '../core/types';
import { forwardOf } from '../core/vec2';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { Effects } from './effects';
import { DRIFT_TIER_COLORS } from './palette';
import type { ParticlePool } from './particles';
import { RacerVisuals } from './racer-visuals';
import { DisposalBag } from './resources';
import { SKID_MARK_LIFE } from './skid-marks';
import type { Terrain } from './terrain';

const DT = 1 / 60;
const track = createCircleTrack(60);
const cleanups: (() => void)[] = [];
/** Sol surélevé constant, pour vérifier que fumée et poussière restent au-dessus du relief. */
const HILL_GROUND = 5;
const HILLY_TERRAIN: Terrain = {
  hilly: true,
  heightAt: () => HILL_GROUND,
  groundAt: () => HILL_GROUND,
};

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup(): { effects: Effects; racers: RacerVisuals; race: RaceState } {
  const race = createTestRace(track, 3);
  const bag = new DisposalBag();
  const racers = new RacerVisuals(race.racers, bag);
  const effects = new Effects(racers, bag, track);
  cleanups.push(() => {
    effects.dispose();
    racers.dispose();
    bag.dispose();
  });
  return { effects, racers, race };
}

/** Comme `setup()`, mais avec un sol surélevé constant (`HILL_GROUND`). */
function setupOnHill(): { effects: Effects; racers: RacerVisuals; race: RaceState } {
  const race = createTestRace(track, 3);
  const bag = new DisposalBag();
  const racers = new RacerVisuals(race.racers, bag);
  const effects = new Effects(racers, bag, track, HILLY_TERRAIN);
  cleanups.push(() => {
    effects.dispose();
    racers.dispose();
    bag.dispose();
  });
  return { effects, racers, race };
}

function step(
  setupResult: { effects: Effects; racers: RacerVisuals; race: RaceState },
  frames: number,
  events: readonly GameEvent[] = [],
): void {
  const { effects, racers, race } = setupResult;
  for (let i = 0; i < frames; i++) {
    racers.update(race, 1, DT);
    effects.handleEvents(i === 0 ? events : [], racers, race);
    effects.update(race, racers, DT, i * DT);
  }
}

/** Particules vivantes d'une réserve : position et teinte. */
function liveParticles(pool: ParticlePool): { position: THREE.Vector3; tint: THREE.Color }[] {
  const geometry = pool.points.geometry;
  const alpha = geometry.getAttribute('alpha');
  const position = geometry.getAttribute('position');
  const tint = geometry.getAttribute('tint');
  const result: { position: THREE.Vector3; tint: THREE.Color }[] = [];
  for (let i = 0; i < alpha.count; i++) {
    if (alpha.getX(i) <= 0) continue;
    result.push({
      position: new THREE.Vector3().fromBufferAttribute(position, i),
      tint: new THREE.Color(tint.getX(i), tint.getY(i), tint.getZ(i)),
    });
  }
  return result;
}

describe('Effects', () => {
  it('colore étincelles et halo de dérapage selon le palier, avec de la fumée, derrière les roues arrière', () => {
    for (const tier of [0, 1, 2, 3] as DriftTier[]) {
      const context = setup();
      const kart = context.race.racers[1].kart;
      kart.speed = 22;
      kart.drift = { active: true, direction: 1, charge: tier, tier };
      step(context, 12);
      const expected = new THREE.Color(DRIFT_TIER_COLORS[tier]);
      const ofTier = ({ tint }: { tint: THREE.Color }): boolean =>
        Math.abs(tint.r - expected.r) < 1e-5 &&
        Math.abs(tint.g - expected.g) < 1e-5 &&
        Math.abs(tint.b - expected.b) < 1e-5;
      const glow = liveParticles(context.effects.glow);
      const soft = liveParticles(context.effects.soft);
      const cores = soft.filter(ofTier);
      expect(glow.length, `palier ${tier}`).toBeGreaterThan(2);
      expect(glow.every(ofTier), `palier ${tier}`).toBe(true);
      // Chaque halo additif a son cœur opaque (mélange normal), pour que la couleur reste lisible sur
      // le gravier clair, dès le palier 0 : le dérapage se voit dès qu'il commence.
      expect(cores.length, `palier ${tier}`).toBe(glow.length);
      // Le reste de la réserve opaque : la fumée des pneus.
      expect(soft.length, `palier ${tier}`).toBeGreaterThan(cores.length);
      const forward = forwardOf(kart.heading);
      for (const { position } of [...glow, ...soft]) {
        const dx = position.x - kart.position.x;
        const dz = position.z - kart.position.z;
        expect(Math.hypot(dx, dz)).toBeLessThan(4);
        expect(dx * forward.x + dz * forward.z).toBeLessThan(0);
      }
    }
  });

  it('laisse des traces de pneus pendant le dérapage, pas pendant le saut, puis elles s’effacent', () => {
    const { effects, racers, race } = setup();
    const kart = race.racers[1].kart;
    kart.speed = 22;
    kart.drift = { active: true, direction: 1, charge: 0.5, tier: 0 };
    const forward = forwardOf(kart.heading);
    let time = 0;
    const drive = (frames: number): void => {
      for (let i = 0; i < frames; i++) {
        kart.prevPosition = { ...kart.position };
        kart.position = {
          x: kart.position.x + forward.x * kart.speed * DT,
          z: kart.position.z + forward.z * kart.speed * DT,
        };
        racers.update(race, 1, DT);
        effects.update(race, racers, DT, time);
        time += DT;
      }
    };

    // En l'air, les roues ne touchent pas le sol.
    kart.hopTime = 1;
    drive(20);
    expect(effects.skids.activeCount).toBe(0);

    // Au sol : un tronçon par roue arrière et par image.
    kart.hopTime = 0;
    drive(30);
    expect(effects.skids.activeCount).toBeGreaterThan(40);
    // Traces sous le kart ou derrière lui, jamais devant.
    const position = effects.skids.mesh.geometry.getAttribute('position');
    let drawn = 0;
    for (let i = 0; i < position.count; i++) {
      // Emplacement libre : sommet à l'origine (y = 0), les traces sont posées au-dessus de la route.
      if (position.getY(i) === 0) continue;
      drawn++;
      const dx = position.getX(i) - kart.position.x;
      const dz = position.getZ(i) - kart.position.z;
      expect(dx * forward.x + dz * forward.z).toBeLessThan(0.5);
    }
    expect(drawn).toBe(effects.skids.activeCount * 6);

    // Fin du dérapage : plus de nouvelle trace, les anciennes s'effacent.
    kart.drift = { active: false, direction: 0, charge: 0, tier: 0 };
    drive(Math.ceil(SKID_MARK_LIFE / DT) + 1);
    expect(effects.skids.activeCount).toBe(0);
  });

  it('soulève de la poussière sur le bas-côté seulement', () => {
    const onRoad = setup();
    onRoad.race.racers[1].kart.speed = 20;
    step(onRoad, 20);
    expect(onRoad.effects.soft.activeCount).toBe(0);

    const offroad = setup();
    offroad.race.racers[1].kart.speed = 20;
    offroad.race.racers[1].kart.offroad = true;
    step(offroad, 20);
    expect(offroad.effects.soft.activeCount).toBeGreaterThan(5);
  });

  it('bouffée à l’usage d’un objet, éclat à l’impact, gerbe de la couleur du mini-turbo', () => {
    const puff = setup();
    step(puff, 1, [{ type: 'item-use', racerId: 1, item: 'bone' }]);
    expect(puff.effects.soft.activeCount).toBeGreaterThan(5);
    expect(puff.effects.glow.activeCount).toBe(0);

    const hit = setup();
    step(hit, 1, [{ type: 'hit', racerId: 2, by: 'bone', ownerId: 1 }]);
    expect(hit.effects.glow.activeCount).toBeGreaterThan(10);
    expect(hit.effects.soft.activeCount).toBeGreaterThan(5);

    const boost = setup();
    step(boost, 1, [{ type: 'boost', racerId: 1, source: 'drift', tier: 2 }]);
    const orange = new THREE.Color(DRIFT_TIER_COLORS[2]);
    const burst = liveParticles(boost.effects.glow);
    expect(burst.length).toBeGreaterThan(0);
    // Les pots d'échappement sont juste derrière le kart.
    const kart = boost.race.racers[1].kart.position;
    for (const { position, tint } of burst) {
      expect(tint.r).toBeCloseTo(orange.r, 5);
      expect(tint.g).toBeCloseTo(orange.g, 5);
      expect(tint.b).toBeCloseTo(orange.b, 5);
      expect(Math.hypot(position.x - kart.x, position.z - kart.z)).toBeLessThan(3);
    }
  });

  it('projette les feuilles du côté de la haie touchée, même à contre-sens', () => {
    for (const lateral of [9.5, -9.5]) {
      const context = setup();
      const racer = context.race.racers[1];
      const projection = track.project(racer.kart.position);
      const sample = projection.sample;
      // Kart contre la haie, tourné à contre-sens.
      racer.kart.position = {
        x: sample.position.x + sample.left.x * lateral,
        z: sample.position.z + sample.left.z * lateral,
      };
      racer.kart.prevPosition = { ...racer.kart.position };
      racer.kart.heading += Math.PI;
      racer.kart.prevHeading = racer.kart.heading;
      racer.kart.lateral = lateral;
      racer.kart.trackIndex = projection.index;
      step(context, 1, [{ type: 'wall', racerId: 1, intensity: 1 }]);
      const leaves = liveParticles(context.effects.soft);
      expect(leaves.length).toBeGreaterThan(3);
      const mean = leaves.reduce(
        (sum, { position }) => ({ x: sum.x + position.x, z: sum.z + position.z }),
        { x: 0, z: 0 },
      );
      const offset =
        (mean.x / leaves.length - racer.kart.position.x) * sample.left.x +
        (mean.z / leaves.length - racer.kart.position.z) * sample.left.z;
      expect(Math.sign(offset)).toBe(Math.sign(lateral));
    }
  });

  it('règle le plancher de la fumée et de la poussière sur le relief (sol + 0,03), pas la valeur absolue', () => {
    const context = setupOnHill();
    const kart = context.race.racers[1].kart;
    kart.speed = 22;
    kart.drift = { active: true, direction: 1, charge: 0.5, tier: 0 };
    kart.offroad = true;
    const spy = vi.spyOn(context.effects.soft, 'emit');
    step(context, 10);

    const sameColor = (a: THREE.Color, hex: string): boolean => {
      const b = new THREE.Color(hex);
      return Math.abs(a.r - b.r) < 1e-3 && Math.abs(a.g - b.g) < 1e-3 && Math.abs(a.b - b.b) < 1e-3;
    };
    const callsFor = (hex: string): Parameters<typeof context.effects.soft.emit>[] =>
      spy.mock.calls.filter((call) => sameColor(call[6] as THREE.Color, hex));
    const smokeCalls = callsFor('#ece8e0');
    const dustCalls = callsFor('#b98f5f');
    expect(smokeCalls.length).toBeGreaterThan(0);
    expect(dustCalls.length).toBeGreaterThan(0);
    // Hauteur d'émission et plancher tous deux relatifs au sol surélevé (jamais 0,03 en absolu).
    for (const call of [...smokeCalls, ...dustCalls]) {
      const [, y, , , , , , , , options] = call;
      expect(y).toBeGreaterThan(HILL_GROUND);
      expect(options?.floor).toBeCloseTo(HILL_GROUND + 0.03, 6);
    }

    // Et, sans mock, aucune particule vivante ne descend sous le sol + 0,03.
    spy.mockRestore();
    const soft = liveParticles(context.effects.soft);
    const smoke = soft.filter(({ tint }) => sameColor(tint, '#ece8e0'));
    const dust = soft.filter(({ tint }) => sameColor(tint, '#b98f5f'));
    for (const { position } of [...smoke, ...dust]) {
      expect(position.y).toBeGreaterThanOrEqual(HILL_GROUND + 0.03 - 1e-6);
    }
  });
});
