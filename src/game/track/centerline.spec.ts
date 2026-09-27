import { describe, expect, it } from 'vitest';
import { distance, headingOf, wrapAngle } from '../core/vec2';
import { buildCenterline, type TrackCorner } from './centerline';
import { CircuitError } from './circuit-error';

/** Rectangle 200 × 100 parcouru vers la gauche, coins de rayon 20, départ au milieu du bas. */
const RECTANGLE: TrackCorner[] = [
  { x: -100, z: -50, radius: 20 },
  { x: -100, z: 50, radius: 20 },
  { x: 100, z: 50, radius: 20 },
  { x: 100, z: -50, radius: 20 },
];
const START = { x: 0, z: -50 };

describe('buildCenterline', () => {
  it('raccorde droites et arcs : longueur exacte et point 0 au départ', () => {
    const line = buildCenterline(START, RECTANGLE);
    // Périmètre du rectangle moins 4 × (2r − πr/2).
    const expected = 600 - 4 * (40 - 10 * Math.PI);
    expect(line.length).toBeCloseTo(expected, 1);
    expect(distance(line.points[0], START)).toBeLessThan(1e-9);
    expect(line.cumulative.length).toBe(line.points.length + 1);
    expect(line.cumulative.at(-1)).toBeCloseTo(line.length, 9);
  });

  it('garde un pas de 0,25 m au plus et reste sur les arcs (rayon exact)', () => {
    const line = buildCenterline(START, RECTANGLE);
    for (let i = 1; i < line.points.length; i++) {
      expect(distance(line.points[i - 1], line.points[i])).toBeLessThanOrEqual(0.2500001);
    }
    const arc = line.arcs[0]!;
    // Centre de l'arc du coin 1 : (−80, −30).
    for (let i = 0; i < line.points.length; i++) {
      const s = line.cumulative[i];
      if (s > arc.start + 0.5 && s < arc.end - 0.5)
        expect(distance(line.points[i], { x: -80, z: -30 })).toBeCloseTo(20, 3);
    }
  });

  it("donne le sens de chaque virage et l'abscisse du sommet de chaque arc", () => {
    const line = buildCenterline(START, RECTANGLE);
    expect(line.arcs.map((arc) => arc?.turn)).toEqual([1, 1, 1, 1]);
    const first = line.arcs[0]!;
    expect(first.end - first.start).toBeCloseTo(10 * Math.PI, 1);
    expect(line.cornerS[0]).toBeCloseTo((first.start + first.end) / 2, 0);
    // 80 m de droite du départ à l'entrée du premier arc.
    expect(first.start).toBeCloseTo(80, 1);
  });

  it('tourne de +360° en virages à gauche et de −360° en virages à droite', () => {
    const turning = (corners: TrackCorner[]) => {
      const { points } = buildCenterline(START, corners);
      let total = 0;
      for (let i = 1; i < points.length - 1; i++) {
        const a = { x: points[i].x - points[i - 1].x, z: points[i].z - points[i - 1].z };
        const b = { x: points[i + 1].x - points[i].x, z: points[i + 1].z - points[i].z };
        total += wrapAngle(headingOf(b) - headingOf(a));
      }
      return total;
    };
    expect(turning(RECTANGLE)).toBeCloseTo(2 * Math.PI, 1);
    expect(turning([...RECTANGLE].reverse())).toBeCloseTo(-2 * Math.PI, 1);
  });

  it("accepte un repère d'altitude aligné et donne son abscisse", () => {
    const corners = [RECTANGLE[0], { x: -100, z: 0 }, ...RECTANGLE.slice(1)];
    const line = buildCenterline(START, corners);
    expect(line.arcs[1]).toBeNull();
    // Du départ : 80 m de droite, l'arc (10π), puis 30 m de droite jusqu'à z = 0.
    expect(line.cornerS[1]).toBeCloseTo(80 + 10 * Math.PI + 30, 0);
  });

  it('accepte deux arcs qui se touchent (demi-cercle en deux coins)', () => {
    // Stade : chaque bout est un demi-cercle de rayon 30 fait de deux coins de 90°.
    const stadium: TrackCorner[] = [
      { x: 130, z: -30, radius: 30 },
      { x: 130, z: 30, radius: 30 },
      { x: -130, z: 30, radius: 30 },
      { x: -130, z: -30, radius: 30 },
    ];
    const line = buildCenterline({ x: 0, z: -30 }, stadium);
    expect(line.length).toBeCloseTo(2 * 200 + 2 * Math.PI * 30, 1);
  });

  it('refuse un rayon qui ne tient pas entre ses voisins, en nommant les coins', () => {
    const tooBig = RECTANGLE.map((corner) => ({ ...corner, radius: 60 }));
    expect(() => buildCenterline(START, tooBig)).toThrow(CircuitError);
    try {
      buildCenterline(START, tooBig);
    } catch (error) {
      expect((error as CircuitError).issues.join(' ')).toMatch(/Coins 1 et 2 .*120.* 100/);
    }
  });

  it("refuse un repère sans rayon qui n'est pas aligné", () => {
    const corners = [RECTANGLE[0], { x: -90, z: 0 }, ...RECTANGLE.slice(1)];
    expect(() => buildCenterline(START, corners)).toThrow(/Coin 2 .*rayon/);
  });

  it('refuse un coin de plus de 150° (il faut deux coins)', () => {
    const hairpin: TrackCorner[] = [
      { x: -100, z: -50, radius: 20 },
      { x: 100, z: -40, radius: 20 },
      { x: 100, z: 50, radius: 20 },
    ];
    expect(() => buildCenterline({ x: 0, z: -45 }, hairpin)).toThrow(/150°/);
  });

  it("refuse un départ qui n'est pas sur la droite du dernier au premier coin", () => {
    expect(() => buildCenterline({ x: 0, z: -40 }, RECTANGLE)).toThrow(/départ/);
    expect(() => buildCenterline({ x: -95, z: -50 }, RECTANGLE)).toThrow(/départ/);
  });

  it('refuse moins de 3 coins et des coins confondus', () => {
    expect(() => buildCenterline(START, RECTANGLE.slice(0, 2))).toThrow(/3 coins/);
    const same = [RECTANGLE[0], RECTANGLE[0], RECTANGLE[2], RECTANGLE[3]];
    expect(() => buildCenterline(START, same)).toThrow(/confondus/);
  });
});
