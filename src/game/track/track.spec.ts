import { describe, expect, it } from 'vitest';
import { KART_RADIUS, RACER_COUNT, ROAD_HALF_WIDTH, WALL_HALF_WIDTH } from '../core/constants';
import { createRng } from '../core/rng';
import type { TrackQuery } from '../core/types';
import {
  addScaled,
  distance,
  dot,
  forwardOf,
  headingOf,
  leftOf,
  length,
  scale,
  wrapAngle,
  type Vec2,
} from '../core/vec2';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { GARDEN_CONTROL_POINTS } from './circuits/grand-jardin';
import { Track, createGardenTrack, trackOutline } from './track';

const DEG = Math.PI / 180;

/** Écart d'abscisse sur un circuit bouclé. */
function circularGap(a: number, b: number, lap: number): number {
  const d = Math.abs(a - b) % lap;
  return Math.min(d, lap - d);
}

/** Cap déroulé (sans saut de 2π) sur deux tours : theta[i] correspond à l'échantillon i % n. */
function unwrappedHeadings(track: TrackQuery): number[] {
  const { samples } = track;
  const n = samples.length;
  const theta = [headingOf(samples[0].tangent)];
  for (let i = 1; i <= 2 * n; i++) {
    theta.push(
      theta[i - 1] +
        wrapAngle(headingOf(samples[i % n].tangent) - headingOf(samples[(i - 1) % n].tangent)),
    );
  }
  return theta;
}

interface Turn {
  /** Abscisse de début (m). */
  start: number;
  /** Longueur d'arc (m). */
  arc: number;
  /** Variation de cap signée (rad), > 0 = gauche. */
  angle: number;
}

/** Portions consécutives de même sens où minCurvature ≤ |courbure| ≤ maxCurvature. */
function findTurns(track: TrackQuery, minCurvature: number, maxCurvature = Infinity): Turn[] {
  const { samples } = track;
  const n = samples.length;
  const step = track.length / n;
  const inTurn = (k: number): boolean => Math.abs(k) >= minCurvature && Math.abs(k) <= maxCurvature;
  // On part d'un échantillon hors virage pour ne pas couper un virage en deux.
  const origin = Math.max(
    0,
    samples.findIndex((sample) => !inTurn(sample.curvature)),
  );
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (let k = 0; k < n; k++) {
    const sample = samples[(origin + k) % n];
    if (!inTurn(sample.curvature)) {
      current = null;
    } else if (current && Math.sign(current.angle) === Math.sign(sample.curvature)) {
      current.arc += step;
      current.angle += sample.curvature * step;
    } else {
      current = { start: sample.s, arc: step, angle: sample.curvature * step };
      turns.push(current);
    }
  }
  return turns;
}

/** Points sur un cercle de rayon r, parcourus vers la gauche (cap croissant) ou vers la droite. */
function circlePoints(radius: number, count: number, direction: 'left' | 'right'): Vec2[] {
  const sign = direction === 'left' ? -1 : 1;
  return Array.from({ length: count }, (_, k) => {
    const phi = (2 * Math.PI * k) / count;
    return { x: radius * Math.cos(phi), z: sign * radius * Math.sin(phi) };
  });
}

