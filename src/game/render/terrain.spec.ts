import { describe, expect, it } from 'vitest';
import { createCircleTrack } from '../testing/fake-track';
import { createHillyTrack as hilly } from '../testing/hilly-track';
import { createGardenTrack } from '../track/track';
import { FLAT_TERRAIN, TERRAIN_FADE, createTerrain } from './terrain';

describe('createTerrain', () => {
  it('circuit plat : aucun relief, hauteur nulle partout', () => {
    const terrain = createTerrain(createGardenTrack());
    expect(terrain.hilly).toBe(false);
    expect(terrain.heightAt(10, 20)).toBe(0);
    expect(FLAT_TERRAIN.groundAt(1, 2)).toBe(0);
  });

  it("sous la route, jamais au-dessus, même au bord intérieur d'un virage relevé", () => {
    const track = hilly();
    const terrain = createTerrain(track);
    expect(terrain.hilly).toBe(true);
    for (let s = 0; s < track.length; s += 3) {
      const sample = track.sampleAt(s);
      for (let lateral = -sample.halfWidth; lateral <= sample.halfWidth; lateral += 1) {
        const x = sample.position.x + sample.left.x * lateral;
        const z = sample.position.z + sample.left.z * lateral;
        const road = track.surfaceAt(s, lateral).height;
        expect(terrain.heightAt(x, z)).toBeLessThanOrEqual(road - 0.05);
        expect(terrain.groundAt(x, z)).toBeCloseTo(road, 1);
      }
    }
  });

  it('redescend au niveau 0 au-delà des haies + 40 m', () => {
    const track = hilly();
    const terrain = createTerrain(track);
    const sample = track.sampleAt(track.length / 2);
    const far = track.wallHalfWidth + TERRAIN_FADE + 2;
    const x = sample.position.x - sample.left.x * far;
    const z = sample.position.z - sample.left.z * far;
    expect(terrain.heightAt(x, z)).toBeCloseTo(0, 6);
  });

  it('varie sans saut au-delà des haies (pas de falaise)', () => {
    const track = hilly();
    const terrain = createTerrain(track);
    const sample = track.sampleAt(track.length / 2);
    let previous = terrain.heightAt(
      sample.position.x - sample.left.x * (track.wallHalfWidth + 0.5),
      sample.position.z - sample.left.z * (track.wallHalfWidth + 0.5),
    );
    for (let d = track.wallHalfWidth + 1; d < track.wallHalfWidth + TERRAIN_FADE; d += 1) {
      const h = terrain.heightAt(
        sample.position.x - sample.left.x * d,
        sample.position.z - sample.left.z * d,
      );
      expect(Math.abs(h - previous)).toBeLessThan(1);
      previous = h;
    }
  });

  it("fonctionne avec n'importe quel TrackQuery", () => {
    const terrain = createTerrain(createCircleTrack(300, 'left', { height: 3 }));
    expect(terrain.groundAt(300, 0)).toBeCloseTo(3, 3);
  });
});
