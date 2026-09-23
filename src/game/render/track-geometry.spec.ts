import { describe, expect, it } from 'vitest';
import { createCircleTrack } from '../testing/fake-track';
import {
  corridorClearance,
  distanceToSamples,
  offsetRing,
  resampleRing,
  trackBounds,
} from './track-geometry';

describe('track-geometry', () => {
  it('décale la boucle vers la gauche du circuit pour un décalage positif', () => {
    // Circuit tournant à gauche : la gauche pointe vers le centre du cercle.
    const left = createCircleTrack(60, 'left');
    for (const point of offsetRing(left, 10)) expect(Math.hypot(point.x, point.z)).toBeCloseTo(50);
    for (const point of offsetRing(left, -10)) expect(Math.hypot(point.x, point.z)).toBeCloseTo(70);
    // Tournant à droite : la gauche pointe vers l'extérieur.
    const right = createCircleTrack(60, 'right');
    for (const point of offsetRing(right, 10)) expect(Math.hypot(point.x, point.z)).toBeCloseTo(70);
  });

  it('répartit régulièrement les points d’une boucle, en nombre pair si demandé', () => {
    const ring = offsetRing(createCircleTrack(60), 0);
    const points = resampleRing(ring, 2, true);
    expect(points.length % 2).toBe(0);
    expect(points.length).toBeGreaterThan(180);
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(2, 1);
      expect(Math.hypot(a.dx, a.dz)).toBeCloseTo(1, 6);
      expect(a.fraction).toBeGreaterThanOrEqual(0);
      expect(a.fraction).toBeLessThan(1);
    }
  });

  it('renvoie une liste vide pour une boucle dégénérée ou un pas invalide (pas de NaN)', () => {
    expect(resampleRing([], 1)).toEqual([]);
    expect(resampleRing([{ x: 1, z: 1 }], 1)).toEqual([]);
    expect(
      resampleRing(
        [
          { x: 2, z: 3 },
          { x: 2, z: 3 },
          { x: 2, z: 3 },
        ],
        1,
      ),
    ).toEqual([]);
    const ring = offsetRing(createCircleTrack(60), 0);
    expect(resampleRing(ring, 0)).toEqual([]);
    expect(resampleRing(ring, Number.NaN)).toEqual([]);
  });

  it('minore prudemment la distance à la ligne médiane', () => {
    const track = createCircleTrack(60);
    // Point au centre du cercle : à 60 m de la ligne médiane.
    expect(distanceToSamples(track, 0, 0)).toBeCloseTo(60, 6);
    const clearance = corridorClearance(track, 0, 0);
    expect(clearance).toBeLessThanOrEqual(60);
    expect(clearance).toBeGreaterThan(59);
    const bounds = trackBounds(track, 5);
    expect(bounds.minX).toBeCloseTo(-65, 1);
    expect(bounds.maxZ).toBeCloseTo(65, 1);
  });
});
