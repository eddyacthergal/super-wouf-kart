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
    const turn = wrapAngle(
      headingOf(track.sampleAt(20).tangent) - headingOf(track.sampleAt(10).tangent),
    );
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

describe('createCircleTrack — relief', () => {
  it('est plat par défaut', () => {
    const track = createCircleTrack(100);
    // toBeCloseTo : tan(0) donne −0, que toEqual distinguerait de 0.
    const surface = track.surfaceAt(40, 3);
    expect(surface.height).toBeCloseTo(0, 12);
    expect(surface.gradient.x).toBeCloseTo(0, 12);
    expect(surface.gradient.z).toBeCloseTo(0, 12);
    expect(track.samples.every((sample) => sample.height === 0 && sample.bank === 0)).toBe(true);
  });

  it('monte de `grade` par mètre et penche de `bank`', () => {
    const track = createCircleTrack(2000, 'left', { height: 5, grade: 0.1, bank: 0.2 });
    expect(track.sampleAt(30).height).toBeCloseTo(8, 6);
    expect(track.surfaceAt(30, 4).height).toBeCloseTo(8 - 4 * Math.tan(0.2), 6);
  });
});