describe('Track (spline générique)', () => {
  it.each(['left', 'right'] as const)(
    'suit un cercle parcouru vers la %s avec la bonne courbure',
    (direction) => {
      const radius = 50;
      const track = new Track(circlePoints(radius, 24, direction));
      expect(track.length).toBeCloseTo(2 * Math.PI * radius, 0);
      const expected = (direction === 'left' ? 1 : -1) / radius;
      for (const sample of track.samples) {
        expect(Math.abs(distance(sample.position, { x: 0, z: 0 }) - radius)).toBeLessThan(0.05);
        expect(sample.curvature).toBeCloseTo(expected, 3);
      }
    },
  );

  it.each(['left', 'right'] as const)(
    'relie signe de courbure, variation de cap et côté du centre (virage vers la %s)',
    (direction) => {
      const sign = direction === 'left' ? 1 : -1;
      const track = new Track(circlePoints(40, 16, direction));
      // Tourner à gauche augmente le cap, tourner à droite le diminue (spec §3).
      const turn = wrapAngle(
        headingOf(track.sampleAt(30).tangent) - headingOf(track.sampleAt(20).tangent),
      );
      expect(Math.sign(turn)).toBe(sign);
      expect(Math.sign(track.sampleAt(25).curvature)).toBe(sign);
      // Le centre du virage est du côté du virage : à gauche (lateral > 0) pour un virage à gauche.
      const sample = track.sampleAt(25);
      expect(Math.sign(dot(sample.left, scale(sample.position, -1)))).toBe(sign);
      // Point à 10 m du bord, côté centre (la spline suit le cercle à quelques centimètres près).
      const lateral = track.project(scale(sample.position, 0.75)).lateral;
      expect(Math.abs(lateral - sign * 10)).toBeLessThan(0.1);
    },
  );

  it('place les rangées de boîtes pile aux fractions visées quand tout le tour est peu courbé', () => {
    const track = new Track(circlePoints(100, 32, 'left'));
    expect(track.itemBoxRows).toHaveLength(3);
    [0.18, 0.5, 0.8].forEach((fraction, k) =>
      expect(track.itemBoxRows[k]).toBeCloseTo(fraction * track.length, 9),
    );
  });

  it('se replie sur la portion la moins courbe quand aucune n’est quasi droite', () => {
    const track = new Track(circlePoints(40, 24, 'right'));
    const rows = track.itemBoxRows;
    expect(rows).toHaveLength(3);
    [0.18, 0.5, 0.8].forEach((fraction, k) => {
      expect(Number.isFinite(rows[k])).toBe(true);
      expect(Math.abs(rows[k] - fraction * track.length)).toBeLessThanOrEqual(40);
      if (k > 0) expect(rows[k]).toBeGreaterThan(rows[k - 1]);
    });
  });

  it('refuse un tracé dégénéré (points confondus ou non finis)', () => {
    expect(() => new Track(Array.from({ length: 5 }, () => ({ x: 3, z: 3 })))).toThrow(/dégénéré/);
    const withNaN = circlePoints(50, 12, 'left').map((p, k) =>
      k === 3 ? { x: Number.NaN, z: p.z } : p,
    );
    expect(() => new Track(withNaN)).toThrow(/dégénéré/);
  });

  it('refuse moins de 4 points de contrôle', () => {
    expect(
      () =>
        new Track([
          { x: 0, z: 0 },
          { x: 10, z: 0 },
          { x: 0, z: 10 },
        ]),
    ).toThrow(/4 points/);
  });
});

