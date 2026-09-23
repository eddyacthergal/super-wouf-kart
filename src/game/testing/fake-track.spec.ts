import { describe, expect, it } from 'vitest';
import { addScaled, distance, headingOf, wrapAngle } from '../core/vec2';
import { createCircleTrack } from './fake-track';
import { createTestRace } from './fixtures';

describe.each(['left', 'right'] as const)('createCircleTrack (%s)', (direction) => {
  const track = createCircleTrack(60, direction);

  it('la tangente suit la ligne médiane', () => {
    const a = track.sampleAt(10);
    const b = track.sampleAt(11);
    expect(distance(addScaled(a.position, a.tangent, 1), b.position)).toBeLessThan(0.01);
  });

  it('le cap tourne dans le sens annoncé par la courbure', () => {
    const turn = wrapAngle(headingOf(track.sampleAt(20).tangent) - headingOf(track.sampleAt(10).tangent));
    expect(Math.sign(turn)).toBe(Math.sign(track.sampleAt(10).curvature));
    expect(Math.sign(turn)).toBe(direction === 'left' ? 1 : -1);
  });

  it('project retrouve s et le décalage latéral', () => {
    const sample = track.sampleAt(42);
    const projection = track.project(addScaled(sample.position, sample.left, 3));
    expect(projection.s).toBeCloseTo(42, 3);
    expect(projection.lateral).toBeCloseTo(3, 3);
  });

  it('la grille est derrière la ligne, sur la route', () => {
    const race = createTestRace(track, 8);
    for (const racer of race.racers) {
      expect(racer.progress).toBeLessThan(0);
      expect(Math.abs(track.project(racer.kart.position).lateral)).toBeLessThan(7);
    }
  });
});
