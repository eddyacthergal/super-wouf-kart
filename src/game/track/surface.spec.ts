import { describe, expect, it } from 'vitest';
import { ROAD_HALF_WIDTH } from '../core/constants';
import type { TrackSample } from '../core/types';
import { surfaceOf } from './surface';

const sample = (overrides: Partial<TrackSample> = {}): TrackSample => ({
  s: 0,
  position: { x: 0, z: 0 },
  tangent: { x: 0, z: 1 },
  left: { x: 1, z: 0 },
  halfWidth: ROAD_HALF_WIDTH,
  curvature: 0,
  height: 3,
  grade: 0.1,
  bank: 0.2,
  ...overrides,
});

describe('surfaceOf', () => {
  it('hauteur de la ligne médiane, bord gauche plus bas quand le dévers est positif', () => {
    expect(surfaceOf(sample(), 0).height).toBeCloseTo(3, 9);
    expect(surfaceOf(sample(), 5).height).toBeCloseTo(3 - 5 * Math.tan(0.2), 9);
    expect(surfaceOf(sample(), -5).height).toBeCloseTo(3 + 5 * Math.tan(0.2), 9);
  });

  it('gradient : pente le long de la tangente, dévers le long de la gauche', () => {
    const { gradient } = surfaceOf(sample(), 2);
    // Tangente +z : ∂h/∂z = grade ; gauche +x : ∂h/∂x = −tan(bank).
    expect(gradient.z).toBeCloseTo(0.1, 9);
    expect(gradient.x).toBeCloseTo(-Math.tan(0.2), 9);
  });
});
