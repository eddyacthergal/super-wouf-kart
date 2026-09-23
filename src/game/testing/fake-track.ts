/**
 * Circuits analytiques pour les tests unitaires (aucune dépendance au vrai circuit).
 * Un cercle de rayon R parcouru vers la gauche (courbure +1/R) ou vers la droite (courbure -1/R).
 * Avec un grand rayon (ex. 2000 m), on obtient une quasi-ligne droite.
 */
import { ROAD_HALF_WIDTH, WALL_HALF_WIDTH } from '../core/constants';
import type { GridSlot, TrackProjection, TrackQuery, TrackSample } from '../core/types';
import { add, headingOf, scale, type Vec2 } from '../core/vec2';

export type TurnDirection = 'left' | 'right';

export function createCircleTrack(radius = 60, direction: TurnDirection = 'left'): TrackQuery {
  const length = 2 * Math.PI * radius;
  const sign = direction === 'left' ? 1 : -1;
  const wrapS = (s: number): number => ((s % length) + length) % length;

  const sampleAt = (sRaw: number): TrackSample => {
    const s = wrapS(sRaw);
    const phi = s / radius;
    // Gauche : P = (R cos φ, -R sin φ), la gauche pointe vers le centre.
    // Droite : P = (R cos φ, R sin φ), la gauche pointe vers l'extérieur.
    const position: Vec2 = { x: radius * Math.cos(phi), z: sign * -radius * Math.sin(phi) };
    const tangent: Vec2 = { x: -Math.sin(phi), z: sign * -Math.cos(phi) };
    const left: Vec2 = { x: tangent.z, z: -tangent.x };
    return { s, position, tangent, left, halfWidth: ROAD_HALF_WIDTH, curvature: sign / radius };
  };

  const count = Math.max(8, Math.round(length));
  const samples: TrackSample[] = [];
  for (let i = 0; i < count; i++) samples.push(sampleAt((i / count) * length));

  const project = (point: Vec2): TrackProjection => {
    const phi = Math.atan2(sign * -point.z, point.x);
    const s = wrapS(phi * radius);
    const sample = sampleAt(s);
    const r = Math.hypot(point.x, point.z);
    const lateral = direction === 'left' ? radius - r : r - radius;
    const index = Math.round((s / length) * count) % count;
    return { s, lateral, index, sample };
  };

  const gridSlot = (index: number): GridSlot => {
    const progress = -(10 + Math.floor(index / 2) * 7 + (index % 2) * 3.5);
    const sample = sampleAt(progress);
    const lateral = index % 2 === 0 ? 3.5 : -3.5;
    return { position: add(sample.position, scale(sample.left, lateral)), heading: headingOf(sample.tangent), progress };
  };

  return {
    length,
    wallHalfWidth: WALL_HALF_WIDTH,
    samples,
    sampleAt,
    project,
    gridSlot,
    itemBoxRows: [length * 0.25, length * 0.6],
  };
}