describe('circuit jardin', () => {
  const track = createGardenTrack();
  const { samples } = track;
  const n = samples.length;
  const L = track.length;
  const step = L / n;

  describe('échantillonnage', () => {
    it('mesure entre 750 et 950 m, avec un échantillon par mètre environ, à pas constant', () => {
      expect(L).toBeGreaterThanOrEqual(750);
      expect(L).toBeLessThanOrEqual(950);
      expect(n).toBe(Math.round(L));
      samples.forEach((sample, i) => {
        expect(sample.s).toBeCloseTo(i * step, 9);
        expect(distance(sample.position, samples[(i + 1) % n].position)).toBeCloseTo(step, 2);
      });
    });

    it('commence au point de contrôle 0 (ligne de départ)', () => {
      expect(distance(samples[0].position, GARDEN_CONTROL_POINTS[0])).toBeLessThan(1e-6);
      expect(samples[0].s).toBe(0);
    });

    it('fournit tangente unitaire dans le sens de la course, gauche et demi-largeur', () => {
      expect(track.wallHalfWidth).toBe(WALL_HALF_WIDTH);
      samples.forEach((sample, i) => {
        const next = samples[(i + 1) % n].position;
        const prev = samples[(i - 1 + n) % n].position;
        const chord = { x: (next.x - prev.x) / (2 * step), z: (next.z - prev.z) / (2 * step) };
        expect(length(sample.tangent)).toBeCloseTo(1, 9);
        expect(sample.tangent.x * chord.x + sample.tangent.z * chord.z).toBeGreaterThan(0.999);
        expect(sample.left.x).toBeCloseTo(sample.tangent.z, 12);
        expect(sample.left.z).toBeCloseTo(-sample.tangent.x, 12);
        expect(sample.halfWidth).toBe(ROAD_HALF_WIDTH);
      });
    });
  });

  describe('contraintes du tracé', () => {
    const theta = unwrappedHeadings(track);
    const turns = findTurns(track, 1 / 500);

    it('fait exactement un tour, globalement vers la gauche', () => {
      expect(theta[n] - theta[0]).toBeCloseTo(2 * Math.PI, 6);
      const integral = samples.reduce((sum, sample) => sum + sample.curvature * step, 0);
      expect(integral).toBeCloseTo(2 * Math.PI, 3);
    });

    it('la courbure a le signe de la variation de cap et la bonne amplitude', () => {
      for (let i = 2; i < n + 2; i++) {
        const curvature = samples[i % n].curvature;
        if (Math.abs(curvature) < 1 / 100) continue;
        expect(Math.sign(theta[i + 2] - theta[i - 2])).toBe(Math.sign(curvature));
      }
      // Sur un virage entier, l'intégrale de la courbure suit la variation de cap
      // (à 10 % près : le lissage déborde un peu au point d'inflexion d'une chicane).
      for (const turn of turns.filter((t) => Math.abs(t.angle) > 45 * DEG)) {
        const i = Math.round(turn.start / step);
        const delta = theta[i + Math.round(turn.arc / step)] - theta[i];
        expect(Math.abs(turn.angle - delta)).toBeLessThan(0.1 * Math.abs(delta));
      }
    });

    it('a un rayon de virage d’au moins 16 m partout', () => {
      for (const sample of samples) expect(Math.abs(sample.curvature)).toBeLessThanOrEqual(1 / 16);
    });

    it('a une ligne droite de départ de L − 60 à 40 m', () => {
      const heading = headingOf(samples[0].tangent);
      for (let s = -60; s <= 40; s += 0.5) {
        const sample = track.sampleAt(s);
        expect(Math.abs(sample.curvature)).toBeLessThan(1 / 200);
        expect(Math.abs(wrapAngle(headingOf(sample.tangent) - heading))).toBeLessThan(0.01);
      }
    });

    it('ne fait jamais se chevaucher deux couloirs éloignés de plus de 60 m', () => {
      const minDistance = 2 * WALL_HALF_WIDTH + 6;
      let closest = Infinity;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (circularGap(samples[i].s, samples[j].s, L) <= 60) continue;
          closest = Math.min(closest, distance(samples[i].position, samples[j].position));
        }
      }
      expect(closest).toBeGreaterThanOrEqual(minDistance);
    });

    it('contient une épingle (≥ 150° sur ≤ 90 m)', () => {
      const window = Math.floor(90 / step);
      let best = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j <= i + window; j++)
          best = Math.max(best, Math.abs(theta[j] - theta[i]));
      }
      expect(best).toBeGreaterThanOrEqual(150 * DEG);
    });

    it('contient une chicane en S (gauche et droite consécutifs, ≥ 30° chacun, sur ≤ 120 m)', () => {
      const big = findTurns(track, 1 / 500).filter((t) => Math.abs(t.angle) >= 30 * DEG);
      const found = big.some((first, k) => {
        const second = big[(k + 1) % big.length];
        const span = (((second.start + second.arc - first.start) % L) + L) % L;
        return Math.sign(first.angle) !== Math.sign(second.angle) && span <= 120;
      });
      expect(found).toBe(true);
    });

    it('contient une grande courbe (rayon 40–80 m, ≥ 90°)', () => {
      const sweepers = findTurns(track, 1 / 80, 1 / 40);
      expect(Math.max(...sweepers.map((t) => Math.abs(t.angle)))).toBeGreaterThanOrEqual(90 * DEG);
    });

    it('contient au moins deux virages de 45° ou plus dans chaque sens', () => {
      expect(turns.filter((t) => t.angle >= 45 * DEG).length).toBeGreaterThanOrEqual(2);
      expect(turns.filter((t) => t.angle <= -45 * DEG).length).toBeGreaterThanOrEqual(2);
    });

    it('tient, haies comprises, dans la boîte [-230, 230]', () => {
      for (const { position } of samples) {
        expect(Math.abs(position.x) + WALL_HALF_WIDTH).toBeLessThanOrEqual(230);
        expect(Math.abs(position.z) + WALL_HALF_WIDTH).toBeLessThanOrEqual(230);
      }
    });
  });

  describe('sampleAt', () => {
    it('boucle l’abscisse (négative ou au-delà d’un tour)', () => {
      const cases: [number, number][] = [
        [-10, L - 10],
        [L + 25, 25],
        [3 * L + 5.5, 5.5],
        [-2 * L - 0.25, L - 0.25],
      ];
      for (const [raw, expected] of cases) {
        const a = track.sampleAt(raw);
        const b = track.sampleAt(expected);
        expect(a.s).toBeCloseTo(expected, 6);
        expect(distance(a.position, b.position)).toBeLessThan(1e-6);
      }
      expect(track.sampleAt(L).s).toBeCloseTo(0, 9);
      expect(track.sampleAt(L).s).toBeLessThan(L);
    });

    it('ramène une abscisse non finie (NaN, ±∞) à la ligne de départ au lieu de planter', () => {
      for (const s of [Number.NaN, Infinity, -Infinity]) {
        const sample = track.sampleAt(s);
        expect(sample.s).toBe(0);
        expect(sample.position).toEqual(samples[0].position);
      }
      expect(() => track.project({ x: Number.NaN, z: 0 })).not.toThrow();
    });

    it('interpole linéairement entre deux échantillons voisins', () => {
      const i = 123;
      const mid = track.sampleAt((i + 0.5) * step);
      const a = samples[i];
      const b = samples[i + 1];
      expect(mid.position.x).toBeCloseTo((a.position.x + b.position.x) / 2, 9);
      expect(mid.position.z).toBeCloseTo((a.position.z + b.position.z) / 2, 9);
      expect(mid.curvature).toBeCloseTo((a.curvature + b.curvature) / 2, 12);
      expect(length(mid.tangent)).toBeCloseTo(1, 12);
      expect(mid.left.x).toBeCloseTo(mid.tangent.z, 12);
      expect(mid.left.z).toBeCloseTo(-mid.tangent.x, 12);
    });
  });

  describe('project', () => {
    it('retrouve s et le décalage latéral de points proches de la route, avec ou sans indice', () => {
      const rng = createRng(2026);
      for (let k = 0; k < 400; k++) {
        const s = rng.range(0, L);
        const lateral = rng.range(-WALL_HALF_WIDTH, WALL_HALF_WIDTH);
        const sample = track.sampleAt(s);
        const point = addScaled(sample.position, sample.left, lateral);

        const global = track.project(point);
        expect(circularGap(global.s, s, L)).toBeLessThan(0.05);
        expect(Math.abs(global.lateral - lateral)).toBeLessThan(0.05);
        expect(global.sample.s).toBe(global.s);
        expect(circularGap(global.index * step, s, L)).toBeLessThanOrEqual(step);

        const hint = (Math.round(s / step) + rng.int(-20, 20) + n) % n;
        const local = track.project(point, hint);
        expect(local.s).toBeCloseTo(global.s, 9);
        expect(local.lateral).toBeCloseTo(global.lateral, 9);
        expect(local.index).toBe(global.index);
      }
    });

    it('lateral > 0 à gauche du pilote, au sens de leftOf(cap) (spec §3)', () => {
      // Virages à gauche et à droite, ligne droite de départ.
      for (const s of [0, 90, 175, 300, 430, 545, 640]) {
        const sample = track.sampleAt(s);
        const heading = headingOf(sample.tangent);
        expect(distance(forwardOf(heading), sample.tangent)).toBeLessThan(1e-12);
        const driverLeft = leftOf(heading);
        expect(track.project(addScaled(sample.position, driverLeft, 4)).lateral).toBeCloseTo(4, 6);
        expect(track.project(addScaled(sample.position, driverLeft, -4)).lateral).toBeCloseTo(
          -4,
          6,
        );
      }
    });

    it('donne le résultat de la recherche globale même avec un indice périmé (minimum hors de la fenêtre)', () => {
      // Un indice décalé de plus de 40 échantillons place le vrai minimum hors de la fenêtre locale,
      // alors que le bord de la fenêtre peut rester à moins de 2 × wallHalfWidth du point.
      for (let i = 0; i < n; i++) {
        for (const lateral of [-9, 0, 9]) {
          const point = addScaled(samples[i].position, samples[i].left, lateral);
          const global = track.project(point);
          for (const offset of [41, 45, 50, 60, 75]) {
            for (const hint of [i + offset, i - offset]) {
              const local = track.project(point, hint);
              expect(circularGap(local.s, global.s, L)).toBeLessThan(1e-9);
              expect(local.lateral).toBeCloseTo(global.lateral, 9);
            }
          }
        }
      }
    });

    it('revient à une recherche globale si l’indice est trop loin ou hors bornes', () => {
      const sample = track.sampleAt(100);
      const point = addScaled(sample.position, sample.left, -2);
      const expected = track.project(point);
      for (const hint of [Math.round(n / 2), -7, n + 3, 10 * n]) {
        const projection = track.project(point, hint);
        expect(projection.s).toBeCloseTo(expected.s, 9);
        expect(projection.lateral).toBeCloseTo(expected.lateral, 9);
      }
      expect(expected.s).toBeCloseTo(100, 2);
    });
  });

  describe('gridSlot', () => {
    const slots = Array.from({ length: RACER_COUNT }, (_, i) => track.gridSlot(i));

    it('place la grille derrière la ligne, sur la ligne droite, en deux colonnes décalées', () => {
      slots.forEach((slot, i) => {
        expect(slot.progress).toBeLessThan(0);
        if (i > 0) expect(slot.progress).toBeLessThan(slots[i - 1].progress);
        const projection = track.project(slot.position);
        expect(circularGap(projection.s, L + slot.progress, L)).toBeLessThan(0.01);
        expect(projection.lateral).toBeCloseTo(i % 2 === 0 ? 3.5 : -3.5, 6);
        expect(Math.abs(projection.lateral)).toBeLessThan(ROAD_HALF_WIDTH - KART_RADIUS);
        expect(
          Math.abs(wrapAngle(slot.heading - headingOf(projection.sample.tangent))),
        ).toBeLessThan(1e-6);
        expect(Math.abs(projection.sample.curvature)).toBeLessThan(1 / 200);
      });
      expect(slots[0].progress).toBe(-12);
    });

    it('suit la formule de grille : progress = −(12 + 7⌊i/2⌋ + 3,5 (i mod 2)), ±3,5 m, pole à gauche', () => {
      expect(slots.map((slot) => slot.progress)).toEqual([
        -12, -15.5, -19, -22.5, -26, -29.5, -33, -36.5,
      ]);
      slots.forEach((slot, i) => {
        const sample = track.sampleAt(slot.progress);
        const lateral = i % 2 === 0 ? 3.5 : -3.5;
        expect(
          distance(slot.position, addScaled(sample.position, sample.left, lateral)),
        ).toBeLessThan(1e-9);
        expect(slot.heading).toBe(headingOf(sample.tangent));
        // Colonne paire à gauche du pilote (convention leftOf du cap), colonne impaire à droite.
        const offset = {
          x: slot.position.x - sample.position.x,
          z: slot.position.z - sample.position.z,
        };
        expect(dot(offset, leftOf(slot.heading))).toBeCloseTo(lateral, 9);
      });
    });

    it('espace les emplacements d’au moins 2,5 m', () => {
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          expect(distance(slots[i].position, slots[j].position)).toBeGreaterThanOrEqual(2.5);
        }
      }
    });

    it('est compatible avec les fabriques de test (course de 8 pilotes)', () => {
      const race = createTestRace(track, RACER_COUNT);
      for (const racer of race.racers) {
        expect(racer.progress).toBeLessThan(0);
        expect(Math.abs(racer.kart.lateral)).toBeCloseTo(3.5, 6);
      }
    });
  });

  describe('itemBoxRows', () => {
    it('place 3 rangées croissantes sur des portions quasi droites, près de 18 %, 50 % et 80 % du tour', () => {
      const rows = track.itemBoxRows;
      expect(rows.length).toBe(3);
      [0.18, 0.5, 0.8].forEach((fraction, k) => {
        expect(rows[k]).toBeGreaterThanOrEqual(0);
        expect(rows[k]).toBeLessThan(L);
        if (k > 0) expect(rows[k]).toBeGreaterThan(rows[k - 1]);
        expect(circularGap(rows[k], fraction * L, L)).toBeLessThanOrEqual(40);
        for (let d = -5; d <= 5; d++)
          expect(Math.abs(track.sampleAt(rows[k] + d).curvature)).toBeLessThan(1 / 60);
      });
    });

    it('retient, pour chaque rangée, l’abscisse quasi droite la plus proche de la cible', () => {
      const straightAround = (s: number): boolean => {
        for (let d = -5; d <= 5; d++)
          if (Math.abs(track.sampleAt(s + d).curvature) >= 1 / 60) return false;
        return true;
      };
      [0.18, 0.5, 0.8].forEach((fraction, k) => {
        const target = fraction * L;
        const gap = circularGap(track.itemBoxRows[k], target, L);
        // La recherche avance par pas de 1 m : aucun candidat plus proche ne convient.
        for (let d = 0; d < gap - 1e-9; d++) {
          expect(straightAround(target + d)).toBe(false);
          expect(straightAround(target - d)).toBe(false);
        }
      });
    });
  });

  describe('trackOutline', () => {
    it('renvoie la ligne médiane sous-échantillonnée, refermée sur son premier point', () => {
      const outline = trackOutline(track);
      expect(outline.length).toBe(Math.ceil(n / 8) + 1);
      expect(outline[outline.length - 1]).toEqual(outline[0]);
      let perimeter = 0;
      for (let k = 0; k < outline.length - 1; k++) {
        expect(outline[k]).toEqual(samples[k * 8].position);
        const d = distance(outline[k], outline[k + 1]);
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThanOrEqual(8 * step + 1e-6);
        perimeter += d;
      }
      expect(perimeter / L).toBeGreaterThan(0.98);
      expect(perimeter / L).toBeLessThanOrEqual(1);
    });

    it('fonctionne avec n’importe quel TrackQuery et un pas personnalisé', () => {
      const circle = createCircleTrack(60);
      const outline = trackOutline(circle, 4);
      expect(outline.length).toBe(Math.ceil(circle.samples.length / 4) + 1);
      expect(outline[outline.length - 1]).toEqual(outline[0]);
      for (const point of outline) expect(distance(point, { x: 0, z: 0 })).toBeCloseTo(60, 6);
    });

    it('ramène un pas invalide (0, négatif, NaN) à un point par échantillon', () => {
      for (const invalid of [0, -3, Number.NaN])
        expect(trackOutline(track, invalid)).toHaveLength(n + 1);
    });

    it('renvoie des copies (modifier le tracé ne touche pas le circuit)', () => {
      const outline = trackOutline(track);
      outline[0].x += 1000;
      expect(samples[0].position.x).not.toBe(outline[0].x);
    });
  });
});
