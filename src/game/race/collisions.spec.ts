import { describe, expect, it } from 'vitest';
import { KART_RADIUS } from '../core/constants';
import type { GameEvent, RacerState } from '../core/types';
import { distance, dot, forwardOf, leftOf, sub } from '../core/vec2';
import { createTestRacer } from '../testing/fixtures';
import { resolveKartCollisions } from './collisions';

function collide(racers: readonly RacerState[]): GameEvent[] {
  const events: GameEvent[] = [];
  resolveKartCollisions(racers, (event) => events.push(event));
  return events;
}

/** Quantité de mouvement totale (vecteur). */
function momentum(racers: readonly RacerState[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const racer of racers) {
    const forward = forwardOf(racer.kart.heading);
    x += racer.tuning.mass * racer.kart.speed * forward.x;
    z += racer.tuning.mass * racer.kart.speed * forward.z;
  }
  return { x, z };
}

describe('resolveKartCollisions', () => {
  it('ne touche pas à des karts séparés de plus de 2 rayons', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 2 * KART_RADIUS + 0.01, z: 0 }, 0);
    a.kart.speed = 20;
    expect(collide([a, b])).toEqual([]);
    expect(a.kart.position).toEqual({ x: 0, z: 0 });
    expect(a.kart.speed).toBe(20);
  });

  it('sépare deux karts qui se chevauchent le long de la normale, à exactement 2 rayons', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 1.2, z: 0.4 }, 0);
    const normal = sub(b.kart.position, a.kart.position);
    collide([a, b]);
    expect(distance(a.kart.position, b.kart.position)).toBeCloseTo(2 * KART_RADIUS, 9);
    // Masses égales : chacun recule de la moitié du chevauchement, le long de la normale.
    const movedA = sub(a.kart.position, { x: 0, z: 0 });
    const movedB = sub(b.kart.position, { x: 1.2, z: 0.4 });
    expect(movedA.x).toBeCloseTo(-movedB.x, 9);
    expect(movedA.z).toBeCloseTo(-movedB.z, 9);
    expect(movedA.x * normal.z - movedA.z * normal.x).toBeCloseTo(0, 9);
    expect(dot(movedB, normal)).toBeGreaterThan(0);
  });

  it('le kart lourd est moins déplacé et moins ralenti que le léger', () => {
    // Deux karts côte à côte, qui se rapprochent latéralement l'un de l'autre.
    const light = createTestRacer(0, { x: 0, z: 0 }, Math.PI / 2);
    const heavy = createTestRacer(1, { x: 1.5, z: 0 }, -Math.PI / 2);
    light.tuning.mass = 0.9;
    heavy.tuning.mass = 1.3;
    light.kart.speed = 10;
    heavy.kart.speed = 10;
    const before = momentum([light, heavy]);
    collide([light, heavy]);
    const movedLight = Math.abs(light.kart.position.x);
    const movedHeavy = Math.abs(heavy.kart.position.x - 1.5);
    expect(movedLight + movedHeavy).toBeCloseTo(0.5, 9);
    expect(movedHeavy).toBeLessThan(movedLight);
    expect(movedLight / movedHeavy).toBeCloseTo(1.3 / 0.9, 9);
    // Choc frontal : le léger repart plus vite en arrière que le lourd.
    expect(light.kart.speed).toBeLessThan(heavy.kart.speed);
    // Quantité de mouvement conservée (vitesses colinéaires à la normale).
    const after = momentum([light, heavy]);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
  });

  it('choc arrière : le kart qui percute ralentit, celui de devant accélère (restitution 0,3)', () => {
    const front = createTestRacer(0, { x: 0, z: 1.8 }, 0);
    const back = createTestRacer(1, { x: 0, z: 0 }, 0);
    front.kart.speed = 15;
    back.kart.speed = 25;
    const before = momentum([front, back]);
    const events = collide([front, back]);
    expect(back.kart.speed).toBeLessThan(25);
    expect(front.kart.speed).toBeGreaterThan(15);
    // Vitesse relative après le choc = -0,3 × vitesse relative avant.
    expect(front.kart.speed - back.kart.speed).toBeCloseTo(0.3 * 10, 9);
    const after = momentum([front, back]);
    expect(after.z).toBeCloseTo(before.z, 9);
    // Le cap ne change pas.
    expect(front.kart.heading).toBe(0);
    expect(back.kart.heading).toBe(0);
    expect(events).toEqual([{ type: 'bump', racerId: 0, otherId: 1, intensity: 10 / 15 }]);
  });

  it('un contact latéral pur ne change pas la vitesse le long du cap', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 1.5, z: 0 }, 0);
    a.kart.speed = 20;
    b.kart.speed = 20;
    expect(collide([a, b])).toEqual([]);
    expect(a.kart.speed).toBeCloseTo(20, 9);
    expect(b.kart.speed).toBeCloseTo(20, 9);
    expect(distance(a.kart.position, b.kart.position)).toBeCloseTo(2 * KART_RADIUS, 9);
  });

  it('un rapprochement lent (≤ 2 m/s) sépare sans signaler de choc', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 0, z: 1.9 }, 0);
    a.kart.speed = 21.5;
    b.kart.speed = 20;
    expect(collide([a, b])).toEqual([]);
    expect(a.kart.speed).toBeLessThan(21.5);
  });

  it('karts qui s’éloignent déjà : séparés, vitesses inchangées', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 0, z: 1.5 }, 0);
    a.kart.speed = 10;
    b.kart.speed = 20;
    expect(collide([a, b])).toEqual([]);
    expect(a.kart.speed).toBe(10);
    expect(b.kart.speed).toBe(20);
  });

  it('intensité bornée à 1 et un seul « bump » par paire et par pas', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 0, z: 1 }, Math.PI);
    a.kart.speed = 30;
    b.kart.speed = 30;
    const events = collide([a, b]);
    expect(events).toEqual([{ type: 'bump', racerId: 0, otherId: 1, intensity: 1 }]);
  });

  it('un kart en tête-à-queue est traité comme les autres', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 0, z: 1.5 }, 0);
    a.kart.speed = 20;
    b.kart.spinTime = 0.8;
    b.kart.speed = 3;
    const events = collide([a, b]);
    expect(events).toHaveLength(1);
    expect(b.kart.speed).toBeGreaterThan(3);
    expect(distance(a.kart.position, b.kart.position)).toBeCloseTo(2 * KART_RADIUS, 9);
  });

  it('trois karts : chaque paire en contact est traitée une fois', () => {
    const a = createTestRacer(0, { x: 0, z: 0 }, 0);
    const b = createTestRacer(1, { x: 0, z: 1.6 }, 0);
    const c = createTestRacer(2, { x: 0, z: 3.2 }, 0);
    a.kart.speed = 28;
    b.kart.speed = 18;
    c.kart.speed = 8;
    const events = collide([a, b, c]);
    const pairs = events.map((event) =>
      event.type === 'bump' ? `${event.racerId}-${event.otherId}` : event.type,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toContain('0-1');
    expect(pairs).toContain('1-2');
  });

  it('centres confondus : séparation déterministe, sans NaN', () => {
    const a = createTestRacer(0, { x: 5, z: 5 }, 0.3);
    const b = createTestRacer(1, { x: 5, z: 5 }, 0.3);
    a.kart.speed = 10;
    b.kart.speed = 10;
    collide([a, b]);
    expect(distance(a.kart.position, b.kart.position)).toBeCloseTo(2 * KART_RADIUS, 9);
    // Normale de repli : gauche du pilote a = (cos θ, -sin θ) ; b part à gauche, a à droite.
    const separation = sub(b.kart.position, a.kart.position);
    expect(dot(separation, leftOf(0.3))).toBeCloseTo(2 * KART_RADIUS, 9);
    expect(a.kart.position.x - 5).toBeCloseTo(-Math.cos(0.3), 9);
    expect(a.kart.position.z - 5).toBeCloseTo(Math.sin(0.3), 9);
    for (const racer of [a, b]) {
      expect(Number.isFinite(racer.kart.position.x)).toBe(true);
      expect(Number.isFinite(racer.kart.speed)).toBe(true);
    }
  });
});
