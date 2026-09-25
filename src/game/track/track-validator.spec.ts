import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../core/vec2';
import { GRAND_JARDIN } from './circuits/grand-jardin';
import { Track, createTrack } from './track';
import { TRACK_RULES, validateTrack } from './track-validator';

/** Stade : deux lignes droites de `straight` m reliées par deux demi-cercles de rayon `radius`. */
function stadium(straight: number, radius: number, pointsPerBend = 12): Vec2[] {
  const points: Vec2[] = [];
  const half = straight / 2;
  // Départ au milieu de la ligne droite du bas, sens trigonométrique (virages à gauche).
  for (let x = 0; x < half; x += 20) points.push({ x, z: -radius });
  for (let k = 0; k <= pointsPerBend; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / pointsPerBend;
    points.push({ x: half + radius * Math.cos(a), z: radius * Math.sin(a) });
  }
  for (let x = half - 20; x > -half; x -= 20) points.push({ x, z: radius });
  for (let k = 0; k <= pointsPerBend; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / pointsPerBend;
    points.push({ x: -half + radius * Math.cos(a), z: radius * Math.sin(a) });
  }
  for (let x = -half + 20; x < 0; x += 20) points.push({ x, z: -radius });
  return points;
}

const rules = (track: Track): string[] => validateTrack(track).map((issue) => issue.rule);

describe('validateTrack', () => {
  it('accepte le Grand Jardin', () => {
    expect(validateTrack(createTrack(GRAND_JARDIN))).toEqual([]);
  });

  it('accepte un stade bien proportionné', () => {
    expect(validateTrack(new Track(stadium(240, 45)))).toEqual([]);
  });

  it('refuse un tour trop court ou trop long', () => {
    expect(rules(new Track(stadium(60, 40)))).toContain('minLength');
    expect(rules(new Track(stadium(300, 200)))).toContain('minLength');
  });

  it('refuse un virage trop serré', () => {
    expect(rules(new Track(stadium(300, 10)))).toContain('minRadius');
  });

  it('refuse deux portions du tracé trop proches', () => {
    // Stade très étroit : les deux lignes droites sont à 2 × 12 m, moins que deux murs + 6 m.
    expect(rules(new Track(stadium(360, 12)))).toContain('corridorGap');
  });

  it('refuse un circuit qui dépasse la zone de jeu', () => {
    expect(rules(new Track(stadium(420, 40)))).toContain('maxExtent');
  });

  it('refuse une boucle en 8', () => {
    const eight: Vec2[] = Array.from({ length: 48 }, (_, k) => {
      const t = (2 * Math.PI * k) / 48;
      return { x: 150 * Math.sin(t), z: 75 * Math.sin(2 * t) };
    });
    expect(rules(new Track(eight))).toContain('loop');
  });

  it('refuse un départ en virage', () => {
    const circle: Vec2[] = Array.from({ length: 32 }, (_, k) => {
      const t = (2 * Math.PI * k) / 32;
      return { x: 120 * Math.cos(t), z: 120 * Math.sin(t) };
    });
    expect(rules(new Track(circle))).toContain('straightBefore');
  });

  it('expose ses seuils (rayon minimal 16 m, murs compris dans ±230 m)', () => {
    expect(TRACK_RULES.minRadius).toBe(16);
    expect(TRACK_RULES.maxExtent).toBe(230);
  });
});
